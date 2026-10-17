import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchProviderModels } from '@/lib/server/llm'
import type { ProviderType } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** POST /api/providers/:id/models — fetch available models from the provider (also acts as connection test). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const provider = await db.provider.findUnique({ where: { id } })
  if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

  try {
    const models = await fetchProviderModels(
      provider.type as ProviderType,
      provider.baseUrl,
      provider.apiKey
    )
    return NextResponse.json({ models })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch models' },
      { status: 400 }
    )
  }
}
