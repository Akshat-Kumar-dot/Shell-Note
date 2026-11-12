// The library in a folder the person chooses, such as one a cloud service
// copies between their devices: folders as real folders, each note one
// .shellnote file, Recently deleted a folder of its own (layout.ts). The
// folder is how notes travel; this keeps every device's notes the same, and
// never loses a word:
//
// - This device keeps its own copy of every note (`local`, outside the
//   folder). Whatever another program does to a note's file, what was written
//   here is still here, to be merged with what arrived.
// - Each file says what it has seen (core's sync/lineage.ts). A file that has
//   seen all this device wrote is taken as it is; one written apart is merged
//   block by block (core's sync/merge.ts), through apply.
// - A second file holding the same note, as cloud services leave when two
//   devices wrote at once ("conflicted copy"), is merged in the same way, then
//   goes to Recently deleted as a note of its own.
// - Every write is whole or not at all, and a file that does not read (half
//   copied, or damaged) is left alone and never taken for the note.
// - When the folder cannot be reached, or is not this library's, nothing in it
//   is taken as deleted.
//
// The merging knows nothing of files, and the files nothing of notes
// (files.ts), so a drive reached another way can use both as they are.
import { apply, become, compare, contentId, createDoc, idFrom, includes, lineageText, merge, mergeOptions, newId, pack, parseDoc, PenProfile, sameContent, seenByBoth, unpack, validateDoc, ValidationError, type Doc, type Lineage, type Opened, type Seen } from '@shellnote/core'
import { EXTENSION } from './names.js'
import { KEPT_DAYS, type Exchanged, type ExchangedNote, type FileState, type FolderEntry, type ItemRef, type Library, type LibraryStore, type NoteEntry, type OpenedNote, type OutsideChange, type SavingNote } from './store.js'
import { canMove, contents, onlyUsedBy, uniqueName } from './tree.js'
import type { FileInfo, Files } from './files.js'
import { BIN, binned, folderId, folderOf, freeName, HIDDEN, inBin, isClutter, isHidden, isNote, join, MARK, namedFor, nameOf, PEN_PROFILE, previewPath, recordPath, safeName, stem, titleStem } from './layout.js'

/** What this device knows of one note: where its file is, what its own copy holds, and what that copy has seen. */
interface NoteState {
  id: string
  /** Where the note's file is in the folder. */
  path: string
  title: string
  pages: number
  assets: string[]
  created: number
  edited: number
  /** The `rev` of this device's copy: its own count, which only goes up. */
  rev: number
  /** The fingerprint of the copy's content. */
  cid: string
  /** When the note was last changed, on any device. */
  at: number
  seen: Seen
  base?: { seen: Seen; rev: number }
  put?: number
  /** The file as last read or written: its size and time, and the fingerprint of what it held. */
  file?: { sig: string; cid: string }
  /** True while the copy holds what the file does not. */
  dirty?: true
}

/** What a file in the folder was found to hold, kept until the file changes. */
interface FileSeen {
  sig: string
  /** The note it holds, and the fingerprint of its content. */
  note?: string
  cid?: string
  title?: string
  lineage?: Lineage
  modified: number
  /** It does not read (half copied or damaged), or was made by a newer ShellNote. */
  problem?: 'broken' | 'newer'
}

interface DeletedRecord {
  at: number
  /** The folder it was in; "" for the top level. */
  from: string
}

export interface FolderLibraryOptions {
  /** The folder the person chose. */
  shared: Files
  /** This device's own place for its copies, outside that folder. */
  local: Files
  now?: () => number
  /** Runs one piece of work at a time across every window of the app; in one window, one after another is enough. */
  lock?: <T>(work: () => Promise<T>) => Promise<T>
  /**
   * A word every window of the app can read and set, such as one kept by the browser: a window that changed this
   * device's copies sets a new one, so the others know to read them again before they go on.
   */
  mark?: { read(): string | null; write(value: string): void }
}

const sigOf = (info: FileInfo): string => `${info.size}:${info.modified}`
const encoder = new TextEncoder()
const decoder = new TextDecoder()
/** A file that has gone is taken as deleted only after it has been gone this long: a cloud service may replace a file by removing it first. */
const GONE_AFTER = 4000
const DAY = 24 * 60 * 60 * 1000
/** How many bytes of pictures are remembered between writes: 128 MiB. */
const PICTURES_HELD = 128 * 2 ** 20

const listing = (doc: Doc): Pick<NoteState, 'title' | 'pages' | 'assets' | 'rev'> => ({ title: doc.title, pages: doc.pages.length, assets: Object.keys(doc.asset).sort(), rev: doc.rev })

export class FolderLibrary implements LibraryStore {
  readonly #shared: Files
  readonly #local: Files
  readonly #now: () => number
  readonly #lock: <T>(work: () => Promise<T>) => Promise<T>
  #queue: Promise<unknown> = Promise.resolve()
  #loaded: Promise<void> | undefined
  #device = ''
  readonly #notes = new Map<string, NoteState>()
  readonly #docs = new Map<string, Doc>()
  readonly #files = new Map<string, FileSeen>()
  #folders: FileInfo[] = []
  readonly #records = new Map<string, DeletedRecord>()
  #recordFiles = new Map<string, { sig: string; record: DeletedRecord }>()
  readonly #gone = new Map<string, number>()
  /** Pictures' bytes read of late, by what they hold, and how many bytes that is. */
  readonly #pictures = new Map<string, Uint8Array>()
  #pictureBytes = 0
  readonly #listeners = new Set<(change: OutsideChange) => void>()
  #changed = new Set<string>()
  #problem: string | undefined
  #timer: ReturnType<typeof setInterval> | undefined
  readonly #mark: FolderLibraryOptions['mark']
  /** The word this window last read or set, and whether it has changed this device's copies since. */
  #word: string | null = null
  #wrote = false

