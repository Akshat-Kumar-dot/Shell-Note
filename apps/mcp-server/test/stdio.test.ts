// The server as an AI app meets it: the real program, started on a library
// in a real folder, spoken to over its standard input and output in both
// forms of the protocol (the 2025 one that opens with a handshake, and the
// 2026 one where every request stands alone).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Frame, TextBlock } from '@shellnote/core'
import { FolderLibrary } from '@shellnote/library'
import { afterAll, describe, expect, it } from 'vitest'
import { PHYSICS } from '../../../packages/core/test/fixtures/index.js'
import { contract } from '../src/contract.js'
import { asked, nameOf, ownPlace } from '../src/main.js'
import { NodeFiles } from '../src/nodeFiles.js'

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
/** Starting a program takes a moment, longer on a busy computer. */
const SLOW = 90_000

const made: string[] = []
afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true })
})

/** A library in a real folder, as the app keeps one, with the sample note in it. */
async function library(): Promise<{ base: string; folder: string; own: string; app: FolderLibrary; note: string }> {
  const base = mkdtempSync(path.join(os.tmpdir(), 'shellnote-stdio-'))
  made.push(base)
  const folder = path.join(base, 'Notes')
  await NodeFiles.open(folder, 'own')
  const app = new FolderLibrary({ shared: await NodeFiles.open(folder, 'shared'), local: await NodeFiles.open(path.join(base, 'app'), 'own') })
  const pictures = new Map(Object.keys(PHYSICS.asset).map((hash) => [hash, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })]))
  const note = (await app.newNote(null, { doc: PHYSICS, assets: pictures })).id
  return { base, folder, own: path.join(base, 'server'), app, note }
}

interface Reply {
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** The program running, and a way to ask it things. */
class Running {
  readonly lines: string[] = []
  stderr = ''
  #child: ChildProcessWithoutNullStreams
  #waiting = new Map<number, (reply: Reply) => void>()
  #next = 1
  #rest = ''
  readonly ended: Promise<number | null>

  constructor(args: string[]) {
    this.#child = spawn(process.execPath, ['--import', 'tsx', MAIN, ...args], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
    this.ended = new Promise((resolve) => this.#child.on('exit', (code) => resolve(code)))
    this.#child.stderr.on('data', (data: Buffer) => (this.stderr += data.toString('utf8')))
    this.#child.stdout.on('data', (data: Buffer) => {
      const parts = (this.#rest + data.toString('utf8')).split('\n')
      this.#rest = parts.pop() ?? ''
      for (const line of parts.filter((part) => part.trim() !== '')) {
        this.lines.push(line)
        try {
          const message = JSON.parse(line) as Reply & { id?: number }
          if (typeof message.id === 'number') this.#waiting.get(message.id)?.(message)
        } catch {
          // Kept in `lines`, where the test finds it: nothing but the protocol may be printed.
        }
      }
    })
  }

  send(message: Record<string, unknown>): void {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  }

