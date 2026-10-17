// Built-in project file tools for the chat agent loop: create, edit, delete,
// read and list files inside the ACTIVE project folder — the AI manages the
// folder itself instead of only emitting file blocks for the user to save.
//
// Availability: the Next.js server must be able to reach the folder on disk.
// That's always true in the Electron desktop app (paths are absolute and the
// server runs locally). Browser-mode projects only store a folder NAME (the
// real handle lives in the renderer's IndexedDB), so resolveProjectRoot()
// returns null and the tools are not offered — the normal file-block flow
// keeps working there.
//
// Security: every path is resolved against the project root and verified to
// stay inside it (case-insensitive on Windows) — same sandbox rules as the
// Electron IPC bridge.
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { db } from '@/lib/db'
import type { ToolSpec } from '@/lib/server/llm'
import { validateFile } from '@/lib/server/verify'
import type { ActivityDiffLine } from '@/lib/activity'

/**
 * Minimal unified line diff: common prefix/suffix trimmed, changed region
 * shown as '-' (old) / '+' (new) lines with 2 context lines around it.
 */
export function lineDiff(oldText: string, newText: string, maxLines = 60): ActivityDiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const ctx = 2
  const out: ActivityDiffLine[] = []
  const push = (l: ActivityDiffLine) => {
    if (out.length <= maxLines) out.push(l)
  }
  for (let i = Math.max(0, start - ctx); i < start; i++) push({ sign: ' ', n: i + 1, t: a[i] })
  for (let i = start; i < endA; i++) push({ sign: '-', n: i + 1, t: a[i] })
  for (let i = start; i < endB; i++) push({ sign: '+', n: i + 1, t: b[i] })
  if (out.length > maxLines) {
    return [...out.slice(0, maxLines), { sign: ' ', t: `… (${Math.max(a.length, b.length)} lines total)` }]
  }
  const tail =
    endA === a.length && endB === b.length
      ? []
      : [{ sign: ' ' as const, t: '…' }]
  for (let i = endA; i < Math.min(a.length, endA + ctx); i++) push({ sign: ' ', n: i + 1, t: a[i] })
  return [...out, ...tail]
}

/** Whole file as '+' lines (used when creating a new file). */
function asAdded(content: string, maxLines = 60): ActivityDiffLine[] {
  const lines = content.split('\n')
  const shown: ActivityDiffLine[] = lines
    .slice(0, maxLines)
    .map((t, i) => ({ sign: '+', n: i + 1, t }))
  if (lines.length > maxLines) shown.push({ sign: ' ', t: `… (${lines.length} lines total)` })
  return shown
}

export interface GradleBuildResult {
  ok: boolean
  code: number | null
  output: string
  timedOut: boolean
  seconds: number
}

const BUILD_TIMEOUT_MS = 6 * 60_000 // first runs download Gradle + deps
const BUILD_OUTPUT_CAP = 100_000

/**
 * Run `gradlew build` in the project root (Windows: gradlew.bat via cmd).
 * Output is capped; the process is killed on timeout. Used by both the
 * build_mod_project AI tool and POST /api/projects/:id/build (UI button).
 */
export function runGradleBuild(root: string, timeoutMs = BUILD_TIMEOUT_MS): Promise<GradleBuildResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const wrapper = isWin ? 'gradlew.bat' : 'gradlew'
    const wrapperPath = path.join(root, wrapper)
    if (!existsSync(wrapperPath)) {
      resolve({
        ok: false,
        code: null,
        output: `${wrapper} not found in the project root — generate the Gradle wrapper scripts first (settings.gradle, ${wrapper}, gradle/wrapper/gradle-wrapper.properties).`,
        timedOut: false,
        seconds: 0,
      })
      return
    }
    const started = Date.now()
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/s', '/c', `${wrapper} build --console=plain --no-daemon`], {
          cwd: root,
          windowsHide: true,
          env: { ...process.env, JAVA_TOOL_OPTIONS: undefined },
        })
      : spawn(wrapper, ['build', '--console=plain', '--no-daemon'], { cwd: root })

    let output = ''
    let truncated = false
    const append = (chunk: Buffer | string) => {
      if (truncated) return
      output += String(chunk)
      if (output.length > BUILD_OUTPUT_CAP) {
        output = output.slice(0, BUILD_OUTPUT_CAP) + '\n…(output truncated)'
        truncated = true
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch { /* best effort */ }
      if (isWin && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      }
      resolve({
        ok: false,
        code: null,
        output: `Build timed out after ${Math.round(timeoutMs / 60000)} minutes — killed.\n${output.slice(-4000)}`,
        timedOut: true,
        seconds: Math.round((Date.now() - started) / 1000),
      })
    }, timeoutMs)

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, code: null, output: `Failed to start Gradle: ${err.message}`, timedOut: false, seconds: Math.round((Date.now() - started) / 1000) })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const tail = output.length > 6000 ? `…(earlier output trimmed)\n${output.slice(-6000)}` : output
      resolve({ ok: code === 0, code, output: tail, timedOut: false, seconds: Math.round((Date.now() - started) / 1000) })
    })
  })
}

