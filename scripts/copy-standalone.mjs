// Post-build copy step (Windows + POSIX friendly).
// Next.js `output: "standalone"` does not include .next/static or public/,
// so the standalone server needs them copied in manually. This replaces the
// old Unix-only `cp -r …` chain in the build script.
import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const standalone = path.join(root, '.next', 'standalone')

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.error('[copy-standalone] .next/standalone/server.js not found — did `next build` succeed?')
  process.exit(1)
}

// .next/static → .next/standalone/.next/static
await mkdir(path.join(standalone, '.next'), { recursive: true })
await cp(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true })

// public → .next/standalone/public
const publicDir = path.join(root, 'public')
if (existsSync(publicDir)) {
  await cp(publicDir, path.join(standalone, 'public'), { recursive: true })
}

console.log('[copy-standalone] copied .next/static and public into .next/standalone ✓')
