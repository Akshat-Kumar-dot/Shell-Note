// Copying one library into another: the notes the app kept itself into the
// folder a person chooses for them, or the other way when they go back.
// Nothing in the library copied from is changed. Each note is read back from
// where it went and compared before the next is copied, so a copy that is not
// exact stops the move, with everything still where it was.
import { sameContent } from '@shellnote/core'
import type { LibraryStore } from './store.js'
import { folderPath, hidden } from './tree.js'

export interface Copied {
  /** Notes copied. */
  notes: number
  /** Notes the other library had already, the same. */
  there: number
  folders: number
}

export interface CopyOptions {
  /**
   * A note both libraries hold with other content: true puts this library's
   * version in the other's place, when it is known to be the later; otherwise both are kept, the copy as a note of
   * its own.
   */
  replace?: boolean
  /** Told as each note is done. */
  onProgress?: (done: number, of: number) => void
}

/** Copy every folder, note, thumbnail and the pen profile of `from` into `to`. */
export async function copyLibrary(from: LibraryStore, to: LibraryStore, options: CopyOptions = {}): Promise<Copied> {
  const source = await from.list()
  const copied: Copied = { notes: 0, there: 0, folders: 0 }

  // Folders in sight, each after the one it is in: found by name where the other library has it, made where not.
  const placed = new Map<string, string>()
  const inSight = source.folders.filter((folder) => !hidden(source, folder)).sort((a, b) => folderPath(source, a.id).length - folderPath(source, b.id).length)
  for (const folder of inSight) {
    const parent = folder.parent === null ? null : (placed.get(folder.parent) ?? null)
    const target = await to.list()
    const there = target.folders.find((other) => other.parent === parent && other.deleted === undefined && other.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase())
    if (there) {
      placed.set(folder.id, there.id)
      continue
    }
    const made = await to.newFolder(parent)
    const before = new Set((await to.list()).folders.map((other) => other.id))
    let name = folder.name
    for (let n = 2; ; n++) {
      try {
        if (name !== made.name) await to.rename({ kind: 'folder', id: made.id }, name)
        break
      } catch (error) {
        // A name the other library cannot take a second time gets a number.
        if (n > 50) throw error
        name = `${folder.name} ${n}`
      }
    }
    // A folder kept as a real folder is known by its place, so its id is new once it is renamed.
    const after = (await to.list()).folders
    const renamed = after.find((other) => other.id === made.id) ?? after.find((other) => !before.has(other.id)) ?? after.find((other) => other.parent === parent && other.deleted === undefined && other.name !== made.name && !target.folders.some((had) => had.id === other.id))
    placed.set(folder.id, (renamed ?? made).id)
    copied.folders++
  }

  let done = 0
  for (const note of source.notes) {
    const opened = await from.open(note.id)
    const blob = (hash: string): Blob | undefined => opened.assets.get(hash)
    const target = await to.list()
    const there = target.notes.find((other) => other.id === note.id)
    let id: string | undefined
    if (there) {
      const held = await to.open(note.id)
      if (sameContent(held.doc, opened.doc)) copied.there++
      else if (options.replace) id = (await to.save({ doc: opened.doc, blob })).id
      else id = (await to.newNote(there.folder, { doc: opened.doc, assets: opened.assets })).id
    } else id = (await to.newNote(note.folder === null ? null : (placed.get(note.folder) ?? null), { doc: opened.doc, assets: opened.assets })).id
    if (id !== undefined) {
      // Read back, and compared: the note, and every picture it came with.
      const back = await to.open(id)
      if (!sameContent(back.doc, { ...opened.doc, id }) || [...opened.assets.keys()].some((hash) => !back.assets.has(hash))) {
        throw new Error(`"${note.title}" did not read back the same from where it was copied to, so the copying stopped. Nothing was removed: every note is still where it was.`)
      }
      const picture = await from.preview(note.id)
      if (picture) await to.setPreview(id, picture)
      // What was in Recently deleted is there in the other library too.
      if (hidden(source, note) && !there) await to.delete({ kind: 'note', id })
      copied.notes++
    }
    options.onProgress?.(++done, source.notes.length)
  }

  if ((await to.penProfile()) === undefined) {
    const profile = await from.penProfile()
    if (profile) await to.setPenProfile(profile)
  }
  return copied
}