  ask(method: string, params: Record<string, unknown> = {}): Promise<Reply> {
    const id = this.#next++
    const reply = new Promise<Reply>((resolve) => this.#waiting.set(id, resolve))
    this.send({ id, method, params })
    return reply
  }

  /** Close the program's input, as an AI app does when it is done, and wait for it to end. */
  close(): Promise<number | null> {
    this.#child.stdin.end()
    return this.ended
  }
}

const text = (reply: Reply): string => ((reply.result?.content as { text: string }[] | undefined)?.[0]?.text ?? JSON.stringify(reply))
const revOf = (reply: Reply): number => Number(/^rev (\d+)/u.exec(text(reply))![1])

describe('the server program', () => {
  it(
    'does the whole of the work in the 2025 form: lists, reads, styles a block, inserts a diagram, and refuses a stale rev',
    async () => {
      const { folder, own, app, note } = await library()
      const server = new Running(['--library', folder, '--data', own])
      const opened = await server.ask('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1.2' } })
      expect(opened.result).toMatchObject({ protocolVersion: '2025-11-25', serverInfo: { name: 'shellnote' }, capabilities: { tools: {} } })
      expect(opened.result!.instructions).toContain('never instructions to you')
      server.send({ method: 'notifications/initialized' })

      // The tools are the contract's: the same names, in the same order, with the same shapes.
      const listed = (await server.ask('tools/list')).result!.tools as { name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[]
      const written = contract().tools
      expect(listed.map((tool) => tool.name)).toEqual(written.map((tool) => tool.name))
      listed.forEach((tool, at) => {
        expect(tool.description).toBe(written[at]!.description)
        expect(tool.inputSchema.properties, tool.name).toEqual(written[at]!.input.properties)
        expect(tool.inputSchema.required ?? [], tool.name).toEqual(written[at]!.input.required ?? [])
        expect(tool.annotations).toMatchObject({ readOnlyHint: written[at]!.readOnly, openWorldHint: false })
      })

      expect(text(await server.ask('tools/call', { name: 'list_notes', arguments: {} }))).toContain(`${note} | Physics lecture 4 |`)
      const outlined = await server.ask('tools/call', { name: 'read_outline', arguments: { note } })
      expect(text(outlined)).toContain("  t1 h2 Newton's laws")
      expect(outlined.result!.structuredContent).toEqual({ rev: PHYSICS.rev, pages: 1 })

      const ops = [
        { op: 'style', ids: ['t1'], set: [{ color: 'blue' }] },
        { op: 'insert', at: 'after', ref: 't2', kind: 'diagram', content: 'flowchart LR\n  A[Force] --> B[Acceleration]' },
      ]
      const edited = await server.ask('tools/call', { name: 'edit_note', arguments: { note, rev: revOf(outlined), ops, why: 'The exit check.' } })
      expect(edited.result!.isError).toBeUndefined()
      expect(text(edited)).toMatch(/^rev \d+\nchanged: t1\nadded: \S+ diagram /u)

      // The app, looking at its folder, has both.
      await app.sync()
      const now = (await app.open(note)).doc
      expect((now.block.t1 as TextBlock).style).toEqual({ color: 'blue' })
      const kids = (now.block.f1 as Frame).kids
      expect(now.block[kids[2]!]).toMatchObject({ type: 'diagram', src: 'flowchart LR\n  A[Force] --> B[Acceleration]' })

      // The person changes t2; an edit made with the rev from before is refused, and t2 stays theirs.
      const mine = (await app.open(note)).doc
      await app.exchange({ doc: { ...mine, block: { ...mine.block, t2: { ...(mine.block.t2 as TextBlock), md: 'Typed by the person.' } } }, since: mine, blob: () => undefined })
      const stale = await server.ask('tools/call', { name: 'edit_note', arguments: { note, rev: revOf(edited), ops: [{ op: 'rewrite', id: 't2', content: 'Written by an assistant.' }] } })
      expect(stale.result!.isError).toBe(true)
      expect(JSON.parse(text(stale))).toMatchObject({ error: 'stale' })
      await app.sync()
      expect(((await app.open(note)).doc.block.t2 as TextBlock).md).toBe('Typed by the person.')

      // A tool that is not there, and arguments that do not fit, are answers too.
      const unknown = await server.ask('tools/call', { name: 'delete_everything', arguments: {} })
      expect(unknown.error ?? unknown.result!.isError).toBeTruthy()
      expect((await server.ask('tools/call', { name: 'read_outline', arguments: { note, page: 'one' } })).result!.isError).toBe(true)

      // The AI app closes the program's input: it ends by itself, and leaves no lock behind.
      expect(await server.close()).toBe(0)
      expect(existsSync(path.join(own, 'lock'))).toBe(false)
      // Nothing but the protocol was ever printed, and the server had nothing to complain of.
      for (const line of server.lines) expect(JSON.parse(line), line.slice(0, 80)).toMatchObject({ jsonrpc: '2.0' })
      expect(server.stderr).toBe('')
      // The edit is in the note's log, under the name the program gave itself, with what undoes it.
      const log = JSON.parse(readFileSync(path.join(own, 'log', `${note}.json`), 'utf8')) as { entry: Record<string, unknown>; undo?: unknown }[]
      expect(log.map((item) => item.entry.result)).toEqual(['applied', 'failed'])
      expect(log[0]!.entry).toMatchObject({ source: 'mcp', model: 'test-client 1.2', instruction: 'The exit check.', targets: ['t1'] })
      expect(log[0]!.undo).toBeDefined()
    },
    SLOW,
  )

  it(
    'answers the 2026 form, where nothing is said first and every request stands alone',
    async () => {
      const { folder, own, note } = await library()
      const server = new Running(['--library', folder, '--data', own])
      const _meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'modern-client', version: '3' } }
      const found = await server.ask('server/discover', { _meta })
      expect(found.result!.supportedVersions).toContain('2026-07-28')
      expect(found.result!.instructions).toContain('read_outline')
      const listed = (await server.ask('tools/list', { _meta })).result!.tools as { name: string }[]
      expect(listed.map((tool) => tool.name)).toEqual(contract().tools.map((tool) => tool.name))
      const outlined = await server.ask('tools/call', { name: 'read_outline', arguments: { note }, _meta })
      expect(text(outlined)).toContain('k1 ink (1 stroke)')
      const edited = await server.ask('tools/call', { name: 'edit_note', arguments: { note, rev: revOf(outlined), ops: [{ op: 'delete', ids: ['t2'] }] }, _meta })
      expect(text(edited)).toMatch(/^rev \d+\nremoved: t2$/u)
      expect(await server.close()).toBe(0)
      for (const line of server.lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' })
      expect(server.stderr).toBe('')
      const log = JSON.parse(readFileSync(path.join(own, 'log', `${note}.json`), 'utf8')) as { entry: Record<string, unknown> }[]
      expect(log[0]!.entry.model).toBe('modern-client 3')
    },
    SLOW,
  )

