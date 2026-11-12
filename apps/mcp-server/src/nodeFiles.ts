// The library's files on this computer's disk, for the server: the folder the
// person chose in ShellNote ("shared"), and the server's own place for its
// copies ("own"). It is the only file here that touches the disk, and it keeps
// the same rules as the desktop app's own side (src-tauri/src/library.rs):
//
// - A path never leaves its folder: not by "..", a drive, a stream or a
//   device's name, not through a link or a junction, and not by a short form
//   of another name. The name checked is the file reached.
// - In the folder chosen, only notes (.shellnote files) and the library's own
//   small files are read, written or removed: never another file it holds.
// - A folder is removed only once it holds no file; a move never takes
//   another file's place.
// - A file is written whole or not at all: to a temporary file beside it,
//   then renamed over it.
import { promises as fs, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { EXTENSION, type FileInfo, type Files } from '@shellnote/library'
import { HIDDEN, isClutter } from '@shellnote/library/layout'

/** Which of the two folders: the one the person chose, or the server's own. */
export type Root = 'shared' | 'own'

/** The largest file read or written: a note with its pictures and videos. */
const MAX_BYTES = 2 ** 30 + 64 * 2 ** 20
/** How deep, and how much, a listing goes at most: a folder that loops or is not a library ends there. */
const MAX_DEPTH = 40
const MAX_ENTRIES = 500_000
const OUTSIDE = "That path is not inside the library's folder."
const NOT_THE_LIBRARYS = "That is not a note, nor a file of the library's own."

/** Names differing only in case are one name on Windows and macOS. */
const ONE_CASE = process.platform === 'win32' || process.platform === 'darwin'
const fold = (text: string): string => (ONE_CASE ? text.normalize('NFC').toLowerCase() : text.normalize('NFC'))

/**
 * A name Windows keeps for one of its devices, in any folder and whatever comes after a dot ("NUL", "con.txt",
 * "COM1"): a file cannot be called one, and opening one reaches the device.
 */
function isDevice(part: string): boolean {
  const stem = (part.split('.')[0] ?? '').replace(/ +$/u, '').toLowerCase()
  if (['con', 'prn', 'aux', 'nul', 'conin$', 'conout$'].includes(stem)) return true
  return /^(?:com|lpt)[0-9¹²³]$/u.test(stem)
}

/**
 * One name of a path, as Windows keeps it: not empty, not "." or "..", no character a name cannot hold (a drive's or
 * a stream's ":" among them), no dot or space at its end (Windows drops those), and not a device's name.
 */
export function plain(part: string): boolean {
  if (part === '' || part === '.' || part === '..' || part.length > 255) return false
  if (part.endsWith('.') || part.endsWith(' ')) return false
  if (Array.from(part).some((ch) => ch < ' ' || '\\/:*?"<>|'.includes(ch))) return false
  return !isDevice(part)
}

/** What a path is to the library, by its name alone. */
export type Kind = 'note' | 'own' | 'clutter' | 'other'

const isId = (text: string): boolean => /^[A-Za-z0-9_-]{1,64}$/u.test(text)

export function kindOf(root: Root, rel: string): Kind {
  const parts = rel.split('/')
  const last = parts[parts.length - 1] ?? ''
  const lower = last.toLowerCase()
  if (root === 'own') {
    if (rel === 'device.json') return 'own'
    if (parts.length === 2 && parts[0] === 'notes') {
      const end = ['.doc.json', '.state.json', '.base.json'].find((suffix) => last.endsWith(suffix))
      return end !== undefined && isId(last.slice(0, -end.length)) ? 'own' : 'other'
    }
    if (parts.length === 2 && parts[0] === 'assets') return /^[0-9a-f]{4,64}$/u.test(last) ? 'own' : 'other'
    // What the server keeps for the person (keeper.ts): each note's log, and copies of a note as it was.
    if (parts.length === 2 && parts[0] === 'log') return last.endsWith('.json') && isId(last.slice(0, -'.json'.length)) ? 'own' : 'other'
    if (parts.length === 3 && parts[0] === 'copies') return isId(parts[1]!) && /^(?:index|[0-9]{1,16})\.json$/u.test(last) ? 'own' : 'other'
    return 'other'
  }
  if ((parts[0] ?? '').toLowerCase() === HIDDEN) {
    // The hidden folder holds small files of two kinds, at most one folder down: nothing that could run.
    const small = lower.endsWith('.json') || lower.endsWith('.webp')
    return parts.length >= 2 && parts.length <= 3 && small ? 'own' : 'other'
  }
  if (isClutter(last)) return 'clutter'
  const named = lower.endsWith(EXTENSION) && lower.length > EXTENSION.length
  return named && parts.every((part) => !part.startsWith('.') && !part.startsWith('~$')) ? 'note' : 'other'
}

const inHidden = (rel: string): boolean => (rel.split('/')[0] ?? '').toLowerCase() === HIDDEN

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'
const held = (error: unknown): boolean => ['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Rename `from` over `to`, trying again for a moment: a cloud service or a virus scanner may hold a file as it reads it. */
async function renameOver(from: string, to: string): Promise<void> {
  for (let tries = 0; ; tries++) {
    try {
      return await fs.rename(from, to)
    } catch (error) {
      if (tries >= 8 || !held(error)) throw error
      await wait(60)
    }
  }
}

let writes = 0

/** The file that says a server is at work in its own place, and the one that says its copies changed. */
const LOCK = 'lock'
const WORD = 'word'
/** A lock is touched this often while its work goes on; one not touched for STALE was left by a server that ended. */
const BEAT = 3_000
const STALE = 15_000
/** How long a call waits for another server's work before it gives up. */
const PATIENCE = 60_000

export class NodeFiles implements Files {
  private constructor(
    /** The folder's real place on the disk, with every link on the way to it followed once, here. */
    private readonly folder: string,
    private readonly root: Root,
  ) {}

  /**
   * The files of a folder. The folder the person chose must be there already, and is never made; the server's own
   * place is made when it is not.
   */
  static async open(folder: string, root: Root): Promise<NodeFiles> {
    if (!path.isAbsolute(folder)) throw new Error("The library's folder must be given as a whole path.")
    if (root === 'own') await fs.mkdir(folder, { recursive: true })
    const real = await fs.realpath(folder).catch(() => undefined)
    if (real === undefined || !(await fs.stat(real)).isDirectory()) throw new Error("The library's folder is not there.")
    return new NodeFiles(real, root)
  }

  /** The place a path names inside the folder; throws when it would lead anywhere else. */
  async #inside(rel: string): Promise<string> {
    if (rel === '' || rel.length > 2048) throw new Error(OUTSIDE)
    let full = this.folder
    for (const part of rel.split('/')) {
      if (!plain(part)) throw new Error(OUTSIDE)
      full = path.join(full, part)
      const meta = await fs.lstat(full).catch(() => undefined)
      if (meta === undefined) continue
      // A symbolic link, and on Windows a junction, which any program may leave in a folder it can write to.
      if (meta.isSymbolicLink()) throw new Error(OUTSIDE)
      // The name on the disk must be the one asked for: a short form ("NOTES~1") is another name's, and a link of a
      // kind the line above does not know would show here too.
      const real = await fs.realpath(full).catch(() => undefined)
      if (real === undefined || fold(real) !== fold(full)) throw new Error(OUTSIDE)
    }
    return full
  }

  #info(rel: string, meta: { isDirectory(): boolean; size: number; mtimeMs: number }): FileInfo {
    const folder = meta.isDirectory()
    return { path: rel, folder, size: folder ? 0 : meta.size, modified: Math.round(meta.mtimeMs) }
  }

  async list(): Promise<FileInfo[]> {
    const out: FileInfo[] = []
    const walk = async (folder: string, prefix: string, depth: number): Promise<void> => {
      for (const item of await fs.readdir(folder, { withFileTypes: true })) {
        if (out.length >= MAX_ENTRIES) return
        const full = path.join(folder, item.name)
        const meta = await fs.lstat(full).catch(() => undefined)
        // A link to elsewhere is not the library's, and is never followed.
        if (meta === undefined || meta.isSymbolicLink() || !(meta.isDirectory() || meta.isFile())) continue
        const rel = prefix === '' ? item.name : `${prefix}/${item.name}`
        out.push(this.#info(rel, meta))
        if (meta.isDirectory() && depth < MAX_DEPTH) await walk(full, rel, depth + 1)
      }
    }
    await walk(this.folder, '', 0)
    return out
  }

  async info(rel: string): Promise<FileInfo | undefined> {
    const full = await this.#inside(rel)
    const meta = await fs.lstat(full).catch(() => undefined)
    return meta === undefined ? undefined : this.#info(rel, meta)
  }

  async read(rel: string): Promise<Uint8Array> {
    const full = await this.#inside(rel)
    if (!['note', 'own'].includes(kindOf(this.root, rel))) throw new Error(NOT_THE_LIBRARYS)
    const handle = await fs.open(full, 'r').catch((error: unknown) => {
      throw new Error(missing(error) ? `${rel} is not there.` : `${rel} cannot be read.`)
    })
    try {
      const meta = await handle.stat()
      if (!meta.isFile()) throw new Error(`${rel} is not a file.`)
      if (meta.size > MAX_BYTES) throw new Error('That file is too large to be a note.')
      return new Uint8Array(await handle.readFile())
    } finally {
      await handle.close()
    }
  }

  async write(rel: string, bytes: Uint8Array): Promise<void> {
    const full = await this.#inside(rel)
    if (!['note', 'own'].includes(kindOf(this.root, rel))) throw new Error(NOT_THE_LIBRARYS)
    if (bytes.length > MAX_BYTES) throw new Error('That is too large to be a note.')
    const parent = path.dirname(full)
    await fs.mkdir(parent, { recursive: true })
    if ((await fs.lstat(full).catch(() => undefined))?.isDirectory()) throw new Error('A folder is there under that name.')
    const temporary = path.join(parent, `.${path.basename(full)}.tmp-${process.pid}-${writes++}`)
    try {
      // "wx": only ever a new file, never one, or a link, another program left under that name.
      const handle = await fs.open(temporary, 'wx')
      try {
        await handle.writeFile(bytes)
        // On the disk before it takes the note's name: a power cut then leaves the old note, never half of the new.
        await handle.sync()
      } finally {
        await handle.close()
      }
      await renameOver(temporary, full)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async move(from: string, to: string): Promise<void> {
    const [source, target] = [await this.#inside(from), await this.#inside(to)]
    if (this.root !== 'shared' || inHidden(from) || inHidden(to)) throw new Error(NOT_THE_LIBRARYS)
    const meta = await fs.lstat(source).catch(() => undefined)
    if (meta === undefined) throw new Error(`${from} is not there.`)
    if (!meta.isDirectory() && (kindOf(this.root, from) !== 'note' || kindOf(this.root, to) !== 'note')) throw new Error(NOT_THE_LIBRARYS)
    // Only the item itself may be there already: its own name in other letters. The disk says whether it is the
    // same file, not the letters.
    if ((await fs.lstat(target).catch(() => undefined)) !== undefined) {
      const [a, b] = [await fs.realpath(source), await fs.realpath(target)]
      if (a !== b) throw new Error(`${to} is there already.`)
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await renameOver(source, target)
  }

  /** Whether a folder holds folders only, at any depth: no file, and no link to elsewhere. */
  async #holdsNothing(folder: string, depth: number): Promise<boolean> {
    if (depth > MAX_DEPTH) return false
    for (const item of await fs.readdir(folder)) {
      const full = path.join(folder, item)
      const meta = await fs.lstat(full)
      if (meta.isSymbolicLink() || !meta.isDirectory() || !(await this.#holdsNothing(full, depth + 1))) return false
    }
    return true
  }

  /** An empty folder removed, with the empty folders in it: rmdir takes a folder only when nothing is in it. */
  async #removeEmpty(folder: string): Promise<void> {
    for (const item of await fs.readdir(folder)) await this.#removeEmpty(path.join(folder, item))
    await fs.rmdir(folder)
  }

  async remove(rel: string): Promise<void> {
    const full = await this.#inside(rel)
    const meta = await fs.lstat(full).catch(() => undefined)
    if (meta === undefined) return
    if (meta.isDirectory()) {
      if (rel.toLowerCase() === HIDDEN) throw new Error(NOT_THE_LIBRARYS)
      if (!(await this.#holdsNothing(full, 0))) throw new Error('That folder still holds files: only an empty folder is removed.')
      return this.#removeEmpty(full)
    }
    if (!['note', 'own', 'clutter'].includes(kindOf(this.root, rel))) throw new Error(NOT_THE_LIBRARYS)
    await fs.rm(full, { force: true })
  }

  async makeFolder(rel: string): Promise<void> {
    const full = await this.#inside(rel)
    // A folder of the person's, in the folder chosen: the library's own folders are made as its files are written.
    if (this.root !== 'shared' || inHidden(rel)) throw new Error(NOT_THE_LIBRARYS)
    await fs.mkdir(full, { recursive: true })
  }

  /**
   * One piece of work at a time across every server on this computer that keeps its copies in this place: each AI
   * app starts a server of its own, and two must never write the same copies at once. A small file says one is at
   * work; a server that ended without removing it is found by the file no longer being touched.
   */
  async lock<T>(work: () => Promise<T>): Promise<T> {
    const file = path.join(this.folder, LOCK)
    const mine = `${process.pid}-${Date.now()}-${writes++}`
    const started = Date.now()
    for (;;) {
      try {
        const handle = await fs.open(file, 'wx')
        try {
          await handle.writeFile(mine)
        } finally {
          await handle.close()
        }
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && !held(error)) throw error
        const meta = await fs.stat(file).catch(() => undefined)
        if (meta !== undefined && Date.now() - meta.mtimeMs > STALE) {
          // Left behind: removed, unless another server took it over in this very moment.
          const again = await fs.stat(file).catch(() => undefined)
          if (again?.mtimeMs === meta.mtimeMs) await fs.rm(file, { force: true }).catch(() => undefined)
          continue
        }
        if (Date.now() - started > PATIENCE) throw new Error('Another program has been at work on the library for a long time. Try again in a moment.', { cause: error })
        await wait(20 + Math.random() * 40)
      }
    }
    const beat = setInterval(() => {
      const now = new Date()
      void fs.utimes(file, now, now).catch(() => undefined)
    }, BEAT)
    beat.unref()
    try {
      return await work()
    } finally {
      clearInterval(beat)
      // Only its own: a lock taken over meanwhile is another server's.
      if ((await fs.readFile(file, 'utf8').catch(() => undefined)) === mine) await fs.rm(file, { force: true }).catch(() => undefined)
    }
  }

  /** A word every server keeping its copies here can read and set: one that changed the copies leaves a new one, so the others read them again. */
  readonly word = {
    read: (): string | null => {
      try {
        return readFileSync(path.join(this.folder, WORD), 'utf8')
      } catch {
        return null
      }
    },
    write: (value: string): void => {
      try {
        writeFileSync(path.join(this.folder, WORD), value)
      } catch {
        // Not written: one server alone still works.
      }
    },
  }
}