export const FILE_TOOLS_SERVER = 'Project files'

const FILE_TOOL_NAMES = [
  'list_project_files',
  'read_project_file',
  'write_project_file',
  'edit_project_file',
  'delete_project_file',
  'build_mod_project',
] as const

export type FileToolName = (typeof FILE_TOOL_NAMES)[number]

export function isFileTool(name: string): name is FileToolName {
  return (FILE_TOOL_NAMES as readonly string[]).includes(name)
}

export const FILE_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'list_project_files',
    description:
      'List files and folders inside the project directory (relative paths, directories first). Call with no path for the project root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative folder path inside the project. Omit or "" for the root.' },
        depth: { type: 'integer', description: 'Sub-folder depth, 1-5 (default 3).' },
      },
    },
  },
  {
    name: 'read_project_file',
    description: 'Read a text file from the project folder (UTF-8). Use before editing to see the current content.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative file path inside the project.' } },
      required: ['path'],
    },
  },
  {
    name: 'write_project_file',
    description:
      'Create a new file or completely overwrite an existing one in the project folder (parent folders are created automatically). Runs the automatic self-check on the content and returns any problems.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path inside the project.' },
        content: { type: 'string', description: 'Full UTF-8 content of the file.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_project_file',
    description:
      'Surgically edit an existing file: replace one exact occurrence of old_text with new_text. old_text must be unique in the file (include surrounding lines if needed). Runs the automatic self-check on the result.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path inside the project.' },
        old_text: { type: 'string', description: 'Exact text to find (must appear exactly once).' },
        new_text: { type: 'string', description: 'Replacement text (may be empty to remove old_text).' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'delete_project_file',
    description: 'Delete a single file from the project folder (folders cannot be deleted). Irreversible — use only for wrong or obsolete files.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative file path inside the project.' } },
      required: ['path'],
    },
  },
  {
    name: 'build_mod_project',
    description:
      'Run the Gradle build (gradlew build) in the project root and return the compiler output. Use after generating or fixing Java files: read the errors, fix them with edit_project_file, and rebuild until the build is green. The jar lands in build/libs/. First run may download Gradle and dependencies and take several minutes.',
    inputSchema: { type: 'object', properties: {} },
  },
]

const IGNORED_DIRS = new Set(
  ['node_modules', '.git', '.gradle', '.idea', '.next', 'build', 'out', 'target', 'run'].map((d) => d.toLowerCase())
)

export interface ProjectRoot {
  root: string
  name: string
}

/** Look up the active project and confirm its folder is reachable from the server. */
export async function resolveProjectRoot(projectId: string): Promise<ProjectRoot | null> {
  try {
    const p = await db.project.findUnique({ where: { id: projectId } })
    if (!p || !p.path || p.storage === 'fsa') return null
    const root = path.resolve(p.path)
    const st = await fs.stat(root).catch(() => null)
    if (!st || !st.isDirectory()) return null
    return { root, name: p.name }
  } catch {
    return null
  }
}

