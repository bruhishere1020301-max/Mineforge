// Tiny OpenAI-compatible fake LLM for offline E2E tests of the /api/chat
// agent loop: file tools, self-check and repair. No dependencies, plain node.
//
// Scenario A (SELF_CHECK_TEST_A in the user message):
//   round 1 → reply with an INVALID pack.mcmeta file block
//   round 2 ("failed the automatic code self-check" in history)
//          → reply with the corrected block
// Scenario B (FILE_TOOLS_TEST_B):
//   round 1 → tool_call write_project_file with invalid JSON
//   round 2 (tool result SELF-CHECK FAILED) → tool_call edit_project_file fixing it
//   round 3 (tool result Self-check: OK) → final text summary
// Scenario C (FILE_TOOLS_TEST_C):
//   round 1 → tool_call write_project_file with invalid JSON
//   round 2 → final text anyway (leaves issues behind → server must prodd)
//   round 3 (prodd user message) → tool_call edit_project_file → round 4 final text
import http from 'node:http'

const PORT = Number(process.env.FAKE_LLM_PORT || 3939)

const BROKEN = '{ "pack": { "pack_format": 48, }' // trailing comma + missing brace
const FIXED = '{\n  "pack": {\n    "pack_format": 48\n  }\n}'

const BROKEN_BLOCK = 'Here is your datapack metadata:\n\n```json path="pack.mcmeta"\n' + BROKEN + '\n```'
const FIXED_BLOCK = '```json path="pack.mcmeta"\n' + FIXED + '\n```'

function toolCall(name, args) {
  return { id: 'call_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

function decide(body) {
  const messages = body.messages ?? []
  const textBlob = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
  const toolResults = messages.filter((m) => m.role === 'tool').map((m) => String(m.content ?? ''))
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0

  const wantsRepair = textBlob.includes('failed the automatic code self-check')
  const prodded = textBlob.includes('self-check still reports problems')
  const wroteBroken = toolResults.some((r) => r.includes('SELF-CHECK FAILED'))
  const wroteOk = toolResults.some((r) => r.includes('Self-check: OK'))
  console.log('[decide] tools=%s toolResults=%d wantsRepair=%s prodded=%s wroteBroken=%s wroteOk=%s',
    hasTools, toolResults.length, wantsRepair, prodded, wroteBroken, wroteOk)

  if (wantsRepair) {
    return { content: 'Self-check: 1 issue(s) fixed.\n\n' + FIXED_BLOCK, tool_calls: [] }
  }

  if (textBlob.includes('FILE_TOOLS_TEST_C')) {
    if (toolResults.length === 0) {
      return {
        content: 'Writing the pack.mcmeta file now.',
        narrate: true,
        tool_calls: [toolCall('write_project_file', { path: 'data/broken.json', content: BROKEN })],
      }
    }
    if (wroteOk) {
      return { content: 'All fixed — created data/broken.json with valid JSON.', tool_calls: [] }
    }
    if (prodded) {
      return {
        content: '',
        tool_calls: [toolCall('edit_project_file', { path: 'data/broken.json', old_text: BROKEN, new_text: FIXED })],
      }
    }
    // finish anyway, leaving the flagged write behind (the server must prod us)
    return { content: 'Here is your datapack metadata — done!', tool_calls: [] }
  }

  if (textBlob.includes('FILE_TOOLS_TEST_B')) {
    if (wroteBroken && !wroteOk) {
      return {
        content: '',
        tool_calls: [toolCall('edit_project_file', { path: 'data/broken.json', old_text: BROKEN, new_text: FIXED })],
      }
    }
    if (wroteOk) {
      return { content: 'Done — created data/broken.json with valid JSON.', tool_calls: [] }
    }
    return {
      content: 'Creating data/broken.json with the pack metadata.',
      narrate: true,
      tool_calls: [toolCall('write_project_file', { path: 'data/broken.json', content: BROKEN })],
    }
  }

  if (textBlob.includes('BUILD_TEST')) {
    if (toolResults.length === 0) {
      return {
        content: 'I will compile the project now.',
        narrate: true,
        tool_calls: [toolCall('build_mod_project', {})],
      }
    }
    return { content: 'The build tool replied: ' + String(toolResults[0]).slice(0, 100), tool_calls: [] }
  }

  if (textBlob.includes('SELF_CHECK_TEST_A')) {
    return { content: BROKEN_BLOCK, tool_calls: [], narrate: true }
  }

  // generic echo — proves the plain streaming path works
  return { content: hasTools ? 'Generic tool-mode reply.' : 'Generic reply.', tool_calls: [] }
}

function sse(res, text) {
  // reasoning delta first (exercises the live-thinking feed), then the reply
  res.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'Planning the datapack structure and checking the required files…' } }] }) + '\n\n')
  // stream the reply in two chunks so the client's streaming path is exercised
  const half = Math.ceil(text.length / 2)
  for (const chunk of [text.slice(0, half), text.slice(half)]) {
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: chunk } }] }) + '\n\n')
  }
  res.write('data: [DONE]\n\n')
  res.end()
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model', context_length: 128000 }, { id: 'fake-model-2', object: 'model', context_length: 32000 }] }))
      return
    }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let body = {}
      try {
        body = JSON.parse(raw)
      } catch {
        /* empty body */
      }
      const out = decide(body)
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        sse(res, out.content)
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: out.content || null,
                ...(out.narrate ? { reasoning_content: 'The user wants datapack metadata; I will write pack.mcmeta first, verify it, then report back.' } : {}),
                tool_calls: out.tool_calls.length ? out.tool_calls : undefined,
              },
            },
          ],
        })
      )
    })
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[fake-llm] OpenAI-compatible fake on http://127.0.0.1:${PORT}/v1`))
