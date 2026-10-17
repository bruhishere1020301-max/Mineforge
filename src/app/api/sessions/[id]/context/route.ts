import { NextRequest, NextResponse } from 'next/server'
import { buildSessionContext } from '@/lib/server/context'

export const dynamic = 'force-dynamic'

/**
 * GET /api/sessions/:id/context — the REAL context window for this session:
 * the exact system prompt + message list the provider receives on the next send,
 * with per-message in/out status and token estimates. Powers the Context panel
 * and the "What the AI sees" payload preview.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await buildSessionContext(id)
  if (!ctx) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  return NextResponse.json({ context: ctx })
}
