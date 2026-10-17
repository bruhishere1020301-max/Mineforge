// Server-side helpers for talking to OpenAI-compatible and Anthropic-compatible APIs.
import type { ModelInfo, ProviderType } from '@/lib/types'

/** Normalize an OpenAI-compatible base URL and return the chat completions endpoint. */
export function openAiChatUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  b = b.replace(/\/chat\/completions$/, '')
  try {
    const u = new URL(b)
    // bare origin (e.g. https://api.openai.com) → append /v1
    if (!u.pathname || u.pathname === '/') b = `${u.origin}/v1`
  } catch {
    // not a valid URL; let the fetch fail naturally
  }
  return `${b}/chat/completions`
}

/** Normalize an OpenAI-compatible base URL and return the models endpoint. */
export function openAiModelsUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  b = b.replace(/\/(models|chat\/completions)$/, '')
  try {
    const u = new URL(b)
    if (!u.pathname || u.pathname === '/') b = `${u.origin}/v1`
  } catch {
    /* ignore */
  }
  return `${b}/models`
}

/** Normalize an Anthropic-compatible base URL and return the messages endpoint. */
export function anthropicMessagesUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  b = b.replace(/\/messages$/, '')
  try {
    const u = new URL(b)
    if (!u.pathname || u.pathname === '/') return `${u.origin}/v1/messages`
  } catch {
    /* ignore */
  }
  // already versioned (…/v1) or a proxied path — just append /messages
  return `${b}/messages`
}

/** Normalize an Anthropic-compatible base URL and return the models endpoint. */
export function anthropicModelsUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  b = b.replace(/\/(models|messages)$/, '')
  try {
    const u = new URL(b)
    if (!u.pathname || u.pathname === '/') return `${u.origin}/v1/models`
  } catch {
    /* ignore */
  }
  return `${b}/models`
}

export const ANTHROPIC_VERSION = '2023-06-01'

/** Fetch the list of models from a provider. Throws with a readable message on failure. */
export async function fetchProviderModels(
  type: ProviderType,
  baseUrl: string,
  apiKey: string
): Promise<ModelInfo[]> {
  const isAnthropic = type === 'anthropic'
  const url = isAnthropic ? anthropicModelsUrl(baseUrl) : openAiModelsUrl(baseUrl)
  const headers: Record<string, string> = {}
  if (isAnthropic) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = ANTHROPIC_VERSION
  } else if (apiKey) {
    // local AI (Ollama, LM Studio, llama.cpp…) often runs with no key at all
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
  } catch (e) {
    throw new Error(`Could not reach ${url} (${e instanceof Error ? e.message : 'network error'})`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Provider returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const json = (await res.json().catch(() => null)) as
    | {
        data?: Array<{
          id?: string
          display_name?: string
          name?: string
          context_length?: number
          context_window?: number
          max_context_length?: number
          contextLength?: number
        }>
      }
    | null
  const models: ModelInfo[] = (json?.data ?? [])
    .filter((m) => typeof m?.id === 'string' && m.id.length > 0)
    .map((m) => {
      // Context window reported by the provider (9Router / OpenRouter / vLLM
      // style lists) — used by /api/chat to size the context automatically.
      const raw = m.context_length ?? m.context_window ?? m.max_context_length ?? m.contextLength
      const ctx = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null
      return {
        id: m.id as string,
        displayName: m.display_name ?? (typeof m.name === 'string' && m.name !== m.id ? m.name : undefined),
        ...(ctx ? { contextLength: ctx } : {}),
      }
    })
  models.sort((a, b) => a.id.localeCompare(b.id))
  if (models.length === 0) throw new Error('Provider returned an empty model list')
  return models
}

/** A single SSE event forwarded to our client. */
export interface ChatStreamEvent {
  type: 'text' | 'error' | 'done' | 'reason'
  text?: string
  message?: string
}

/**
 * Open a streaming chat completion against the provider and yield normalized events.
 */
export async function* streamChatCompletion(opts: {
  type: ProviderType
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxTokens?: number
  signal?: AbortSignal
}): AsyncGenerator<ChatStreamEvent> {
  const { type, baseUrl, apiKey, model, system, messages, signal } = opts
  const maxTokens = opts.maxTokens ?? 8192

  let url: string
  let headers: Record<string, string>
  let body: string

  if (type === 'anthropic') {
    url = anthropicMessagesUrl(baseUrl)
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    }
    body = JSON.stringify({ model, system, messages, stream: true, max_tokens: maxTokens })
  } else {
    url = openAiChatUrl(baseUrl)
    headers = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    }
    body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: true,
      max_tokens: maxTokens,
    })
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal,
    })
  } catch (e) {
    if (signal?.aborted) return
    yield { type: 'error', message: `Could not reach ${url} (${e instanceof Error ? e.message : 'network error'})` }
    return
  }

  if (!res.ok || !res.body) {
    const errBody = await res.text().catch(() => '')
    let msg = `Provider returned ${res.status} ${res.statusText}`
    try {
      const j = JSON.parse(errBody) as { error?: { message?: string }; message?: string }
      msg = j?.error?.message ?? j?.message ?? msg
    } catch {
      if (errBody) msg = `${msg}: ${errBody.slice(0, 300)}`
    }
    yield { type: 'error', message: msg }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const extractDelta = (json: Record<string, unknown>): { kind: 'text' | 'reason'; text: string } | null => {
    if (type === 'anthropic') {
      if (json.type === 'content_block_delta') {
        const delta = json.delta as { text?: string; thinking?: string } | undefined
        if (delta && typeof delta.text === 'string') return { kind: 'text', text: delta.text }
        if (delta && typeof delta.thinking === 'string') return { kind: 'reason', text: delta.thinking }
      }
      if (json.type === 'content_block_start') {
        const block = json.content_block as { type?: string; thinking?: string } | undefined
        if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
          return { kind: 'reason', text: block.thinking }
        }
      }
      return null
    }
    const choices = json.choices as Array<{ delta?: { content?: string; reasoning_content?: string; reasoning?: string } }> | undefined
    const d = choices?.[0]?.delta
    if (d && typeof d.reasoning_content === 'string') return { kind: 'reason', text: d.reasoning_content }
    if (d && typeof d.reasoning === 'string') return { kind: 'reason', text: d.reasoning }
    const c = d?.content
    if (typeof c === 'string') return { kind: 'text', text: c }
    return null
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) continue // comment / keep-alive
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          yield { type: 'done' }
          return
        }
        try {
          const json = JSON.parse(payload) as Record<string, unknown>
          const delta = extractDelta(json)
          if (delta && delta.text) yield { type: delta.kind, text: delta.text } as ChatStreamEvent
        } catch {
          // partial JSON — ignore; will arrive complete in a later chunk
        }
      }
    }
    yield { type: 'done' }
  } finally {
    reader.releaseLock?.()
  }
}

