// Minimal, dependency-free MCP (Model Context Protocol) client.
// Supports both transports:
//  - "http"   : Streamable HTTP (POST JSON-RPC, JSON or SSE responses)
//  - "stdio"  : local command, newline-delimited JSON-RPC over stdin/stdout
import { spawn, type ChildProcess } from 'child_process'

export interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpServerConfig {
  id: string
  transport: 'http' | 'stdio'
  url?: string | null
  command?: string | null
  args?: string | null // JSON array
  env?: string | null // JSON object
}

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'mineforge-studio', version: '1.0.0' }
const CONN_TTL_MS = 5 * 60 * 1000

let nextId = 1

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number
  result?: unknown
  error?: { message?: string; code?: number }
}

/* ------------------------------------------------------------------ */
/* Streamable HTTP transport                                           */
/* ------------------------------------------------------------------ */

class HttpTransport {
  private sessionId: string | null = null
  private initialized = false

  constructor(private url: string) {}

  private async post(body: Record<string, unknown>, expectResponse: boolean): Promise<JsonRpcResponse | null> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid

    if (res.status === 202) {
      await res.text().catch(() => '')
      return null // accepted notification
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 180)}` : ''}`)
    }
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('text/event-stream')) {
      // parse SSE stream until we get the response with the matching id (or stream ends)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let found: JsonRpcResponse | null = null
      try {
        while (!found) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const l = line.trim()
            if (!l.startsWith('data:')) continue
            try {
              const msg = JSON.parse(l.slice(5).trim()) as JsonRpcResponse
              if (expectResponse && msg.id === body.id) {
                found = msg
                break
              }
            } catch {
              /* skip */
            }
          }
        }
      } finally {
        reader.releaseLock?.()
      }
      if (expectResponse && !found) throw new Error('MCP server closed the SSE stream before responding')
      return found
    }
    const json = (await res.json().catch(() => null)) as JsonRpcResponse | null
    if (!json) throw new Error('MCP server returned an invalid JSON response')
    return json
  }

  async connect(): Promise<void> {
    const res = await this.post(
      {
        jsonrpc: '2.0',
        id: nextId++,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      },
      true
    )
    if (res?.error) throw new Error(`initialize failed: ${res.error.message ?? 'unknown error'}`)
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false).catch(() => undefined)
    this.initialized = true
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    if (!this.initialized) throw new Error('not connected')
    const res = await this.post({ jsonrpc: '2.0', id: nextId++, method, params }, true)
    if (!res) throw new Error(`No response for ${method}`)
    if (res.error) throw new Error(`${method}: ${res.error.message ?? 'unknown error'}`)
    return res.result
  }
}

/* ------------------------------------------------------------------ */
/* stdio transport                                                     */
/* ------------------------------------------------------------------ */

class StdioTransport {
  private child: ChildProcess | null = null
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ''
  private startPromise: Promise<void> | null = null

  constructor(private cfg: { command: string; args: string[]; env: Record<string, string> }) {}

