import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { toSessionDTO } from '../route'
import type { MessageDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

function toMessageDTO(m: {
  id: string
  role: string
  content: string
  excluded: boolean
  createdAt: Date
}): MessageDTO {
  return {
    id: m.id,
    role: m.role as MessageDTO['role'],
    content: m.content,
    excluded: m.excluded,
    createdAt: m.createdAt.toISOString(),
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await db.chatSession.findUnique({
    where: { id },
    include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  return NextResponse.json({
    session: toSessionDTO(session),
    messages: session.messages.map(toMessageDTO),
  })
}

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  mode: z.enum(['single', 'datapack', 'mod', 'shader']).optional(),
  projectId: z.string().nullable().optional(),
  contextLimit: z.number().int().min(1).max(60).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const existing = await db.chatSession.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  const session = await db.chatSession.update({ where: { id }, data: { ...parsed.data } })
  return NextResponse.json({ session: toSessionDTO(session) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.chatSession.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
}
