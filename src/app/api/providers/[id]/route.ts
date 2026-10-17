import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { toProviderDTO } from '../route'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  type: z.enum(['openai', 'anthropic', 'local']).optional(),
  baseUrl: z.string().url().max(500).optional(),
  apiKey: z.string().max(2000).optional(), // empty → keep existing
  defaultModel: z.string().max(200).nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const existing = await db.provider.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

  const data: Record<string, string | null> = {}
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.type !== undefined) data.type = parsed.data.type
  if (parsed.data.baseUrl !== undefined) data.baseUrl = parsed.data.baseUrl
  if (parsed.data.apiKey) data.apiKey = parsed.data.apiKey
  if (parsed.data.defaultModel !== undefined) data.defaultModel = parsed.data.defaultModel

  const provider = await db.provider.update({ where: { id }, data })
  return NextResponse.json({ provider: toProviderDTO(provider) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.provider.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }
}
