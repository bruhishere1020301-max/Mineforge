// Client UI state (persisted): active view, mode, selected project/provider/model.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMode } from '@/lib/types'

export type ViewId = 'studio' | 'projects' | 'providers' | 'mcp'

interface StudioState {
  view: ViewId
  mode: ChatMode
  activeProjectId: string | null
  activeSessionId: string | null
  activeProviderId: string | null
  activeModel: string | null
  setView: (v: ViewId) => void
  setMode: (m: ChatMode) => void
  setActiveProject: (id: string | null) => void
  setActiveSession: (id: string | null) => void
  setActiveProvider: (id: string | null) => void
  setActiveModel: (m: string | null) => void
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set) => ({
      view: 'studio',
      mode: 'mod',
      activeProjectId: null,
      activeSessionId: null,
      activeProviderId: null,
      activeModel: null,
      setView: (view) => set({ view }),
      setMode: (mode) => set({ mode }),
      setActiveProject: (activeProjectId) => set({ activeProjectId }),
      setActiveSession: (activeSessionId) => set({ activeSessionId }),
      setActiveProvider: (activeProviderId) => set({ activeProviderId, activeModel: null }),
      setActiveModel: (activeModel) => set({ activeModel }),
    }),
    {
      name: 'mineforge-ui',
      partialize: (s) => ({
        mode: s.mode,
        activeProjectId: s.activeProjectId,
        activeProviderId: s.activeProviderId,
        activeModel: s.activeModel,
      }),
    }
  )
)
