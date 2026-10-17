// Debug helper: dumps the raw SSE event stream for scenario C.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'http://127.0.0.1:3457'
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return (await r.json().catch(() => null))
}

const prov = await post('/api/providers', { name: 'Fake C (debug)', type: 'local', baseUrl: 'http://127.0.0.1:3939/v1' })
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-debug-'))
const proj = await post('/api/projects', { name: 'Debug', path: tmpRoot, kind: 'datapack', storage: 'manual' })

const res = await fetch(BASE + '/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    providerId: prov.provider.id,
    model: 'fake-model',
    mode: 'datapack',
    projectId: proj.project.id,
    messages: [{ role: 'user', content: 'FILE_TOOLS_TEST_C write the metadata' }],
  }),
})
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    const l = line.trim()
    if (!l.startsWith('data:')) continue
    try {
      const e = JSON.parse(l.slice(5).trim())
      console.log(e.type, '|', e.server ?? '', e.tool ?? '', '|', String(e.result ?? e.message ?? e.text ?? '').slice(0, 100).replace(/\n/g, ' \\n '))
    } catch { /* ignore */ }
  }
}
await fetch(BASE + `/api/providers/${prov.provider.id}`, { method: 'DELETE' })
await fetch(BASE + `/api/projects/${proj.project.id}`, { method: 'DELETE' })
fs.rmSync(tmpRoot, { recursive: true, force: true })
