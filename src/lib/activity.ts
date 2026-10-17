// Activity stream attached to assistant messages (Cline-style transparency):
// what the model was thinking, which files it created/edited/deleted, the
// exact diff lines it changed, and self-check verdicts.
//
// Entries are streamed live over SSE (`activity` implied by note/tool events)
// and appended to the persisted message content inside a hidden marker
// <!--mf-activity … --> so they survive reloads. stripActivity() removes the
// marker everywhere the content is shown to the MODEL (context window), so
// the model never receives it.

export type ActivityDiffLine = { sign: ' ' | '-' | '+'; n?: number; t: string }

export type ActivityFileOp = 'create' | 'overwrite' | 'edit' | 'delete'

export type ActivityEntry =
  | { kind: 'thinking'; text: string }
  | { kind: 'check'; text: string; ok: boolean }
  | {
      kind: 'file'
      op: ActivityFileOp
      path: string
      summary: string
      diff?: ActivityDiffLine[]
      problems?: string[]
    }

const START = '<!--mf-activity'
const END = '-->'

/** Append the encoded activity marker to a reply (persistence only). */
export function encodeActivity(text: string, entries: ActivityEntry[]): string {
  if (!entries.length) return text
  return `${text}\n\n${START}\n${JSON.stringify(entries)}\n${END}`
}

/**
 * Split a stored message into display text + activity entries.
 * Returns entries: [] and the original text when no marker is present.
 */
export function splitActivity(text: string): { content: string; entries: ActivityEntry[] } {
  const idx = text.lastIndexOf(START)
  if (idx === -1) return { content: text, entries: [] }
  const end = text.indexOf(END, idx)
  if (end === -1) return { content: text, entries: [] }
  try {
    const json = text.slice(idx + START.length, end).trim()
    const entries = JSON.parse(json) as ActivityEntry[]
    if (!Array.isArray(entries)) return { content: text, entries: [] }
    const content = (text.slice(0, idx) + text.slice(end + END.length)).replace(/\s+$/, '')
    return { content, entries }
  } catch {
    return { content: text, entries: [] }
  }
}

/** Remove the activity marker (used before content reaches the model). */
export function stripActivity(text: string): string {
  return splitActivity(text).content
}