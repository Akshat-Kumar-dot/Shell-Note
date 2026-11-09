// Moving the note storage version 1 kept into the library (library/migrate.ts):
// copy, read back, compare, and only then mark the move done; never lose the
// note, and never copy it over a newer one.
import type { Doc } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { MIXED } from '../../../packages/core/test/fixtures/index.js'
import { migrateOldNote, sameDoc, type MigrationIO, type OldNote } from '../src/library/migrate.js'
import type { NoteEntry } from '../src/library/store.js'

/** Storage in memory, which records what was asked of it, in order. */
function memory(old: OldNote | undefined | 'damaged', change: (doc: Doc) => unknown = (doc) => structuredClone(doc)) {
  const calls: string[] = []
  const docs = new Map<string, unknown>()
  const entries = new Map<string, NoteEntry>()
  const assets = new Set<string>()
  let done: { at: number; note: string | null } | undefined
  const io: MigrationIO = {
    done: async () => done !== undefined,
    readOld: async () => {
      calls.push('readOld')
      if (old === 'damaged') throw new Error('The kept note is damaged.')
      return old
    },
    write: async (note, entry) => {
      calls.push('write')
      docs.set(note.doc.id, change(note.doc))
      entries.set(entry.id, entry)
      note.assets.forEach((_bytes, hash) => assets.add(hash))
    },
    readBack: async (id) => {
      calls.push('readBack')
      return { doc: docs.get(id), entry: entries.get(id), assets }
    },
    markDone: async (record) => {
      calls.push('markDone')
      done = record
    },
  }
  return { io, calls, docs, entries, assets, done: () => done }
}

const withPicture = (): OldNote => ({ doc: MIXED, assets: new Map([[Object.keys(MIXED.asset)[0]!, new Blob(['png'])]]) })

describe('moving the old note into the library', () => {
  it('copies it, reads it back, and only then marks the move done; a second start does nothing', async () => {
    const store = memory(withPicture())
    expect(await migrateOldNote(store.io, 5)).toEqual({ state: 'moved', note: MIXED.id })
    expect(store.calls).toEqual(['readOld', 'readBack', 'write', 'readBack', 'markDone'])
    expect(store.done()).toEqual({ at: 5, note: MIXED.id })
    expect(sameDoc(store.docs.get(MIXED.id), MIXED)).toBe(true)
    expect(store.entries.get(MIXED.id)).toMatchObject({ title: MIXED.title, folder: null, unsaved: true })
    expect(await migrateOldNote(store.io, 6)).toEqual({ state: 'already' })
  })

  it('marks the move done with nothing to move when there was no old note', async () => {
    const store = memory(undefined)
    expect(await migrateOldNote(store.io, 5)).toEqual({ state: 'nothing' })
    expect(store.done()).toEqual({ at: 5, note: null })
  })

  it('does not mark the move done when the copy reads back different, so it is tried again next time', async () => {
    const store = memory(withPicture(), (doc) => ({ ...structuredClone(doc), title: 'Something else' }))
    await expect(migrateOldNote(store.io, 5)).rejects.toThrow(/did not read back the same/u)
    expect(store.done()).toBeUndefined()
  })

  it('does not mark it done when the copy cannot be read, or a picture is missing', async () => {
    const broken = memory(withPicture(), () => ({ not: 'a note' }))
    await expect(migrateOldNote(broken.io, 5)).rejects.toThrow(/could not be read back/u)
    expect(broken.done()).toBeUndefined()

    const store = memory(withPicture())
    const write = store.io.write
    store.io.write = async (note, entry) => write({ ...note, assets: new Map() }, entry)
    await expect(migrateOldNote(store.io, 5)).rejects.toThrow(/did not read back the same/u)
    expect(store.done()).toBeUndefined()
  })

  it('leaves a damaged old note where it was, without marking anything done', async () => {
    const store = memory('damaged')
    await expect(migrateOldNote(store.io, 5)).rejects.toThrow(/damaged/u)
    expect(store.calls).toEqual(['readOld'])
    expect(store.done()).toBeUndefined()
  })

  it('never copies the old note over a library copy that is as new or newer, as after a copy the browser closed before marking done', async () => {
    const store = memory(withPicture())
    const edited = { ...structuredClone(MIXED), rev: MIXED.rev + 3, title: 'Edited since' }
    store.docs.set(MIXED.id, edited)
    store.entries.set(MIXED.id, { id: MIXED.id } as NoteEntry)
    expect(await migrateOldNote(store.io, 5)).toEqual({ state: 'moved', note: MIXED.id })
    expect(store.calls).not.toContain('write')
    expect(store.docs.get(MIXED.id)).toBe(edited)
    expect(store.done()).toEqual({ at: 5, note: MIXED.id })
  })

  it('copies again over an older or unreadable earlier copy', async () => {
    const store = memory(withPicture())
    store.docs.set(MIXED.id, { broken: true })
    store.entries.set(MIXED.id, { id: MIXED.id } as NoteEntry)
    expect(await migrateOldNote(store.io, 5)).toEqual({ state: 'moved', note: MIXED.id })
    expect(store.calls).toContain('write')
    expect(sameDoc(store.docs.get(MIXED.id), MIXED)).toBe(true)
  })
})
