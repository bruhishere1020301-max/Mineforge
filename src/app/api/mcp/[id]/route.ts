import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { invalidateMcpServer } from '@/lib/server/mcp-client'
import { toMcpDTO } from '../route'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().max(1000).nullable().optional(),
  command: z.string().max(500).nullable().optional(),
  args: z.string().max(4000).nullable().optional(),
  env: z.string().max(4000).nullable().optional(),
  enabled: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const existing = await db.mcpServer.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })

  const data: Record<string, unknown> = { ...parsed.data }
  // config changed → reset connection status
  const configChanged =
    (parsed.data.url !== undefined && parsed.data.url !== existing.url) ||
    (parsed.data.command !== undefined && parsed.data.command !== existing.command) ||
    (parsed.data.args !== undefined && parsed.data.args !== existing.args) ||
    (parsed.data.env !== undefined && parsed.data.env !== existing.env)
  if (configChanged) {
    data.status = 'unknown'
    data.statusMessage = null
    data.toolCount = 0
    invalidateMcpServer(id)
  }
  const server = await db.mcpServer.update({ where: { id }, data })
  return NextResponse.json({ server: toMcpDTO(server) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  invalidateMcpServer(id)
  try {
    await db.mcpServer.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
  }
}
