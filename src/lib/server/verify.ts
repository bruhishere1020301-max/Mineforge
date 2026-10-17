// Deterministic self-check for AI-generated files ("faulty script" detection).
// Runs server-side after every reply (and on every write/edit tool call):
//  - strict JSON parsing for .json / .mcmeta (+ required keys for pack.mcmeta
//    and fabric.mod.json),
//  - string/comment-aware brace/bracket/paren balance + unterminated string
//    and block-comment detection for code files (java, js, ts, glsl, …),
//  - merge-conflict markers and empty files anywhere.
// When problems are found the chat route asks the model for one repair round
// and splices the corrected file blocks back into the reply.
import { parseAssistantOutput } from '@/lib/parse-files'

export interface FileIssue {
  path: string
  problems: string[]
}

export interface VerifyResult {
  checked: number
  issues: FileIssue[]
}

const JSON_LIKE = /(?:\.json|\.mcmeta)$/

const CODE_EXTS = new Set([
  'java', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'glsl', 'fsh', 'vsh', 'vert', 'frag', 'wgsl',
  'mcfunction', 'gradle', 'kts', 'kt',
])

/**
 * Scan a source file for unbalanced (), [], {} and unterminated
 * strings/comments. The scanner tracks line comments (//), block comments,
 * quoted strings ('…', "…", `…`) with escapes, so braces inside
 * comments/strings never count. Line numbers are included in the messages.
 */
function scanDelimiters(content: string): string[] {
  const problems: string[] = []
  const stack: Array<{ ch: string; line: number }> = []
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const push = (m: string) => {
    if (problems.length < 5) problems.push(m)
  }

  let line = 1
  let mode: 'code' | 'line' | 'block' | 'str' = 'code'
  let quote = ''
  let openLine = 1

  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    const n = i + 1 < content.length ? content[i + 1] : ''

    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; line++ }
      continue
    }
    if (mode === 'block') {
      if (c === '\n') line++
      if (c === '*' && n === '/') { mode = 'code'; i++ }
      continue
    }
    if (mode === 'str') {
      if (c === '\\') {
        if (n === '\n') line++
        i++
        continue
      }
      if (c === quote) { mode = 'code'; continue }
      if (c === '\n') {
        // Strings may not span lines in Java/JS/JSON — except backticks (templates).
        if (quote !== '`') {
          push(`line ${line}: unterminated ${quote === '"' ? 'string' : 'character'} literal (opened on line ${openLine})`)
          mode = 'code'
        }
        line++
      }
      continue
    }

    // mode === 'code'
    if (c === '\n') { line++; continue }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue }
    if (c === '/' && n === '*') { mode = 'block'; openLine = line; i++; continue }
    if (c === '"' || c === "'" || c === '`') {
      mode = 'str'
      quote = c
      openLine = line
      continue
    }
    if (c === '(' || c === '[' || c === '{') { stack.push({ ch: c, line }); continue }
    if (c === ')' || c === ']' || c === '}') {
      const top = stack.pop()
      if (!top) push(`line ${line}: unmatched '${c}'`)
      else if (top.ch !== pairs[c]) push(`line ${line}: '${c}' does not match '${top.ch}' from line ${top.line}`)
      continue
    }
  }

  if (mode === 'block') push(`unterminated block comment (/* opened on line ${openLine})`)
  if (mode === 'str') {
    push(`unterminated ${quote === '`' ? 'template literal' : quote === '"' ? 'string' : 'character'} literal (opened on line ${openLine})`)
  }
  if (stack.length === 1) {
    push(`line ${stack[0].line}: unclosed '${stack[0].ch}'`)
  } else if (stack.length > 1) {
    push(`${stack.length} unclosed brackets — first '${stack[0].ch}' opened on line ${stack[0].line}`)
  }
  return problems
}

