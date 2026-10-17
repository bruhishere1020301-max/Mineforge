'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Blocks, Cable, FolderOpen, Hammer, KeyRound, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { BrandTitle } from './logo'
import { ThemeToggle } from './theme-toggle'
import { ModelPicker } from './model-picker'
import { SessionsList } from './sessions-list'
import { StudioView } from './studio-view'
import { ProjectsView } from './projects-view'
import { ProvidersView } from './providers-view'
import { McpView } from './mcp-view'
import { useStudioStore, type ViewId } from '@/store/studio'
import { MODE_INFO, type ProjectDTO, type ProviderDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

const NAV: { id: ViewId; label: string; icon: typeof Hammer }[] = [
  { id: 'studio', label: 'Studio', icon: Hammer },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'providers', label: 'AI Models', icon: KeyRound },
  { id: 'mcp', label: 'MCP Tools', icon: Cable },
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView } = useStudioStore()
  return (
    <nav aria-label="Main navigation" className="space-y-1 px-2">
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            setView(item.id)
            onNavigate?.()
          }}
          aria-current={view === item.id ? 'page' : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
            view === item.id
              ? 'bg-emerald-600/15 text-emerald-500'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {item.label}
        </button>
      ))}
    </nav>
  )
}

export function AppShell() {
  const { view, mode, activeProjectId, activeProviderId, activeModel } = useStudioStore()
  const [mobileOpen, setMobileOpen] = useState(false)

  const { data: providersData } = useQuery<{ providers: ProviderDTO[] }>({
    queryKey: ['providers'],
    queryFn: async () => (await fetch('/api/providers')).json(),
  })
  const providers = providersData?.providers ?? []

  const { data: projectsData } = useQuery<{ projects: ProjectDTO[] }>({
    queryKey: ['projects'],
    queryFn: async () => (await fetch('/api/projects')).json(),
  })
  const activeProject = projectsData?.projects.find((p) => p.id === activeProjectId) ?? null
  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? providers[0]
  const model = activeModel ?? activeProvider?.defaultModel ?? null

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      {/* ---------------- header ---------------- */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/60 px-3 backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {/* mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 lg:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="border-b border-border px-4 py-3.5">
                <SheetTitle asChild>
                  <div>
                    <BrandTitle />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="flex h-[calc(100%-4.5rem)] flex-col">
                <div className="py-3">
                  <SidebarNav onNavigate={() => setMobileOpen(false)} />
                </div>
                {view === 'studio' && <SessionsList />}
              </div>
            </SheetContent>
          </Sheet>
          <BrandTitle />
        </div>
        <div className="flex items-center gap-1.5">
          <ModelPicker providers={providers} />
          <ThemeToggle />
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <div className="flex min-h-0 flex-1">
        {/* desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
          <div className="py-3">
            <SidebarNav />
          </div>
          {view === 'studio' && (
            <div className="flex min-h-0 flex-1 flex-col border-t border-border">
              <SessionsList />
            </div>
          )}
          <div className="border-t border-border p-3">
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Blocks className="h-3 w-3" /> one-file mods · datapacks · shaders · your keys
            </p>
          </div>
        </aside>

        {/* main view */}
        <main className="min-w-0 flex-1 overflow-hidden">
          {view === 'studio' && <StudioView providers={providers} />}
          {view === 'projects' && <ProjectsView />}
          {view === 'providers' && <ProvidersView />}
          {view === 'mcp' && <McpView />}
        </main>
      </div>

      {/* ---------------- status bar (sticky footer) ---------------- */}
      <footer className="mt-auto flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border bg-card/70 px-3 text-[11px] text-muted-foreground backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', MODE_INFO[mode].dotClass)} />
            {MODE_INFO[mode].statusText}
          </span>
          <span className="hidden text-muted-foreground/40 sm:inline">|</span>
          <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
            <FolderOpen className="h-3 w-3 shrink-0" />
            {activeProject ? <span className="truncate">{activeProject.name}</span> : 'no folder'}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate">
            {activeProvider ? (
              <>
                {activeProvider.name} · <span className="font-mono text-emerald-500">{model ?? 'no model'}</span>
              </>
            ) : (
              'no provider configured'
            )}
          </span>
        </div>
      </footer>
    </div>
  )
}
