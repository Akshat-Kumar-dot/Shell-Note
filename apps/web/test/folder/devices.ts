// For the tests of the library in a folder: devices, each with its own copy
// of the synced folder, and a cloud service that copies files between them
// the way such services do, conflicted copies included.
import { apply, type Doc, type Op } from '@shellnote/core'
import { MemoryFiles } from '../../src/library/folder/files.js'
import { FolderLibrary } from '../../src/library/folder/library.js'
import type { OutsideChange } from '../../src/library/store.js'

/** One clock for every device and folder of a test. Each look at it moves it on, so no two writes share a time. */
export class Clock {
  time = 1_800_000_000_000
  now = (): number => (this.time += 7)
  /** Let time pass. */
  wait(ms: number): void {
    this.time += ms
  }
}

export interface Device {
  /** Its copy of the synced folder. */
  folder: MemoryFiles
  /** Its own place, outside the folder. */
  own: MemoryFiles
  library: FolderLibrary
  /** What the library said changed from outside, in order. */
  heard: OutsideChange[]
}

export function device(clock: Clock, folder = new MemoryFiles(clock.now), own = new MemoryFiles(clock.now)): Device {
  const library = new FolderLibrary({ shared: folder, local: own, now: clock.now })
  const heard: OutsideChange[] = []
  library.watch((change) => heard.push({ notes: new Set(change.notes), library: change.library }))
  return { folder, own, library, heard }
}

/** The app opened again on the same device: what it kept is all it knows. */
export const restarted = (clock: Clock, was: Device): Device => device(clock, was.folder, was.own)

/** Change a note as a screen does: open it, edit, and keep it. */
export async function edit(on: Device, id: string, ...ops: Op[]): Promise<Doc> {
  const opened = await on.library.open(id)
  const doc = apply(opened.doc, ops).doc
  await on.library.exchange({ doc, since: opened.doc, blob: (hash) => opened.assets.get(hash) })
  return doc
}

const key = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
const FOLDER = 'folder'

/**
 * A cloud service: each device's folder is brought in step with the server's
 * copy, one device at a time. A file changed both on the device and on the
 * server since that device last synced is a conflict: the server's version
 * stays, and the device's is kept beside it as a "conflicted copy" (`copies`),
 * or simply lost, as some services do (`overwrites`).
 */
export class Cloud {
  readonly #server = new Map<string, string>()
  readonly #known = new Map<MemoryFiles, Map<string, string>>()

  constructor(readonly conflicts: 'copies' | 'overwrites' = 'copies') {}

  async sync(folder: MemoryFiles): Promise<void> {
    const known = this.#known.get(folder) ?? new Map<string, string>()
    const here = new Map<string, string>()
    for (const info of await folder.list()) here.set(info.path, info.folder ? FOLDER : key(folder.peek(info.path)!))
    const put = (path: string, value: string): void => {
      if (value === FOLDER) void folder.makeFolder(path)
      else folder.put(path, new Uint8Array(Buffer.from(value, 'base64')))
    }
    // Folders before what they hold, and what they hold before a removed folder.
    const paths = [...new Set([...here.keys(), ...this.#server.keys(), ...known.keys()])].sort()
    for (const path of paths) {
      const mine = here.get(path)
      const theirs = this.#server.get(path)
      const was = known.get(path)
      if (mine === theirs) continue
      const changedHere = mine !== was
      const changedThere = theirs !== was
      if (changedHere && !changedThere) {
        if (mine === undefined) this.#server.delete(path)
        else this.#server.set(path, mine)
      } else if (changedThere && !changedHere) {
        if (theirs === undefined) await folder.remove(path)
        else put(path, theirs)
      } else if (mine === undefined) put(path, theirs!)
      else if (theirs === undefined) this.#server.set(path, mine)
      else {
        // Changed on both: the server's stays under the name.
        if (this.conflicts === 'copies' && mine !== FOLDER && !path.startsWith('.shellnote/')) {
          const dot = path.lastIndexOf('.')
          const copy = `${path.slice(0, dot)} (conflicted copy)${path.slice(dot)}`
          put(copy, mine)
          this.#server.set(copy, mine)
        }
        put(path, theirs)
      }
    }
    this.#known.set(folder, new Map(this.#server))
  }

  /** Sync each device's folder, then let each library look at its folder; twice round, so what one wrote reaches the others. */
  async settle(...devices: Device[]): Promise<void> {
    for (let round = 0; round < 3; round++) {
      for (const each of devices) {
        await this.sync(each.folder)
        await each.library.sync()
        await this.sync(each.folder)
      }
    }
  }
}
