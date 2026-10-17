// Server-side context-window builder — the single source of truth for what the AI receives.
// Both the chat proxy and the context preview endpoint use this, so what you SEE
// in the Context panel is EXACTLY what gets sent to the provider.
import { db } from '@/lib/db'
import { buildSystemPrompt } from '@/lib/prompts'
import { stripActivity } from '@/lib/activity'
import type { ChatMode, ContextPreview, ContextStats } from '@/lib/types'

export interface ContextMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Rough token estimate — ~4 chars per token. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

export const DEFAULT_CONTEXT_LIMIT = 20
export const MAX_CONTEXT_LIMIT = 60
/** Hard cap on auto-expanded windows (token budget permitting). */
export const MAX_AUTO_MESSAGES = 200

/**
 * Output-token budget for a known context window: reserve up to 25% for the
 * reply (clamped to a sane 1k–8k range so tiny and huge windows both work).
 */
export function outputBudgetFor(contextLength: number): number {
  return Math.min(8192, Math.max(1024, Math.floor(contextLength * 0.25)))
}

/**
 * Auto-expand the message window to use the model's detected context window:
 * take the newest messages while the estimated token count (incl. the system
 * prompt) stays inside the window minus the output budget. Never returns
 * fewer than `baseLimit` (the user's explicit session setting wins as a floor).
 */
export function autoExpandLimit(
  messages: Array<{ content: string }>,
  baseLimit: number,
  contextLength: number,
  systemChars: number
): number {
  const budgetChars = (contextLength - outputBudgetFor(contextLength) - 512) * 4
  let chars = systemChars
  let count = 0
  for (let i = messages.length - 1; i >= 0 && count < MAX_AUTO_MESSAGES; i--) {
    const add = messages[i].content.length
    if (chars + add > budgetChars && count >= baseLimit) break
    chars += add
    count++
  }
  return Math.max(count, Math.min(baseLimit, messages.length))
}

/**
 * Load a session and build its context window:
 * - system prompt (mode + project aware)
 * - all messages, minus excluded ones, keeping only the last `contextLimit`
 *   (auto-expanded to the model's detected context window when available)
 * - stats (included / total / excluded / limit / estTokens)
 */
export async function buildSessionContext(
  sessionId: string,
  opts: { modelContextLength?: number | null } = {}
): Promise<ContextPreview | null> {
  const session = await db.chatSession.findUnique({
    where: { id: sessionId },
    include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  })
  if (!session) return null

  let projectName: string | null = null
  let projectKind: string | null = null
  if (session.projectId) {
    const project = await db.project.findUnique({ where: { id: session.projectId } })
    if (project) {
      projectName = project.name
      projectKind = project.kind
    }
  }

  const baseLimit = Math.min(
    Math.max(session.contextLimit || DEFAULT_CONTEXT_LIMIT, 1),
    MAX_CONTEXT_LIMIT
  )
  const all = session.messages.map((m) => ({ ...m, content: stripActivity(m.content) }))
  const eligible = all.filter((m) => !m.excluded)

  const system = buildSystemPrompt(session.mode as ChatMode, { projectName, projectKind })

  // Auto-detect: when the model's context window is known, grow the window to
  // fill it (respecting the output budget) instead of stopping at the session
  // limit — but never send FEWER messages than the user configured.
  const ctxLen = opts.modelContextLength && opts.modelContextLength > 1000 ? opts.modelContextLength : null
  const limit = ctxLen
    ? autoExpandLimit(eligible, baseLimit, ctxLen, system.length)
    : baseLimit
  const included = eligible.slice(-limit)
  const includedIds = new Set(included.map((m) => m.id))

  const chars = system.length + included.reduce((n, m) => n + m.content.length, 0)

  const stats: ContextStats = {
    included: included.length,
    total: all.length,
    excluded: all.length - eligible.length,
    limit,
    estTokens: estimateTokens(chars),
    ...(ctxLen ? { contextWindow: { length: ctxLen, output: outputBudgetFor(ctxLen), trimmed: 0 } } : {}),
  }

  return {
    system,
    contextLimit: limit,
    stats,
    messages: all.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      inContext: includedIds.has(m.id),
      excluded: m.excluded,
      createdAt: m.createdAt.toISOString(),
    })),
    llmMessages: included.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  }
}
