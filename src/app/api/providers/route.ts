import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { ProviderDTO, ProviderType } from '@/lib/types'

export const dynamic = 'force-dynamic'

function mask(key: string): string {
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export function toProviderDTO(p: {
  id: string
  name: string
  type: string
  baseUrl: string
  apiKey: string
  defaultModel: string | null
  createdAt: Date
}): ProviderDTO {
  return {
    id: p.id,
    name: p.name,
    type: p.type as ProviderType,
    baseUrl: p.baseUrl,
    maskedKey: p.apiKey ? mask(p.apiKey) : 'no key needed',
    hasKey: p.apiKey.length > 0,
    defaultModel: p.defaultModel,
    createdAt: p.createdAt.toISOString(),
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['openai', 'anthropic', 'local']),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().max(2000).optional(), // optional for local AI (Ollama, LM Studio, …)
  defaultModel: z.string().max(200).optional().nullable(),
})

export async function GET() {
  const providers = await db.provider.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ providers: providers.map(toProviderDTO) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid provider payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const { name, type, baseUrl, apiKey, defaultModel } = parsed.data
  if (type !== 'local' && !apiKey) {
    return NextResponse.json({ error: 'API key is required for cloud providers (local AI needs none)' }, { status: 400 })
  }
  const provider = await db.provider.create({
    data: { name, type, baseUrl, apiKey: apiKey ?? '', defaultModel: defaultModel ?? null },
  })
  return NextResponse.json({ provider: toProviderDTO(provider) }, { status: 201 })
}
