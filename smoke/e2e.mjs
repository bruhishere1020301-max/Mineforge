// Offline E2E test for the /api/chat agent loop against the standalone server:
//   A) self-check catches a broken pack.mcmeta in a plain-streamed reply
//      → repair round → `replace` event with the fixed reply
//   B) file tools: write (broken JSON → SELF-CHECK FAILED) → edit (OK) → summary
//   C) file tools with leftovers: write broken → model finishes anyway →
//      system prods → edit fix → final summary
// Usage: node smoke/e2e.mjs   (expects standalone server on :3457 + fake LLM on :3939)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3457'
const BROKEN = '{ "pack": { "pack_format": 48, }'
const FIXED = '{\n  "pack": {\n    "pack_format": 48\n  }\n}'

let failures = 0
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  OK  ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name} ${extra}`)
  }
}

async function postJson(p, body) {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

async function delJson(p) {
  const res = await fetch(BASE + p, { method: 'DELETE' })
  return res.status
}

async function streamChat(body) {
  const res = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${await res.text()}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []
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
        events.push(JSON.parse(l.slice(5).trim()))
      } catch {
        /* ignore */
      }
    }
  }
  return events
}

const textOf = (events) => events.filter((e) => e.type === 'text').map((e) => e.text).join('')

// ---- setup ------------------------------------------------------------------
const prov = await postJson('/api/providers', {
  name: 'Fake LLM (e2e)',
  type: 'local',
  baseUrl: 'http://127.0.0.1:3939/v1',
})
if (!prov.json?.provider?.id) {
  console.error('could not create provider', prov)
  process.exit(1)
}
const providerId = prov.json.provider.id

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mineforge-e2e-'))
const proj = await postJson('/api/projects', {
  name: 'E2E Project',
  path: tmpRoot,
  kind: 'datapack',
  storage: 'manual',
})
const projectId = proj.json?.project?.id
if (!projectId) {
  console.error('could not create project', proj)
  process.exit(1)
}


try {
  // ---- scenario D: context-window auto-detection ---------------------------
  console.log('Scenario D - context window auto-fit')
  const modelsRes = await fetch(`${BASE}/api/providers/${providerId}/models`, { method: 'POST' })
  const modelsJson = await modelsRes.json().catch(() => null)
  const fakeModel = modelsJson?.models?.find((m) => m.id === 'fake-model')
  check('models list carries detected contextLength', fakeModel?.contextLength === 128000, JSON.stringify(fakeModel))
  const d = await streamChat({
    providerId,
    model: 'fake-model',
    mode: 'mod',
    contextLength: 4000,
    messages: [{ role: 'user', content: 'hello' }],
  })
  const dMeta = d.find((e) => e.type === 'meta')
  check(
    'meta reports auto-detected window + output budget',
    dMeta?.context?.contextWindow?.length === 4000 && dMeta?.context?.contextWindow?.output === 1024,
    JSON.stringify(dMeta?.context)
  )

  // ---- scenario A: self-check + repair on the plain streaming path ----------
  console.log('Scenario A - self-check + auto-repair (plain path)')
  const a = await streamChat({
    providerId,
    model: 'fake-model',
    mode: 'datapack',
    messages: [{ role: 'user', content: 'SELF_CHECK_TEST_A make me a datapack' }],
  })
  const aText = textOf(a)
  check('broken draft was streamed first', aText.includes(BROKEN))
  check(
    'Self-check tool_start emitted',
    a.some((e) => e.type === 'tool_start' && e.server === 'Self-check')
  )
  const aTool = a.find((e) => e.type === 'tool' && e.server === 'Self-check')
  check('Self-check reports the fix', !!aTool && aTool.result.includes('issue(s) fixed'), aTool?.result)
  const aReplace = a.find((e) => e.type === 'replace')
  check('replace event carries the fixed reply', !!aReplace && aReplace.text.includes('"pack_format": 48\n'))
  check('replace text contains the fixed block', !!aReplace && aReplace.text.includes(FIXED))
  check(
    'live reasoning note streamed',
    a.some((e) => e.type === 'note' && e.kind === 'reasoning' && (e.text ?? '').includes('Planning'))
  )
  check('done emitted', a.some((e) => e.type === 'done'))

  // ---- scenario B: file tools create + edit ---------------------------------
  console.log('Scenario B - write (broken) then edit (fixed) via file tools')
  const b = await streamChat({
    providerId,
    model: 'fake-model',
    mode: 'datapack',
    projectId,
    messages: [{ role: 'user', content: 'FILE_TOOLS_TEST_B create the datapack metadata' }],
  })
  check('meta exposes 6 file tools', b[0]?.type === 'meta' && b[0].mcpTools === 6, JSON.stringify(b[0]))
  const bWrite = b.find((e) => e.type === 'tool' && e.server === 'Project files' && e.tool === 'write_project_file')
  check('write tool ran and flagged broken JSON', !!bWrite && bWrite.result.includes('SELF-CHECK FAILED'), bWrite?.result)
  check('write carries human summary', !!bWrite && (bWrite.summary ?? '').startsWith('Created data/broken.json'), bWrite?.summary)
  check(
    'write event carries a +line diff',
    !!bWrite && Array.isArray(bWrite.diff) && bWrite.diff.some((l) => l.sign === '+'),
    JSON.stringify(bWrite?.diff?.slice(0, 3))
  )
  const bEdit = b.find((e) => e.type === 'tool' && e.server === 'Project files' && e.tool === 'edit_project_file')
  check('edit tool ran and passed self-check', !!bEdit && bEdit.result.includes('Self-check: OK'), bEdit?.result)
  check(
    'edit event carries a line diff',
    !!bEdit && Array.isArray(bEdit.diff) && bEdit.diff.some((l) => l.sign === '-' || l.sign === '+'),
    JSON.stringify(bEdit?.diff?.slice(0, 3))
  )
  check(
    'working + reasoning notes emitted before tools',
    b.some((e) => e.type === 'note' && e.kind === 'working' && (e.text ?? '').includes('Creating data/broken.json')) &&
      b.some((e) => e.type === 'note' && e.kind === 'reasoning')
  )
  const onDisk = path.join(tmpRoot, 'data', 'broken.json')
  check('file exists on disk', fs.existsSync(onDisk))
  check('file content was fixed', fs.existsSync(onDisk) && fs.readFileSync(onDisk, 'utf8') === FIXED)
  check('final summary streamed', textOf(b).includes('Done'), textOf(b).slice(0, 200))

  // ---- scenario C: leftovers force a prodd round ----------------------------
  console.log('Scenario C - leftover issues force a system prodd round')
  const c = await streamChat({
    providerId,
    model: 'fake-model',
    mode: 'datapack',
    projectId,
    messages: [{ role: 'user', content: 'FILE_TOOLS_TEST_C write the metadata' }],
  })
  const cEdit = c.find((e) => e.type === 'tool' && e.server === 'Project files' && e.tool === 'edit_project_file')
  check('edit ran after the prodd round', !!cEdit && cEdit.result.includes('Self-check: OK'), cEdit?.result)
  check('file fixed on disk', fs.existsSync(onDisk) && fs.readFileSync(onDisk, 'utf8') === FIXED)
  check('final summary after fix', textOf(c).includes('All fixed'), textOf(c).slice(0, 200))

  // ---- scenario F: build_mod_project tool plumbing (no wrapper → friendly error)
  console.log('Scenario F - build_mod_project tool')
  const f = await streamChat({
    providerId,
    model: 'fake-model',
    mode: 'mod',
    projectId,
    messages: [{ role: 'user', content: 'BUILD_TEST compile the mod please' }],
  })
  const fBuild = f.find((e) => e.type === 'tool' && e.server === 'Project files' && e.tool === 'build_mod_project')
  check('build tool ran in the loop', !!fBuild, JSON.stringify(f.find((e) => e.type === 'tool')))
  check('missing-wrapper error names gradlew', !!fBuild && (fBuild.result ?? '').includes('gradlew'), fBuild?.result?.slice(0, 140))
  check('build failure surfaced as summary', !!fBuild && (fBuild.summary ?? '').includes('FAILED'), fBuild?.summary)
  check('narration note before build', f.some((e) => e.type === 'note' && e.kind === 'working' && (e.text ?? '').includes('compile')))
  check('final build reply streamed', textOf(f).includes('build tool replied'), textOf(f).slice(0, 150))

  // ---- scenario E: activity persists with the reply but never reaches the model
  console.log('Scenario E - activity marker persists, context stays clean')
  const sess = await postJson('/api/sessions', { title: 'E2E activity', mode: 'datapack', projectId })
  const sessionId = sess.json?.session?.id
  check('session created', !!sessionId, JSON.stringify(sess.json))
  if (sessionId) {
    await streamChat({
      providerId,
      model: 'fake-model',
      mode: 'datapack',
      projectId,
      sessionId,
      content: 'SELF_CHECK_TEST_A persist the activity please',
    })
    const msgsRes = await fetch(`${BASE}/api/sessions/${sessionId}`)
    const msgsJson = await msgsRes.json().catch(() => null)
    const assistantMsg = (msgsJson?.messages ?? []).find((m) => m.role === 'assistant')
    check('assistant reply persisted with activity marker', !!assistantMsg && assistantMsg.content.includes('<!--mf-activity'), assistantMsg?.content?.slice(-80))
    check(
      'persisted activity contains thinking + check entries',
      !!assistantMsg && assistantMsg.content.includes('"kind":"thinking"') && assistantMsg.content.includes('"kind":"check"')
    )
    const ctxRes = await fetch(`${BASE}/api/sessions/${sessionId}/context`)
    const ctxJson = await ctxRes.json().catch(() => null)
    const llmText = JSON.stringify(ctxJson?.context?.llmMessages ?? [])
    check('context sent to the model has NO activity marker', !llmText.includes('mf-activity'))
    check('context still has the real reply text', llmText.includes('pack_format'))
    await delJson(`/api/sessions/${sessionId}`)
  }
} finally {
  await delJson(`/api/providers/${providerId}`)
  await delJson(`/api/projects/${projectId}`)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
