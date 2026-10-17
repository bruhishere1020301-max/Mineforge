'use client'

import { useEffect, useMemo, useState } from 'react'
import { Cpu, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStudioStore } from '@/store/studio'
import { getCachedModels, setCachedModels } from '@/lib/models-cache'
import { formatContextLength, type ModelInfo, type ProviderDTO } from '@/lib/types'

interface Props {
  providers: ProviderDTO[]
}

export function ModelPicker({ providers }: Props) {
  const {
    activeProviderId,
    activeModel,
    setActiveProvider,
    setActiveModel,
  } = useStudioStore()
  const [open, setOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [manual, setManual] = useState('')
  const [query, setQuery] = useState('')

  const provider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) ?? providers[0],
    [providers, activeProviderId]
  )
  const model = activeModel ?? provider?.defaultModel ?? ''

  const [models, setModels] = useState<ModelInfo[] | null>(null)
  useEffect(() => {
    setModels(provider ? getCachedModels(provider.id) : null)
    setManual('')
    setQuery('')
  }, [provider?.id, open])

  // keep a sensible fallback selection
  useEffect(() => {
    if (!provider) return
    if (!activeModel && provider.defaultModel) setActiveModel(provider.defaultModel)
  }, [provider, activeModel, setActiveModel])

  const fetchModels = async () => {
    if (!provider) return
    setFetching(true)
    try {
      const res = await fetch(`/api/providers/${provider.id}/models`, { method: 'POST' })
      const json = (await res.json()) as { models?: ModelInfo[]; error?: string }
      if (!res.ok || !json.models) throw new Error(json.error ?? 'Failed to fetch models')
      setModels(json.models)
      setCachedModels(provider.id, json.models)
      if (!json.models.some((m) => m.id === model) && json.models.length > 0) {
        setActiveModel(json.models[0].id)
      }
    } catch {
      setModels([])
    } finally {
      setFetching(false)
    }
  }

  // Auto-load the full model list when the picker opens and nothing is cached
  // yet — e.g. right after connecting 9Router, every routed model shows up
  // without pressing "Fetch list".
  useEffect(() => {
    if (open && provider && models === null && !fetching) void fetchModels()
  }, [open, provider?.id, models, fetching])

  /** The models the search box narrows down. */
  const allModels = models ?? (provider?.defaultModel ? [{ id: provider.defaultModel }] : [])
  const q = query.trim().toLowerCase()
  const filteredModels = q
    ? allModels.filter(
        (m) =>
          m.id.toLowerCase().includes(q) || (m.displayName ?? '').toLowerCase().includes(q)
      )
    : allModels

  if (providers.length === 0) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 border-dashed text-muted-foreground"
        onClick={() => useStudioStore.getState().setView('providers')}
      >
        <Cpu className="h-3.5 w-3.5" />
        Add AI provider
      </Button>
    )
  }

  const typeLabel = provider?.type === 'anthropic' ? 'Anthropic' : provider?.type === 'local' ? 'Local' : 'OpenAI'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 max-w-[280px] gap-1.5 font-mono text-xs">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span className="truncate">
            {provider ? `${provider.name} / ${model || 'pick a model'}` : 'Select AI model'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Provider ({typeLabel}-compatible)</Label>
            <Select
              value={provider?.id}
              onValueChange={(v) => {
                const p = providers.find((x) => x.id === v)
                setActiveProvider(v)
                setActiveModel(p?.defaultModel ?? null)
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Choose provider" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-sm">
                    {p.name} · {p.type === 'anthropic' ? 'Anthropic' : p.type === 'local' ? 'Local' : 'OpenAI'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Model
                {allModels.length > 0 && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    ({q ? `${filteredModels.length}/${allModels.length}` : allModels.length})
                  </span>
                )}
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                onClick={fetchModels}
                disabled={fetching || !provider}
              >
                {fetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Fetch list
              </Button>
            </div>
            {allModels.length > 3 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${allModels.length} models…`}
                  className="h-8 pl-8 text-xs"
                  aria-label="Search models"
                />
              </div>
            )}
            <Select value={model || undefined} onValueChange={(v) => setActiveModel(v)}>
              <SelectTrigger className="h-9 w-full font-mono text-xs">
                <SelectValue placeholder={fetching ? 'Loading models…' : 'Choose a model'} />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {filteredModels.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                    {m.displayName ? `${m.displayName} — ${m.id}` : m.id}
                    {formatContextLength(m.contextLength) ? ` · ${formatContextLength(m.contextLength)} ctx` : ''}
                  </SelectItem>
                ))}
                {model && !allModels.some((m) => m.id === model) && (
                  <SelectItem value={model} className="font-mono text-xs">
                    {model}
                  </SelectItem>
                )}
                {q && filteredModels.length === 0 && (
                  <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                    No models match “{query}”.
                  </p>
                )}
              </SelectContent>
            </Select>
            {models === null && !fetching && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Press <span className="font-semibold">Fetch list</span> to load available models from your provider.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Or type a model id</Label>
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manual.trim()) {
                  setActiveModel(manual.trim())
                  setOpen(false)
                }
              }}
              placeholder="e.g. gpt-4o / claude-sonnet-4-20250514"
              className="h-9 font-mono text-xs"
            />
            {manual.trim() && manual.trim() !== model && (
              <Button
                size="sm"
                className="h-7 w-full gap-1 text-xs"
                onClick={() => {
                  setActiveModel(manual.trim())
                  setOpen(false)
                }}
              >
                <Sparkles className="h-3 w-3" /> Use “{manual.trim()}”
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
