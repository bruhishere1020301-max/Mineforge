import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { toProjectDTO } from '../route'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  kind: z.enum(['fabric', 'forge', 'neoforge', 'quilt', 'shader', 'datapack', 'other']).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const existing = await db.project.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const project = await db.project.update({
    where: { id },
    data: { ...parsed.data },
  })
  return NextResponse.json({ project: toProjectDTO(project) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.project.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
}
