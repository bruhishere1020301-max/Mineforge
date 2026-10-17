import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { callMcpTool } from '@/lib/server/mcp-client'
import type { McpServerConfig } from '@/lib/server/mcp-client'

export const dynamic = 'force-dynamic'

const callSchema = z.object({
  tool: z.string().min(1).max(200),
  args: z.record(z.string(), z.unknown()).optional(),
})

/** POST /api/mcp/:id/call — execute one tool on a server (manual testing from the UI). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = callSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid call payload — expected { tool, args }' }, { status: 400 })
  }

  const server = await db.mcpServer.findUnique({ where: { id } })
  if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })

  const config: McpServerConfig = {
    id: server.id,
    transport: server.transport === 'stdio' ? 'stdio' : 'http',
    url: server.url,
    command: server.command,
    args: server.args,
    env: server.env,
  }

  try {
    const result = await callMcpTool(config, parsed.data.tool, parsed.data.args ?? {})
    return NextResponse.json({ result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Tool call failed' },
      { status: 400 }
    )
  }
}