/** Assert `rel` is a relative path that resolves to a file inside `root`. */
function resolveInside(root: string, rel: unknown): string {
  if (typeof rel !== 'string' || rel.trim() === '') {
    throw new Error('Invalid "path": expected a non-empty relative string.')
  }
  if (rel.includes('\0')) throw new Error('Invalid "path": NUL bytes are not allowed.')
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(rel)) {
    throw new Error(`Access denied: "${rel}" must be relative to the project folder.`)
  }
  const abs = path.resolve(root, rel)
  const sep = path.sep
  const r = process.platform === 'win32' ? root.toLowerCase() : root
  const a = process.platform === 'win32' ? abs.toLowerCase() : abs
  if (a !== r && !a.startsWith(r.endsWith(sep) ? r : r + sep)) {
    throw new Error(`Access denied: "${rel}" resolves outside the project folder.`)
  }
  return abs
}


/** Execute one built-in file tool against the project root. Throws on failure. */
export async function callFileTool(
  root: string,
  name: FileToolName,
  args: Record<string, unknown>
): Promise<FileToolResult> {
  if (name === 'list_project_files') {
    const rel = typeof args.path === 'string' ? args.path.trim() : ''
    const depth =
      typeof args.depth === 'number' && Number.isFinite(args.depth)
        ? Math.min(Math.max(Math.floor(args.depth), 1), 5)
        : 3
    const start = rel ? resolveInside(root, rel) : path.resolve(root)
    const st = await fs.stat(start).catch(() => null)
    if (!st || !st.isDirectory()) throw new Error(`Not a folder: ${rel || '(project root)'}`)

    const lines: string[] = []
    let count = 0
    let truncated = false
    const walk = async (dirAbs: string, prefix: string, level: number): Promise<void> => {
      if (count >= 300) { truncated = true; return }
      const dirents = await fs.readdir(dirAbs, { withFileTypes: true }).catch(() => [])
      dirents.sort((a, b) => {
        const ad = a.isDirectory() ? 0 : 1
        const bd = b.isDirectory() ? 0 : 1
        return ad - bd || a.name.localeCompare(b.name)
      })
      for (const d of dirents) {
        if (count >= 300) { truncated = true; return }
        if (d.isDirectory() && IGNORED_DIRS.has(d.name.toLowerCase())) continue
        const childRel = prefix ? `${prefix}/${d.name}` : d.name
        count++
        if (d.isDirectory()) {
          lines.push(`📁 ${childRel}/`)
          if (level + 1 < depth) await walk(path.join(dirAbs, d.name), childRel, level + 1)
        } else {
          let size = ''
          try {
            size = ` (${(await fs.stat(path.join(dirAbs, d.name))).size} B)`
          } catch { /* vanished — omit size */ }
          lines.push(`📄 ${childRel}${size}`)
        }
      }
    }
    await walk(start, rel.replace(/\/+$/, ''), 0)
    if (lines.length === 0) return { result: 'Folder is empty.', summary: `Listed ${rel || 'project root'} (empty)`, problems: [] }
    return {
      result: lines.join('\n') + (truncated ? '\n…(truncated at 300 entries)' : ''),
      summary: `Listed ${lines.length} entries in ${rel || 'project root'}`,
      problems: [],
    }
  }

  if (name === 'read_project_file') {
    const abs = resolveInside(root, argString(args, 'path'))
    const st = await fs.stat(abs).catch(() => null)
    if (!st) throw new Error(`File not found: ${args.path}`)
    if (st.isDirectory()) throw new Error(`"${args.path}" is a folder — read a file instead.`)
    let content = await fs.readFile(abs, 'utf8')
    if (content.length > 40_000) content = content.slice(0, 40_000) + '\n…(truncated at 40k chars)'
    return { result: content, summary: `Read ${String(args.path)} (${content.length} chars)`, problems: [] }
  }

  if (name === 'write_project_file') {
    const rel = argString(args, 'path')
    const content = typeof args.content === 'string' ? args.content : null
    if (content === null) throw new Error('Invalid "content": expected a string.')
    if (content.trim() === '') throw new Error('Invalid "content": refusing to write an empty file.')
    const abs = resolveInside(root, rel)
    const existed = await fs.access(abs).then(() => true).catch(() => false)
    const oldContent = existed ? await fs.readFile(abs, 'utf8').catch(() => '') : ''
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
    const bytes = Buffer.byteLength(content, 'utf8')
    const problems = validateFile(rel, content)
    const check = problems.length > 0 ? `⚠ SELF-CHECK FAILED: ${problems.join('; ')}` : 'Self-check: OK'
    return {
      result: `${existed ? 'Overwrote' : 'Created'} ${rel} (${bytes} bytes)\n${check}`,
      summary: `${existed ? 'Overwrote' : 'Created'} ${rel} (${bytes} bytes)${problems.length ? ' — self-check FAILED' : ''}`,
      problems,
      op: existed ? 'overwrite' : 'create',
      path: rel,
      diff: existed ? lineDiff(oldContent, content) : asAdded(content),
    }
  }

  if (name === 'edit_project_file') {
    const rel = argString(args, 'path')
    const oldText = typeof args.old_text === 'string' ? args.old_text : ''
    const newText = typeof args.new_text === 'string' ? args.new_text : null
    if (!oldText) throw new Error('Invalid "old_text": expected a non-empty string.')
    if (newText === null) throw new Error('Invalid "new_text": expected a string (may be empty).')
    const abs = resolveInside(root, rel)
    const st = await fs.stat(abs).catch(() => null)
    if (!st || st.isDirectory()) throw new Error(`File not found: ${rel} — use write_project_file to create it.`)
    const content = await fs.readFile(abs, 'utf8')
    const occurrences = content.split(oldText).length - 1
    if (occurrences === 0) {
      throw new Error(`old_text not found in ${rel} — re-read the file; its content may have changed.`)
    }
    if (occurrences > 1) {
      throw new Error(`old_text matches ${occurrences} times in ${rel} — include more surrounding lines so it is unique.`)
    }
    const updated = content.replace(oldText, newText)
    await fs.writeFile(abs, updated, 'utf8')

    const diff = lineDiff(content, updated)
    const problems = validateFile(rel, updated)
    const check = problems.length > 0 ? `⚠ SELF-CHECK FAILED: ${problems.join('; ')}` : 'Self-check: OK'
    const oldLines = content.split('\n')
    const newLines = updated.split('\n')
    const changedLine = diff.find((d) => d.sign === '+')?.n ?? 1
    const delta = newLines.length - oldLines.length
    return {
      result: `Edited ${rel} (${oldLines.length} → ${newLines.length} lines${delta ? `, ${delta > 0 ? '+' : ''}${delta} lines` : ''})\n${check}`,
      summary: `Edited ${rel} (line ${changedLine} changed${problems.length ? ' — self-check FAILED' : ''})`,
      problems,
      op: 'edit',
      path: rel,
      diff,
    }
  }

  if (name === 'delete_project_file') {
    const rel = argString(args, 'path')
    const abs = resolveInside(root, rel)
    const st = await fs.stat(abs).catch(() => null)
    if (!st) throw new Error(`File not found: ${rel}`)
    if (st.isDirectory()) throw new Error(`"${rel}" is a folder — only single files can be deleted.`)
    await fs.unlink(abs)
    return {
      result: `Deleted ${rel}`,
      summary: `Deleted ${rel} (${st.size} bytes)`,
      problems: [],
      op: 'delete',
      path: rel,
    }
  }

  if (name === 'build_mod_project') {
    const build = await runGradleBuild(root)
    const header = build.ok
      ? `BUILD SUCCESSFUL in ${build.seconds}s — jar lands in build/libs/`
      : `BUILD FAILED${build.code !== null ? ` (exit ${build.code})` : ''}${build.timedOut ? ' (timed out)' : ''} after ${build.seconds}s`
    return {
      result: `${header}\n\n${build.output}`,
      summary: build.ok
        ? `Gradle build succeeded in ${build.seconds}s (jar in build/libs)`
        : `Gradle build FAILED${build.timedOut ? ' (timeout)' : ''} — read the compiler errors and fix them`,
      problems: [],
    }
  }

  throw new Error(`Unknown file tool: ${name}`)
}

function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`Invalid "${key}": expected a non-empty string.`)
  return v
}

export interface FileToolResult {
  result: string
  /** One-line human summary for the live feed ("Created data/x.json (32 bytes)"). */
  summary: string
  /** Problems reported by the automatic self-check after a write/edit (empty = clean). */
  problems: string[]
  /** Structured data for the Cline-style inline activity cards. */
  op?: 'create' | 'overwrite' | 'edit' | 'delete'
  path?: string
  diff?: ActivityDiffLine[]
}