// Filesystem abstraction layer.
// - In the browser (Chromium / preview): File System Access API (showDirectoryPicker + FileSystemDirectoryHandle persisted in IndexedDB).
// - In Electron: native dialogs + Node fs over the secure electronAPI bridge (see /electron).
// - Fallback (manual): folder is metadata only; saving falls back to downloads.
import type { ProjectDTO, TreeNode, WriteResult } from '@/lib/types'

interface ElectronAPI {
  selectDirectory(): Promise<{ path: string; name: string } | null>
  writeFiles(rootPath: string, files: Array<{ path: string; content: string }>): Promise<WriteResult>
  readTree(rootPath: string, maxDepth?: number): Promise<TreeNode>
  fileExists(rootPath: string, relPath: string): Promise<boolean>
  readFile(rootPath: string, relPath: string): Promise<string>
  openPath(p: string): Promise<string>
  revealFile(p: string): Promise<void>
  isElectron: true
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

export function hasDirectoryPicker(): boolean {
  return (
    (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') || isElectron()
  )
}

/* ---------------------------------- IndexedDB handle store ---------------------------------- */

const IDB_NAME = 'mineforge-fs'
const IDB_STORE = 'handles'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB put failed'))
    }
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => {
      db.close()
      resolve(req.result as T | undefined)
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('IndexedDB get failed'))
    }
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB delete failed'))
    }
  })
}

/* ----------------------------------- Picking a folder ----------------------------------- */

export interface PickedFolder {
  name: string
  path: string
  storage: 'fsa' | 'electron'
  handleKey: string | null
}

export async function pickDirectory(): Promise<PickedFolder | null> {
  if (isElectron() && window.electronAPI) {
    const r = await window.electronAPI.selectDirectory()
    if (!r) return null
    return { name: r.name, path: r.path, storage: 'electron', handleKey: null }
  }
  if (typeof window.showDirectoryPicker === 'function') {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    const key = `dir:${crypto.randomUUID()}`
    await idbSet(key, handle)
    return { name: handle.name, path: handle.name, storage: 'fsa', handleKey: key }
  }
  throw new Error('Your current browser does not support folder picking. Run the desktop app or use Chrome/Edge.')
}

/* --------------------------------- Permission helpers --------------------------------- */

export async function getHandlePermission(project: ProjectDTO): Promise<'granted' | 'prompt' | 'denied' | 'unavailable'> {
  if (project.storage !== 'fsa' || !project.handleKey) {
    return project.storage === 'electron' ? 'granted' : 'unavailable'
  }
  const handle = await idbGet<FileSystemDirectoryHandle>(project.handleKey)
  if (!handle) return 'unavailable'
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
  }
  if (!h.queryPermission) return 'granted'
  const st = await h.queryPermission({ mode: 'readwrite' })
  return st === 'granted' ? 'granted' : st === 'prompt' ? 'prompt' : 'denied'
}

/** Must be called from a user gesture (click). Returns true when read/write permission is granted. */
export async function ensurePermission(project: ProjectDTO): Promise<boolean> {
  if (project.storage === 'electron') return true
  if (project.storage !== 'fsa' || !project.handleKey) return false
  const handle = await idbGet<FileSystemDirectoryHandle>(project.handleKey)
  if (!handle) return false
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
    requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
  }
  if (h.queryPermission) {
    const q = await h.queryPermission({ mode: 'readwrite' })
    if (q === 'granted') return true
  }
  if (h.requestPermission) {
    const r = await h.requestPermission({ mode: 'readwrite' })
    return r === 'granted'
  }
  return true
}

export async function forgetHandle(project: ProjectDTO): Promise<void> {
  if (project.storage === 'fsa' && project.handleKey) await idbDelete(project.handleKey)
}

/* ------------------------------------ Writing files ------------------------------------ */

async function writeViaHandle(
  handle: FileSystemDirectoryHandle,
  relPath: string,
  content: string
): Promise<void> {
  const parts = relPath.split('/').filter(Boolean)
  const fileName = parts.pop()
  if (!fileName) throw new Error(`Invalid path: ${relPath}`)
  let dir = handle
  for (const part of parts) {
    dir = await (
      dir as FileSystemDirectoryHandle & {
        getDirectoryHandle: (n: string, o: { create?: boolean }) => Promise<FileSystemDirectoryHandle>
      }
    ).getDirectoryHandle(part, { create: true })
  }
  const file = await (
    dir as FileSystemDirectoryHandle & {
      getFileHandle: (n: string, o: { create?: boolean }) => Promise<FileSystemFileHandle>
    }
  ).getFileHandle(fileName, { create: true })
  const w = await (file as FileSystemFileHandle & {
    createWritable: () => Promise<FileSystemWritableFileStream>
  }).createWritable()
  await w.write(content)
  await w.close()
}

