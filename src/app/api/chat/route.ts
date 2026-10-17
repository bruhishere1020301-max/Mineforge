import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  streamChatCompletion,
  chatCompletionWithTools,
  type ToolSpec,
  type ToolMessage,
} from '@/lib/server/llm'
import { getMcpTools, callMcpTool, type McpServerConfig, type McpTool } from '@/lib/server/mcp-client'
import {
  FILE_TOOL_SPECS,
  FILE_TOOLS_SERVER,
  isFileTool,
  callFileTool,
  resolveProjectRoot,
} from '@/lib/server/file-tools'
import {
  verifyGeneratedText,
  buildRepairPrompt,
  spliceRepairs,
  issuesToLines,
  type FileIssue,
} from '@/lib/server/verify'
import { buildSessionContext, estimateTokens, outputBudgetFor, type ContextMessage } from '@/lib/server/context'
import { encodeActivity, type ActivityEntry, type ActivityDiffLine } from '@/lib/activity'
import { buildSystemPrompt } from '@/lib/prompts'
import type { ContextStats, ProviderType } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const chatSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1).max(200),
  mode: z.enum(['single', 'datapack', 'mod', 'shader']).default('mod'),
  projectName: z.string().max(120).nullable().optional(),
  projectKind: z.string().max(40).nullable().optional(),
  // Active project id — enables the built-in file tools (create/edit/delete)
  // whenever the folder is reachable from the server (desktop app / dev).
  projectId: z.string().max(64).nullable().optional(),
  // The model's context window in tokens (auto-detected from the provider's
  // model list) — the server then sizes input window + output budget to it.
  contextLength: z.number().int().positive().max(100_000_000).nullable().optional(),
  // --- Real context window path ---
  // When sessionId + content are given, the SERVER persists the user message and
  // builds the context from the session's stored history (window size + exclusions
  // are respected). This is exactly what the Context panel previews.
  sessionId: z.string().nullable().optional(),
  content: z.string().min(1).max(200_000).optional(),
  // --- Legacy / stateless fallback (no session yet) ---
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      })
    )
    .min(1)
    .max(200)
    .optional(),
})

const jsonHeaders = { 'Content-Type': 'application/json' }

/* ------------------------------------------------------------------ */
/* MCP tool gathering                                                  */
/* ------------------------------------------------------------------ */

interface McpDbServer {
  id: string
  name: string
  transport: string
  url: string | null
  command: string | null
  args: string | null
  env: string | null
}

function toMcpConfig(s: McpDbServer): McpServerConfig {
  return {
    id: s.id,
    transport: s.transport === 'stdio' ? 'stdio' : 'http',
    url: s.url,
    command: s.command,
    args: s.args,
    env: s.env,
  }
}

interface McpEntry {
  server: McpDbServer
  tool: McpTool
  callName: string
}

