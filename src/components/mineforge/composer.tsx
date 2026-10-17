'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Blocks, FolderOpen, Package, Send, Sparkles, Square, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useStudioStore } from '@/store/studio'
import { CHAT_MODE_ORDER, MODE_INFO, type ChatMode, type ProjectDTO } from '@/lib/types'

const MODE_ICONS: Record<ChatMode, typeof Zap> = {
  single: Zap,
  datapack: Package,
  mod: Blocks,
  shader: Sparkles,
}

const MODE_PLACEHOLDERS: Record<ChatMode, string> = {
  single:
    'Describe the mod — you get ONE self-contained .java file to paste into your project… e.g. “Ruby Sword that sets enemies on fire — single file, Fabric 1.21.1”',
  datapack:
    'Describe the datapack… e.g. “A pack called Bonus Mining: mining stone has a 10% chance to drop bonus loot — vanilla, no mods needed”',
  mod: 'Describe the mod you want… e.g. “Create a Fabric 1.21.1 mod: ruby ore that generates underground, drops rubies, and adds a full tool set”',
  shader:
    'Describe the shader you want… e.g. “Create an Iris shader with warm cinematic sunlight, volumetric fog, waving leaves and soft shadows”',
}

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  disabled?: boolean
  activeProject: ProjectDTO | null
  contextSlot?: React.ReactNode
}

export function Composer({ value, onChange, onSend, onStop, streaming, disabled, activeProject, contextSlot }: Props) {
  const { mode, setMode, setView } = useStudioStore()
  const [projectOpen, setProjectOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { data } = useQuery<{ projects: ProjectDTO[] }>({
    queryKey: ['projects'],
    queryFn: async () => (await fetch('/api/projects')).json(),
  })
  const projects = data?.projects ?? []

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!streaming && !disabled && value.trim()) onSend()
    }
  }

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }

  return (
    <div className="border-t border-border bg-background/80 px-3 pb-3 pt-2.5 backdrop-blur sm:px-4">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {/* context row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex overflow-x-auto rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Generation mode">
            {CHAT_MODE_ORDER.map((m) => {
              const Icon = MODE_ICONS[m]
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  title={MODE_INFO[m].hint}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                    mode === m
                      ? 'bg-emerald-600 text-emerald-50'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  )}
                  aria-pressed={mode === m}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {MODE_INFO[m].label}
                </button>
              )
            })}
          </div>

          <Popover open={projectOpen} onOpenChange={setProjectOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:bg-secondary',
                  activeProject ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <FolderOpen className={cn('h-3.5 w-3.5', activeProject ? 'text-emerald-500' : '')} />
                {activeProject ? activeProject.name : 'No folder'}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
              <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Generate into folder
              </p>
              {projects.length === 0 && (
                <p className="px-2 pb-2 text-xs text-muted-foreground">
                  No project folders yet — add one from your PC in Projects.
                </p>
              )}
              <div className="max-h-60 overflow-y-auto">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary',
                      activeProject?.id === p.id && 'bg-secondary'
                    )}
                    onClick={() => {
                      useStudioStore.getState().setActiveProject(
                        activeProject?.id === p.id ? null : p.id
                      )
                      setProjectOpen(false)
                    }}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        activeProject?.id === p.id ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{p.kind}</span>
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full gap-1.5 text-xs"
                onClick={() => {
                  setProjectOpen(false)
                  setView('projects')
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" /> Manage folders
              </Button>
            </PopoverContent>
          </Popover>

          {contextSlot}
        </div>

        {/* input row */}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-sm focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/30">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              autoGrow(e.target)
            }}
            onKeyDown={handleKeyDown}
            placeholder={MODE_PLACEHOLDERS[mode]}
            rows={2}
            disabled={streaming}
            className="max-h-[220px] min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
            aria-label="Chat prompt"
          />
          {streaming ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-9 gap-1.5"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <Square className="h-3.5 w-3.5 fill-current" /> Stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-emerald-600 text-emerald-50 hover:bg-emerald-500"
              onClick={onSend}
              disabled={disabled || !value.trim()}
              aria-label="Send prompt"
            >
              <Send className="h-3.5 w-3.5" /> Forge it
            </Button>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[10.5px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate text-foreground/70" title={MODE_INFO[mode].hint}>
            {MODE_INFO[mode].hint}
          </span>
          <span className="shrink-0 text-muted-foreground/40">·</span>
          <span className="shrink-0">Enter to send · Shift+Enter for a new line</span>
        </p>
      </div>
    </div>
  )
}
