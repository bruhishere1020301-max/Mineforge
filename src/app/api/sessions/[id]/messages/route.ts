import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { MessageDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
})

/** POST /api/sessions/:id/messages — persist one message. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid message payload' }, { status: 400 })

  const session = await db.chatSession.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const msg = await db.chatMessage.create({ data: { sessionId: id, ...parsed.data } })
  // touch the session so it sorts to the top
  await db.chatSession.update({ where: { id }, data: { updatedAt: new Date() } })

  const dto: MessageDTO = {
    id: msg.id,
    role: msg.role as MessageDTO['role'],
    content: msg.content,
    excluded: msg.excluded,
    createdAt: msg.createdAt.toISOString(),
  }
  return NextResponse.json({ message: dto }, { status: 201 })
}