export async function writeProjectFiles(
  project: ProjectDTO,
  files: Array<{ path: string; content: string }>
): Promise<WriteResult> {
  if (files.length === 0) return { written: 0, errors: [] }

  if (project.storage === 'electron' && window.electronAPI) {
    return window.electronAPI.writeFiles(project.path, files)
  }
  if (project.storage === 'fsa' && project.handleKey) {
    const ok = await ensurePermission(project)
    if (!ok) throw new Error('Permission to write to this folder was not granted. Reconnect the folder from the Projects view and allow access.')
    const handle = await idbGet<FileSystemDirectoryHandle>(project.handleKey)
    if (!handle) throw new Error('This folder handle is no longer available. Please re-add the folder in Projects.')
    let written = 0
    const errors: string[] = []
    for (const f of files) {
      try {
        await writeViaHandle(handle, f.path, f.content)
        written++
      } catch (e) {
        errors.push(`${f.path}: ${e instanceof Error ? e.message : 'write failed'}`)
      }
    }
    return { written, errors }
  }
  throw new Error('This project is folder metadata only (manual). Re-add it with a real folder connection to write files.')
}

/* ------------------------------------ Reading trees ------------------------------------ */

const SKIP_DIRS = new Set(['node_modules', '.git', '.gradle', 'build', '.next', 'run', '.idea', 'out', 'target'])

async function readFsaTree(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  depth: number,
  maxDepth: number
): Promise<TreeNode[]> {
  if (depth >= maxDepth) return []
  const out: TreeNode[] = []
  const entries: Array<{ name: string; kind: string; handle: FileSystemDirectoryHandle | FileSystemFileHandle }> = []
  // @ts-expect-error — async iterator exists on directory handles in Chromium
  for await (const [name, handle] of dir.entries()) {
    if (depth === 0 && SKIP_DIRS.has(name)) continue
    if (SKIP_DIRS.has(name)) continue
    entries.push({ name, kind: handle.kind, handle })
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1))
  const limit = entries.slice(0, 400)
  for (const e of limit) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.kind === 'directory') {
      const children = await readFsaTree(e.handle as FileSystemDirectoryHandle, rel, depth + 1, maxDepth)
      out.push({ name: e.name, path: rel, kind: 'dir', children })
    } else {
      const fh = e.handle as FileSystemFileHandle & { getFile: () => Promise<File> }
      let size: number | undefined
      try {
        size = (await fh.getFile()).size
      } catch {
        size = undefined
      }
      out.push({ name: e.name, path: rel, kind: 'file', size })
    }
  }
  return out
}

export async function readProjectTree(project: ProjectDTO, maxDepth = 4): Promise<TreeNode[]> {
  if (project.storage === 'electron' && window.electronAPI) {
    const root = await window.electronAPI.readTree(project.path, maxDepth)
    return root.children ?? []
  }
  if (project.storage === 'fsa' && project.handleKey) {
    const ok = await ensurePermission(project)
    if (!ok) throw new Error('Permission to read this folder was not granted.')
    const handle = await idbGet<FileSystemDirectoryHandle>(project.handleKey)
    if (!handle) throw new Error('Folder handle unavailable — re-add the folder in Projects.')
    return readFsaTree(handle, '', 0, maxDepth)
  }
  throw new Error('This project has no connected folder.')
}

export async function openProjectFolder(project: ProjectDTO): Promise<void> {
  if (project.storage === 'electron' && window.electronAPI) {
    await window.electronAPI.openPath(project.path)
    return
  }
  throw new Error('Opening in Explorer is only available in the desktop app.')
}

/* ------------------------------------ Download fallback ------------------------------------ */

export function downloadFile(path: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = path.split('/').pop() || 'file.txt'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Bundle generated files into a .zip that keeps the folder structure —
 * datapacks and shader packs can be dropped into the game as-is.
 */
export async function downloadZip(zipName: string, files: Array<{ path: string; content: string }>): Promise<void> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const f of files) zip.file(f.path, f.content)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