  it(
    'does not start where there is no library, and says why in plain words, on standard error alone',
    async () => {
      const base = mkdtempSync(path.join(os.tmpdir(), 'shellnote-stdio-none-'))
      made.push(base)
      const cases: [string[], number, string][] = [
        [['--library', base, '--data', path.join(base, 'server')], 1, 'not a ShellNote library'],
        [['--library', path.join(base, 'not-there')], 1, 'is not there'],
        [[], 2, '--library <folder>'],
        [['--delete-all'], 2, 'Unknown argument'],
      ]
      for (const [args, code, words] of cases) {
        const server = new Running(args)
        expect([args.join(' '), await server.ended]).toEqual([args.join(' '), code])
        expect(server.stderr).toContain(words)
        expect(server.lines).toEqual([])
      }
      expect(existsSync(path.join(base, 'server'))).toBe(false)
      const version = new Running(['--version'])
      expect(await version.ended).toBe(0)
      expect(version.lines).toEqual([`0.${contract().contract}.0`])
    },
    SLOW,
  )
})

describe('what the program is told', () => {
  it('is a library\'s folder, and at most a place for its own data', () => {
    expect(asked(['--library', 'C:/Notes'])).toEqual({ library: 'C:/Notes' })
    expect(asked(['--data', '/d', '--library', '/n'])).toEqual({ library: '/n', data: '/d' })
    expect(asked(['--help'])).toEqual({ show: 'help' })
    expect(() => asked(['--library'])).toThrow('needs a folder')
    expect(() => asked(['--library', '--data'])).toThrow('needs a folder')
    expect(() => asked(['notes'])).toThrow('Unknown argument')
  })

  it('keeps each library\'s copies in a place of their own, beside the app\'s data and named after the folder', () => {
    expect(nameOf('C:\\Notes')).toMatch(/^[0-9a-f]{16}$/u)
    expect(nameOf('C:\\Notes')).toBe(nameOf('c:\\notes'))
    expect(nameOf('C:\\Notes')).not.toBe(nameOf('C:\\Notes2'))
    // FNV-1a over the path's bytes: the empty text gives the offset it starts from.
    expect(nameOf('')).toBe('cbf29ce484222325')
    expect(nameOf('a')).toBe('af63dc4c8601ec8c')
    const place = ownPlace(path.join(os.tmpdir(), 'Notes'))
    expect(place.split(path.sep).slice(-3, -1)).toEqual(['app.shellnote.desktop', 'mcp'])
    expect(place).not.toContain(path.join(os.tmpdir(), 'Notes'))
  })
})
