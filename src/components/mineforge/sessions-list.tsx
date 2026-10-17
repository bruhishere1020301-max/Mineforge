'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStudioStore } from '@/store/studio'
import type { SessionDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export function SessionsList() {
  const { activeSessionId, setActiveSession } = useStudioStore()
  const queryClient = useQueryClient()
  const { data } = useQuery<{ sessions: SessionDTO[] }>({
    queryKey: ['sessions'],
    queryFn: async () => (await fetch('/api/sessions')).json(),
  })
  const sessions = data?.sessions ?? []

  const deleteSession = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    },
    onSuccess: (_d, id) => {
      if (id === activeSessionId) setActiveSession(null)
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Sessions
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          onClick={() => setActiveSession(null)}
          title="New session"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && (
          <p className="px-2 py-1 text-[11.5px] leading-snug text-muted-foreground">
            No sessions yet — your chats appear here.
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={cn(
              'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors',
              activeSessionId === s.id
                ? 'bg-emerald-600/15 text-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => setActiveSession(s.id)}
            >
              <MessageSquare
                className={cn('h-3.5 w-3.5 shrink-0', activeSessionId === s.id && 'text-emerald-500')}
              />
              <span className="truncate">{s.title}</span>
            </button>
            <button
              type="button"
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => deleteSession.mutate(s.id)}
              aria-label={`Delete session ${s.title}`}
            >
              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
