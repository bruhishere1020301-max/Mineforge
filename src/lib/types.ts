// Shared types for MineForge Studio

export type ProviderType = 'openai' | 'anthropic' | 'local'
export type ProjectKind = 'fabric' | 'forge' | 'neoforge' | 'quilt' | 'shader' | 'datapack' | 'other'
export type ProjectStorage = 'fsa' | 'electron' | 'manual'

/**
 * Generation modes.
 * - `single`   — ONE self-contained .java file, paste it into an existing mod project
 * - `datapack` — instant vanilla data pack: paste the folder/zip into the world, /reload, done
 * - `mod`      — full multi-file mod project (build files, metadata, assets)
 * - `shader`   — Iris / OptiFine shader pack
 */
export type ChatMode = 'single' | 'datapack' | 'mod' | 'shader'

/** Shared metadata per chat mode — labels, hints, badge + dot styling. */
export const MODE_INFO: Record<
  ChatMode,
  { label: string; short: string; hint: string; badgeClass: string; dotClass: string; statusText: string }
> = {
  single: {
    label: 'Single File',
    short: 'Single-file mod',
    hint: 'One self-contained .java file — copy it, paste it into your mod project, build, done.',
    badgeClass: 'bg-amber-500/15 text-amber-500',
    dotClass: 'bg-amber-400',
    statusText: 'Single-file mode',
  },
  datapack: {
    label: 'Datapack',
    short: 'Instant datapack',
    hint: 'No Java, no build — paste the pack folder into saves/<world>/datapacks and /reload.',
    badgeClass: 'bg-orange-500/15 text-orange-400',
    dotClass: 'bg-orange-400',
    statusText: 'Datapack mode',
  },
  mod: {
    label: 'Mod Project',
    short: 'Mod project',
    hint: 'Complete multi-file mod project — sources, build files, metadata and assets.',
    badgeClass: 'bg-emerald-500/15 text-emerald-500',
    dotClass: 'bg-emerald-500',
    statusText: 'Mod project mode',
  },
  shader: {
    label: 'Shader',
    short: 'Shader pack',
    hint: 'Iris + OptiFine compatible GLSL shader pack with all program passes.',
    badgeClass: 'bg-fuchsia-500/15 text-fuchsia-400',
    dotClass: 'bg-fuchsia-400',
    statusText: 'Shader mode',
  },
}

/** All chat modes in display order. */
export const CHAT_MODE_ORDER: ChatMode[] = ['single', 'datapack', 'mod', 'shader']

export interface ProviderDTO {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  maskedKey: string
  hasKey: boolean
  defaultModel: string | null
  createdAt: string
}

/** Shared label + badge styling per provider type. */
export const PROVIDER_TYPE_INFO: Record<ProviderType, { label: string; badgeClass: string }> = {
  openai: { label: 'OpenAI-compatible', badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  anthropic: { label: 'Anthropic-compatible', badgeClass: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400' },
  local: { label: 'Local AI', badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
}

export interface ProjectDTO {
  id: string
  name: string
  path: string
  kind: ProjectKind
  storage: ProjectStorage
  handleKey: string | null
  createdAt: string
}

export interface SessionDTO {
  id: string
  title: string
  mode: ChatMode
  projectId: string | null
  contextLimit: number
  updatedAt: string
  messageCount?: number
}

export interface MessageDTO {
  id: string
  role: 'user' | 'assistant'
  content: string
  excluded: boolean
  createdAt: string
}

/** Live context-window stats — what the AI actually receives. */
export interface ContextStats {
  included: number // messages sent to the AI
  total: number // all messages in the session
  excluded: number // messages manually excluded
  limit: number // the session's context window size
  estTokens: number // rough token estimate (chars / 4) incl. system prompt
  /** Present when the model's context window was auto-detected. */
  contextWindow?: {
    length: number // model context window in tokens
    output: number // output-token budget reserved for the reply
    trimmed: number // oldest messages trimmed to fit the window
  }
}

/** Per-message view of the context window (GET /api/sessions/:id/context). */
export interface ContextPreview {
  system: string
  contextLimit: number
  stats: ContextStats
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    inContext: boolean
    excluded: boolean
    createdAt: string
  }>
  /** Exactly the message array sent to the provider (in order). */
  llmMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface ModelInfo {
  id: string
  displayName?: string
  /** Context window in tokens when the provider reports it (OpenRouter/9Router-style lists). */
  contextLength?: number
}

/** Format a token count like 128000 → "128k". */
export function formatContextLength(n?: number | null): string | null {
  if (!n || !Number.isFinite(n) || n <= 0) return null
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n))
}

/** MCP (Model Context Protocol) server — as returned by /api/mcp. */
export interface McpServerDTO {
  id: string
  name: string
  transport: 'http' | 'stdio'
  url: string | null
  command: string | null
  args: string | null // JSON array (stdio)
  env: string | null // JSON object (stdio)
  enabled: boolean
  status: 'unknown' | 'connected' | 'error'
  statusMessage: string | null
  toolCount: number
  createdAt: string
}

/** A tool exposed by an MCP server. */
export interface McpToolDTO {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface TreeNode {
  name: string
  path: string // relative, '/'-separated
  kind: 'dir' | 'file'
  size?: number
  children?: TreeNode[]
  truncated?: boolean
}

export interface GeneratedFile {
  path: string
  content: string
  lang: string
}

export interface WriteResult {
  written: number
  errors: string[]
}

export const PROJECT_KINDS: { value: ProjectKind; label: string }[] = [
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'shader', label: 'Shader Pack' },
  { value: 'datapack', label: 'Datapack Folder' },
  { value: 'other', label: 'Other' },
]

export const KIND_BADGE_CLASS: Record<ProjectKind, string> = {
  fabric: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  forge: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  neoforge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  quilt: 'bg-lime-500/15 text-lime-400 border-lime-500/30',
  shader: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
  datapack: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  other: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}
