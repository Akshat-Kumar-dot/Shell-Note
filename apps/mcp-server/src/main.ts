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
import { openFolderHost } from './folderHost.js'
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
app starts it, and nothing else can reach it.`

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
    } else throw new Error(`Unknown argument ${JSON.stringify(arg.slice(0, 60))}. Try --help.`)
  }
  return out
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
