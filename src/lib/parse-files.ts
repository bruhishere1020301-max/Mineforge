// Parse assistant output into interleaved prose segments and structured file blocks.
// The AI is instructed to emit blocks like:  ```java path="src/.../Main.java" ... ```
// We also tolerate  ```java src/Main.java  and  ```java\n// file: src/Main.java
import type { GeneratedFile } from '@/lib/types'

export type Segment =
  | { type: 'text'; content: string }
  | { type: 'code'; code: GeneratedFile; closed: boolean }

function parseInfoString(info: string): { lang: string; path: string | null } {
  let lang = ''
  let path: string | null = null

  // path="..." or file='...' or filename=...
  const attr = info.match(/(?:path|file|filename)\s*=\s*["']([^"']+)["']/i)
  if (attr) path = attr[1]

  const tokens = info.trim().split(/\s+/).filter(Boolean)
  const nonAttr = tokens.filter((t) => !/^(?:path|file|filename)\s*=/i.test(t))
  if (nonAttr.length > 0) {
    const first = nonAttr[0]
    // e.g. "java:path/to/Foo.java" or "java:path/to/Foo.java"
    const m = first.match(/^([a-zA-Z0-9+#-]+)[:](.+)$/)
    if (m) {
      lang = m[1]
      if (!path) path = m[2]
    } else {
      lang = first.replace(/[^\w+#.-]/g, '')
    }
    // bare trailing path token: ```java src/main/java/Foo.java
    if (!path && nonAttr.length > 1) {
      const maybe = nonAttr[nonAttr.length - 1]
      if (/\.[A-Za-z0-9]+$/.test(maybe) && !maybe.includes('=')) path = maybe
    }
  }
  return { lang, path }
}

const HEADER_RE =
  /^\s*(?:#|\/\/|\/\*|<!--)\s*(?:file|path|filename)\s*:\s*(\S+?)\s*(?:\*\/|-->)?\s*$/i

const FENCE_LINE_RE = /^ {0,3}```(.*)$/

/** True when a fence info string carries a file path — such a line can only OPEN a file block. */
function fenceInfoHasPath(info: string): boolean {
  return parseInfoString(info).path !== null
}

/**
 * Parse assistant output into interleaved prose segments and structured file blocks.
 * Line-based tokenizer (like CommonMark fences) with a parity-shift guard:
 * when a block is interrupted by a fence line that itself carries a path
 * (e.g. stray unbalanced fences from tool output), that line is treated as the
 * OPENER of a new file block — so real file blocks are never swallowed.
 */
export function parseAssistantOutput(text: string): Segment[] {
  const segments: Segment[] = []
  const lines = text.split('\n')
  const n = lines.length
  let i = 0
  let prose: string[] = []

  const flushProse = () => {
    const joined = prose.join('\n')
    if (joined.trim()) segments.push({ type: 'text', content: joined })
    prose = []
  }

  while (i < n) {
    const m = lines[i].match(FENCE_LINE_RE)
    if (!m) {
      prose.push(lines[i])
      i++
      continue
    }

    // ---- fence opener at line i ----
    const info = (m[1] ?? '').trim()
    const body: string[] = []
    let closed = false
    let j = i + 1

    while (j < n) {
      const fm = lines[j].match(FENCE_LINE_RE)
      if (!fm) {
        body.push(lines[j])
        j++
        continue
      }
      const innerInfo = (fm[1] ?? '').trim()
      if (fenceInfoHasPath(innerInfo)) {
        // Parity-shift guard: this fence line is really the OPENER of a file
        // block. Close the current block here and reprocess it as an opener.
        closed = true
        break
      }
      closed = true
      j++ // consume the closing fence line
      break
    }

    let { lang, path } = parseInfoString(info)
    if (!path && body.length > 0) {
      const hm = body[0].match(HEADER_RE)
      if (hm) {
        path = hm[1]
        body.shift()
      }
    }
    if (!path && info && /\.[A-Za-z0-9]+$/.test(info) && !info.includes('=')) {
      path = info
    }

    if (path) {
      flushProse()
      segments.push({ type: 'code', code: { path, lang: lang || guessLang(path), content: body.join('\n') }, closed })
    } else {
      // plain code block — keep as fenced text so markdown renders it as code
      prose.push(`\`\`\`${info}`)
      prose.push(...body)
      if (closed) prose.push('```')
    }

    // when interrupted, j points AT the path-fence line → reprocess it as an opener
    i = j
  }

  flushProse()
  return segments
}

export function extractFiles(text: string): GeneratedFile[] {
  return parseAssistantOutput(text)
    .filter((s): s is { type: 'code'; code: GeneratedFile; closed: boolean } => s.type === 'code' && s.closed)
    .map((s) => s.code)
}

export function guessLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'java':
      return 'java'
    case 'json':
    case 'mcmeta':
      return 'json'
    case 'gradle':
    case 'kts':
      return 'gradle'
    case 'properties':
      return 'properties'
    case 'fsh':
    case 'vsh':
    case 'glsl':
    case 'gsh':
    case 'csh':
      return 'glsl'
    case 'toml':
      return 'toml'
    case 'xml':
      return 'xml'
    case 'md':
      return 'markdown'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'js':
      return 'javascript'
    case 'ts':
      return 'typescript'
    default:
      return ext || 'text'
  }
}

/** Normalize a file path coming from the AI: strip leading ./ and /, forbid .. escapes. */
export function safeRelPath(p: string): string | null {
  const norm = p.replace(/\\/g, '/').replace(/^[./]+/, '').trim()
  if (!norm || norm.includes('..') || norm.startsWith('/')) return null
  return norm
}
