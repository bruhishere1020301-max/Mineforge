'use client'

import { useMemo, useState } from 'react'
import { Bot, Braces, Check, Copy, Eye, EyeOff, Loader2, Trash2, User } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { formatContextLength, type ContextPreview, type ContextStats } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Props {
  context: ContextPreview | null
  loading?: boolean
  liveStats?: ContextStats | null
  model: string | null
  onLimitChange: (n: number) => void
  onToggleExclude: (id: string, excluded: boolean) => void
  onDeleteMessage: (id: string) => void
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

function snippet(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 70)
}

/**
 * The REAL context window panel — shows and controls exactly which messages
 * get sent to the AI on the next request (server truth, not a mock-up).
 */
export function ContextPanel({
  context,
  loading,
  liveStats,
  model,
  onLimitChange,
  onToggleExclude,
  onDeleteMessage,
}: Props) {
  const stats = liveStats ?? context?.stats ?? null
  // slider state: local override that resets whenever the server value changes
  const contextLimit = context?.contextLimit ?? 20
  const [limitOverride, setLimitOverride] = useState<number | null>(null)
  const [prevContextLimit, setPrevContextLimit] = useState(contextLimit)
  if (prevContextLimit !== contextLimit) {
    setPrevContextLimit(contextLimit)
    setLimitOverride(null)
  }
  const limit = limitOverride ?? contextLimit
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const rows = useMemo(() => (context ? [...context.messages].reverse() : []), [context])

  const payloadJson = useMemo(() => {
    if (!context) return ''
    return JSON.stringify(
      {
        model: model ?? '(no model selected)',
        messages: [{ role: 'system', content: context.system }, ...context.llmMessages],
      },
      null,
      2
    )
  }, [context, model])

  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(payloadJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------------- header + stats ---------------- */}
      <div className="shrink-0 space-y-3 border-b border-border p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Braces className="h-4 w-4 text-emerald-500" /> Context window
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() => setPreviewOpen(true)}
            disabled={!context}
          >
            <Eye className="h-3 w-3" /> What the AI sees
          </Button>
        </div>

        {stats ? (
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg border border-border bg-card px-1.5 py-2 text-center">
              <p className="text-[15px] font-semibold leading-none">
                {stats.included}
                <span className="text-muted-foreground/60">/{stats.total}</span>
              </p>
              <p className="mt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">sent</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-1.5 py-2 text-center">
              <p className="font-mono text-[15px] font-semibold leading-none">~{fmtTokens(stats.estTokens)}</p>
              <p className="mt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">tokens (est.)</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-1.5 py-2 text-center">
              <p className="text-[15px] font-semibold leading-none">{stats.excluded}</p>
              <p className="mt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">excluded</p>
            </div>
          </div>
        ) : (
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            The AI receives the full conversation history of this session — not just your last
            message. Everything you said before stays in its context.
          </p>
        )}

        {liveStats && (
          <p className="flex items-center gap-1.5 text-[10.5px] font-medium text-emerald-500">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            sending with this context now…
          </p>
        )}

        {(stats?.contextWindow ?? liveStats?.contextWindow) &&
          (() => {
            const cw = stats?.contextWindow ?? liveStats!.contextWindow!
            return (
              <p className="text-[10.5px] leading-snug text-muted-foreground">
                <span className="font-mono font-semibold text-emerald-500">{formatContextLength(cw.length)}</span>{' '}
                model context auto-detected · ~{fmtTokens(cw.output)} reserved for the reply
                {cw.trimmed > 0 ? ` · ${cw.trimmed} old message(s) trimmed to fit` : ''}.
              </p>
            )
          })()}

        {context && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                Window size (recent messages sent)
              </span>
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-500">
                {limit}
              </span>
            </div>
            <Slider
              min={1}
              max={60}
              step={1}
              value={[limit]}
              onValueChange={(v) => setLimitOverride(v[0] ?? limit)}
              onValueCommit={(v) => onLimitChange(v[0] ?? limit)}
              aria-label="Context window size"
            />
            <p className="text-[10px] leading-relaxed text-muted-foreground/80">
              Older messages beyond the window are never sent. The system prompt is always
              included.
            </p>
          </div>
        )}
      </div>

      {/* ---------------- message list ---------------- */}
      <div className="min-h-0 flex-1">
        {loading && !context ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : !context || rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Braces className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {context
                ? 'No messages yet — everything you and the AI say will show up here with its context status.'
                : 'Start chatting and this panel will show exactly which messages the AI can see.'}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="max-h-full space-y-1.5 p-2.5">
              {rows.map((m, idx) => {
                const num = rows.length - idx
                const isUser = m.role === 'user'
                return (
                  <div
                    key={m.id}
                    className={cn(
                      'rounded-lg border p-2 transition-colors',
                      m.excluded
                        ? 'border-amber-500/30 bg-amber-500/5'
                        : m.inContext
                          ? 'border-border bg-card'
                          : 'border-border/50 bg-transparent opacity-60'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {isUser ? (
                        <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <Bot className="h-3 w-3 shrink-0 text-emerald-500" />
                      )}
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {isUser ? 'You' : 'AI'}
                      </span>
                      <span className="font-mono text-[9px] text-muted-foreground/50">#{num}</span>
                      <span className="ml-auto flex items-center gap-0.5">
                        {m.excluded ? (
                          <EyeOff className="h-3 w-3 text-amber-500" aria-label="Excluded from context" />
                        ) : m.inContext ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="In context" />
                        ) : (
                          <span
                            className="h-1.5 w-1.5 rounded-full border border-muted-foreground/60"
                            aria-label="Outside context window"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => onToggleExclude(m.id, !m.excluded)}
                          className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
                          aria-label={
                            m.excluded
                              ? 'Include this message in the context'
                              : 'Exclude this message from the context'
                          }
                        >
                          {m.excluded ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(m.id)}
                          className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
                          aria-label="Delete this message from history"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                    <p
                      className={cn(
                        'mt-1 line-clamp-1 text-[11px]',
                        m.excluded
                          ? 'text-muted-foreground line-through decoration-amber-500/50'
                          : 'text-foreground/85'
                      )}
                    >
                      {snippet(m.content) || '(empty)'}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/60">
                      ~{Math.ceil(m.content.length / 4)} tok · {m.content.length.toLocaleString()} chars
                      {m.excluded ? ' · excluded' : m.inContext ? '' : ' · out of window'}
                    </p>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* ---------------- legend ---------------- */}
      {context && rows.length > 0 && (
        <div className="shrink-0 border-t border-border px-3.5 py-2.5">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> in context
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full border border-muted-foreground/60" /> out of
              window
            </span>
            <span className="flex items-center gap-1">
              <EyeOff className="h-2.5 w-2.5 text-amber-500" /> excluded
            </span>
          </p>
        </div>
      )}

      {/* ---------------- payload preview ---------------- */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[85vh] w-[92vw] max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Eye className="h-4 w-4 text-emerald-500" /> Exactly what the AI receives
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              This is the real request payload for your next message — the system prompt plus the
              messages currently inside the context window. On Anthropic-compatible providers the
              system prompt is sent as the separate <span className="font-mono">system</span>{' '}
              field.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-zinc-950">
            <ScrollArea className="h-[52vh]">
              <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[10.5px] leading-relaxed text-emerald-100/90">
                {payloadJson}
              </pre>
            </ScrollArea>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={copyPayload}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy payload'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------- delete confirm ---------------- */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from the session history and from the AI&apos;s context window.
              Files already saved to your folder are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDeleteId) onDeleteMessage(confirmDeleteId)
                setConfirmDeleteId(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