  private start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise<void>((resolve, reject) => {
      try {
        const child = spawn(this.cfg.command, this.cfg.args, {
          env: { ...process.env, ...this.cfg.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        this.child = child
        let stderr = ''
        child.stdout!.setEncoding('utf-8')
        child.stdout!.on('data', (chunk: string) => {
          this.buffer += chunk
          const lines = this.buffer.split('\n')
          this.buffer = lines.pop() ?? ''
          for (const line of lines) {
            const l = line.trim()
            if (!l) continue
            try {
              const msg = JSON.parse(l) as JsonRpcResponse
              if (msg.id !== undefined && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id)!
                this.pending.delete(msg.id)
                if (msg.error) p.reject(new Error(String(msg.error.message ?? 'MCP error')))
                else p.resolve(msg.result)
              }
            } catch {
              /* non-JSON line — ignore */
            }
          }
        })
        child.stderr!.setEncoding('utf-8')
        child.stderr!.on('data', (d: string) => {
          stderr = (stderr + d).slice(-500)
        })
        child.on('error', (err) => {
          this.failAll(new Error(`Failed to start "${this.cfg.command}": ${err.message}`))
          reject(err)
        })
        child.on('exit', (code) => {
          this.failAll(new Error(`MCP process exited (code ${code})${stderr ? ` — ${stderr.slice(0, 200)}` : ''}`))
          this.startPromise = null
        })
        resolve()
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    return this.startPromise
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private write(msg: Record<string, unknown>): void {
    if (!this.child?.stdin?.writable) throw new Error('MCP process is not running')
    this.child.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  private request(method: string, params?: unknown, timeoutMs = 60_000): Promise<unknown> {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      try {
        this.write({ jsonrpc: '2.0', id, method, params })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  async connect(): Promise<void> {
    await this.start()
    const res = (await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })) as { protocolVersion?: string } | undefined
    if (!res) throw new Error('initialize failed: no result')
    try {
      this.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    } catch {
      /* best effort */
    }
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    if (!this.startPromise) throw new Error('not connected')
    return this.request(method, params)
  }
}

/* ------------------------------------------------------------------ */
/* Connection cache + public API                                       */
/* ------------------------------------------------------------------ */

interface CachedConn {
  transport: HttpTransport | StdioTransport
  tools: McpTool[]
  at: number
}

const cache = new Map<string, CachedConn>()

function parseServerConfig(s: McpServerConfig): { transport: 'http' | 'stdio'; url?: string; command?: string; args?: string[]; env?: Record<string, string> } {
  if (s.transport === 'stdio') {
    let args: string[] = []
    let env: Record<string, string> = {}
    try {
      args = s.args ? (JSON.parse(s.args) as string[]) : []
    } catch {
      throw new Error('Args must be a JSON array, e.g. ["-y","@modelcontextprotocol/server-filesystem","C:\\Mods"]')
    }
    try {
      env = s.env ? (JSON.parse(s.env) as Record<string, string>) : {}
    } catch {
      throw new Error('Env must be a JSON object, e.g. {"GITHUB_TOKEN":"ghp_..."}')
    }
    if (!s.command) throw new Error('stdio transport requires a command')
    return { transport: 'stdio', command: s.command, args, env }
  }
  if (!s.url) throw new Error('HTTP transport requires a URL')
  return { transport: 'http', url: s.url }
}

async function getConnected(server: McpServerConfig, force = false): Promise<CachedConn> {
  const cached = cache.get(server.id)
  if (!force && cached && Date.now() - cached.at < CONN_TTL_MS) return cached

  const cfg = parseServerConfig(server)
  const transport = cfg.transport === 'http' ? new HttpTransport(cfg.url!) : new StdioTransport(cfg)
  await transport.connect()
  const result = (await transport.rpc('tools/list', {})) as { tools?: McpTool[] } | undefined
  const tools = (result?.tools ?? []).filter((t) => t && typeof t.name === 'string')
  const conn: CachedConn = { transport, tools, at: Date.now() }
  cache.set(server.id, conn)
  return conn
}

export function invalidateMcpServer(id: string): void {
  cache.delete(id)
}

/** Connect (or reuse) a server and list its tools. Throws with a readable message. */
export async function testMcpServer(server: McpServerConfig): Promise<McpTool[]> {
  invalidateMcpServer(server.id)
  const conn = await getConnected(server, true)
  return conn.tools
}

/** List tools using the cached connection; errors → empty list (best effort). */
export async function getMcpTools(server: McpServerConfig): Promise<McpTool[]> {
  try {
    const conn = await getConnected(server)
    return conn.tools
  } catch {
    return []
  }
}

/** Call a tool on a server. Returns the concatenated text content. */
export async function callMcpTool(server: McpServerConfig, tool: string, args: Record<string, unknown>): Promise<string> {
  const conn = await getConnected(server)
  const result = (await conn.transport.rpc('tools/call', { name: tool, arguments: args })) as
    | { content?: Array<{ type?: string; text?: string }>; isError?: boolean; error?: { message?: string } }
    | undefined
  const text = (result?.content ?? [])
    .filter((c) => !c.type || c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
    .trim()
  if (result?.isError) return `TOOL ERROR: ${text || 'unknown tool error'}`
  return text || '(no output)'
}
