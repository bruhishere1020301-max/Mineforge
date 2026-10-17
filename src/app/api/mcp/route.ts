import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export function toMcpDTO(s: {
  id: string
  name: string
  transport: string
  url: string | null
  command: string | null
  args: string | null
  env: string | null
  enabled: boolean
  status: string
  statusMessage: string | null
  toolCount: number
  createdAt: Date
}) {
  return {
    id: s.id,
    name: s.name,
    transport: s.transport as 'http' | 'stdio',
    url: s.url,
    command: s.command,
    args: s.args,
    env: s.env,
    enabled: s.enabled,
    status: s.status,
    statusMessage: s.statusMessage,
    toolCount: s.toolCount,
    createdAt: s.createdAt.toISOString(),
  }
}

export type McpServerDTO = ReturnType<typeof toMcpDTO>

const createSchema = z.object({
  name: z.string().min(1).max(120),
  transport: z.enum(['http', 'stdio']),
  url: z.string().max(1000).optional().nullable(),
  command: z.string().max(500).optional().nullable(),
  args: z.string().max(4000).optional().nullable(), // JSON array
  env: z.string().max(4000).optional().nullable(), // JSON object
})

export async function GET() {
  const servers = await db.mcpServer.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ servers: servers.map(toMcpDTO) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid MCP server payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const { name, transport, url, command, args, env } = parsed.data
  if (transport === 'http' && !url) return NextResponse.json({ error: 'HTTP transport needs a URL' }, { status: 400 })
  if (transport === 'stdio' && !command) return NextResponse.json({ error: 'stdio transport needs a command' }, { status: 400 })
  const server = await db.mcpServer.create({
    data: { name, transport, url: url ?? null, command: command ?? null, args: args ?? null, env: env ?? null },
  })
  return NextResponse.json({ server: toMcpDTO(server) }, { status: 201 })
}