/** Collect tools from every ENABLED MCP server (best-effort; failures are skipped). */
async function gatherMcpTools(): Promise<McpEntry[]> {
  const servers = await db.mcpServer.findMany({ where: { enabled: true } })
  const entries: McpEntry[] = []
  const used = new Set<string>()
  for (const s of servers) {
    let tools: McpTool[] = []
    try {
      tools = await getMcpTools(toMcpConfig(s))
    } catch {
      continue
    }
    const slug = (s.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'server').slice(0, 24)
    for (const t of tools) {
      const base = `mcp_${slug}_${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
      let callName = base
      let i = 2
      while (used.has(callName)) callName = `${base}_${i++}`.slice(0, 64)
      used.add(callName)
      entries.push({ server: s, tool: t, callName })
    }
  }
  return entries
}

const MCP_SYSTEM_ADDON = `

## MCP tools
You have MCP (Model Context Protocol) tools available — their names start with mcp_. Call them whenever they help:
looking up current loader/API versions, checking the correct project layout, searching the modding wiki, or anything
else they expose. After receiving tool results, you MUST still produce your final answer in the required file-block
output format. Do not call tools for information you are already certain about.`

const FILE_TOOLS_ADDON = `

## Project file tools (live folder access)
The user's project folder "${'{PROJECT_NAME}'}" is connected directly on this machine, so you can manage its files
yourself with these tools instead of asking the user to save anything:
- list_project_files(path?, depth?) — browse folders (omit path for the project root)
- read_project_file(path) — inspect an existing file before changing it
- write_project_file(path, content) — create a new file or fully overwrite one (parent folders are auto-created)
- edit_project_file(path, old_text, new_text) — surgical edit; old_text must be unique, so include context lines
- delete_project_file(path) — remove a wrong or obsolete file (folders cannot be deleted)
- build_mod_project() — run "gradlew build" in the project folder and return the compiler output (jar lands in build/libs/)

Rules:
- All paths are RELATIVE to the project folder and sandboxed; never use "..", absolute paths or drive letters.
- After every write/edit the system runs the automatic self-check on the result and returns its verdict to you —
  if it reports problems, fix them immediately (usually with edit_project_file) before finishing.
- Read a file back when you are unsure about its current content.
- In your final answer, briefly list every file you created/edited/deleted. Emit a file block ONLY for brand-new
  files you want to show as preview cards; files changed through tools do not need to be repeated as blocks.`

const SELF_CHECK_ADDON = `

## Automatic error self-check
Before finishing, review every file you produce for faulty scripts and errors: valid JSON, balanced braces/brackets/
parens, terminated strings and comments, correct paths/imports, no merge-conflict markers, and commands/entries that
match the target Minecraft/loader version. The system re-runs these checks deterministically after your reply and,
when it finds problems, sends you a repair request listing each one — answer it with the complete corrected files.`

/**
 * POST /api/chat — streaming proxy to the user's own provider
 * (OpenAI-compatible /chat/completions, Anthropic-compatible /v1/messages,
 * or a local AI server like Ollama / LM Studio).
 *
 * When MCP servers with tools are enabled, this runs a tool-calling agent loop:
 * the model can call MCP tools mid-generation, see their results, and then
 * produce the final answer.
 *
 * SSE events:
 *  data: {"type":"meta","context":{…},"model":"…","mcpTools":N}
 *  data: {"type":"tool_start","server":"…","tool":"…"}
 *  data: {"type":"tool","server":"…","tool":"…","result":"…"}
 *  data: {"type":"text","text":"…"}
 *  data: {"type":"note","kind":"reasoning|working","text":"…"}  (live thinking)
 *  data: {"type":"replace","text":"…"}          (self-check rewrote the reply)
 *  data: {"type":"error","message":"…"}
 *  data: {"type":"done"}
 *
 * Tool events cover MCP tools, the built-in project file tools
 * (create/edit/delete, server: "Project files") and the automatic
 * "Self-check" scan (deterministic faulty-script detection + one repair round).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = chatSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid chat payload' }), { status: 400, headers: jsonHeaders })
  }
  const { providerId, model, mode } = parsed.data
  // Model context window (auto-detected client-side from the model list).
  const modelCtxLen =
    parsed.data.contextLength && parsed.data.contextLength > 1000 ? parsed.data.contextLength : null

  const provider = await db.provider.findUnique({ where: { id: providerId } })
  if (!provider) {
    return new Response(
      JSON.stringify({ error: 'Provider not found — add one in AI Models first.' }),
      { status: 404, headers: jsonHeaders }
    )
  }

  // ---- build the context window -------------------------------------------------
  let system: string
  let history: ContextMessage[]
  let stats: ContextStats
  let sessionId: string | null = null
  let sessionProjectId: string | null = null

  if (parsed.data.sessionId && parsed.data.content) {
    // Real context path: persist the user message server-side, then build context from the DB.
    sessionId = parsed.data.sessionId
    const session = await db.chatSession.findUnique({ where: { id: sessionId } })
    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404, headers: jsonHeaders })
    }
    sessionProjectId = session.projectId
    await db.chatMessage.create({
      data: { sessionId, role: 'user', content: parsed.data.content },
    })
    const ctx = await buildSessionContext(sessionId, { modelContextLength: modelCtxLen })
    if (!ctx) {
      return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404, headers: jsonHeaders })
    }
    system = ctx.system
    history = ctx.llmMessages
    stats = ctx.stats
  } else if (parsed.data.messages) {
    // Stateless fallback: no session — send what the client has.
    history = parsed.data.messages.map((m) => ({ role: m.role, content: m.content }))
    system = buildSystemPrompt(mode, {
      projectName: parsed.data.projectName ?? null,
      projectKind: parsed.data.projectKind ?? null,
    })
    stats = {
      included: history.length,
      total: history.length,
      excluded: 0,
      limit: history.length,
      estTokens: estimateTokens(system.length + history.reduce((n, m) => n + m.content.length, 0)),
    }
  } else {
    return new Response(JSON.stringify({ error: 'Nothing to send' }), { status: 400, headers: jsonHeaders })
  }

  // ---- context-window auto-fit --------------------------------------------------
  // When the model's context window is known, reserve an output budget and
  // trim the OLDEST messages until the estimated input fits inside it.
  let maxOutTokens = 8192
  let trimmedMessages = 0
  if (modelCtxLen) {
    maxOutTokens = outputBudgetFor(modelCtxLen)
    const budgetChars = (modelCtxLen - maxOutTokens - 512) * 4
    let chars = system.length + history.reduce((n, m) => n + m.content.length, 0)
    while (chars > budgetChars && history.length > 2) {
      chars -= history[0].content.length
      history = history.slice(1)
      trimmedMessages++
    }
    stats = {
      ...stats,
      included: history.length,
      estTokens: estimateTokens(system.length + history.reduce((n, m) => n + m.content.length, 0)),
      contextWindow: { length: modelCtxLen, output: maxOutTokens, trimmed: trimmedMessages },
    }
  }

  // ---- MCP tools available to the AI --------------------------------------------
  const mcpEntries = await gatherMcpTools()
  const mcpSpecs: ToolSpec[] = mcpEntries.map((e) => ({
    name: e.callName,
    description: `[${e.server.name}] ${e.tool.description ?? 'MCP tool'}`,
    inputSchema:
      (e.tool.inputSchema && typeof e.tool.inputSchema === 'object'
        ? (e.tool.inputSchema as Record<string, unknown>)
        : { type: 'object', properties: {} }),
  }))

  // ---- built-in project file tools (create / edit / delete) ----------------------
  // Enabled when the active project's folder is reachable from this server —
  // always true in the desktop app, never for browser-only (FSA) folders.
  const effectiveProjectId = parsed.data.projectId ?? sessionProjectId ?? null
  const projectRoot = effectiveProjectId ? await resolveProjectRoot(effectiveProjectId) : null
  const fileSpecs: ToolSpec[] = projectRoot ? FILE_TOOL_SPECS : []
  const allSpecs: ToolSpec[] = [...mcpSpecs, ...fileSpecs]

  const systemWithTools =
    system +
    (mcpSpecs.length > 0 ? MCP_SYSTEM_ADDON : '') +
    (projectRoot ? FILE_TOOLS_ADDON.replace('{PROJECT_NAME}', projectRoot.name) : '') +
    SELF_CHECK_ADDON

  const providerType = provider.type as ProviderType

  // ---- stream --------------------------------------------------------------------
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = ''
      // Cline-style transparency: thinking + file operations + check results,
      // streamed live and persisted inside the reply (stripped before context).
      const activity: ActivityEntry[] = []
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        // first event: exactly what's in the context window for this request
        send({ type: 'meta', context: stats, model, mcpTools: allSpecs.length })

        // ---- shared helpers -----------------------------------------------------------

        /** Ask the model for corrected file blocks and splice them into `text`. */
        const repairText = async (text: string, issues: FileIssue[]): Promise<string | null> => {
          let repaired = ''
          for await (const ev of streamChatCompletion({
            type: providerType,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model,
            system,
            messages: [
              ...history,
              { role: 'assistant' as const, content: text },
              { role: 'user' as const, content: buildRepairPrompt(issues) },
            ],
            maxTokens: maxOutTokens,
            signal: req.signal,
          })) {
            if (ev.type === 'error') return null
            if (ev.type === 'text' && ev.text) repaired += ev.text
          }
          if (!repaired.trim()) return null
          return spliceRepairs(text, repaired, new Set(issues.map((i) => i.path)))
        }

        /**
         * Deterministic self-check of `text` (+ leftovers from file-tool
         * writes). Problems trigger ONE repair round. Emits the
         * Self-check entries on the tool feed and returns the final text.
         */
        const runSelfCheck = async (
          text: string,
          leftover: Map<string, string[]> = new Map()
        ): Promise<{ text: string; label: string }> => {
          const { checked, issues } = verifyGeneratedText(text)
          if ((checked === 0 && leftover.size === 0) || req.signal.aborted) {
            return { text, label: '' }
          }
          send({ type: 'tool_start', server: 'Self-check', tool: 'scan generated files' })
          const leftoverLabel =
            leftover.size > 0
              ? `⚠️ ${leftover.size} tool-written file(s) still flagged: ${[...leftover.entries()].map(([p, pr]) => `${p} → ${pr.join('; ')}`).join(' | ')}`
              : ''
          let finalText = text
          let label: string
          if (issues.length === 0) {
            label = leftoverLabel || `✅ ${checked} file(s) checked — no problems found`
          } else {
            const fixed = await repairText(text, issues)
            if (fixed) {
              finalText = fixed
              const after = verifyGeneratedText(fixed)
              const fixedLabel = `🔧 ${issues.length} issue(s) fixed (${issuesToLines(issues, 3).join(' | ')})`
              label =
                after.issues.length === 0
                  ? leftoverLabel
                    ? `${fixedLabel} · ${leftoverLabel}`
                    : fixedLabel
                  : `⚠️ ${fixedLabel} — ${after.issues.length} file(s) still have issues`
            } else {
              label = `⚠️ ${issues.length} issue(s) could not be auto-fixed: ${issuesToLines(issues, 4).join(' | ')}`
            }
          }
          send({ type: 'tool', server: 'Self-check', tool: 'scan generated files', result: label.slice(0, 600) })
          activity.push({ kind: 'check', text: label, ok: !label.includes('⚠') })
          return { text: finalText, label }
        }

        /** Plain streaming path — also the fallback for providers without tool support. */
        const runPlainStream = async () => {
          let streamed = ''
          for await (const ev of streamChatCompletion({
            type: providerType,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model,
            system: systemWithTools,
            messages: history,
            maxTokens: maxOutTokens,
            signal: req.signal,
          })) {
            if (ev.type === 'text' && ev.text) {
              full += ev.text
              streamed += ev.text
              send({ type: 'text', text: ev.text })
            } else if (ev.type === 'reason' && ev.text) {
              // reasoning-model stream: show live thinking in the tool feed
              send({ type: 'note', kind: 'reasoning', text: ev.text })
              activity.push({ kind: 'thinking', text: ev.text })
            } else if (ev.type === 'error') {
              send({ type: 'error', message: ev.message ?? 'Provider error' })
            }
          }
          // Self-check after streaming — a repair round rewrites the whole
          // message via a `replace` event.
          if (!req.signal.aborted && streamed.trim()) {
            const before = full
            const res2 = await runSelfCheck(full)
            if (res2.text !== before) {
              full = res2.text
              send({ type: 'replace', text: res2.text })
            }
          }
        }

        if (allSpecs.length === 0) {
          // ---- plain streaming path (nothing to call) ---------------------------------
          await runPlainStream()
        } else {
          // ---- agent loop: MCP tools + built-in project file tools --------------------
          const work: ToolMessage[] = history.map((h) => ({ role: h.role, content: h.content }))
          let finalText = ''
          let fallbackToPlain = false
          // self-check problems reported on files written via file tools
          const writtenIssues = new Map<string, string[]>()
          let selfProdded = false
          const MAX_ROUNDS = 8

          for (let round = 0; round < MAX_ROUNDS; round++) {
            if (req.signal.aborted) break
            const res = await chatCompletionWithTools({
              type: providerType,
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              model,
              system: systemWithTools,
              messages: work,
              tools: allSpecs,
              maxTokens: maxOutTokens,
              signal: req.signal,
            })
            if (!res.ok) {
              if (round === 0 && mcpSpecs.length === 0) {
                // The provider cannot do tool calling — degrade gracefully.
                fallbackToPlain = true
                break
              }
              if (res.error !== 'aborted' && !req.signal.aborted) {
                send({ type: 'error', message: res.error })
              }
              break
            }
            const { text, toolCalls, reasoning } = res
            // Show the model's thinking/narration between tool rounds live.
            if (reasoning && reasoning.trim()) {
              send({ type: 'note', kind: 'reasoning', text: reasoning })
              activity.push({ kind: 'thinking', text: reasoning })
            }
            if (text && text.trim() && toolCalls.length > 0) {
              send({ type: 'note', kind: 'working', text: text.trim() })
              activity.push({ kind: 'thinking', text: text.trim() })
            }
            if (toolCalls.length === 0) {
              if (writtenIssues.size > 0 && !selfProdded) {
                // The model finished, but files it wrote still fail the
                // self-check — send the problems back for one fix round.
                selfProdded = true
                work.push({
                  role: 'user',
                  content:
                    'The automatic self-check still reports problems in files you wrote directly:\n' +
                    [...writtenIssues.entries()].map(([p, pr]) => `- ${p}: ${pr.join('; ')}`).join('\n') +
                    '\nFix them now with edit_project_file (or write_project_file), then reply with a short summary of what you fixed.',
                })
                continue
              }
              finalText = text
              break
            }
            // record the assistant's tool-call turn
            work.push({ role: 'assistant', content: text, toolCalls })
            // execute every requested tool
            for (const tc of toolCalls) {
              if (isFileTool(tc.name)) {
                send({ type: 'tool_start', server: FILE_TOOLS_SERVER, tool: tc.name })
                let result = ''
                let problems: string[] = []
                let summary = ''
                let op: 'create' | 'overwrite' | 'edit' | 'delete' | undefined
                let opPath = ''
                let diff: ActivityDiffLine[] | undefined = undefined
                if (!projectRoot) {
                  result = 'No project folder is connected — file tools are unavailable.'
                  summary = 'No project folder connected'
                } else {
                  try {
                    const r = await callFileTool(projectRoot.root, tc.name, tc.args)
                    result = r.result
                    problems = r.problems
                    summary = r.summary
                    op = r.op
                    opPath = r.path ?? ''
                    diff = r.diff
                    const rel = String(tc.args.path ?? '')
                    if (rel && (tc.name === 'write_project_file' || tc.name === 'edit_project_file')) {
                      if (problems.length > 0) writtenIssues.set(rel, problems)
                      else writtenIssues.delete(rel)
                    }
                  } catch (e) {
                    result = `TOOL ERROR: ${e instanceof Error ? e.message : 'file tool failed'}`
                    summary = `Error: ${(e instanceof Error ? e.message : 'file tool failed').slice(0, 140)}`
                  }
                }
                const forModel = result.length > 6000 ? `${result.slice(0, 6000)}\n…(truncated)` : result
                work.push({ role: 'tool', toolCallId: tc.id, content: forModel })
                if (op && summary) {
                  activity.push({ kind: 'file', op, path: opPath, summary, diff, problems })
                } else if (tc.name === 'build_mod_project' && summary) {
                  activity.push({ kind: 'check', text: summary, ok: summary.includes('succeeded') })
                } else if (summary.startsWith('Error:') || summary === 'No project folder connected') {
                  activity.push({ kind: 'check', text: `${tc.name}: ${summary}`, ok: false })
                }
                send({
                  type: 'tool',
                  server: FILE_TOOLS_SERVER,
                  tool: tc.name,
                  result: result.slice(0, 1500),
                  ...(summary ? { summary } : {}),
                  ...(op ? { op } : {}),
                  ...(opPath ? { path: opPath } : {}),
                  ...(diff ? { diff } : {}),
                })
                continue
              }
              const entry = mcpEntries.find((e) => e.callName === tc.name)
              if (!entry) {
                work.push({ role: 'tool', toolCallId: tc.id, content: `Unknown tool: ${tc.name}` })
                continue
              }
              send({ type: 'tool_start', server: entry.server.name, tool: entry.tool.name })
              let result = ''
              try {
                result = await callMcpTool(toMcpConfig(entry.server), entry.tool.name, tc.args)
              } catch (e) {
                result = `TOOL ERROR: ${e instanceof Error ? e.message : 'tool call failed'}`
              }
              const forModel = result.length > 6000 ? `${result.slice(0, 6000)}\n…(truncated)` : result
              work.push({ role: 'tool', toolCallId: tc.id, content: forModel })
              send({
                type: 'tool',
                server: entry.server.name,
                tool: entry.tool.name,
                result: result.slice(0, 600),
              })
            }
          }

          if (fallbackToPlain) {
            await runPlainStream()
          } else if (!req.signal.aborted) {
            if (finalText) {
              // self-check + at most one repair round BEFORE anything streams
              const res2 = await runSelfCheck(finalText, writtenIssues)
              full = res2.text
              // emit in small chunks so the UI keeps its streaming feel
              const size = 160
              for (let i = 0; i < full.length; i += size) {
                send({ type: 'text', text: full.slice(i, i + size) })
              }
            } else if (work.some((m) => m.role === 'tool')) {
              send({
                type: 'error',
                message: 'The model used tools but did not produce a final answer. Try again or rephrase the request.',
              })
            }
          }
        }

        send({ type: 'done' }) // safety net in case upstream ended without [DONE]
      } catch (e) {
        if (!req.signal.aborted) {
          send({ type: 'error', message: e instanceof Error ? e.message : 'Unexpected streaming error' })
        }
      } finally {
        // persist the assistant reply server-side (partial text is kept if the
        // user stopped early); activity travels inside the content marker and
        // is stripped again before the content ever reaches the model
        if (sessionId && full.trim()) {
          try {
            await db.chatMessage.create({ data: { sessionId, role: 'assistant', content: encodeActivity(full, activity) } })
            await db.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })
          } catch {
            // persistence is best-effort; the reply is already on screen
          }
        }
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
