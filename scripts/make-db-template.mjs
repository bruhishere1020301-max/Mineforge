// Builds an empty, schema-only SQLite database used as the first-run template
// for the packaged desktop app (Electron copies it into its userData folder
// when no database exists yet). Runs `prisma db push` against electron/db-template.db.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templatePath = path.join(root, 'electron', 'db-template.db')
const require = createRequire(import.meta.url)

// Start from a clean slate so the template never carries stale data.
if (existsSync(templatePath)) rmSync(templatePath)

let prismaCli
try {
  prismaCli = require.resolve('prisma/build/index.js')
} catch {
  console.error('[db-template] prisma CLI not found — run `npm install` first.')
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:' + templatePath },
  }
)

if (result.status !== 0 || !existsSync(templatePath)) {
  console.error('[db-template] prisma db push failed.')
  process.exit(result.status ?? 1)
}

console.log('[db-template] created', templatePath, '✓')
