// How the library's files are reached, and nothing about what they hold: a
// folder on this computer through the desktop app (desktopFiles.ts), or one
// kept in memory, for the tests and to stand in for two devices. A drive
// reached over the network would be a third. Paths are relative to the
// library's folder, with "/" between names, and never leave it.

/** A file or a folder, as a listing tells it. */
export interface FileInfo {
  path: string
  folder: boolean
  /** In bytes; 0 for a folder. */
  size: number
  /** When it was last written, in milliseconds since 1970. */
  modified: number
}

export interface Files {
  /** Everything in the folder, at any depth, folders too. Throws when the folder cannot be reached. */
  list(): Promise<FileInfo[]>
  /** One file or folder as it is now; undefined when it is not there. */
  info(path: string): Promise<FileInfo | undefined>
  /** A file's bytes. Throws when it is not there. */
  read(path: string): Promise<Uint8Array>
  /**
   * Write a file whole or not at all (to a temporary file beside it, then
   * renamed over it), so a reader never finds half of it. Folders on the way are made.
   */
  write(path: string, bytes: Uint8Array): Promise<void>
  /** Rename a file or a folder, or move it. Throws when something is at `to` already; folders on the way are made. */
  move(from: string, to: string): Promise<void>
  /** Remove a file, or a folder with all it holds. Nothing happens when it is not there. */
  remove(path: string): Promise<void>
  /** Make a folder, and those on the way to it. Nothing happens when it is there. */
  makeFolder(path: string): Promise<void>
}

const fold = (path: string): string => path.toLocaleLowerCase()

/** A folder kept in memory. Names differing only in case are one name, as on Windows and macOS. */
export class MemoryFiles implements Files {
  readonly #files = new Map<string, { path: string; bytes: Uint8Array; modified: number }>()
  readonly #folders = new Map<string, { path: string; modified: number }>()
  /** Set to make every call fail, as a drive that is not connected does. */
  unreachable = false

  /** `now`: the clock, so two folders standing for two devices can share one. */
  constructor(private readonly now: () => number = Date.now) {}

  #check(): void {
    if (this.unreachable) throw new Error('The folder cannot be reached.')
  }

  #parents(path: string): void {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/')
      if (this.#files.has(fold(folder))) throw new Error(`${folder} is a file, not a folder.`)
      if (!this.#folders.has(fold(folder))) this.#folders.set(fold(folder), { path: folder, modified: this.now() })
    }
  }

  async list(): Promise<FileInfo[]> {
    this.#check()
    return [
      ...[...this.#folders.values()].map((folder) => ({ path: folder.path, folder: true, size: 0, modified: folder.modified })),
      ...[...this.#files.values()].map((file) => ({ path: file.path, folder: false, size: file.bytes.length, modified: file.modified })),
    ]
  }

  async info(path: string): Promise<FileInfo | undefined> {
    this.#check()
    const file = this.#files.get(fold(path))
    if (file) return { path: file.path, folder: false, size: file.bytes.length, modified: file.modified }
    const folder = this.#folders.get(fold(path))
    return folder && { path: folder.path, folder: true, size: 0, modified: folder.modified }
  }

  async read(path: string): Promise<Uint8Array> {
    this.#check()
    const file = this.#files.get(fold(path))
    if (!file) throw new Error(`${path} is not there.`)
    return file.bytes.slice()
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    this.#check()
    if (this.#folders.has(fold(path))) throw new Error(`${path} is a folder.`)
    this.#parents(path)
    this.#files.set(fold(path), { path: this.#files.get(fold(path))?.path ?? path, bytes: bytes.slice(), modified: this.now() })
  }

  async move(from: string, to: string): Promise<void> {
    this.#check()
    const sameName = fold(from) === fold(to)
    if (!sameName && (this.#files.has(fold(to)) || this.#folders.has(fold(to)))) throw new Error(`${to} is there already.`)
    const file = this.#files.get(fold(from))
    if (file) {
      this.#parents(to)
      this.#files.delete(fold(from))
      this.#files.set(fold(to), { ...file, path: to })
      return
    }
    if (!this.#folders.has(fold(from))) throw new Error(`${from} is not there.`)
    if (fold(to).startsWith(`${fold(from)}/`)) throw new Error('A folder cannot go into itself.')
    this.#parents(to)
    const inside = (path: string): boolean => fold(path) === fold(from) || fold(path).startsWith(`${fold(from)}/`)
    const moved = (path: string): string => to + path.slice(from.length)
    for (const folder of [...this.#folders.values()].filter((f) => inside(f.path))) {
      this.#folders.delete(fold(folder.path))
      this.#folders.set(fold(moved(folder.path)), { ...folder, path: moved(folder.path) })
    }
    for (const held of [...this.#files.values()].filter((f) => inside(f.path))) {
      this.#files.delete(fold(held.path))
      this.#files.set(fold(moved(held.path)), { ...held, path: moved(held.path) })
    }
  }

  async remove(path: string): Promise<void> {
    this.#check()
    this.#files.delete(fold(path))
    for (const key of [...this.#folders.keys()]) if (key === fold(path) || key.startsWith(`${fold(path)}/`)) this.#folders.delete(key)
    for (const key of [...this.#files.keys()]) if (key.startsWith(`${fold(path)}/`)) this.#files.delete(key)
  }

  async makeFolder(path: string): Promise<void> {
    this.#check()
    if (this.#files.has(fold(path))) throw new Error(`${path} is a file, not a folder.`)
    this.#parents(`${path}/x`)
  }

  /** For tests: a file as it is, or undefined. */
  peek(path: string): Uint8Array | undefined {
    return this.#files.get(fold(path))?.bytes
  }

  /** For tests: put bytes at a path as another program would, with no care for what is being read. */
  put(path: string, bytes: Uint8Array): void {
    this.#parents(path)
    this.#files.set(fold(path), { path, bytes, modified: this.now() })
  }
}
