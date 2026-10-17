import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { MessageDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Context-window controls for a single message.
 * PATCH  { excluded: boolean } — include/exclude this message from the AI's context
 * DELETE — remove it from the session history entirely
 */
const patchSchema = z.object({ excluded: z.boolean() })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const existing = await db.chatMessage.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  const msg = await db.chatMessage.update({ where: { id }, data: { excluded: parsed.data.excluded } })
  const dto: MessageDTO = {
    id: msg.id,
    role: msg.role as MessageDTO['role'],
    content: msg.content,
    excluded: msg.excluded,
    createdAt: msg.createdAt.toISOString(),
  }
  return NextResponse.json({ message: dto })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.chatMessage.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
}
