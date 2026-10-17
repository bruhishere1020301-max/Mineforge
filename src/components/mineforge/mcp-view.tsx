'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Cable,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import type { McpServerDTO, McpToolDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

interface AddForm {
  name: string
  transport: 'http' | 'stdio'
  url: string
  command: string
  args: string
  env: string
}

const EMPTY_ADD: AddForm = { name: '', transport: 'http', url: '', command: '', args: '', env: '' }

/** Build a starter args object from a tool's JSON-schema so the Try dialog isn't empty. */
function defaultArgsFromSchema(schema: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (typeof schema !== 'object' || schema === null) return out
  const s = schema as { properties?: Record<string, Record<string, unknown>>; required?: string[] }
  if (!s.properties) return out
  const required = new Set(s.required ?? Object.keys(s.properties))
  for (const [key, prop] of Object.entries(s.properties)) {
    if (!required.has(key)) continue
    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      out[key] = prop.enum[0]
    } else if (prop.type === 'number' || prop.type === 'integer') {
      out[key] = 1
    } else if (prop.type === 'boolean') {
      out[key] = true
    } else if (prop.type === 'object' || prop.type === 'array') {
      out[key] = {}
    } else {
      // string — pick a sensible Minecraft-ish default from the property name
      const k = key.toLowerCase()
      if (k.includes('loader')) out[key] = 'fabric'
      else if (k.includes('mc') || k.includes('minecraft')) out[key] = '1.21.1'
      else out[key] = ''
    }
  }
  return out
}

