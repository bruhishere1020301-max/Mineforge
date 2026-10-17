import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { testMcpServer } from '@/lib/server/mcp-client'
import { toMcpDTO } from '../../route'
import type { McpServerConfig } from '@/lib/server/mcp-client'

export const dynamic = 'force-dynamic'

function toConfig(s: {
  id: string
  transport: string
  url: string | null
  command: string | null
  args: string | null
  env: string | null
}): McpServerConfig {
  return {
    id: s.id,
    transport: s.transport === 'stdio' ? 'stdio' : 'http',
    url: s.url,
    command: s.command,
    args: s.args,
    env: s.env,
  }
}

/** GET /api/mcp/:id/tools — (re)connect to the server, list its tools, persist the status. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const server = await db.mcpServer.findUnique({ where: { id } })
  if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })

  try {
    const tools = await testMcpServer(toConfig(server))
    const updated = await db.mcpServer.update({
      where: { id },
      data: { status: 'connected', statusMessage: null, toolCount: tools.length },
    })
    return NextResponse.json({ tools, server: toMcpDTO(updated) })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Connection failed'
    const updated = await db.mcpServer
      .update({ where: { id }, data: { status: 'error', statusMessage: message.slice(0, 500), toolCount: 0 } })
      .catch(() => null)
    return NextResponse.json({ error: message, server: updated ? toMcpDTO(updated) : null }, { status: 400 })
  }
}