  constructor(options: FolderLibraryOptions) {
    this.#shared = options.shared
    const local = options.local
    const noting = <A extends unknown[]>(change: (...args: A) => Promise<void>) => (...args: A): Promise<void> => {
      this.#wrote = true
      return change(...args)
    }
    this.#local = { list: () => local.list(), info: (path) => local.info(path), read: (path) => local.read(path), write: noting((path, bytes) => local.write(path, bytes)), move: noting((from, to) => local.move(from, to)), remove: noting((path) => local.remove(path)), makeFolder: noting((path) => local.makeFolder(path)) }
    this.#now = options.now ?? Date.now
    this.#lock = options.lock ?? ((work) => work())
    this.#mark = options.mark
  }

  // ----- one thing at a time ---------------------------------------------------

  #run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(() =>
      this.#lock(async () => {
        if (this.#loaded) {
          // Another window changed this device's copies: what this one remembers of them is read again.
          const word = this.#mark?.read() ?? null
          if (word !== this.#word) {
            this.#word = word
            await this.#remember()
          }
        } else {
          this.#word = this.#mark?.read() ?? null
          await (this.#loaded = this.#load())
        }
        try {
          return await work()
        } finally {
          if (this.#wrote && this.#mark) {
            this.#word = newId()
            this.#mark.write(this.#word)
          }
          this.#wrote = false
        }
      }),
    )
    this.#queue = next.catch(() => undefined)
    return next
  }

  /** An action of the person's: done, then the folder looked at again, so what is listed is what is there. */
  #act<T>(work: () => Promise<T>): Promise<T> {
    return this.#run(async () => {
      const result = await work()
      await this.#look()
      return result
    })
  }

  // ----- this device's own copies ------------------------------------------------

  async #readJson(files: Files, path: string): Promise<unknown> {
    try {
      // Asked first whether it is there: a read of what is not there is a fault, and many of these files need not be.
      if (!(await files.info(path))) return undefined
      return JSON.parse(decoder.decode(await files.read(path))) as unknown
    } catch {
      return undefined
    }
  }

  #writeJson(files: Files, path: string, value: unknown): Promise<void> {
    return files.write(path, encoder.encode(JSON.stringify(value)))
  }

  async #load(): Promise<void> {
    const device = (await this.#readJson(this.#local, 'device.json')) as { id?: unknown } | undefined
    if (typeof device?.id === 'string' && /^[A-Za-z0-9]{8}$/u.test(device.id)) this.#device = device.id
    else {
      this.#device = newId()
      await this.#writeJson(this.#local, 'device.json', { id: this.#device })
    }
    await this.#remember()
    await this.#look()
  }

  /** What this device knows of each note, read from its own place: nothing else is kept between starts. */
  async #remember(): Promise<void> {
    this.#notes.clear()
    this.#docs.clear()
    for (const info of await this.#local.list()) {
      if (info.folder || !/^notes\/[A-Za-z0-9_-]+\.state\.json$/u.test(info.path)) continue
      const state = (await this.#readJson(this.#local, info.path)) as NoteState | undefined
      if (state && typeof state.id === 'string' && typeof state.path === 'string' && typeof state.cid === 'string') this.#notes.set(state.id, state)
    }
  }

  /** This device's copy of a note. */
  async #doc(id: string): Promise<Doc> {
    const cached = this.#docs.get(id)
    if (cached) return cached
    const kept = await this.#readJson(this.#local, `notes/${id}.doc.json`)
    if (kept === undefined) throw new Error('This note is not in the library any more.')
    const doc = parseDoc(kept)
    this.#docs.set(id, doc)
    // The copy was written and the app ended before what is known of it was: it counts as a change made here.
    const state = this.#notes.get(id)
    if (state && state.rev !== doc.rev) {
      Object.assign(state, listing(doc), { cid: await contentId(doc), seen: { ...state.seen, [this.#device]: Math.max(doc.rev, state.seen[this.#device] ?? 0) }, dirty: true })
      await this.#writeJson(this.#local, `notes/${id}.state.json`, state)
    }
    return doc
  }

  /** Keep this device's copy of a note, and what it knows of it. */
  async #keep(state: NoteState, doc: Doc): Promise<void> {
    Object.assign(state, listing(doc))
    // The note first, then what is known of it: read in that order too, a half-done keep is seen and put right.
    if (this.#docs.get(state.id) !== doc) await this.#writeJson(this.#local, `notes/${state.id}.doc.json`, doc)
    await this.#writeJson(this.#local, `notes/${state.id}.state.json`, state)
    this.#notes.set(state.id, state)
    this.#docs.set(state.id, doc)
  }

  /** The version this device last took from elsewhere or merged: what merging words needs. */
  async #baseDoc(id: string): Promise<Doc | undefined> {
    const kept = await this.#readJson(this.#local, `notes/${id}.base.json`)
    try {
      return kept === undefined ? undefined : parseDoc(kept)
    } catch {
      return undefined
    }
  }

  async #keepAssets(assets: Iterable<[string, Uint8Array]>): Promise<void> {
    for (const [hash, bytes] of assets) if (!this.#pictures.has(hash) && !(await this.#local.info(`assets/${hash}`))) await this.#local.write(`assets/${hash}`, bytes)
  }

  /** The bytes of a note's pictures. Those just read are remembered: a note is written again with each pause in typing. */
  async #assetBytes(doc: Doc): Promise<Record<string, Uint8Array>> {
    const bytes: Record<string, Uint8Array> = {}
    for (const hash of Object.keys(doc.asset)) {
      const held = this.#pictures.get(hash)
      if (held) {
        bytes[hash] = held
        continue
      }
      try {
        if (!(await this.#local.info(`assets/${hash}`))) continue
        const read = await this.#local.read(`assets/${hash}`)
        bytes[hash] = read
        if (this.#pictureBytes + read.length > PICTURES_HELD) {
          this.#pictures.clear()
          this.#pictureBytes = 0
        }
        this.#pictures.set(hash, read)
        this.#pictureBytes += read.length
      } catch {
        // Not kept: a picture nothing shows any more may have no bytes.
      }
    }
    return bytes
  }

  async #forget(id: string): Promise<void> {
    const state = this.#notes.get(id)
    this.#notes.delete(id)
    this.#docs.delete(id)
    this.#gone.delete(id)
    await this.#local.remove(`notes/${id}.state.json`)
    await this.#local.remove(`notes/${id}.doc.json`)
    await this.#local.remove(`notes/${id}.base.json`)
    // Pictures no other note uses go too.
    if (state) {
      for (const hash of onlyUsedBy({ notes: [...this.#notes.values()].map((n) => this.#entry(n)), folders: [] }, new Set([id]), state.assets)) {
        await this.#local.remove(`assets/${hash}`)
        this.#pictures.delete(hash)
      }
    }
  }

  #lineage(state: NoteState): Lineage {
    return { v: 1, by: this.#device, at: state.at, id: state.cid, seen: state.seen, ...(state.base ? { base: state.base } : {}), ...(state.put !== undefined ? { put: state.put } : {}) }
  }

  // ----- the note's file ----------------------------------------------------------

  /** Read a note's file, or say why it does not read. */
  async #open(path: string, assets: boolean): Promise<Opened | 'broken' | 'newer'> {
    try {
      return unpack(await this.#shared.read(path), { assets })
    } catch (error) {
      return error instanceof ValidationError && error.code === 'too_new' ? 'newer' : 'broken'
    }
  }

  /** What a file holds, read again only when the file changed. */
  async #see(info: FileInfo): Promise<FileSeen> {
    const sig = sigOf(info)
    const before = this.#files.get(info.path)
    if (before?.sig === sig) return before
    const opened = await this.#open(info.path, false)
    const seen: FileSeen = typeof opened === 'string' ? { sig, modified: info.modified, problem: opened } : { sig, modified: info.modified, note: opened.doc.id, title: opened.doc.title, cid: opened.lineage?.id ?? (await contentId(opened.doc)), ...(opened.lineage ? { lineage: opened.lineage } : {}) }
    this.#files.set(info.path, seen)
    return seen
  }

  /** Write this device's copy to the note's file, unless the file changed meanwhile: then that is taken in first. */
  async #write(state: NoteState, tries = 0): Promise<void> {
    const there = await this.#shared.info(state.path)
    const known = this.#files.get(state.path)
    if (there && (sigOf(there) !== state.file?.sig || known?.problem)) {
      const seen = await this.#see(there)
      // Made by a newer ShellNote: never written over. Half copied: left until it settles.
      if (seen.problem === 'newer' || (seen.problem === 'broken' && this.#now() - seen.modified < GONE_AFTER)) return
      if (!seen.problem && seen.note === state.id && seen.sig !== state.file?.sig && tries < 3) {
        await this.#settle(state.id, [state.path])
        if (this.#notes.get(state.id)?.dirty) await this.#write(this.#notes.get(state.id)!, tries + 1)
        return
      }
      // Another note took this name meanwhile: this one goes beside it.
      if (!seen.problem && seen.note !== state.id) state.path = await this.#freePath(folderOf(state.path), state.title)
    }
    const doc = await this.#doc(state.id)
    await this.#shared.write(state.path, pack(doc, await this.#assetBytes(doc), this.#lineage(state)))
    const written = await this.#shared.info(state.path)
    if (!written) throw new Error('The note was written, but its file is not there.')
    state.file = { sig: sigOf(written), cid: state.cid }
    delete state.dirty
    this.#files.set(state.path, { sig: sigOf(written), modified: written.modified, note: state.id, cid: state.cid, lineage: this.#lineage(state) })
    await this.#keep(state, doc)
  }

  /** A name not taken in a folder: by what was listed last, then by the folder itself, where a file may have arrived since. */
  async #free(folder: string, wanted: string, extension: string, but?: string): Promise<string> {
    const taken = [...this.#files.keys(), ...this.#folders.map((f) => f.path)].filter((path) => folderOf(path) === folder && path !== but).map(nameOf)
    for (;;) {
      const path = join(folder, freeName(wanted, extension, taken))
      if (!(await this.#shared.info(path))) return path
      taken.push(nameOf(path))
    }
  }

  /** A path not taken in a folder for a note of this title. */
  #freePath(folder: string, title: string, but?: string): Promise<string> {
    return this.#free(folder, titleStem(title), EXTENSION, but)
  }

  #freeFolder(folder: string, name: string): Promise<string> {
    return this.#free(folder, name, '')
  }

  // ----- taking in what arrived -----------------------------------------------------

  /**
   * Bring this device's copy of a note and a file holding the note together.
   * Returns whether the file held anything the copy lacked.
   */
  async #takeIn(id: string, path: string, seen: FileSeen): Promise<boolean> {
    const state = this.#notes.get(id)
    const theirs: Lineage = seen.lineage ?? { v: 1, by: 'file', at: seen.modified, id: seen.cid!, seen: {} }
    if (state && seen.cid === state.cid) {
      state.seen = seenByBoth(state.seen, theirs.seen)
      return false
    }
    const relation = state && seen.lineage ? compare(theirs.seen, state.seen) : 'apart'
    if (state && relation === 'behind') {
      // An older version than this device's: this one stands, and is written again.
      state.dirty = true
      return false
    }
    const opened = await this.#open(path, true)
    if (typeof opened === 'string') throw new Error('The file changed while it was read.')
    await this.#keepAssets(Object.entries(opened.assets))
    if (!state) {
      // New to this device: taken as it is. Its count carries on above any this device gave the note before.
      const doc = { ...opened.doc, rev: Math.max(opened.doc.rev, theirs.seen[this.#device] ?? 0) }
      const fresh: NoteState = { id, path, ...listing(doc), created: seen.modified, edited: theirs.at, cid: seen.cid!, at: theirs.at, seen: theirs.seen, base: { seen: theirs.seen, rev: doc.rev }, ...(theirs.put !== undefined ? { put: theirs.put } : {}) }
      await this.#writeJson(this.#local, `notes/${id}.base.json`, doc)
      await this.#keep(fresh, doc)
      this.#changed.add(id)
      return true
    }
    const mine = this.#lineage(state)
    const doc = await this.#doc(id)
    let next: Doc
    if (relation === 'ahead') {
      // It has seen all this device wrote, and more: its version, through apply, so this device's count goes on.
      next = become(doc, opened.doc).doc
      state.seen = theirs.seen
      state.cid = seen.cid!
    } else {
      // Written apart: merged, over the last version both are known to come from when this device has it.
      const base = state.base && includes(theirs.seen, state.base.seen) ? await this.#baseDoc(id) : undefined
      next = validateDoc(become(doc, merge(doc, opened.doc, { ...(base ? { base } : {}), ...mergeOptions(mine, theirs) }).doc).doc)
      const cid = await contentId(next)
      state.seen = seenByBoth(mine.seen, theirs.seen)
      // A merge that says nothing new of what was seen, yet holds something new, counts as this device's change.
      if (cid !== state.cid && cid !== seen.cid && compare(state.seen, mine.seen) === 'same') state.seen = { ...state.seen, [this.#device]: next.rev }
      state.cid = cid
    }
    state.at = Math.max(state.at, theirs.at)
    state.edited = state.at
    state.base = { seen: state.seen, rev: next.rev }
    await this.#writeJson(this.#local, `notes/${id}.base.json`, next)
    await this.#keep(state, next)
    this.#changed.add(id)
    return true
  }

  /** The note a file holds, kept beside the note it could not be merged with, under a name that says so. */
  async #keepBeside(state: NoteState, path: string, seen: FileSeen): Promise<void> {
    const opened = await this.#open(path, true)
    if (typeof opened === 'string') return
    const id = idFrom(`${state.id}|${seen.cid}|beside`)
    if (this.#notes.has(id)) return
    await this.#keepAssets(Object.entries(opened.assets))
    const day = new Date(this.#now()).toISOString().slice(0, 10)
    const doc = validateDoc({ ...opened.doc, id, title: `${opened.doc.title} (conflicted copy ${day})` })
    const fresh: NoteState = { id, path: await this.#freePath(folderOf(state.path), doc.title), ...listing(doc), created: this.#now(), edited: this.#now(), cid: await contentId(doc), at: this.#now(), seen: { [this.#device]: doc.rev }, dirty: true }
    await this.#keep(fresh, doc)
    await this.#write(fresh)
    this.#changed.add(id)
  }

  /**
   * A second file holding a note that is merged in now: Recently deleted
   * takes it, as a note of its own, for 30 days. One that held just what the
   * note holds was copied by hand, and becomes a note of its own where it is.
   */
  async #retire(state: NoteState, path: string, seen: FileSeen, same: boolean): Promise<void> {
    const opened = await this.#open(path, true)
    if (typeof opened === 'string') return
    if (same && !inBin(path)) {
      const doc = { ...opened.doc, id: newId((id) => this.#notes.has(id) || Object.hasOwn(opened.doc.block, id) || Object.hasOwn(opened.doc.page, id)) }
      await this.#keepAssets(Object.entries(opened.assets))
      const fresh: NoteState = { id: doc.id, path, ...listing(doc), created: this.#now(), edited: this.#now(), cid: await contentId(doc), at: this.#now(), seen: { [this.#device]: doc.rev }, dirty: true }
      await this.#keep(fresh, doc)
      await this.#write(fresh)
      return
    }
    // The same name on every device, so two that do this at once leave one file.
    const id = idFrom(`${state.id}|${seen.cid}`)
    const name = `${titleStem(opened.doc.title)} (conflicted copy ${seen.cid!.slice(0, 8)})${EXTENSION}`
    const target = join(BIN, name)
    if (path === target) return
    if (!(await this.#shared.info(target))) {
      const doc = validateDoc({ ...opened.doc, id, title: `${opened.doc.title} (conflicted copy)` })
      await this.#shared.write(target, pack(doc, opened.assets))
      if (!this.#records.has(name)) await this.#record(name, { at: this.#now(), from: inBin(state.path) ? '' : folderOf(state.path) })
    }
    await this.#shared.remove(path)
    this.#files.delete(path)
  }

  async #record(name: string, record: DeletedRecord | undefined): Promise<void> {
    if (record) {
      await this.#writeJson(this.#shared, recordPath(name), record)
      this.#records.set(name, record)
    } else {
      await this.#shared.remove(recordPath(name))
      this.#records.delete(name)
    }
  }

  /** Bring one note and every file that holds it together: its content, and where it belongs. */
  async #settle(id: string, paths: string[]): Promise<void> {
    const before = this.#notes.get(id)
    // Nothing new: the one file is where it was and as it was last read or written, and the copy holds no more.
    if (before && !before.dirty && paths.length === 1 && paths[0] === before.path && this.#files.get(before.path)?.sig === before.file?.sig) {
      this.#gone.delete(id)
      return
    }
    const was = before ? JSON.stringify(before) : ''
    const files = paths.map((path) => ({ path, seen: this.#files.get(path)! })).filter((file) => !file.seen.problem)
    if (files.length === 0) {
      // Files that do not read yet are waited for; none at all, and the note is written again, or is gone.
      if (!before || paths.length > 0) return
      if (before.dirty || !before.file) {
        await this.#write(before)
        return
      }
      const since = this.#gone.get(id) ?? this.#now()
      this.#gone.set(id, since)
      if (this.#now() - since >= GONE_AFTER) {
        await this.#forget(id)
        this.#changed.add(id)
      }
      return
    }
    this.#gone.delete(id)

    // Where the note belongs: the file put there last says. A deleted one does not stand over a note changed since.
    // Of two put there at once, or never moved: the one named as its title asks, as a service's conflicted copy never is.
    // Nothing here depends on the device, so every device chooses the same file.
    const fits = (file: (typeof files)[number]): number => (file.seen.title === undefined ? 2 : titleStem(file.seen.title).toLocaleLowerCase() === stem(nameOf(file.path)).toLocaleLowerCase() ? 0 : namedFor(nameOf(file.path), file.seen.title) ? 1 : 2)
    const order = [...files].sort((a, b) => (b.seen.lineage?.put ?? 0) - (a.seen.lineage?.put ?? 0) || fits(a) - fits(b) || a.path.length - b.path.length || (a.path < b.path ? -1 : 1))
    let main = order[0]!
    if (inBin(main.path)) {
      const alive = order.find((file) => !inBin(file.path) && !includes(main.seen.lineage?.seen ?? {}, file.seen.lineage?.seen ?? {}))
      if (alive) main = alive
    }
    const edited = before !== undefined && !inBin(before.path) && !includes(main.seen.lineage?.seen ?? {}, before.seen)
    const mainCid = main.seen.cid
    // The very same version in a second file was copied there by hand; two devices never write the same version twice.
    const mainLineage = main.seen.lineage
    const copied = (seen: FileSeen): boolean => seen.cid === mainCid && (seen.lineage && mainLineage ? lineageText(seen.lineage) === lineageText(mainLineage) : !seen.lineage && !mainLineage)

    const beside: typeof files = []
    for (const file of [main, ...files.filter((other) => other !== main)]) {
      try {
        await this.#takeIn(id, file.path, file.seen)
      } catch (error) {
        const state = this.#notes.get(id)
        // The two cannot be merged: both are kept, side by side. A file that only failed to read is tried again.
        if (!state || !(error instanceof ValidationError)) throw error
        state.seen = seenByBoth(state.seen, file.seen.lineage?.seen ?? {})
        beside.push(file)
      }
    }
    const state = this.#notes.get(id)!
    if (state.path !== main.path) {
      if (edited && inBin(main.path)) {
        // Deleted on another device, and changed here since: the change brings it back to where it was.
        const back = await this.#freePath(this.#folders.some((f) => f.path === folderOf(state.path)) ? folderOf(state.path) : '', state.title)
        await this.#shared.move(main.path, back)
        await this.#record(nameOf(main.path), undefined)
        this.#files.delete(main.path)
        this.#files.set(back, main.seen)
        main = { path: back, seen: main.seen }
        state.put = this.#now()
        state.dirty = true
      } else if (main.seen.lineage?.put !== undefined) state.put = main.seen.lineage.put
      state.path = main.path
      this.#changed.add('')
    }
    state.file = { sig: main.seen.sig, cid: mainCid! }
    if (state.cid !== mainCid || !includes(main.seen.lineage?.seen ?? {}, state.seen) || beside.includes(main)) state.dirty = true
    for (const file of files) {
      if (file === main) continue
      if (beside.includes(file)) {
        await this.#keepBeside(state, file.path, file.seen)
        await this.#shared.remove(file.path)
        this.#files.delete(file.path)
      } else await this.#retire(state, file.path, file.seen, copied(file.seen))
      this.#changed.add('')
    }
    if (beside.includes(main)) await this.#keepBeside(state, main.path, main.seen)
    if (state.dirty) await this.#write(state)
    else if (JSON.stringify(state) !== was) await this.#writeJson(this.#local, `notes/${id}.state.json`, state)
  }

  /** Look at the folder, and bring every note together with what is there now. */
  async #look(): Promise<void> {
    let infos: FileInfo[]
    try {
      infos = await this.#shared.list()
    } catch (error) {
      this.#problem = `The library's folder cannot be reached: ${(error as Error).message} Your notes are kept on this computer, and go into the folder when it is back.`
      return
    }
    if (!infos.some((info) => info.path === MARK)) {
      if (this.#notes.size > 0 && [...this.#notes.values()].some((state) => state.file)) {
        // Not the library any more (another folder under its name, or one not copied yet): nothing is taken as deleted.
        this.#problem = "The folder is not this library's any more. Your notes are kept on this computer; choose the library's folder again in Settings."
        return
      }
      await this.#writeJson(this.#shared, MARK, { v: 1 })
    }
    this.#problem = undefined
    const was = this.#shape()

    // When each deleted item went, and from where: read again only when its small file changed.
    const told = new Map<string, { sig: string; record: DeletedRecord }>()
    this.#records.clear()
    for (const info of infos) {
      if (info.folder || !info.path.startsWith(`${HIDDEN}/deleted/`) || !info.path.endsWith('.json')) continue
      const name = nameOf(info.path).slice(0, -'.json'.length)
      const held = this.#recordFiles.get(name)
      if (held?.sig === sigOf(info)) {
        told.set(name, held)
        this.#records.set(name, held.record)
        continue
      }
      const record = (await this.#readJson(this.#shared, info.path)) as Partial<DeletedRecord> | undefined
      if (record && typeof record.at === 'number' && typeof record.from === 'string') {
        const read = { at: record.at, from: record.from }
        told.set(name, { sig: sigOf(info), record: read })
        this.#records.set(name, read)
      }
    }
    this.#recordFiles = told
    this.#folders = infos.filter((info) => info.folder && !isHidden(info.path) && info.path !== BIN)
    const noteFiles = infos.filter((info) => !info.folder && isNote(info.path))
    const there = new Set(noteFiles.map((info) => info.path))
    for (const path of [...this.#files.keys()]) if (!there.has(path)) this.#files.delete(path)
    const byNote = new Map<string, string[]>()
    const unread = new Map<string, string[]>()
    for (const info of noteFiles) {
      const seen = await this.#see(info)
      if (seen.note !== undefined) byNote.set(seen.note, [...(byNote.get(seen.note) ?? []), info.path])
      else unread.set(info.path, [info.path])
    }
    for (const id of new Set([...this.#notes.keys(), ...byNote.keys()])) {
      // A file that does not read, where this note's file was, is waited for, not taken as the note gone.
      const state = this.#notes.get(id)
      const paths = byNote.get(id) ?? (state && unread.has(state.path) ? [state.path] : [])
      try {
        await this.#settle(id, paths)
      } catch (error) {
        console.warn(`shellnote: note ${id} could not be brought in step with its file`, error)
      }
    }
    // What lies in Recently deleted with no word of when it went is counted from now.
    for (const path of [...this.#folders.map((f) => f.path), ...[...this.#notes.values()].map((state) => state.path)]) {
      if (binned(path) && !this.#records.has(nameOf(path))) await this.#record(nameOf(path), { at: this.#now(), from: '' })
    }
    if (this.#shape() !== was) this.#changed.add('')
    this.#tell()
  }

  /** What the library lists, as one text: to see whether a look changed it. */
  #shape(): string {
    return JSON.stringify([this.#folders.map((f) => f.path).sort(), [...this.#notes.values()].map((s) => [s.id, s.path, s.title]).sort(), [...this.#records.entries()].sort()])
  }

  #tell(): void {
    if (this.#changed.size === 0) return
    const library = this.#changed.delete('')
    const change: OutsideChange = { notes: this.#changed, library }
    this.#changed = new Set()
    for (const listener of [...this.#listeners]) listener(change)
  }

  // ----- what the app is told ----------------------------------------------------------

  /** Look at the folder now: what other devices wrote is taken in, and what this one holds goes out. */
  sync(): Promise<void> {
    return this.#run(() => this.#look())
  }

  /** Look at the folder every so often while the app is open. Returns the function that stops it. */
  start(every = 2000): () => void {
    let busy = false
    this.#timer ??= setInterval(() => {
      if (busy) return
      busy = true
      void this.sync()
        .catch((error: unknown) => console.warn('shellnote: the folder could not be looked at', error))
        .finally(() => (busy = false))
    }, every)
    return () => {
      clearInterval(this.#timer)
      this.#timer = undefined
    }
  }

  watch(listener: (change: OutsideChange) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** What stands in the way of the folder now, in words a person can read; undefined when nothing does. */
  problem(): string | undefined {
    return this.#problem
  }

  // ----- the library's actions -----------------------------------------------------------

  #entry(state: NoteState): NoteEntry {
    const record = binned(state.path) ? this.#records.get(nameOf(state.path)) : undefined
    const home = binned(state.path) ? (record && this.#folders.some((f) => f.path === record.from) ? record.from : '') : folderOf(state.path)
    return {
      id: state.id,
      title: state.title,
      folder: folderId(home),
      created: state.created,
      edited: state.edited,
      pages: state.pages,
      assets: state.assets,
      unsaved: false,
      file: { name: nameOf(state.path), savedAt: state.edited },
      ...(binned(state.path) ? { deleted: record?.at ?? state.put ?? state.edited } : {}),
    }
  }

  #folderEntry(info: FileInfo): FolderEntry {
    const record = binned(info.path) ? this.#records.get(nameOf(info.path)) : undefined
    const home = binned(info.path) ? (record && this.#folders.some((f) => f.path === record.from) ? record.from : '') : folderOf(info.path)
    return { id: folderId(info.path)!, name: nameOf(info.path), parent: folderId(home), created: info.modified, edited: info.modified, ...(binned(info.path) ? { deleted: record?.at ?? info.modified } : {}) }
  }

  #library(): Library {
    return { notes: [...this.#notes.values()].map((state) => this.#entry(state)), folders: this.#folders.map((info) => this.#folderEntry(info)) }
  }

  /** A folder's place from its id; "" for the top level. Throws when it is not there. */
  #folderPath(id: string | null): string {
    if (id === null) return ''
    const found = this.#folders.find((info) => folderId(info.path) === id)
    if (!found) throw new Error('That folder is not in the library any more.')
    return found.path
  }

  #state(id: string): NoteState {
    const state = this.#notes.get(id)
    if (!state) throw new Error('That note is not in the library any more.')
    return state
  }

  list(): Promise<Library> {
    return this.#run(async () => this.#library())
  }

  open(id: string): Promise<OpenedNote> {
    return this.#run(async () => {
      const state = this.#notes.get(id)
      if (!state) throw new Error('This note is not in the library any more.')
      const doc = await this.#doc(id)
      const file: FileState = { name: nameOf(state.path), rev: doc.rev, savedAt: state.edited }
      return { entry: this.#entry(state), doc, assets: await this.#blobs(doc), file }
    })
  }

  async #blobs(doc: Doc): Promise<Map<string, Blob>> {
    const assets = new Map<string, Blob>()
    for (const [hash, bytes] of Object.entries(await this.#assetBytes(doc))) assets.set(hash, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: doc.asset[hash]!.mime }))
    return assets
  }

  /** A change made on this device: counted as its own, and the file named after the title. */
  async #changedHere(state: NoteState, doc: Doc): Promise<void> {
    state.cid = await contentId(doc)
    state.seen = { ...state.seen, [this.#device]: doc.rev }
    state.at = state.edited = this.#now()
    state.dirty = true
    await this.#keep(state, doc)
    if (!namedFor(nameOf(state.path), doc.title) && !inBin(state.path)) {
      const target = await this.#freePath(folderOf(state.path), doc.title, state.path)
      if (await this.#shared.info(state.path)) {
        await this.#shared.move(state.path, target)
        const seen = this.#files.get(state.path)
        this.#files.delete(state.path)
        if (seen) this.#files.set(target, seen)
      }
      state.path = target
      // Of two devices that named it at once, the later name stands.
      state.put = this.#now()
      this.#changed.add('')
    }
    await this.#write(state)
  }

  async #newState(doc: Doc, folder: string): Promise<NoteState> {
    const now = this.#now()
    return { id: doc.id, path: await this.#freePath(folder, doc.title), ...listing(doc), created: now, edited: now, cid: await contentId(doc), at: now, seen: { [this.#device]: doc.rev }, dirty: true }
  }

  save(note: SavingNote): Promise<NoteEntry> {
    return this.#exchange(note, undefined).then((kept) => kept.entry)
  }

  exchange(note: ExchangedNote): Promise<Exchanged> {
    return this.#exchange(note, note.since)
  }

  /** Keep a note. With `since`, the note as the screen last had it from the library; without, the note given is taken to hold all the library has. */
  #exchange({ doc, blob }: SavingNote, since: Doc | undefined): Promise<Exchanged> {
    return this.#run(async () => {
      for (const hash of Object.keys(doc.asset)) {
        const bytes = blob(hash)
        if (bytes && !(await this.#local.info(`assets/${hash}`))) await this.#local.write(`assets/${hash}`, new Uint8Array(await bytes.arrayBuffer()))
      }
      let state = this.#notes.get(doc.id)
      if (!state) {
        // Open on a screen, with nothing new in it, and gone from the library: removed for good elsewhere, and not brought back.
        if (since !== undefined && sameContent(since, doc)) throw new Error('This note is not in the library any more: it was removed for good, here or on another device.')
        // A note the library does not have: kept as a new one, at the top level.
        state = await this.#newState(doc, '')
        await this.#keep(state, doc)
        await this.#write(state)
        this.#changed.add('')
        this.#tell()
        return { entry: this.#entry(state) }
      }
      const mine = await this.#doc(doc.id)
      // What the screen holds, merged with what arrived since it last looked; through apply, so this device's count goes on.
      const arrived = since !== undefined && !sameContent(since, mine)
      const target = arrived ? merge(doc, mine, { base: since, first: 'mine' }).doc : doc
      if (!sameContent(mine, target)) await this.#changedHere(state, become(mine, target).doc)
      else if (state.dirty) await this.#write(state)
      this.#tell()
      const now = await this.#doc(doc.id)
      return { entry: this.#entry(state), ...(sameContent(now, doc) ? {} : { merged: { doc: now, assets: await this.#blobs(now) } }) }
    })
  }

  newNote(folder: string | null, from?: { doc: Doc; assets: Map<string, Blob>; file?: FileState | undefined }): Promise<NoteEntry> {
    return this.#act(async () => {
      const library = this.#library()
      const home = folder !== null && library.folders.some((f) => f.id === folder && !inBin(this.#folderPath(folder))) ? this.#folderPath(folder) : ''
      let doc: Doc
      if (from) {
        // The same file opened twice gives two notes, so the two stay apart.
        const taken = new Set([...this.#notes.keys(), ...Object.keys(from.doc.block), ...from.doc.pages])
        doc = this.#notes.has(from.doc.id) ? { ...from.doc, id: newId((id) => taken.has(id)) } : from.doc
        for (const [hash, bytes] of from.assets) await this.#keepAssets([[hash, new Uint8Array(await bytes.arrayBuffer())]])
      } else doc = createDoc({ title: uniqueName('Untitled', contents(library, folderId(home)).notes.map((n) => n.title)) })
      const state = await this.#newState(doc, home)
      await this.#keep(state, doc)
      await this.#write(state)
      return this.#entry(state)
    })
  }

  newFolder(parent: string | null): Promise<FolderEntry> {
    return this.#act(async () => {
      const library = this.#library()
      const home = parent !== null && library.folders.some((f) => f.id === parent) && !inBin(this.#folderPath(parent)) ? this.#folderPath(parent) : ''
      const path = await this.#freeFolder(home, 'Untitled folder')
      await this.#shared.makeFolder(path)
      const info = (await this.#shared.info(path)) ?? { path, folder: true, size: 0, modified: this.#now() }
      this.#folders.push(info)
      return this.#folderEntry(info)
    })
  }

  rename(item: ItemRef, name: string): Promise<void> {
    return this.#act(async () => {
      const wanted = name.trim()
      if (wanted === '') throw new Error('A name cannot be empty.')
      if (item.kind === 'note') {
        // A note's title is part of the note, so it changes through core's apply, like any edit.
        const state = this.#state(item.id)
        const doc = await this.#doc(item.id)
        if (doc.title !== wanted) await this.#changedHere(state, apply(doc, [{ op: 'update', id: doc.id, set: { title: wanted } }]).doc)
        return
      }
      const path = this.#folderPath(item.id)
      const target = join(folderOf(path), safeName(wanted))
      if (target === path) return
      if (target === BIN || target === HIDDEN) throw new Error(`A folder cannot be called "${nameOf(target)}": the library keeps that name for itself.`)
      if (target.toLocaleLowerCase() !== path.toLocaleLowerCase() && (await this.#shared.info(target))) throw new Error(`"${nameOf(target)}" is here already. Choose another name.`)
      await this.#shared.move(path, target)
      if (binned(path)) {
        const record = this.#records.get(nameOf(path))
        await this.#record(nameOf(path), undefined)
        if (record) await this.#record(nameOf(target), record)
      }
    })
  }

  /** Put a note's file somewhere else, and say when: of two devices that moved it, the later one stands. */
  async #put(state: NoteState, target: string): Promise<void> {
    if (await this.#shared.info(state.path)) await this.#shared.move(state.path, target)
    const seen = this.#files.get(state.path)
    this.#files.delete(state.path)
    if (seen) this.#files.set(target, seen)
    state.path = target
    state.put = this.#now()
    state.dirty = true
    await this.#write(state)
  }

  move(item: ItemRef, to: string | null): Promise<void> {
    return this.#act(async () => {
      if (!canMove(this.#library(), item, to)) throw new Error(item.kind === 'folder' && to !== null ? 'A folder cannot go into itself or into one of its own folders.' : 'That place is not in the library any more.')
      const home = this.#folderPath(to)
      if (item.kind === 'note') {
        const state = this.#state(item.id)
        if (folderOf(state.path) !== home) await this.#put(state, await this.#freePath(home, stem(nameOf(state.path))))
      } else {
        const path = this.#folderPath(item.id)
        if (folderOf(path) !== home) await this.#shared.move(path, await this.#freeFolder(home, nameOf(path)))
      }
    })
  }

  delete(item: ItemRef): Promise<void> {
    return this.#act(async () => {
      const path = item.kind === 'note' ? this.#state(item.id).path : this.#folderPath(item.id)
      if (binned(path)) return
      // Out of a deleted folder too: it then waits in Recently deleted by itself.
      const target = item.kind === 'note' ? await this.#freePath(BIN, stem(nameOf(path))) : await this.#freeFolder(BIN, nameOf(path))
      await this.#record(nameOf(target), { at: this.#now(), from: inBin(path) ? '' : folderOf(path) })
      if (item.kind === 'note') await this.#put(this.#state(item.id), target)
      else await this.#shared.move(path, target)
    })
  }

  restore(item: ItemRef): Promise<void> {
    return this.#act(async () => {
      const path = item.kind === 'note' ? this.#notes.get(item.id)?.path : this.#folders.find((info) => folderId(info.path) === item.id)?.path
      if (path === undefined || !binned(path)) throw new Error(`That ${item.kind} is not in Recently deleted any more.`)
      // Back to its folder, or to the top level when that folder is gone or deleted itself.
      const from = this.#records.get(nameOf(path))?.from ?? ''
      const home = from !== '' && this.#folders.some((f) => f.path === from) && !inBin(from) ? from : ''
      if (item.kind === 'note') await this.#put(this.#state(item.id), await this.#freePath(home, stem(nameOf(path))))
      else await this.#shared.move(path, await this.#freeFolder(home, nameOf(path)))
      await this.#record(nameOf(path), undefined)
    })
  }

  /**
   * Remove an item for good, with the notes a folder holds. Only notes are ever removed: a folder that holds other
   * files too (the person may have chosen a folder with more in it than notes) loses its notes and is put back in
   * the library with the rest. Returns whether the item is gone.
   */
  async #removeForGood(path: string, folder: boolean): Promise<boolean> {
    const inside = (other: string): boolean => other === path || (folder && other.startsWith(`${path}/`))
    for (const state of [...this.#notes.values()]) {
      if (!inside(state.path)) continue
      await this.#shared.remove(previewPath(state.id))
      await this.#forget(state.id)
    }
    for (const key of [...this.#files.keys()]) if (inside(key)) this.#files.delete(key)
    let others = false
    if (folder) {
      // Each note's file by itself, and the small files other programs leave; then the folder, when nothing else is in it.
      for (const info of await this.#shared.list()) {
        if (info.folder || !info.path.startsWith(`${path}/`)) continue
        if (isNote(info.path) || isClutter(nameOf(info.path))) await this.#shared.remove(info.path)
        else others = true
      }
    }
    if (!others) await this.#shared.remove(path)
    else if (binned(path)) {
      const from = this.#records.get(nameOf(path))?.from ?? ''
      await this.#shared.move(path, await this.#freeFolder(from !== '' && this.#folders.some((f) => f.path === from) && !inBin(from) ? from : '', nameOf(path)))
    }
    if (binned(path)) await this.#record(nameOf(path), undefined)
    return !others
  }

  deleteForever(item: ItemRef): Promise<void> {
    return this.#act(async () => {
      if (item.kind === 'note') {
        const state = this.#notes.get(item.id)
        if (state) await this.#removeForGood(state.path, false)
      } else {
        const found = this.#folders.find((info) => folderId(info.path) === item.id)
        if (found && !(await this.#removeForGood(found.path, true))) {
          await this.#look()
          throw new Error(`The notes in "${nameOf(found.path)}" are removed for good. The folder holds other files too, which ShellNote never removes, so it is back in your library with them.`)
        }
      }
    })
  }

  #inBin(): { path: string; folder: boolean }[] {
    return [...this.#folders.filter((info) => binned(info.path)).map((info) => ({ path: info.path, folder: true })), ...[...this.#notes.values()].filter((state) => binned(state.path)).map((state) => ({ path: state.path, folder: false }))]
  }

  emptyBin(): Promise<void> {
    return this.#act(async () => {
      for (const item of this.#inBin()) await this.#removeForGood(item.path, item.folder)
    })
  }

  purgeExpired(now: number): Promise<number> {
    return this.#act(async () => {
      let gone = 0
      for (const item of this.#inBin()) {
        const record = this.#records.get(nameOf(item.path))
        if (!record || now - record.at <= KEPT_DAYS * DAY) continue
        if (await this.#removeForGood(item.path, item.folder)) gone++
      }
      return gone
    })
  }

  preview(id: string): Promise<Blob | undefined> {
    return this.#run(async () => {
      try {
        if (!(await this.#shared.info(previewPath(id)))) return undefined
        return new Blob([(await this.#shared.read(previewPath(id))) as Uint8Array<ArrayBuffer>], { type: 'image/webp' })
      } catch {
        return undefined
      }
    })
  }

  setPreview(id: string, picture: Blob): Promise<void> {
    return this.#run(async () => {
      // A note deleted for good meanwhile gets no thumbnail back.
      if (this.#notes.has(id)) await this.#shared.write(previewPath(id), new Uint8Array(await picture.arrayBuffer()))
    })
  }

  penProfile(): Promise<PenProfile | undefined> {
    return this.#run(async () => {
      const kept = PenProfile.safeParse(await this.#readJson(this.#shared, PEN_PROFILE))
      return kept.success ? kept.data : undefined
    })
  }

  setPenProfile(profile: PenProfile | undefined): Promise<void> {
    return this.#run(async () => {
      if (profile) await this.#writeJson(this.#shared, PEN_PROFILE, PenProfile.parse(profile))
      else await this.#shared.remove(PEN_PROFILE)
    })
  }
}
