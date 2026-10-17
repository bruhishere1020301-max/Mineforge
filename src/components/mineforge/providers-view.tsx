'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  RefreshCw,
  Router,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useStudioStore } from '@/store/studio'
import { getCachedModels, setCachedModels } from '@/lib/models-cache'
import { PROVIDER_TYPE_INFO, formatContextLength, type ModelInfo, type ProviderDTO, type ProviderType } from '@/lib/types'
import { cn } from '@/lib/utils'

interface FormState {
  id?: string
  name: string
  type: ProviderType
  baseUrl: string
  apiKey: string
}

const EMPTY_FORM: FormState = { name: '', type: 'openai', baseUrl: '', apiKey: '' }

const PRESETS: Record<ProviderType, { baseUrl: string; name: string; hint: string }> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'Works with OpenAI, OpenRouter, Groq, Together, DeepSeek and any /chat/completions API.',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    hint: 'Works with Anthropic and any Anthropic-compatible proxy (uses /v1/messages with x-api-key).',
  },
  local: {
    name: 'Local AI (Ollama)',
    baseUrl: 'http://localhost:11434/v1',
    hint: 'Runs on your own PC — no API key, no cloud, nothing leaves your machine. 9Router, Ollama, LM Studio, llama.cpp, Jan or any OpenAI-compatible local server.',
  },
}

const LOCAL_PRESETS: { label: string; baseUrl: string }[] = [
  { label: '9Router', baseUrl: 'http://localhost:20128/v1' },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { label: 'llama.cpp', baseUrl: 'http://localhost:8080/v1' },
  { label: 'Jan', baseUrl: 'http://localhost:1337/v1' },
  { label: 'Demo (built-in)', baseUrl: 'http://localhost:3030/v1' },
]

/** 9Router — a local AI gateway (one OpenAI-compatible endpoint for 60+ providers). */
const NINETROUTER_BASE_URL = 'http://localhost:20128/v1'