/* ------------------------------------------------------------------ */
/* Tool-calling completion (used by the MCP agent loop)                */
/* ------------------------------------------------------------------ */

/** A tool exposed to the model (OpenAI + Anthropic compatible). */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** One tool call requested by the model. */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/**
 * History entries for tool rounds. Plain turns stay {role, content};
 * tool exchanges add assistant tool_calls turns and tool results.
 */
export type ToolMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export type ToolRoundResult =
  | { ok: true; text: string; toolCalls: ToolCall[]; reasoning?: string }
  | { ok: false; error: string }

function toOpenAiMessages(system: string, messages: ToolMessage[]): Array<Record<string, unknown>> {
  return [
    { role: 'system', content: system },
    ...messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
      }
      if (m.role === 'assistant' && 'toolCalls' in m) {
        return {
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        }
      }
      return { role: m.role, content: m.content }
    }),
  ]
}

function toAnthropicMessages(messages: ToolMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'tool') {
      // Anthropic requires tool results to live in a user message — merge consecutive ones
      const last = out[out.length - 1]
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content = [...(last.content as unknown[]), block]
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (m.role === 'assistant' && 'toolCalls' in m) {
      const content: Array<Record<string, unknown>> = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
      }
      out.push({ role: 'assistant', content })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * Non-streaming chat completion with tools. Works with OpenAI-compatible
 * endpoints (incl. local AI like Ollama / LM Studio) and Anthropic-compatible
 * endpoints. Returns either the model's text, or the tool calls it requested.
 */
export async function chatCompletionWithTools(opts: {
  type: ProviderType
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: ToolMessage[]
  tools: ToolSpec[]
  maxTokens?: number
  signal?: AbortSignal
}): Promise<ToolRoundResult> {
  const { type, baseUrl, apiKey, model, system, messages, tools, signal } = opts
  const maxTokens = opts.maxTokens ?? 8192
  const isAnthropic = type === 'anthropic'

  let url: string
  let headers: Record<string, string>
  let body: string

  if (isAnthropic) {
    url = anthropicMessagesUrl(baseUrl)
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    }
    body = JSON.stringify({
      model,
      system,
      messages: toAnthropicMessages(messages),
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      max_tokens: maxTokens,
    })
  } else {
    url = openAiChatUrl(baseUrl)
    headers = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    }
    body = JSON.stringify({
      model,
      messages: toOpenAiMessages(system, messages),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      tool_choice: 'auto',
      max_tokens: maxTokens,
    })
  }

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal })
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: 'aborted' }
    return { ok: false, error: `Could not reach ${url} (${e instanceof Error ? e.message : 'network error'})` }
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    let msg = `Provider returned ${res.status} ${res.statusText}`
    try {
      const j = JSON.parse(errBody) as { error?: { message?: string }; message?: string }
      msg = j?.error?.message ?? j?.message ?? msg
    } catch {
      if (errBody) msg = `${msg}: ${errBody.slice(0, 300)}`
    }
    return { ok: false, error: msg }
  }

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!json) return { ok: false, error: 'Provider returned an invalid JSON response' }

  if (isAnthropic) {
    const content = (json.content as Array<Record<string, unknown>> | undefined) ?? []
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => String(c.text ?? ''))
      .join('')
      .trim()
    const reasoning = content
      .filter((c) => c.type === 'thinking')
      .map((c) => String(c.thinking ?? ''))
      .join('')
      .trim()
    const toolCalls: ToolCall[] = content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({
        id: String(c.id ?? ''),
        name: String(c.name ?? ''),
        args: safeParseArgs(c.input),
      }))
      .filter((tc) => tc.name)
    return { ok: true, text, toolCalls, ...(reasoning ? { reasoning } : {}) }
  }

  const choices = json.choices as Array<Record<string, unknown>> | undefined
  const message = (choices?.[0]?.message ?? {}) as {
    content?: string | null
    reasoning_content?: string | null
    reasoning?: string | null
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>
  }
  const text = typeof message.content === 'string' ? message.content.trim() : ''
  const reasoningRaw =
    typeof message.reasoning_content === 'string'
      ? message.reasoning_content
      : typeof message.reasoning === 'string'
        ? message.reasoning
        : ''
  const reasoning = reasoningRaw.trim()
  const toolCalls: ToolCall[] = (message.tool_calls ?? [])
    .map((tc) => ({
      id: String(tc.id ?? ''),
      name: String(tc.function?.name ?? ''),
      args: safeParseArgs(tc.function?.arguments),
    }))
    .filter((tc) => tc.name)
  return { ok: true, text, toolCalls, ...(reasoning ? { reasoning } : {}) }
}