/** Validate every closed file block in an assistant reply. */
export function verifyGeneratedText(text: string): VerifyResult {
  const issues: FileIssue[] = []
  let checked = 0
  for (const seg of parseAssistantOutput(text)) {
    if (seg.type !== 'code' || !seg.closed) continue
    checked++
    const problems = validateFile(seg.code.path, seg.code.content)
    if (problems.length > 0) issues.push({ path: seg.code.path, problems })
  }
  return { checked, issues }
}

/** Compact "path: problem; problem" lines for tool-feed results and repair prompts. */
export function issuesToLines(issues: FileIssue[], limit = 8): string[] {
  const lines = issues.slice(0, limit).map((i) => `${i.path} → ${i.problems.join('; ')}`)
  if (issues.length > limit) lines.push(`…and ${issues.length - limit} more files`)
  return lines
}

/** The follow-up message sent to the model when the self-check found problems. */
export function buildRepairPrompt(issues: FileIssue[]): string {
  return [
    'Your previous reply failed the automatic code self-check:',
    ...issuesToLines(issues).map((l) => `- ${l}`),
    '',
    'Fix ONLY these problems. Reply with the COMPLETE corrected file blocks for exactly the files listed above,',
    'using the normal fence format (```lang path="…"). Keep every other file and all prose identical —',
    'do not add, remove, rename or truncate anything, and do not shorten the file contents.',
    'Finish with a one-line note such as "Self-check: N issue(s) fixed.".',
  ].join('\n')
}

/**
 * Merge a repair reply into the original text: every file block in
 * `original` whose path is in `paths` is replaced with the version found in
 * `repairText`; everything else (prose + other files) is preserved.
 * Returns null when the repair reply contains none of the flagged files.
 */
export function spliceRepairs(original: string, repairText: string, paths: Set<string>): string | null {
  const fixes = new Map<string, string>()
  for (const seg of parseAssistantOutput(repairText)) {
    if (seg.type === 'code' && seg.closed && paths.has(seg.code.path)) {
      fixes.set(seg.code.path, seg.code.content)
    }
  }
  if (fixes.size === 0) return null

  let out = ''
  for (const seg of parseAssistantOutput(original)) {
    if (out) out += '\n'
    if (seg.type === 'text') {
      out += seg.content
    } else {
      const content = fixes.get(seg.code.path) ?? seg.code.content
      const lang = seg.code.lang || 'text'
      out += '```' + lang + ' path="' + seg.code.path + '"\n' + content + '\n```'
    }
  }
  return out
}

/** Run every deterministic check against one generated file. Returns problems (empty = OK). */
export function validateFile(filePath: string, content: string): string[] {
  const lower = filePath.toLowerCase()
  if (!content.trim()) return ['file is empty']
  const problems: string[] = []

  if (/(^|\n)\s*(<{7}|>{7})/.test(content)) {
    problems.push('merge-conflict markers (<<<<<<< or >>>>>>>) left in the file')
  }

  if (JSON_LIKE.test(lower)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      problems.push(`invalid JSON — ${e instanceof Error ? e.message : String(e)}`)
      return problems
    }
    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    if (lower.endsWith('pack.mcmeta')) {
      const pack = obj ? (obj.pack as Record<string, unknown> | undefined) : undefined
      const format = pack && typeof pack === 'object' ? pack.pack_format : undefined
      if (typeof format !== 'number') problems.push('pack.mcmeta must contain "pack": { "pack_format": <number> }')
    }
    if (lower.endsWith('fabric.mod.json')) {
      if (typeof obj?.id !== 'string' || !obj.id) problems.push('fabric.mod.json missing required string "id"')
      if (typeof obj?.version !== 'string' || !obj.version) problems.push('fabric.mod.json missing required string "version"')
    }
    return problems
  }

  const ext = lower.includes('.') ? lower.split('.').pop()! : ''
  if (CODE_EXTS.has(ext)) problems.push(...scanDelimiters(content))
  return problems
}