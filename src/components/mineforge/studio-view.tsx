'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Braces, Gem, Hammer, Sun, CheckCircle2, Loader2, Wrench, Zap, PackageOpen, Pickaxe } from 'lucide-react'
import { Composer } from './composer'
import { ChatMessage, type UIMessage } from './chat-message'
import { ContextPanel } from './context-panel'
import { BrandTitle } from './logo'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useStudioStore } from '@/store/studio'
import { useToast } from '@/hooks/use-toast'
import { titleFromPrompt } from '@/lib/prompts'
import { MODE_INFO, type ChatMode, type ContextPreview, type ContextStats, type MessageDTO, type ProjectDTO, type ProviderDTO } from '@/lib/types'
import { getCachedModels } from '@/lib/models-cache'
import type { ActivityDiffLine, ActivityEntry, ActivityFileOp } from '@/lib/activity'
import { cn } from '@/lib/utils'

const TEMPLATES: Array<{ mode: ChatMode; icon: typeof Zap; title: string; prompt: string }> = [
  {
    mode: 'single',
    icon: Zap,
    title: 'Ruby sword — one file',
    prompt:
      'Create a single-file mod: a Ruby Sword for Fabric 1.21.1 — diamond-tier sword that sets enemies on fire for 4 seconds on hit. Everything in ONE self-contained .java file I can paste into my project.',
  },
  {
    mode: 'single',
    icon: Pickaxe,
    title: 'Teleport wand — one file',
    prompt:
      'Create a single-file mod: a Warp Wand for Fabric 1.21.1 — right-click teleports you 20 blocks in the direction you look (sound + particles), 3s cooldown. Everything in ONE .java file, no other files.',
  },
  {
    mode: 'datapack',
    icon: PackageOpen,
    title: 'Bonus mining (instant)',
    prompt:
      'Create a Minecraft 1.21.1 datapack called Bonus Mining: when a player mines stone, coal ore, iron ore or diamond ore, there is a 10% chance to drop a bonus item (iron ingot, gold ingot or diamond). Include pack.mcmeta, the functions, and the load/tick tags. No mods needed — instant install.',
  },
  {
    mode: 'datapack',
    icon: Hammer,
    title: 'Timber — chop full trees',
    prompt:
      'Create a Minecraft 1.21.1 datapack called Timber: when a player breaks a log while sneaking, the entire tree above it breaks and drops its logs. Include pack.mcmeta, functions and tags. Instant /reload install, no Java.',
  },
  {
    mode: 'mod' as const,
    icon: Gem,
    title: 'Ruby mod (Fabric)',
    prompt:
      'Create a complete Fabric 1.21.1 mod: Ruby ore that generates underground in small veins, drops rubies, plus a full ruby tool set (sword, pickaxe, axe, shovel, hoe) and armor with lang files, models, and recipes.',
  },
  {
    mode: 'shader' as const,
    icon: Sun,
    title: 'Cartoon shader',
    prompt:
      'Create an Iris + OptiFine compatible shader pack with a bright cartoon look: vibrant saturated colors, soft shadows, waving water and leaves, and a warm sun. Include shaders.properties and all program passes.',
  },
]

interface ToolFeedItem {
  key: number
  server: string
  tool: string
  pending: boolean
  result?: string
  /** One-line human summary of a file operation ("Created data/x.json (32 bytes)"). */
  summary?: string
  /** 'thinking' entries show the model's live reasoning / working narration. */
  kind?: 'tool' | 'thinking'
}

interface Props {
  providers: ProviderDTO[]
}

