'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FilePlus2,
  FilePenLine,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActivityDiffLine, ActivityEntry } from '@/lib/activity'

const OP_META = {
  create: { icon: FilePlus2, verb: 'created', tone: 'text-emerald-500' },
  overwrite: { icon: FilePenLine, verb: 'overwrote', tone: 'text-amber-500' },
  edit: { icon: FilePenLine, verb: 'edited', tone: 'text-sky-500' },
  delete: { icon: Trash2, verb: 'deleted', tone: 'text-red-500' },
} as const

/** Unified diff rows: line-number gutter + colored +/- lines (like Cline). */
function DiffBlock({ diff }: { diff: ActivityDiffLine[] }) {
  return (
    <div className="mt-1.5 overflow-x-auto rounded border border-border/60 font-mono text-[10.5px] leading-[1.55]">
      {diff.map((l, i) => (
        <div
          key={i}
          className={cn(
            'flex min-w-max',
            l.sign === '+' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            l.sign === '-' && 'bg-red-500/10 text-red-600 dark:text-red-400',
            l.sign === ' ' && 'text-muted-foreground/60'
          )}
        >
          <span className="w-10 shrink-0 select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground/40">
            {l.n ?? ''}
          </span>
          <span className="w-4 shrink-0 select-none text-center font-bold">{l.sign === ' ' ? '' : l.sign}</span>
          <span className="whitespace-pre pr-3">{l.t}</span>
        </div>
      ))}
    </div>
  )
}

function ThinkingBlock({ entry, live }: { entry: Extract<ActivityEntry, { kind: 'thinking' }>; live: boolean }) {
  // open while it is the live last entry, collapsed once the run finishes
  const [open, setOpen] = useState(live)
  return (
    <div className="rounded-lg border border-border/60 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {live ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-emerald-500" />
        ) : (
          <Sparkles className="h-3 w-3 shrink-0 text-emerald-500/70" />
        )}
        <span>{live ? 'Thinking…' : 'Thought'}</span>
      </button>
      {open && (
        <p className="max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-border/40 px-3 py-2 text-[11.5px] italic leading-relaxed text-muted-foreground">
          {entry.text}
        </p>
      )}
    </div>
  )
}

function FileBlock({ entry, live }: { entry: Extract<ActivityEntry, { kind: 'file' }>; live: boolean }) {
  const [open, setOpen] = useState(false)
  const meta = OP_META[entry.op] ?? OP_META.edit
  const Icon = meta.icon
  const hasProblems = !!entry.problems && entry.problems.length > 0
  return (
    <div className="rounded-lg border border-border/60 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-secondary/30"
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.tone)} />
        <span className="truncate font-mono font-semibold text-foreground">{entry.path}</span>
        <span className="shrink-0 text-muted-foreground">{meta.verb}</span>
        {live ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-emerald-500" />
        ) : hasProblems ? (
          <CircleAlert className="h-3 w-3 shrink-0 text-red-500" />
        ) : (
          <CircleCheck className="h-3 w-3 shrink-0 text-emerald-500" />
        )}
        {open ? (
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2">
          {entry.diff && entry.diff.length > 0 ? (
            <DiffBlock diff={entry.diff} />
          ) : (
            <p className="text-[11px] text-muted-foreground">{entry.summary}</p>
          )}
          {hasProblems && (
            <p className="mt-1.5 text-[10.5px] text-red-500">⚠ {entry.problems!.join('; ')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function CheckBlock({ entry }: { entry: Extract<ActivityEntry, { kind: 'check' }> }) {
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug',
        entry.ok
          ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-500'
      )}
    >
      {entry.ok ? (
        <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">{entry.text}</span>
    </div>
  )
}

/** Cline-style inline activity: live thinking, file diffs, check verdicts. */
export function ActivityView({ entries, streaming }: { entries: ActivityEntry[]; streaming?: boolean }) {
  if (entries.length === 0) return null
  const lastIndex = entries.length - 1
  return (
    <div className="mb-2 space-y-1.5">
      {entries.map((e, i) => {
        const live = !!streaming && i === lastIndex
        if (e.kind === 'thinking') return <ThinkingBlock key={i} entry={e} live={live} />
        if (e.kind === 'file') return <FileBlock key={i} entry={e} live={live} />
        return <CheckBlock key={i} entry={e} />
      })}
    </div>
  )
}
