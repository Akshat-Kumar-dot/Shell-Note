// What assistants did to a note through the MCP server (docs/mcp.md), shown
// in the note's own log. The server is another device on the library's
// folder: its edit reaches the open note as any device's does, and it writes
// what it did, with what undoes it, in a log of its own on this computer. In
// the desktop app, with the library kept in a folder, that log is read here
// and its entries join the note's.
//
// An edit made elsewhere is undone here only while the blocks it touched are
// exactly as it left them. The server counts its own changes, so its entry
// says how it left each block by a mark of the block (core's blockPrint), and
// the entry keeps its Undo only when this copy's blocks bear the same marks.
import { blockPrint, checkOp, LogEntry, type Doc, type Op } from '@shellnote/core'
import type { LogItem } from '@shellnote/editor'
import { invoke } from '@tauri-apps/api/core'

/** The most operations an undo may hold: more is not an edit an assistant could have sent. */
const MAX_UNDO = 2000

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** An entry is told from the others by when it was made and what came of it: the server writes each once. */
const keyOf = (entry: LogEntry): string => `${entry.source}:${entry.at}:${entry.ms}:${entry.result}:${entry.ops.length}`

/** What undoes an entry here, when its blocks are still as the edit left them; undefined when they are not, or it cannot be told. */
function undoHere(undo: unknown, doc: Doc): LogItem['undo'] {
  if (!isRecord(undo) || !Array.isArray(undo.inverse) || !isRecord(undo.after)) return undefined
  if (undo.inverse.length === 0 || undo.inverse.length > MAX_UNDO) return undefined
  const marks = Object.entries(undo.after)
  // A column changes as its blocks come and go, and as the page is laid out: it is the blocks themselves that must be as they were left.
  const blocks = marks.filter(([id]) => doc.block[id]?.type !== 'frame')
  if (blocks.length === 0) return undefined
  for (const [id, mark] of blocks) {
    const block = doc.block[id]
    if (mark === null ? block !== undefined : block === undefined || blockPrint(block) !== mark) return undefined
  }
  try {
    for (const op of undo.inverse) checkOp(op)
  } catch {
    return undefined
  }
  // From this rev on, the editor's own rule holds: the undo stands while none of its blocks changes again.
  return { inverse: undo.inverse as Op[], rev: doc.rev }
}

/**
 * A note's log with the server's entries it does not hold yet, in the order
 * things happened; undefined when there is nothing new. `kept` is the
 * server's log as read, taken as data: an item that is not an entry of the
 * server's is left out.
 */
export function withAssistants(log: readonly LogItem[], kept: unknown, doc: Doc): LogItem[] | undefined {
  if (!Array.isArray(kept)) return undefined
  const have = new Set(log.map((item) => keyOf(item.entry)))
  const fresh: LogItem[] = []
  for (const item of kept) {
    if (!isRecord(item)) continue
    const parsed = LogEntry.safeParse(item.entry)
    if (!parsed.success || parsed.data.source !== 'mcp' || have.has(keyOf(parsed.data))) continue
    have.add(keyOf(parsed.data))
    const undo = parsed.data.result === 'applied' ? undoHere(item.undo, doc) : undefined
    fresh.push({ entry: parsed.data, ...(undo ? { undo } : {}) })
  }
  if (fresh.length === 0) return undefined
  // Of two edits of one batch to the same block, only the later left it as it is: the earlier lost its undo above.
  return [...log, ...fresh].map((item, index) => ({ item, index })).sort((a, b) => a.item.entry.at - b.item.entry.at || a.index - b.index).map(({ item }) => item)
}

/** The server's log of a note, as it is on this computer now; nothing when there is none, or it cannot be read. */
export async function assistantLog(note: string): Promise<unknown> {
  try {
    const bytes = await invoke<ArrayBuffer>('library_read', { rootName: 'server', path: `log/${note}.json` })
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return undefined
  }
}
