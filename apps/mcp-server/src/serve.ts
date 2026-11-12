// How calls arrive: the Model Context Protocol, over this program's own
// input and output. This is the only file that knows the MCP package: the
// tools are plain code (tools/), so a change in the protocol, or in that
// package, is a change here and nowhere else. Another way in, such as HTTPS,
// would be another file like this one.
//
// Nothing here opens a port: only the program that started this one can
// reach it. Its standard output carries the protocol and nothing else; what
// the server has to say for itself goes to standard error.
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { CONTRACT } from './guide.js'
import type { NoteHost } from './host.js'
import { INSTRUCTIONS, TOOLS } from './tools/index.js'

export const NAME = 'shellnote'
/** The server's version: its second number is the contract's, which only goes up. */
export const VERSION = `0.${CONTRACT}.0`

const FAILED = JSON.stringify({ error: 'failed', hint: 'Something went wrong inside the ShellNote server. Read the note again before you go on: it may not have changed.' })

/** What the calling program calls itself, when it said: in each request (2026), or as it connected (2025). */
function clientOf(server: McpServer, context: unknown): string | undefined {
  try {
    const envelope = (context as { mcpReq?: { envelope?: Record<string, unknown> } } | undefined)?.mcpReq?.envelope
    const said = (envelope?.['io.modelcontextprotocol/clientInfo'] ?? server.server.getClientVersion()) as { name?: unknown; version?: unknown } | undefined
    if (typeof said?.name !== 'string') return undefined
    return typeof said.version === 'string' ? `${said.name} ${said.version}` : said.name
  } catch {
    return undefined
  }
}

/** A server offering the tools over a host. */
export function mcpServer(host: NoteHost, now: () => number = Date.now): McpServer {
  const server = new McpServer({ name: NAME, title: 'ShellNote', version: VERSION }, { instructions: INSTRUCTIONS, capabilities: { tools: {} } })
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        // What an AI app may ask the person about: only a tool that changes something, and none reaches beyond the library.
        annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, idempotentHint: tool.readOnly, openWorldHint: false },
      },
      async (args: unknown, context: unknown) => {
        try {
          const client = clientOf(server, context)
          const answer = await tool.run(args, { host, now, ...(client === undefined ? {} : { client }) })
          if (answer.error) return { content: [{ type: 'text' as const, text: answer.text }], isError: true }
          return { content: [{ type: 'text' as const, text: answer.text }], ...(answer.data ? { structuredContent: answer.data } : {}) }
        } catch (error) {
          // A fault of the server's own: said in plain words, with nothing of the disk or the note in it.
          console.error(`shellnote-mcp: ${tool.name} failed:`, error instanceof Error ? error.message : error)
          return { content: [{ type: 'text' as const, text: FAILED }], isError: true }
        }
      },
    )
  }
  return server
}

/** Serve the tools over this program's standard input and output, until the program that started it closes them. */
export function serve(host: NoteHost): { close(): Promise<void> } {
  return serveStdio(() => mcpServer(host), { onerror: (error) => console.error('shellnote-mcp:', error.message) })
}
