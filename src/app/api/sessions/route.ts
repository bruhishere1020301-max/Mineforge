import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { ChatMode, SessionDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export function toSessionDTO(s: {
  id: string
  title: string
  mode: string
  projectId: string | null
  contextLimit?: number | null
  updatedAt: Date
  messageCount?: number
}): SessionDTO {
  return {
    id: s.id,
    title: s.title,
    mode: s.mode as ChatMode,
    projectId: s.projectId,
    contextLimit: s.contextLimit ?? 20,
    updatedAt: s.updatedAt.toISOString(),
    messageCount: s.messageCount,
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(120).default('New session'),
  mode: z.enum(['single', 'datapack', 'mod', 'shader']).default('mod'),
  projectId: z.string().nullable().optional(),
})

export async function GET() {
  const sessions = await db.chatSession.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { messages: true } } },
    take: 60,
  })
  return NextResponse.json({
    sessions: sessions.map((s) => toSessionDTO({ ...s, messageCount: s._count.messages })),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid session payload' }, { status: 400 })
  }
  const { title, mode, projectId } = parsed.data
  const session = await db.chatSession.create({
    data: { title, mode, projectId: projectId ?? null },
  })
  return NextResponse.json({ session: toSessionDTO(session) }, { status: 201 })
}