export function ProvidersView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { activeProviderId, setActiveProvider, setActiveModel } = useStudioStore()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [modelLists, setModelLists] = useState<Record<string, ModelInfo[]>>({})
  const [modelQuery, setModelQuery] = useState('')

  const { data, isLoading } = useQuery<{ providers: ProviderDTO[] }>({
    queryKey: ['providers'],
    queryFn: async () => (await fetch('/api/providers')).json(),
  })
  const providers = useMemo(() => data?.providers ?? [], [data])

  // hydrate model lists from cache
  useEffect(() => {
    const initial: Record<string, ModelInfo[]> = {}
    for (const p of providers) {
      const cached = getCachedModels(p.id)
      if (cached) initial[p.id] = cached
    }
    if (Object.keys(initial).length > 0) setModelLists((prev) => ({ ...initial, ...prev }))
  }, [providers])

  const testConnection = async (p: ProviderDTO) => {
    setTesting(p.id)
    try {
      const res = await fetch(`/api/providers/${p.id}/models`, { method: 'POST' })
      const json = (await res.json()) as { models?: ModelInfo[]; error?: string }
      if (!res.ok || !json.models) throw new Error(json.error ?? 'Connection failed')
      setModelLists((m) => ({ ...m, [p.id]: json.models as ModelInfo[] }))
      setCachedModels(p.id, json.models)
      toast({
        title: `Connected — ${json.models.length} models`,
        description: json.models.slice(0, 4).map((m) => m.id).join(', ') + (json.models.length > 4 ? ' …' : ''),
      })
    } catch (e) {
      toast({
        title: 'Connection failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setTesting(null)
    }
  }

  const saveProvider = useMutation({
    mutationFn: async (f: FormState) => {
      const isEdit = !!f.id
      const res = await fetch(isEdit ? `/api/providers/${f.id}` : '/api/providers', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: f.name,
          type: f.type,
          baseUrl: f.baseUrl,
          ...(f.apiKey ? { apiKey: f.apiKey } : {}),
        }),
      })
      const json = (await res.json()) as { provider?: ProviderDTO; error?: string }
      if (!res.ok || !json.provider) throw new Error(json.error ?? 'Failed to save provider')
      return json.provider
    },
    onSuccess: (p, f) => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] })
      if (!activeProviderId) {
        setActiveProvider(p.id)
        if (p.defaultModel) setActiveModel(p.defaultModel)
      }
      toast({ title: `Provider saved — ${p.name}`, description: 'Now fetch its model list and pick a model.' })
      // Brand-new provider → pull its FULL model list immediately (e.g. every
      // model routed by 9Router appears without an extra click).
      if (!f.id) void testConnection(p)
    },
    onError: (e) => toast({ title: 'Could not save provider', description: e.message, variant: 'destructive' }),
  })

  const deleteProvider = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/providers/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] })
      if (activeProviderId) setActiveProvider(null)
    },
  })

  const setDefaultModel = useMutation({
    mutationFn: async ({ id, model }: { id: string; model: string }) => {
      const res = await fetch(`/api/providers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModel: model }),
      })
      if (!res.ok) throw new Error('Failed to set default model')
    },
    onError: () => toast({ title: 'Could not set model', variant: 'destructive' }),
  })

  const openAdd = (preset?: 'demo' | '9router') => {
    if (preset === 'demo') {
      setForm({
        name: 'Demo (offline mock)',
        type: 'local',
        baseUrl: 'http://localhost:3030/v1',
        apiKey: '',
      })
    } else if (preset === '9router') {
      setForm({
        name: '9Router',
        type: 'local',
        baseUrl: NINETROUTER_BASE_URL,
        apiKey: '',
      })
    } else {
      setForm({ ...EMPTY_FORM, name: PRESETS.openai.name, baseUrl: PRESETS.openai.baseUrl })
    }
    setShowKey(false)
    setDialogOpen(true)
  }

  const openEdit = (p: ProviderDTO) => {
    setForm({ id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl, apiKey: '' })
    setShowKey(false)
    setDialogOpen(true)
  }

  const isDemoRunning = providers.some((p) => p.baseUrl.includes('localhost:3030'))
  const is9RouterAdded = providers.some((p) => p.baseUrl.includes('localhost:20128'))

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-pixel text-sm text-foreground">AI PROVIDERS &amp; MODELS</h1>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Bring your own keys — OpenAI-compatible (<code className="rounded bg-secondary px-1">/chat/completions</code>),
              Anthropic-compatible (<code className="rounded bg-secondary px-1">/v1/messages</code>), or{' '}
              <b className="text-amber-500">Local AI</b> running on your own PC (<b>9Router</b>, Ollama, LM Studio,
              llama.cpp — no key needed). Keys are stored in the local app database and only used server-side.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => openAdd()} className="gap-1.5 bg-emerald-600 text-emerald-50 hover:bg-emerald-500">
              <KeyRound className="h-4 w-4" /> Add provider
            </Button>
            {!is9RouterAdded && (
              <Button variant="outline" onClick={() => openAdd('9router')} className="gap-1.5">
                <Router className="h-4 w-4" /> 9Router
              </Button>
            )}
            {!isDemoRunning && (
              <Button variant="outline" onClick={() => openAdd('demo')} className="gap-1.5">
                <FlaskConical className="h-4 w-4" /> Try demo
              </Button>
            )}
          </div>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        ) : providers.length === 0 ? (
          <div className="space-y-4 rounded-xl border border-dashed border-border py-14 text-center">
            <KeyRound className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No providers yet.</p>
            <div className="mx-auto max-w-md space-y-2 px-6 text-left text-[12px] leading-relaxed text-muted-foreground/80">
              <p>
                <b className="text-foreground">OpenAI-compatible</b> — OpenAI, OpenRouter, Groq, DeepSeek, Together… any
                endpoint exposing <code>/v1/chat/completions</code>.
              </p>
              <p>
                <b className="text-foreground">Anthropic-compatible</b> — Anthropic API or proxies exposing{' '}
                <code>/v1/messages</code>.
              </p>
              <p>
                <b className="text-amber-500">Local AI</b> — 9Router, Ollama, LM Studio, llama.cpp, Jan… models running
                on your own PC. No API key, no cloud.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => {
              const models = modelLists[p.id] ?? getCachedModels(p.id) ?? []
              return (
                <div
                  key={p.id}
                  className={cn(
                    'rounded-xl border bg-card p-4',
                    activeProviderId === p.id ? 'border-emerald-500/50' : 'border-border'
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[15px] font-semibold">{p.name}</h2>
                        <Badge variant="outline" className={cn('text-[10px]', PROVIDER_TYPE_INFO[p.type].badgeClass)}>
                          {PROVIDER_TYPE_INFO[p.type].label}
                        </Badge>
                        {activeProviderId === p.id && (
                          <Badge className="bg-emerald-600 text-[10px] text-emerald-50">in use</Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={p.baseUrl}>
                        {p.baseUrl}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">key: {p.maskedKey}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => testConnection(p)} disabled={testing === p.id}>
                        {testing === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                        Test / fetch models
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} aria-label="Edit provider">
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteProvider.mutate(p.id)} aria-label="Delete provider">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="flex min-w-56 items-center gap-2">
                      <span className="text-[11px] font-medium text-muted-foreground">Default model</span>
                      <Select
                        value={p.defaultModel ?? undefined}
                        onValueChange={(v) => {
                          setDefaultModel.mutate({ id: p.id, model: v })
                          if (activeProviderId === p.id) setActiveModel(v)
                        }}
                      >
                        <SelectTrigger className="h-8 w-64 font-mono text-xs">
                          <SelectValue placeholder={models.length ? 'Pick a model' : 'Fetch list first'} />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {models.length === 0 && p.defaultModel && (
                            <SelectItem value={p.defaultModel} className="font-mono text-xs">
                              {p.defaultModel}
                            </SelectItem>
                          )}
                          {models.map((m) => (
                            <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                              {m.displayName ? `${m.displayName} — ${m.id}` : m.id}
                              {formatContextLength(m.contextLength) ? ` · ${formatContextLength(m.contextLength)} ctx` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {models.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {models.length} models
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-[11px] text-muted-foreground"
                      onClick={() => {
                        setActiveProvider(p.id)
                        setActiveModel(p.defaultModel)
                        toast({ title: `Using ${p.name}` })
                      }}
                    >
                      <RefreshCw className="h-3 w-3" /> Use this provider
                    </Button>
                  </div>
                  {models.length === 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                      <XCircle className="h-3 w-3" /> No model list yet — hit “Test / fetch models”.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground/60">
          <b className="text-foreground">9Router</b> — one local endpoint for 60+ AI providers with automatic
          fallback: install it with <code className="rounded bg-secondary px-1">npm install -g 9router</code>, start it
          with <code className="rounded bg-secondary px-1">9router</code>, connect your providers in its dashboard
          (localhost:20128), then hit <b>Test / fetch models</b> here. The demo provider is a{' '}
          <b>Local AI</b> entry pointing at <code className="rounded bg-secondary px-1">http://localhost:3030/v1</code>{' '}
          — a tiny offline mock bundled with this app for trying the full flow (including MCP tools) without real keys
          or a local model server. For real local AI use 9Router, <b>Ollama</b> or <b>LM Studio</b>.
        </p>
      </div>

      {/* add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit provider' : 'Add AI provider'}</DialogTitle>
            <DialogDescription>
              Point MineForge at any OpenAI- or Anthropic-compatible endpoint. The key is stored locally in the app
              database.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => {
                  const t = v as ProviderType
                  setForm((f) => {
                    const wasPresetName = Object.values(PRESETS).some((p) => p.name === f.name)
                    const wasPresetUrl = Object.values(PRESETS).some((p) => p.baseUrl === f.baseUrl)
                    return {
                      ...f,
                      type: t,
                      name: !f.id && (wasPresetName || !f.name.trim()) ? PRESETS[t].name : f.name,
                      baseUrl: !f.id && (wasPresetUrl || !f.baseUrl.trim()) ? PRESETS[t].baseUrl : f.baseUrl,
                    }
                  })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI-compatible (/v1/chat/completions)</SelectItem>
                  <SelectItem value="anthropic">Anthropic-compatible (/v1/messages)</SelectItem>
                  <SelectItem value="local">Local AI — your PC (9Router / Ollama / LM Studio, no key)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">{PRESETS[form.type].hint}</p>
              {form.type === 'local' && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {LOCAL_PRESETS.map((lp) => (
                    <button
                      key={lp.label}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          name: !f.id && (f.name === PRESETS.local.name || f.name === PRESETS.openai.name || f.name === PRESETS.anthropic.name || !f.name.trim()) ? lp.label : f.name,
                          baseUrl: lp.baseUrl,
                        }))
                      }
                      className={cn(
                        'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                        form.baseUrl === lp.baseUrl
                          ? 'border-amber-500/50 bg-amber-500/15 text-amber-500'
                          : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'
                      )}
                    >
                      {lp.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pv-name">Display name</Label>
              <Input id="pv-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="My OpenRouter" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pv-url">Base URL</Label>
              <Input
                id="pv-url"
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder={PRESETS[form.type].baseUrl}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pv-key">
                API key{' '}
                {form.type === 'local' ? (
                  <span className="text-amber-500">(not needed for local AI)</span>
                ) : (
                  form.id && <span className="text-muted-foreground">(leave blank to keep current)</span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="pv-key"
                  type={showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="sk-…"
                  className="pr-10 font-mono text-xs"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 text-emerald-50 hover:bg-emerald-500"
              disabled={!form.name.trim() || !form.baseUrl.trim() || (!form.id && form.type !== 'local' && !form.apiKey.trim()) || saveProvider.isPending}
              onClick={() => {
                saveProvider.mutate(form)
                setDialogOpen(false)
              }}
            >
              {saveProvider.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {form.id ? 'Save changes' : 'Add provider'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
