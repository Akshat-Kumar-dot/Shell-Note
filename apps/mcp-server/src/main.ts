// The program an AI app starts:
//
//   shellnote-mcp --library "C:\path\to\Notes"
//
// The folder is the one chosen in ShellNote (Settings, "Where your notes are
// kept"). It is the only thing the server is ever told, and the only place
// of the person's it reaches.
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blockPrint, RULEBOOK } from '@shellnote/core'
import { openFolderHost, type FolderHost } from './folderHost.js'
import { serve, VERSION } from './serve.js'

const HELP = `ShellNote MCP server ${VERSION}

  shellnote-mcp --library <folder>

  --library <folder>  The folder ShellNote keeps its library in: Settings,
                      "Where your notes are kept". Given as a whole path.
  --data <folder>     Where the server keeps its own copies of the notes, the
                      log of what assistants did, and notes as they were.
                      Left out: a folder of its own beside ShellNote's data.
  --version           Print the version.
  --help              Print this.

It speaks the Model Context Protocol on its standard input and output: an AI
app starts it, and nothing else can reach it.

For you, at a terminal, and never for an assistant:

  --copies            List the notes kept as they were before an assistant
                      changed them, and when each copy was kept.
  --restore <note> <time>
                      Bring a note back to one of those copies: the note's id
                      and the copy's time, as --copies prints them. The note
                      as it is now is kept first, so this too can be taken back.`

/** Where programs keep their own data on this system. */
function dataHome(): string {
  if (process.platform === 'win32') return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
}

/** A short name for a folder's path, the same each time: the copies of each library stay apart. */
export function nameOf(folder: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(folder.toLowerCase())) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn
  return hash.toString(16).padStart(16, '0')
}

/** The server's own place for a library: beside the desktop app's data, never inside it. */
export function ownPlace(folder: string): string {
  return path.join(dataHome(), 'app.shellnote.desktop', 'mcp', nameOf(path.resolve(folder)))
}

export interface Asked {
  library?: string
  data?: string
  show?: 'help' | 'version'
  /** List the notes kept as they were. */
  copies?: true
  /** Bring a note back to the copy kept at a time. */
  restore?: { note: string; at: number }
}

/** What the program was asked, from its arguments; throws, in plain words, on one it does not know. */
export function asked(args: readonly string[]): Asked {
  const out: Asked = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--help' || arg === '-h') out.show = 'help'
    else if (arg === '--version') out.show = 'version'
    else if (arg === '--library' || arg === '--data') {
      const value = args[++i]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a folder after it.`)
      out[arg === '--library' ? 'library' : 'data'] = value
    } else if (arg === '--copies') out.copies = true
    else if (arg === '--restore') {
      const [note, time] = [args[++i], args[++i]]
      if (note === undefined || time === undefined || !/^[0-9]{1,16}$/u.test(time)) throw new Error('--restore needs a note\'s id and a copy\'s time after it, as --copies prints them.')
      out.restore = { note, at: Number(time) }
    } else throw new Error(`Unknown argument ${JSON.stringify(arg.slice(0, 60))}. Try --help.`)
  }
  return out
}

const when = (at: number): string => new Date(at).toISOString().slice(0, 16).replace('T', ' ')

/** The notes kept as they were, for a person to read: each with its id, and each copy with its time. */
export async function copiesKept(host: FolderHost): Promise<string> {
  const kept = await host.copies()
  if (kept.length === 0) return 'No note has been kept as it was: no assistant has changed one yet.'
  const lines = kept.flatMap((note) => [`${note.title.replace(/\s+/gu, ' ').slice(0, 80) || '(untitled)'}  (${note.id})`, ...note.times.map((at) => `  ${at}  kept ${when(at)} UTC`)])
  return [...lines, '', 'To bring one back: --restore <note id> <time>'].join('\n')
}

/** Bring a note back to a copy, write that into its log, and say what was done. */
export async function restored(host: FolderHost, note: string, at: number): Promise<string> {
  const started = Date.now()
  const kept = await host.restore(note, at)
  if (kept.changed.length === 0) return 'The note already is as that copy has it. Nothing was changed.'
  const after: Record<string, string | null> = {}
  for (const id of kept.changed) if (kept.doc.block[id]) after[id] = blockPrint(kept.doc.block[id])
  await host.record(note, {
    entry: { at: started, source: 'mcp', model: 'shellnote-mcp --restore', rulebook: RULEBOOK.version, instruction: `Brought back as it was on ${when(at)} UTC.`, targets: [], ops: [], result: 'applied', tier: 1, calls: 0, retries: 0, tokensIn: 0, tokensOut: 0, ms: Math.max(0, Date.now() - started) },
    undo: { inverse: kept.inverse, rev: kept.doc.rev, after },
  })
  return `The note is as it was on ${when(at)} UTC. As it was a moment ago, it is kept too: --copies lists it.`
}

export async function main(args: readonly string[]): Promise<number> {
  let want: Asked
  try {
    want = asked(args)
  } catch (error) {
    console.error(`shellnote-mcp: ${(error as Error).message}`)
    return 2
  }
  if (want.show) {
    // The only time anything but the protocol is printed: asked for by a person at a terminal, and nothing is served.
    process.stdout.write(`${want.show === 'help' ? HELP : VERSION}\n`)
    return 0
  }
  if (want.library === undefined) {
    console.error('shellnote-mcp: say which folder holds the library: --library <folder>. Try --help.')
    return 2
  }
  try {
    const host = await openFolderHost(path.resolve(want.library), want.data === undefined ? ownPlace(want.library) : path.resolve(want.data))
    if (want.copies || want.restore) {
      // Asked by a person at a terminal: answered in words, and nothing is served.
      process.stdout.write(`${want.restore ? await restored(host, want.restore.note, want.restore.at) : await copiesKept(host)}\n`)
      return 0
    }
    serve(host)
    return -1
  } catch (error) {
    console.error(`shellnote-mcp: ${(error as Error).message}`)
    return 1
  }
}

// Started as a program, not read by another file.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    // -1: serving. The program ends by itself when the one that started it closes its input.
    if (code >= 0) process.exitCode = code
  })
}