export function StudioView({ providers }: Props) {
  const { mode, setMode, activeSessionId, setActiveSession, activeProjectId, activeProviderId, activeModel, setView } =
    useStudioStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [liveStats, setLiveStats] = useState<ContextStats | null>(null)
  const [ctxSheetOpen, setCtxSheetOpen] = useState(false)
  const [toolFeed, setToolFeed] = useState<ToolFeedItem[]>([])
  const [expandedFeedKey, setExpandedFeedKey] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string | null>(null)
  const suppressReloadRef = useRef<string | null>(null)

  const { data: projectsData } = useQuery<{ projects: ProjectDTO[] }>({
    queryKey: ['projects'],
    queryFn: async () => (await fetch('/api/projects')).json(),
  })
  const activeProject = useMemo(
    () => projectsData?.projects.find((p) => p.id === activeProjectId) ?? null,
    [projectsData, activeProjectId]
  )
  const provider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) ?? providers[0],
    [providers, activeProviderId]
  )
  const model = activeModel ?? provider?.defaultModel ?? null

  // ---- REAL context window — server truth from /api/sessions/:id/context ----
  const {
    data: contextData,
    isLoading: contextLoading,
    refetch: refetchContext,
  } = useQuery<{ context: ContextPreview | null }>({
    queryKey: ['session-context', activeSessionId],
    queryFn: async () => {
      const r = await fetch(`/api/sessions/${activeSessionId}/context`)
      if (!r.ok) return { context: null }
      return (await r.json()) as { context: ContextPreview }
    },
    enabled: !!activeSessionId,
  })
  const context = contextData?.context ?? null
  const stats = liveStats ?? context?.stats ?? null

  const reloadMessages = useCallback(async (sid: string) => {
    try {
      const r = await fetch(`/api/sessions/${sid}`)
      if (!r.ok) return
      const data = (await r.json()) as { messages?: MessageDTO[] }
      setMessages(
        (data.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          excluded: m.excluded,
        }))
      )
    } catch {
      // keep the current view
    }
  }, [])

  // load an existing session's messages (skipped when send() just created this session locally —
  // reloading mid-stream would wipe the in-flight assistant message)
  useEffect(() => {
    sessionIdRef.current = activeSessionId
    setLiveStats(null)
    if (!activeSessionId) {
      setMessages([])
      return
    }
    if (suppressReloadRef.current === activeSessionId) {
      suppressReloadRef.current = null
      return
    }
    void reloadMessages(activeSessionId)
  }, [activeSessionId, reloadMessages])

  // ---- stick-to-bottom chat scrolling (instant while streaming) --------------
  // The old smooth scrollIntoView fired on every streamed chunk and browsers
  // coalesce those into no movement at all. Now: the view follows the
  // generation instantly while the user is at the bottom, and stops following
  // the moment they scroll up to read something.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const onChatScroll = () => {
    const el = scrollContainerRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  }
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, toolFeed])

  // ---- context window controls ----
  const changeLimit = useCallback(
    async (n: number) => {
      if (!activeSessionId) return
      try {
        await fetch(`/api/sessions/${activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contextLimit: n }),
        })
        await refetchContext()
      } catch {
        toast({ title: 'Could not save window size', variant: 'destructive' })
      }
    },
    [activeSessionId, refetchContext, toast]
  )

  const toggleExclude = useCallback(
    async (id: string, excluded: boolean) => {
      // optimistic: update the chat bubble badge right away
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, excluded } : x)))
      try {
        await fetch(`/api/messages/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ excluded }),
        })
        await refetchContext()
      } catch {
        setMessages((m) => m.map((x) => (x.id === id ? { ...x, excluded: !excluded } : x)))
        toast({ title: 'Could not update context', variant: 'destructive' })
      }
    },
    [refetchContext, toast]
  )

  const deleteMessageById = useCallback(
    async (id: string) => {
      setMessages((m) => m.filter((x) => x.id !== id))
      try {
        await fetch(`/api/messages/${id}`, { method: 'DELETE' })
        await refetchContext()
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
        toast({ title: 'Message removed', description: 'It is gone from the history and the AI\u2019s context.' })
      } catch {
        toast({ title: 'Could not delete message', variant: 'destructive' })
        if (activeSessionId) void reloadMessages(activeSessionId)
      }
    },
    [activeSessionId, queryClient, refetchContext, reloadMessages, toast]
  )

  // ---- send ----
  const send = useCallback(
    async (promptText?: string) => {
      const text = (promptText ?? input).trim()
      if (!text || streaming) return

      // Read the CURRENT mode from the store — template clicks call setMode + send
      // in the same tick, so a closure over the render-time `mode` would be stale.
      const modeNow = useStudioStore.getState().mode

      if (!provider || !model) {
        toast({
          title: 'No AI provider selected',
          description: 'Add an OpenAI- or Anthropic-compatible provider with your API key, then pick a model.',
        })
        setView('providers')
        return
      }

      const userMsg: UIMessage = { id: `u-${Date.now()}`, role: 'user', content: text }
      const assistantId = `a-${Date.now()}`
      setMessages((m) => [...m, userMsg, { id: assistantId, role: 'assistant', content: '', streaming: true }])
      setInput('')
      setStreaming(true)
      setLiveStats(null)
      setToolFeed([])
      // sending always re-attaches the view to the bottom
      stickToBottomRef.current = true
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
      let toolKey = 0

      // ensure a session exists
      let sessionId = sessionIdRef.current
      if (!sessionId) {
        try {
          const res = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: titleFromPrompt(text),
              mode: modeNow,
              projectId: activeProjectId,
            }),
          })
          const json = (await res.json()) as { session?: { id: string } }
          if (json.session?.id) {
            sessionId = json.session.id
            sessionIdRef.current = sessionId
            suppressReloadRef.current = sessionId // keep the in-flight local messages
            setActiveSession(sessionId)
          }
        } catch {
          // session persistence is best-effort — chat still works statelessly
        }
      } else {
        // keep an existing session's mode in sync with the selected pill
        void fetch(`/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: modeNow }),
        }).catch(() => {})
      }

      const controller = new AbortController()
      abortRef.current = controller
      let full = ''
      let fileToolsUsed = false
      // Cline-style inline activity attached to the streaming assistant message
      let lastActivityReasoning = false
      const pushActivity = (entry: ActivityEntry, mergeReasoning = false) => {
        setMessages((m) =>
          m.map((x) => {
            if (x.id !== assistantId) return x
            const arr = x.activity ?? []
            if (mergeReasoning && entry.kind === 'thinking' && arr.length > 0) {
              const last = arr[arr.length - 1]
              if (last && last.kind === 'thinking') {
                return { ...x, activity: [...arr.slice(0, -1), { ...last, text: last.text + entry.text }] }
              }
            }
            return { ...x, activity: [...arr, entry] }
          })
        )
      }
      // auto-detected context window of the active model (from the model list)
      const contextLength = getCachedModels(provider.id)?.find((m) => m.id === model)?.contextLength ?? null

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(
            sessionId
              ? {
                  // real context path — the server persists this message and builds
                  // the context window from the session's stored history
                  providerId: provider.id,
                  model,
                  mode: modeNow,
                  projectName: activeProject?.name ?? null,
                  projectKind: activeProject?.kind ?? null,
                  projectId: activeProjectId ?? null,
                  contextLength,
                  sessionId,
                  content: text,
                }
              : {
                  // stateless fallback
                  providerId: provider.id,
                  model,
                  mode: modeNow,
                  projectName: activeProject?.name ?? null,
                  projectKind: activeProject?.kind ?? null,
                  projectId: activeProjectId ?? null,
                  contextLength,
                  messages: [...messages, userMsg]
                    .filter((m) => !m.streaming && m.content)
                    .slice(-60)
                    .map((m) => ({ role: m.role, content: m.content })),
                }
          ),
        })
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(err?.error ?? `Chat request failed (${res.status})`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const l = line.trim()
            if (!l.startsWith('data:')) continue
            try {
              const ev = JSON.parse(l.slice(5).trim()) as {
                type: string
                text?: string
                message?: string
                context?: ContextStats
                server?: string
                tool?: string
                result?: string
                summary?: string
                kind?: string
                op?: string
                path?: string
                diff?: ActivityDiffLine[]
              }
              // thinking rows settle as soon as the next real event arrives
              const settleThinking = (f: ToolFeedItem[]) =>
                f.some((x) => x.kind === 'thinking' && x.pending)
                  ? f.map((x) => (x.kind === 'thinking' && x.pending ? { ...x, pending: false } : x))
                  : f
              if (ev.type === 'meta' && ev.context) {
                // live stats for the Context panel while streaming
                setLiveStats(ev.context)
              } else if (ev.type === 'note' && ev.text) {
                // live "thinking": reasoning accumulates, narration is one row
                const noteText = ev.text
                const isReasoning = ev.kind === 'reasoning'
                pushActivity({ kind: 'thinking', text: noteText }, isReasoning && lastActivityReasoning)
                lastActivityReasoning = isReasoning
                setToolFeed((f) => {
                  if (isReasoning) {
                    const last = f[f.length - 1]
                    if (last && last.kind === 'thinking' && last.pending && last.tool === 'thinking…') {
                      return f.map((x, i) =>
                        i === f.length - 1 ? { ...x, result: `${x.result ?? ''}${noteText}` } : x
                      )
                    }
                  }
                  toolKey += 1
                  return [
                    ...settleThinking(f),
                    {
                      key: toolKey,
                      server: 'AI',
                      tool: isReasoning ? 'thinking…' : 'working',
                      kind: 'thinking' as const,
                      pending: isReasoning,
                      result: noteText,
                    },
                  ]
                })
              } else if (ev.type === 'tool_start' && ev.server && ev.tool) {
                if (ev.server === 'Project files') fileToolsUsed = true
                toolKey += 1
                const item: ToolFeedItem = { key: toolKey, server: ev.server, tool: ev.tool, pending: true }
                setToolFeed((f) => [...settleThinking(f), item])
              } else if (ev.type === 'tool' && ev.server && ev.tool) {
                const summary = ev.summary
                if (ev.server === 'Self-check') {
                  lastActivityReasoning = false
                  pushActivity({ kind: 'check', text: ev.result ?? 'Self-check', ok: !(ev.result ?? '').includes('⚠') })
                } else if (ev.server === 'Project files' && ev.op && ev.path) {
                  lastActivityReasoning = false
                  pushActivity({
                    kind: 'file',
                    op: ev.op as ActivityFileOp,
                    path: ev.path,
                    summary: summary ?? ev.tool,
                    diff: ev.diff,
                  })
                }
                // mark the newest matching pending entry as done
                setToolFeed((f) => {
                  const settled = settleThinking(f)
                  let idx = -1
                  for (let i = settled.length - 1; i >= 0; i--) {
                    if (settled[i].server === ev.server && settled[i].tool === ev.tool && settled[i].pending) {
                      idx = i
                      break
                    }
                  }
                  if (idx === -1) {
                    toolKey += 1
                    return [
                      ...settled,
                      { key: toolKey, server: ev.server ?? '', tool: ev.tool ?? '', pending: false, result: ev.result, summary },
                    ]
                  }
                  return settled.map((x, i) => (i === idx ? { ...x, pending: false, result: ev.result, summary: summary ?? x.summary } : x))
                })
              } else if (ev.type === 'text' && ev.text) {
                full += ev.text
                setToolFeed((f) => settleThinking(f))
                setMessages((m) =>
                  m.map((x) => (x.id === assistantId ? { ...x, content: x.content + ev.text } : x))
                )
              } else if (ev.type === 'replace' && typeof ev.text === 'string') {
                // the automatic self-check rewrote the reply — swap the whole message
                const replaced = ev.text
                full = replaced
                setToolFeed((f) => settleThinking(f))
                setMessages((m) =>
                  m.map((x) => (x.id === assistantId ? { ...x, content: replaced } : x))
                )
              } else if (ev.type === 'error') {
                const msgText = ev.message ?? 'Provider error'
                setToolFeed((f) => settleThinking(f))
                setMessages((m) =>
                  m.map((x) => (x.id === assistantId ? { ...x, content: `⚠️ ${msgText}`, error: true } : x))
                )
              }
            } catch {
              // ignore malformed event
            }
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          const msgText = e instanceof Error ? e.message : 'Network error'
          setMessages((m) =>
            m.map((x) => (x.id === assistantId ? { ...x, content: `⚠️ ${msgText}`, error: true } : x))
          )
        }
      } finally {
        setStreaming(false)
        abortRef.current = null
        setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, streaming: false } : x)))
        setToolFeed((f) =>
          f.some((x) => x.kind === 'thinking' && x.pending)
            ? f.map((x) => (x.kind === 'thinking' && x.pending ? { ...x, pending: false } : x))
            : f
        )
        // the AI touched project files directly — refresh folder listings
        if (fileToolsUsed) void queryClient.invalidateQueries({ queryKey: ['projects'] })
        // the server persisted both messages — resync from the DB so the
        // context panel and chat bubbles share real message ids
        if (sessionId) {
          void (async () => {
            await reloadMessages(sessionId as string)
            await refetchContext()
            void queryClient.invalidateQueries({ queryKey: ['sessions'] })
            setLiveStats(null)
          })()
        } else {
          setLiveStats(null)
        }
      }
    },
    [input, streaming, provider, model, activeProjectId, activeProject, messages, reloadMessages, refetchContext, queryClient, setActiveSession, setView, toast]
  )

  const stop = () => abortRef.current?.abort()

  const panelProps = {
    context,
    loading: contextLoading,
    liveStats,
    model,
    onLimitChange: (n: number) => void changeLimit(n),
    onToggleExclude: (id: string, excluded: boolean) => void toggleExclude(id, excluded),
    onDeleteMessage: (id: string) => void deleteMessageById(id),
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------- chat column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={onChatScroll}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 [scrollbar-width:thin]"
        >
          <div className="mx-auto w-full max-w-3xl space-y-5">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-6 py-8 text-center sm:py-14">
                <div className="space-y-3">
                  <div className="flex justify-center">
                    <BrandTitle />
                  </div>
                  <h1 className="font-pixel text-sm leading-relaxed text-foreground sm:text-base">
                    One-file mods · instant datapacks<br />full projects &amp; shaders
                  </h1>
                  <p className="mx-auto max-w-md text-[13px] leading-relaxed text-muted-foreground">
                    {provider && model ? (
                      <>
                        Using <span className="font-semibold text-foreground">{provider.name}</span> ·{' '}
                        <span className="font-mono text-emerald-500">{model}</span>. Describe what you want — files are
                        written straight into your connected folder.
                      </>
                    ) : (
                      <>Add an AI provider (OpenAI or Anthropic compatible) with your API key to start generating.</>
                    )}
                  </p>
                  <p className="mx-auto flex max-w-md items-center justify-center gap-1.5 text-[11px] text-muted-foreground/80">
                    <Braces className="h-3.5 w-3.5 shrink-0 text-emerald-500/80" />
                    The AI remembers your whole conversation — the Context window panel shows and controls exactly what
                    it sees.
                  </p>
                </div>
                <div className="grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.title}
                      type="button"
                      onClick={() => {
                        setMode(t.mode)
                        void send(t.prompt)
                      }}
                      className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-all hover:border-emerald-500/40 hover:bg-secondary/40 hover:shadow-md"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-500 transition-colors group-hover:bg-emerald-600 group-hover:text-emerald-50">
                        <t.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                          {t.title}
                          <span className={cnBadge(t.mode)}>{MODE_INFO[t.mode].short}</span>
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[11.5px] leading-snug text-muted-foreground">
                          {t.prompt}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <ChatMessage key={m.id} message={m} activeProject={activeProject} onFilesSaved={() => void queryClient.invalidateQueries({ queryKey: ['projects'] })} />
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* MCP tool activity feed (live during generation) */}
        {toolFeed.length > 0 && (
          <div className="shrink-0 border-t border-border bg-background/60 px-3 py-2 sm:px-4">
            <div className="mx-auto w-full max-w-3xl rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-500">
                <Wrench className="h-3.5 w-3.5" /> AI activity — tools, files &amp; thinking
              </p>
              <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
                {toolFeed.map((t) => {
                  const isThinking = t.kind === 'thinking'
                  const expanded = expandedFeedKey === t.key
                  const clickable = !!t.result
                  return (
                    <div
                      key={t.key}
                      className={cn('flex items-start gap-2 text-[11.5px]', clickable && 'cursor-pointer')}
                      onClick={() => {
                        if (clickable) setExpandedFeedKey(expanded ? null : t.key)
                      }}
                    >
                      {t.pending ? (
                        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-emerald-500" />
                      ) : isThinking ? (
                        <span className="mt-0.5 h-3.5 shrink-0 text-center text-[11px] leading-none">💭</span>
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      )}
                      <span className="min-w-0 flex-1">
                        {isThinking ? (
                          <span
                            className={cn(
                              'block whitespace-pre-wrap italic leading-snug text-muted-foreground',
                              !expanded && 'line-clamp-2'
                            )}
                          >
                            {t.result}
                          </span>
                        ) : (
                          <>
                            <span className="font-mono font-semibold">{t.summary ?? t.tool}</span>
                            <span className="text-muted-foreground"> · {t.server}</span>
                            {!expanded && !t.summary && t.result && (
                              <span
                                className="block truncate font-mono text-[10.5px] text-muted-foreground/80"
                                title={t.result}
                              >
                                {t.result.split('\n')[0].slice(0, 160)}
                              </span>
                            )}
                          </>
                        )}
                        {expanded && t.result && (
                          <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/70 p-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                            {t.result}
                          </pre>
                        )}
                        {clickable && (
                          <span className="block text-[9.5px] text-muted-foreground/50">
                            {expanded ? '▾ collapse' : '▸ details'}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          onStop={stop}
          streaming={streaming}
          activeProject={activeProject}
          contextSlot={
            <button
              type="button"
              onClick={() => setCtxSheetOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
              aria-label="Open context window panel"
            >
              <Braces className="h-3.5 w-3.5 text-emerald-500" />
              {stats ? `${stats.included}/${stats.total} context` : 'Context'}
            </button>
          }
        />
      </div>

      {/* ---------------- context panel (desktop) ---------------- */}
      <aside
        className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-sidebar/40 lg:flex"
        aria-label="Context window panel"
      >
        <ContextPanel {...panelProps} />
      </aside>

      {/* ---------------- context panel (mobile) ---------------- */}
      <Sheet open={ctxSheetOpen} onOpenChange={setCtxSheetOpen}>
        <SheetContent side="right" className="flex w-[88vw] max-w-[340px] flex-col gap-0 p-0">
          <SheetHeader className="shrink-0 border-b border-border px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-[13px]">
              <Braces className="h-4 w-4 text-emerald-500" /> Context window
            </SheetTitle>
            <SheetDescription className="sr-only">
              Manage which messages the AI can see in this session&apos;s context window.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <ContextPanel {...panelProps} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function cnBadge(mode: ChatMode) {
  return `rounded px-1 py-px text-[9px] font-bold uppercase ${MODE_INFO[mode].badgeClass}`
}