export function McpView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolDTO[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  // manual tool testing
  const [tryTool, setTryTool] = useState<{ server: McpServerDTO; tool: McpToolDTO } | null>(null)
  const [tryArgs, setTryArgs] = useState('{}')
  const [tryResult, setTryResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [tryRunning, setTryRunning] = useState(false)

  const { data, isLoading } = useQuery<{ servers: McpServerDTO[] }>({
    queryKey: ['mcp'],
    queryFn: async () => (await fetch('/api/mcp')).json(),
  })
  const servers = useMemo(() => data?.servers ?? [], [data])

  const refreshList = () => void queryClient.invalidateQueries({ queryKey: ['mcp'] })

  const applyServerUpdate = (server: McpServerDTO) => {
    queryClient.setQueryData<{ servers: McpServerDTO[] }>(['mcp'], (old) =>
      old ? { servers: old.servers.map((s) => (s.id === server.id ? server : s)) } : old
    )
  }

  const addServer = useMutation({
    mutationFn: async (f: AddForm) => {
      const payload: Record<string, unknown> = { name: f.name.trim(), transport: f.transport }
      if (f.transport === 'http') {
        payload.url = f.url.trim()
      } else {
        payload.command = f.command.trim()
        if (f.args.trim()) payload.args = f.args.trim()
        if (f.env.trim()) payload.env = f.env.trim()
      }
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as { server?: McpServerDTO; error?: string }
      if (!res.ok || !json.server) throw new Error(json.error ?? 'Failed to add server')
      return json.server
    },
    onSuccess: (s) => {
      refreshList()
      toast({ title: `Added ${s.name}`, description: 'Connecting to fetch its tools…' })
      void connect(s)
    },
    onError: (e) => toast({ title: 'Could not add server', description: e.message, variant: 'destructive' }),
  })

  const deleteServer = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/mcp/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => refreshList(),
  })

  const toggleEnabled = async (s: McpServerDTO, enabled: boolean) => {
    applyServerUpdate({ ...s, enabled })
    try {
      const res = await fetch(`/api/mcp/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('patch failed')
    } catch {
      applyServerUpdate({ ...s, enabled: !enabled })
      toast({ title: 'Could not update server', variant: 'destructive' })
    }
  }

  const connect = async (s: McpServerDTO) => {
    setConnecting(s.id)
    try {
      const res = await fetch(`/api/mcp/${s.id}/tools`)
      const json = (await res.json()) as { tools?: McpToolDTO[]; server?: McpServerDTO; error?: string }
      if (!res.ok || !json.tools) throw new Error(json.error ?? 'Connection failed')
      setToolsByServer((t) => ({ ...t, [s.id]: json.tools as McpToolDTO[] }))
      if (json.server) applyServerUpdate(json.server)
      setExpanded(s.id)
      toast({
        title: `${s.name} connected`,
        description: `${json.tools.length} tool${json.tools.length === 1 ? '' : 's'} available to the AI.`,
      })
    } catch (e) {
      // the endpoint also returns the updated server (status: error) — refetch to show it
      refreshList()
      toast({
        title: 'Connection failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setConnecting(null)
    }
  }

  const addDemo = async () => {
    const res = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MineForge Demo', transport: 'http', url: 'http://localhost:3031/mcp' }),
    })
    const json = (await res.json()) as { server?: McpServerDTO; error?: string }
    if (!res.ok || !json.server) {
      toast({ title: 'Could not add demo server', description: json.error, variant: 'destructive' })
      return
    }
    refreshList()
    toast({ title: 'Demo server added', description: 'Connecting…' })
    void connect(json.server)
  }

  const openTry = (server: McpServerDTO, tool: McpToolDTO) => {
    setTryTool({ server, tool })
    setTryResult(null)
    try {
      setTryArgs(JSON.stringify(defaultArgsFromSchema(tool.inputSchema), null, 2))
    } catch {
      setTryArgs('{}')
    }
  }

  const runTry = async () => {
    if (!tryTool) return
    let args: Record<string, unknown>
    try {
      args = tryArgs.trim() ? (JSON.parse(tryArgs) as Record<string, unknown>) : {}
      if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('not an object')
    } catch {
      setTryResult({ ok: false, text: 'Args must be a valid JSON object, e.g. {"loader":"fabric"}' })
      return
    }
    setTryRunning(true)
    try {
      const res = await fetch(`/api/mcp/${tryTool.server.id}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: tryTool.tool.name, args }),
      })
      const json = (await res.json()) as { result?: string; error?: string }
      setTryResult({ ok: res.ok, text: json.result ?? json.error ?? '(no output)' })
    } catch (e) {
      setTryResult({ ok: false, text: e instanceof Error ? e.message : 'Tool call failed' })
    } finally {
      setTryRunning(false)
    }
  }

  const hasDemo = servers.some((s) => (s.url ?? '').includes('localhost:3031'))

  const validateAdd = (): string | null => {
    if (!addForm.name.trim()) return 'Name is required'
    if (addForm.transport === 'http' && !addForm.url.trim()) return 'HTTP servers need a URL'
    if (addForm.transport === 'stdio') {
      if (!addForm.command.trim()) return 'stdio servers need a command'
      if (addForm.args.trim()) {
        try {
          const a = JSON.parse(addForm.args) as unknown
          if (!Array.isArray(a)) return 'Args must be a JSON array like ["-y","server-name"]'
        } catch {
          return 'Args is not valid JSON'
        }
      }
      if (addForm.env.trim()) {
        try {
          const e = JSON.parse(addForm.env) as unknown
          if (typeof e !== 'object' || e === null || Array.isArray(e)) return 'Env must be a JSON object like {"KEY":"value"}'
        } catch {
          return 'Env is not valid JSON'
        }
      }
    }
    return null
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-pixel text-sm text-foreground">MCP SERVERS &amp; TOOLS</h1>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Connect <b>Model Context Protocol</b> servers to give the AI extra tools while it works — version
              lookups, wiki knowledge, file access, anything an MCP server exposes. Tools from{' '}
              <b className="text-emerald-500">enabled</b> servers are automatically offered to the AI in the Studio.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { setAddForm(EMPTY_ADD); setAddOpen(true) }} className="gap-1.5 bg-emerald-600 text-emerald-50 hover:bg-emerald-500">
              <Plus className="h-4 w-4" /> Add server
            </Button>
            {!hasDemo && (
              <Button variant="outline" onClick={() => void addDemo()} className="gap-1.5">
                <FlaskConical className="h-4 w-4" /> Try demo
              </Button>
            )}
          </div>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        ) : servers.length === 0 ? (
          <div className="space-y-4 rounded-xl border border-dashed border-border py-14 text-center">
            <Cable className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No MCP servers connected yet.</p>
            <div className="mx-auto max-w-md space-y-2 px-6 text-left text-[12px] leading-relaxed text-muted-foreground/80">
              <p>
                <b className="text-foreground">HTTP / Streamable HTTP</b> — any MCP server reachable by URL (local or
                remote). Example: the built-in demo at{' '}
                <code className="rounded bg-secondary px-1">http://localhost:3031/mcp</code>.
              </p>
              <p>
                <b className="text-foreground">stdio</b> — a command run on the machine hosting the app, e.g.{' '}
                <code className="rounded bg-secondary px-1">npx -y @modelcontextprotocol/server-filesystem C:\Mods</code>.
              </p>
            </div>
            <Button variant="outline" onClick={() => void addDemo()} className="gap-1.5">
              <FlaskConical className="h-4 w-4" /> Add the demo server
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((s) => {
              const tools = toolsByServer[s.id]
              const isOpen = expanded === s.id
              return (
                <div key={s.id} className={cn('rounded-xl border bg-card p-4', s.enabled ? 'border-border' : 'border-border/60 opacity-70')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[15px] font-semibold">{s.name}</h2>
                        <Badge variant="outline" className="gap-1 border-border text-[10px] uppercase text-muted-foreground">
                          {s.transport === 'stdio' ? <Terminal className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                          {s.transport}
                        </Badge>
                        {s.status === 'connected' && (
                          <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-500">
                            <CheckCircle2 className="h-3 w-3" /> connected · {s.toolCount} tools
                          </Badge>
                        )}
                        {s.status === 'error' && (
                          <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-[10px] text-destructive">
                            <XCircle className="h-3 w-3" /> error
                          </Badge>
                        )}
                        {s.status === 'unknown' && (
                          <Badge variant="outline" className="border-dashed border-border text-[10px] text-muted-foreground">
                            not connected yet
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={s.transport === 'http' ? (s.url ?? '') : `${s.command} ${s.args ?? ''}`}>
                        {s.transport === 'http' ? (s.url ?? '—') : [s.command, s.args].filter(Boolean).join(' ')}
                      </p>
                      {s.status === 'error' && s.statusMessage && (
                        <p className="mt-1 max-w-xl break-words text-[11px] text-destructive/90">{s.statusMessage}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Switch checked={s.enabled} onCheckedChange={(v) => void toggleEnabled(s, v)} aria-label={`Enable ${s.name}`} />
                        {s.enabled ? 'AI uses it' : 'off'}
                      </label>
                      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => void connect(s)} disabled={connecting === s.id}>
                        {connecting === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {s.status === 'connected' ? 'Refresh' : 'Connect'}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteServer.mutate(s.id)} aria-label="Delete server">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {(tools ?? []).length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : s.id)}
                        className="flex w-full items-center gap-1.5 text-left text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        <Wrench className="h-3.5 w-3.5 text-emerald-500" /> {tools.length} tools
                      </button>
                      {isOpen && (
                        <div className="mt-2 space-y-1.5">
                          {tools.map((t) => (
                            <div key={t.name} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2">
                              <div className="min-w-0">
                                <p className="font-mono text-[11.5px] font-semibold text-foreground">{t.name}</p>
                                {t.description && (
                                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{t.description}</p>
                                )}
                              </div>
                              <Button variant="ghost" size="sm" className="h-6 shrink-0 gap-1 px-2 text-[10.5px] text-muted-foreground hover:text-foreground" onClick={() => openTry(s, t)}>
                                Try
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground/60">
          How it works: the app speaks the Model Context Protocol (Streamable HTTP and stdio transports). While
          generating mods or shaders, every tool from your enabled servers is offered to the AI — it can call them
          mid-conversation, see the results, and keep working. The demo server at{' '}
          <code className="rounded bg-secondary px-1">localhost:3031</code> ships with Minecraft version lookups,
          project-layout templates, shader-pack structure and a mini modding wiki.
        </p>
      </div>

      {/* add server dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add MCP server</DialogTitle>
            <DialogDescription>
              Connect any Model Context Protocol server. Its tools become available to the AI in the Studio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My MCP server"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Transport</Label>
              <Select
                value={addForm.transport}
                onValueChange={(v) => setAddForm((f) => ({ ...f, transport: v as 'http' | 'stdio' }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP — Streamable HTTP server (URL)</SelectItem>
                  <SelectItem value="stdio">stdio — local command (npx / bunx / binary)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {addForm.transport === 'http' ? (
              <div className="space-y-1.5">
                <Label htmlFor="mcp-url">Server URL</Label>
                <Input
                  id="mcp-url"
                  value={addForm.url}
                  onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="http://localhost:3031/mcp"
                  className="font-mono text-xs"
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-cmd">Command</Label>
                  <Input
                    id="mcp-cmd"
                    value={addForm.command}
                    onChange={(e) => setAddForm((f) => ({ ...f, command: e.target.value }))}
                    placeholder="npx"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-args">Arguments <span className="text-muted-foreground">(JSON array, optional)</span></Label>
                  <Textarea
                    id="mcp-args"
                    value={addForm.args}
                    onChange={(e) => setAddForm((f) => ({ ...f, args: e.target.value }))}
                    placeholder={'["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Mods"]'}
                    className="max-h-28 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-env">Environment <span className="text-muted-foreground">(JSON object, optional)</span></Label>
                  <Textarea
                    id="mcp-env"
                    value={addForm.env}
                    onChange={(e) => setAddForm((f) => ({ ...f, env: e.target.value }))}
                    placeholder={'{"GITHUB_TOKEN": "ghp_…"}'}
                    className="max-h-24 font-mono text-xs"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              className="gap-1.5 bg-emerald-600 text-emerald-50 hover:bg-emerald-500"
              disabled={!!validateAdd() || addServer.isPending}
              onClick={() => {
                addServer.mutate(addForm)
                setAddOpen(false)
              }}
            >
              {addServer.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add &amp; connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* try-tool dialog */}
      <Dialog open={!!tryTool} onOpenChange={(o) => !o && setTryTool(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-[13px]">
              <Wrench className="h-4 w-4 text-emerald-500" /> {tryTool?.tool.name}
            </DialogTitle>
            <DialogDescription>
              {tryTool?.tool.description || `Call this tool on ${tryTool?.server.name ?? ''} and see the raw result.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="try-args">Arguments (JSON)</Label>
              <Textarea
                id="try-args"
                value={tryArgs}
                onChange={(e) => setTryArgs(e.target.value)}
                className="max-h-36 font-mono text-xs"
                spellCheck={false}
              />
            </div>
            {tryResult && (
              <div className="space-y-1.5">
                <Label>Result</Label>
                <pre
                  className={cn(
                    'max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border p-3 font-mono text-[11px] leading-relaxed',
                    tryResult.ok ? 'border-border bg-secondary/40 text-foreground/90' : 'border-destructive/40 bg-destructive/10 text-destructive'
                  )}
                >
                  {tryResult.text}
                </pre>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTryTool(null)}>
              Close
            </Button>
            <Button className="gap-1.5 bg-emerald-600 text-emerald-50 hover:bg-emerald-500" onClick={() => void runTry()} disabled={tryRunning}>
              {tryRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              Run tool
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
