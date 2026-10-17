// Debug: scenario E only — dumps raw SSE events + GET messages + context keys.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'http://127.0.0.1:3457'
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return (await r.json().catch(() => null))
}

const prov = await post('/api/providers', { name: 'Fake E (debug)', type: 'local', baseUrl: 'http://127.0.0.1:3939/v1' })
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-debug-e-'))
const proj = await post('/api/projects', { name: 'DebugE', path: tmpRoot, kind: 'datapack', storage: 'manual' })
const sess = await post('/api/sessions', { title: 'DebugE', mode: 'datapack', projectId: proj.project.id })
const sessionId = sess.session?.id
console.log('ids', prov.provider?.id, proj.project?.id, sessionId)

const res = await fetch(BASE + '/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    providerId: prov.provider.id,
    model: 'fake-model',
    mode: 'datapack',
    projectId: proj.project.id,
    sessionId,
    content: 'SELF_CHECK_TEST_A persist the activity please',
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
      console.log('EVT', e.type, '|', e.server ?? '', e.tool ?? '', '|', String(e.result ?? e.message ?? e.text ?? '').slice(0, 90).replace(/\n/g, ' \\n '))
    } catch { /* ignore */ }
  }
}

const msgs = await (await fetch(`${BASE}/api/sessions/${sessionId}`)).json().catch(() => null)
console.log('messages keys:', Object.keys(msgs ?? {}), 'count:', (msgs?.messages ?? []).length)
for (const m of msgs?.messages ?? []) {
  console.log('MSG', m.role, '|', String(m.content).slice(0, 60).replace(/\n/g, ' \\n '), '| …tail:', String(m.content).slice(-50).replace(/\n/g, ' '))
}
const ctx = await (await fetch(`${BASE}/api/sessions/${sessionId}/context`)).json().catch(() => null)
console.log('context llmMessages:', (ctx?.llmMessages ?? []).length, '| stats:', JSON.stringify(ctx?.stats))
console.log('ctx has pack_format:', JSON.stringify(ctx?.llmMessages ?? []).includes('pack_format'))
console.log('ctx has marker:', JSON.stringify(ctx?.llmMessages ?? []).includes('mf-activity'))
await fetch(`${BASE}/api/providers/${prov.provider.id}`, { method: 'DELETE' })
await fetch(`${BASE}/api/projects/${proj.project.id}`, { method: 'DELETE' })
fs.rmSync(tmpRoot, { recursive: true, force: true })
