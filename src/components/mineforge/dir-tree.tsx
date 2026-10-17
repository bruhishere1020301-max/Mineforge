'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react'
import type { TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'

function formatSize(size?: number): string | null {
  if (size === undefined) return null
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1)
  const isDir = node.kind === 'dir'
  const size = formatSize(node.size)

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded px-1.5 py-[3px] text-left text-[12px] hover:bg-secondary"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={() => isDir && setOpen((o) => !o)}
      >
        {isDir ? (
          <>
            {open ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          </>
        ) : (
          <span className="ml-3 flex shrink-0">
            <File className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        )}
        <span className={cn('truncate', isDir ? 'font-medium' : 'text-muted-foreground')}>{node.name}</span>
        {size && <span className="ml-auto shrink-0 pl-2 text-[10px] text-muted-foreground/70">{size}</span>}
      </button>
      {isDir && open && (
        <div>
          {(node.children ?? []).map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} />
          ))}
          {(node.children ?? []).length === 0 && (
            <p className="py-0.5 text-[10.5px] text-muted-foreground/60" style={{ paddingLeft: `${(depth + 1) * 14 + 26}px` }}>
              empty
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function DirTree({ tree, loading }: { tree: TreeNode[]; loading?: boolean }) {
  if (loading) return <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading folder…</p>
  if (tree.length === 0) return <p className="px-2 py-1.5 text-xs text-muted-foreground">Folder is empty.</p>
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
      {tree.map((n) => (
        <TreeRow key={n.path} node={n} depth={0} />
      ))}
    </div>
  )
}
