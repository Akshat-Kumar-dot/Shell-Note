// What the server keeps for the person, in its own place beside its copies
// of the notes: a log of what assistants did to each note, which the app can
// show with a way to take an edit back; and each note as it was before an
// assistant changed it, so that nothing an assistant does is past mending.
// Neither is ever in the library's folder, so neither travels to the
// person's other devices or to a cloud service.
import { LogEntry, parseDoc, type Doc, type Op } from '@shellnote/core'
import type { Files } from '@shellnote/library'

/** One edit in a note's log: what was asked and done, and the operations that undo it. */
export interface LogItem {
  entry: LogEntry
  /**
   * What takes the edit back, and the note's rev just after it on this device. `after` holds the mark of each
   * block the edit touched, as it left it (core's blockPrint; null for a block it removed): another device counts
   * its own revs, so it is by these marks that the app knows the blocks are still as the edit left them.
   */
  undo?: { inverse: Op[]; rev: number; after?: Record<string, string | null> }
}

/** The most entries kept for one note: the oldest go first. The same as the app keeps. */
export const LOG_KEPT = 200
/** The most copies kept of one note, how long one is kept, and how long after a copy the next is made. */
export const COPIES_KEPT = 20
export const COPY_DAYS = 30
export const COPY_EVERY = 60 * 60 * 1000

const DAY = 24 * 60 * 60 * 1000
const encoder = new TextEncoder()
const decoder = new TextDecoder()
/** A note's id as a file may be named after it. */
const named = (note: string): boolean => /^[A-Za-z0-9_-]{1,64}$/u.test(note)

export class Keeper {
  constructor(
    private readonly files: Files,
    private readonly now: () => number = Date.now,
  ) {}

  async #read(path: string): Promise<unknown> {
    try {
      if (!(await this.files.info(path))) return undefined
      return JSON.parse(decoder.decode(await this.files.read(path))) as unknown
    } catch {
      return undefined
    }
  }

  #write(path: string, value: unknown): Promise<void> {
    return this.files.write(path, encoder.encode(JSON.stringify(value)))
  }

  /** A note's log, oldest first: only entries that still are log entries. */
  async logged(note: string): Promise<LogItem[]> {
    const kept = named(note) ? await this.#read(`log/${note}.json`) : undefined
    return Array.isArray(kept) ? kept.filter((item): item is LogItem => typeof item === 'object' && item !== null && LogEntry.safeParse((item as LogItem).entry).success) : []
  }

  /** Add an entry to a note's log. */
  async log(note: string, item: LogItem): Promise<void> {
    if (!named(note)) return
    const entry = LogEntry.parse(item.entry)
    await this.#write(`log/${note}.json`, [...(await this.logged(note)), { ...item, entry }].slice(-LOG_KEPT))
  }

  /** When copies of a note were kept, oldest first. */
  async copies(note: string): Promise<number[]> {
    const kept = named(note) ? await this.#read(`copies/${note}/index.json`) : undefined
    return Array.isArray(kept) ? kept.filter((at): at is number => Number.isSafeInteger(at) && at > 0).sort((a, b) => a - b) : []
  }

  /** The notes a copy is kept of. */
  async kept(): Promise<string[]> {
    const notes = new Set<string>()
    for (const info of await this.files.list()) {
      const found = /^copies\/([A-Za-z0-9_-]{1,64})\/index\.json$/u.exec(info.path)
      if (found && !info.folder) notes.add(found[1]!)
    }
    return [...notes].sort()
  }

  /** A copy of a note, as it was kept at that time. */
  async copyAt(note: string, at: number): Promise<Doc | undefined> {
    const kept = named(note) && Number.isSafeInteger(at) ? await this.#read(`copies/${note}/${at}.json`) : undefined
    try {
      return kept === undefined ? undefined : parseDoc(kept)
    } catch {
      return undefined
    }
  }

  /**
   * Keep a note as it is, before an assistant changes it; not when a copy was
   * kept within the hour, so a run of edits has the note from before the run.
   * With `always`, whatever was kept before: a note brought back from a copy
   * is first kept as it was. Returns whether a copy was kept now.
   */
  async copy(note: string, doc: Doc, always = false): Promise<boolean> {
    if (!named(note)) return false
    const had = await this.copies(note)
    const last = had.at(-1)
    // Never the time of a copy already kept: two in one moment are two.
    const now = Math.max(this.now(), always && last !== undefined ? last + 1 : 0)
    if (!always && last !== undefined && now - last < COPY_EVERY && now >= last) return false
    await this.#write(`copies/${note}/${now}.json`, doc)
    // The oldest go once there are too many, and any kept longer than they are promised for.
    const all = [...had, now]
    const keep = all.filter((at, i) => i >= all.length - COPIES_KEPT && now - at <= COPY_DAYS * DAY)
    await this.#write(`copies/${note}/index.json`, keep)
    for (const at of all) if (!keep.includes(at)) await this.files.remove(`copies/${note}/${at}.json`)
    return true
  }
}
