import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { ProjectDTO, ProjectKind, ProjectStorage } from '@/lib/types'

export const dynamic = 'force-dynamic'

export function toProjectDTO(p: {
  id: string
  name: string
  path: string
  kind: string
  storage: string
  handleKey: string | null
  createdAt: Date
}): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    kind: p.kind as ProjectKind,
    storage: p.storage as ProjectStorage,
    handleKey: p.handleKey,
    createdAt: p.createdAt.toISOString(),
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  path: z.string().min(1).max(1000),
  kind: z.enum(['fabric', 'forge', 'neoforge', 'quilt', 'shader', 'datapack', 'other']),
  storage: z.enum(['fsa', 'electron', 'manual']).default('manual'),
  handleKey: z.string().max(200).nullable().optional(),
})

export async function GET() {
  const projects = await db.project.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ projects: projects.map(toProjectDTO) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid project payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const { name, path, kind, storage, handleKey } = parsed.data
  const project = await db.project.create({
    data: { name, path, kind, storage, handleKey: handleKey ?? null },
  })
  return NextResponse.json({ project: toProjectDTO(project) }, { status: 201 })
}
