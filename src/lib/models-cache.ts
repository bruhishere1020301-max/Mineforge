'use client'

// Cache fetched model lists per provider in localStorage.
import type { ModelInfo } from '@/lib/types'

const PREFIX = 'mineforge-models:'

export function getCachedModels(providerId: string): ModelInfo[] | null {
  try {
    const raw = localStorage.getItem(PREFIX + providerId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { models?: ModelInfo[]; at?: number }
    if (!Array.isArray(parsed.models) || parsed.models.length === 0) return null
    return parsed.models
  } catch {
    return null
  }
}

export function setCachedModels(providerId: string, models: ModelInfo[]): void {
  try {
    localStorage.setItem(PREFIX + providerId, JSON.stringify({ models, at: Date.now() }))
  } catch {
    // storage full / private mode — ignore
  }
}
