import { NextRequest, NextResponse } from 'next/server'
import { resolveProjectRoot, runGradleBuild } from '@/lib/server/file-tools'

export const dynamic = 'force-dynamic'

/**
 * POST /api/projects/:id/build — run `gradlew build` in the project folder
 * and return the result (powers the "Build .jar" button; the AI's
 * build_mod_project tool runs the same code).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const root = await resolveProjectRoot(id)
  if (!root) {
    return NextResponse.json(
      { error: 'This folder is not reachable from the server — use the desktop app or a real folder path.' },
      { status: 400 }
    )
  }
  const build = await runGradleBuild(root.root)
  return NextResponse.json({
    ok: build.ok,
    code: build.code,
    timedOut: build.timedOut,
    seconds: build.seconds,
    output: build.output,
    summary: build.ok
      ? `Build OK in ${build.seconds}s — jar in build/libs/`
      : `Build failed${build.timedOut ? ' (timeout)' : ''} — see output`,
  })
}