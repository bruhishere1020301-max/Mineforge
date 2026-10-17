'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleAlert,
  FolderPlus,
  FolderOpen,
  Hammer,
  HardDrive,
  Loader2,
  Monitor,
  Plug,
  RefreshCw,
  Trash2,
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
import { DirTree } from './dir-tree'
import { useToast } from '@/hooks/use-toast'
import { useStudioStore } from '@/store/studio'
import {
  ensurePermission,
  forgetHandle,
  getHandlePermission,
  hasDirectoryPicker,
  isElectron,
  openProjectFolder,
  pickDirectory,
  readProjectTree,
} from '@/lib/fs-access'
import { KIND_BADGE_CLASS, PROJECT_KINDS, type ProjectDTO, type ProjectKind, type TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ProjectsView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { activeProjectId, setActiveProject, setView } = useStudioStore()
  const [manualOpen, setManualOpen] = useState(false)
  const [manualForm, setManualForm] = useState({ name: '', path: '', kind: 'fabric' as ProjectKind })
  const [treeFor, setTreeFor] = useState<string | null>(null)
  const [buildingFor, setBuildingFor] = useState<string | null>(null)
  const [trees, setTrees] = useState<Record<string, TreeNode[]>>({})
  const [treeLoading, setTreeLoading] = useState(false)
  const [permissions, setPermissions] = useState<Record<string, 'granted' | 'prompt' | 'denied' | 'unavailable'>>({})

  const { data, isLoading } = useQuery<{ projects: ProjectDTO[] }>({
    queryKey: ['projects'],
    queryFn: async () => (await fetch('/api/projects')).json(),
  })
  const projects = useMemo(() => data?.projects ?? [], [data])

  // check FSA handle availability (only meaningful in browser mode)
  useEffect(() => {
    if (isElectron()) return
    let cancelled = false
    const run = async () => {
      const next: Record<string, 'granted' | 'prompt' | 'denied' | 'unavailable'> = {}
      for (const p of projects) {
        if (p.storage === 'fsa') next[p.id] = await getHandlePermission(p)
      }
      if (!cancelled && Object.keys(next).length > 0) setPermissions((prev) => ({ ...prev, ...next }))
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [projects])

  const addProject = useMutation({
    mutationFn: async (payload: {
      name: string
      path: string
      kind: ProjectKind
      storage: 'fsa' | 'electron' | 'manual'
      handleKey?: string | null
    }) => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as { project?: ProjectDTO; error?: string }
      if (!res.ok || !json.project) throw new Error(json.error ?? 'Failed to add project')
      return json.project
    },
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      setActiveProject(p.id)
      toast({ title: `Folder connected — ${p.name}`, description: 'Generated files will be written right into it.' })
    },
    onError: (e) => toast({ title: 'Could not add folder', description: e.message, variant: 'destructive' }),
  })

  const removeProject = useMutation({
    mutationFn: async (p: ProjectDTO) => {
      await fetch(`/api/projects/${p.id}`, { method: 'DELETE' })
      await forgetHandle(p)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const handlePickFolder = async () => {
    try {
      const picked = await pickDirectory()
      if (!picked) return
      addProject.mutate({
        name: picked.name,
        path: picked.path,
        kind: useStudioStore.getState().mode === 'shader' ? 'shader' : useStudioStore.getState().mode === 'datapack' ? 'datapack' : 'fabric',
        storage: picked.storage,
        handleKey: picked.handleKey,
      })
    } catch (e) {
      toast({
        title: 'Folder picking failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  const reconnect = async (p: ProjectDTO) => {
    const ok = await ensurePermission(p)
    setPermissions((prev) => ({ ...prev, [p.id]: ok ? 'granted' : 'denied' }))
    toast(
      ok
        ? { title: 'Access granted', description: `“${p.name}” is ready for reading and writing.` }
        : { title: 'Access denied', variant: 'destructive' }
    )
  }

  const browse = async (p: ProjectDTO) => {
    if (treeFor === p.id) {
      setTreeFor(null)
      return
    }
    setTreeFor(p.id)
    setTreeLoading(true)
    try {
      const tree = await readProjectTree(p)
      setTrees((t) => ({ ...t, [p.id]: tree }))
    } catch (e) {
      toast({
        title: 'Could not read folder',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
      setTreeFor(null)
    } finally {
      setTreeLoading(false)
    }
  }

  const openFolder = async (p: ProjectDTO) => {
    try {
      await openProjectFolder(p)
    } catch (e) {
      toast({
        title: 'Not available here',
        description: e instanceof Error ? e.message : 'Only in the desktop app.',
        variant: 'destructive',
      })
    }
  }

  // run `gradlew build` server-side (CurseForge-grade flow:
  // generate → Build .jar → drop into .minecraft/mods)
  const buildProject = async (p: ProjectDTO) => {
    setBuildingFor(p.id)
    try {
      const res = await fetch(`/api/projects/${p.id}/build`, { method: 'POST' })
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean
        summary?: string
        output?: string
        error?: string
      } | null
      if (!res.ok) throw new Error(json?.error ?? `Build failed (${res.status})`)
      if (json?.ok) {
        toast({ title: 'Build OK', description: json.summary ?? 'Jar in build/libs/' })
      } else {
        const tail = (json?.output ?? '').split('\n').slice(-8).join('\n').slice(0, 500)
        toast({ title: 'Build failed', description: tail || 'See the build output.', variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'Could not build', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setBuildingFor(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-pixel text-sm text-foreground">PROJECT FOLDERS</h1>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Connect folders from your PC — the AI writes generated mods &amp; shader packs straight into them.{' '}
              {isElectron()
                ? 'Running in the desktop app: native folder picker + direct file writes.'
                : 'Browser mode: pick a folder and grant read/write access (Chrome/Edge), or use the desktop app for native dialogs.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handlePickFolder} disabled={!hasDirectoryPicker()} className="gap-1.5 bg-emerald-600 text-emerald-50 hover:bg-emerald-500">
              <FolderPlus className="h-4 w-4" /> Add folder from PC
            </Button>
            <Button variant="outline" onClick={() => setManualOpen(true)} className="gap-1.5">
              <Plug className="h-4 w-4" /> Manual entry
            </Button>
          </div>
        </header>

        {!hasDirectoryPicker() && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-[12.5px] text-amber-500">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This browser can&apos;t pick real folders. Use Chrome or Edge on desktop for one-click folder access, or
              run the MineForge desktop app for native folder dialogs — or add the folder manually below.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No folders connected yet.</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground/80">
              Tip: create an empty folder like <code className="rounded bg-secondary px-1 py-0.5">C:\Mods\rubymod</code>{' '}
              and connect it — then everything the AI generates lands there, ready for <code>gradlew build</code>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {projects.map((p) => {
              const perm = permissions[p.id]
              const needsReconnect = !isElectron() && p.storage === 'fsa' && perm !== 'granted'
              return (
                <div
                  key={p.id}
                  className={cn(
                    'rounded-xl border bg-card p-4 transition-colors',
                    activeProjectId === p.id ? 'border-emerald-500/50 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]' : 'border-border'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-[15px] font-semibold">{p.name}</h2>
                        <Badge variant="outline" className={cn('border text-[10px] uppercase', KIND_BADGE_CLASS[p.kind])}>
                          {PROJECT_KINDS.find((k) => k.value === p.kind)?.label ?? p.kind}
                        </Badge>
                        {p.storage === 'electron' && (
                          <Badge variant="outline" className="gap-1 border-border text-[10px] text-muted-foreground">
                            <Monitor className="h-3 w-3" /> native
                          </Badge>
                        )}
                        {p.storage === 'fsa' && (
                          <Badge variant="outline" className="gap-1 border-border text-[10px] text-muted-foreground">
                            <HardDrive className="h-3 w-3" /> browser
                          </Badge>
                        )}
                        {p.storage === 'manual' && (
                          <Badge variant="outline" className="border-dashed border-border text-[10px] text-muted-foreground">
                            metadata only
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={p.path}>
                        {p.path}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant={activeProjectId === p.id ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setActiveProject(activeProjectId === p.id ? null : p.id)}
                      >
                        {activeProjectId === p.id ? 'Active' : 'Set active'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeProject.mutate(p)}
                        aria-label="Remove project"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {needsReconnect && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <p className="text-[11.5px] text-amber-500">
                        {perm === 'unavailable'
                          ? 'Folder handle lost (browser storage cleared) — remove and re-add the folder.'
                          : 'Folder access needs to be re-granted after a reload.'}
                      </p>
                      {perm !== 'unavailable' && (
                        <Button size="sm" variant="outline" className="h-7 gap-1 border-amber-500/40 text-[11px] text-amber-500 hover:text-amber-400" onClick={() => reconnect(p)}>
                          <RefreshCw className="h-3 w-3" /> Reconnect
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" className="h-7 gap-1.5 text-[11.5px]" onClick={() => browse(p)}>
                      <FolderOpen className="h-3.5 w-3.5" /> {treeFor === p.id ? 'Hide files' : 'Browse files'}
                    </Button>
                    {isElectron() && (
                      <Button variant="secondary" size="sm" className="h-7 gap-1.5 text-[11.5px]" onClick={() => openFolder(p)}>
                        Open in Explorer
                      </Button>
                    )}
                    {p.storage !== 'fsa' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 gap-1.5 text-[11.5px]"
                        disabled={buildingFor === p.id}
                        onClick={() => void buildProject(p)}
                        title="Run gradlew build — the jar lands in build/libs/"
                      >
                        {buildingFor === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Hammer className="h-3.5 w-3.5" />
                        )}
                        {buildingFor === p.id ? 'Building… (first run downloads Gradle)' : 'Build .jar'}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[11.5px] text-muted-foreground" onClick={() => setView('studio')}>
                      Generate here →
                    </Button>
                  </div>

                  {treeFor === p.id && (
                    <div className="mt-3">
                      <DirTree tree={trees[p.id] ?? []} loading={treeLoading} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* manual entry dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add folder manually</DialogTitle>
            <DialogDescription>
              Metadata-only entry — for the browser preview or when you just want to track a path. The desktop app
              writes to real folders picked with the native dialog.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mf-name">Name</Label>
              <Input
                id="mf-name"
                value={manualForm.name}
                onChange={(e) => setManualForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My Ruby Mod"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-path">Path on your PC</Label>
              <Input
                id="mf-path"
                value={manualForm.path}
                onChange={(e) => setManualForm((f) => ({ ...f, path: e.target.value }))}
                placeholder="C:\Mods\rubymod"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Project type</Label>
              <Select
                value={manualForm.kind}
                onValueChange={(v) => setManualForm((f) => ({ ...f, kind: v as ProjectKind }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!manualForm.name.trim() || !manualForm.path.trim() || addProject.isPending}
              onClick={() => {
                addProject.mutate({
                  name: manualForm.name.trim(),
                  path: manualForm.path.trim(),
                  kind: manualForm.kind,
                  storage: 'manual',
                })
                setManualOpen(false)
                setManualForm({ name: '', path: '', kind: 'fabric' })
              }}
            >
              {addProject.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
