// The pictures of the library's notes, for the agent to place in the open one (note control, step 3;: only
// pictures the person already has). The library keeps each picture once, by the SHA-256 of its bytes, so one
// goes into another note with no file. Read when a line places a picture, never sent to a model: the model knows
// a picture only by its description, its caption and its note.
import type { PictureSource } from '@shellnote/core'
import type { PicturesPlace } from '@shellnote/editor'
import type { LibraryStore } from '@shellnote/library'

/** The pictures of every note in the library but the one open (`open`, its id), Recently deleted left out. */
export function libraryPictures(library: LibraryStore, open: string | undefined): PicturesPlace {
  // The bytes of the pictures listed, for the one placed.
  const bytes = new Map<string, Blob>()
  return {
    async list() {
      const { notes } = await library.list()
      const out: PictureSource[] = []
      for (const entry of notes) {
        if (entry.deleted !== undefined || entry.id === open || entry.assets.length === 0) continue
        let note
        try {
          note = await library.open(entry.id)
        } catch {
          continue
        }
        for (const block of Object.values(note.doc.block)) {
          if (block.type !== 'image') continue
          const meta = note.doc.asset[block.asset]
          const blob = note.assets.get(block.asset)
          if (!meta || !blob) continue
          bytes.set(block.asset, blob)
          out.push({ hash: block.asset, meta, note: entry.title, ...(block.alt ? { alt: block.alt } : {}), ...(block.caption ? { caption: block.caption } : {}) })
        }
      }
      return out
    },
    async bytes(hash) {
      return bytes.get(hash)
    },
  }
}
