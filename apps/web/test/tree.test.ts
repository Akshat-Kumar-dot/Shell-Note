// The library's rules (library/tree.ts): names for new items, where folders
// sit, what may move where, sorting, searching and Recently deleted.
import { createDoc } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { MIXED } from '../../../packages/core/test/fixtures/index.js'
import type { FolderEntry, Library, NoteEntry } from '../src/library/store.js'
import { blank, canMove, contents, counts, daysLeft, deletedItems, entryFor, expired, folderPath, hidden, inside, isWithin, onlyUsedBy, search, sorted, uniqueName, unsaved } from '../src/library/tree.js'

const DAY = 24 * 60 * 60 * 1000
const folder = (id: string, name: string, parent: string | null, edited = 0, deleted?: number): FolderEntry => ({ id, name, parent, created: edited, edited, ...(deleted === undefined ? {} : { deleted }) })
const note = (id: string, title: string, folder: string | null, edited = 0, extra: Partial<NoteEntry> = {}): NoteEntry => ({ id, title, folder, created: edited, edited, pages: 1, assets: [], unsaved: false, ...extra })

// Physics ⊃ Waves ⊃ Lab; Maths at the top; Old deleted. Notes beside them.
const library: Library = {
  folders: [folder('phys', 'Physics', null, 10), folder('wave', 'Waves', 'phys', 20), folder('lab', 'Lab', 'wave', 30), folder('math', 'Maths', null, 40), folder('old', 'Old', null, 5, 1000)],
  notes: [
    note('n1', 'Shopping', null, 50),
    note('n2', 'Newton', 'phys', 60, { assets: ['a1', 'a2'] }),
    note('n3', 'Résumé of waves', 'lab', 70, { assets: ['a2'] }),
    note('n4', 'Algebra', 'math', 80, { deleted: 2000 }),
    note('n5', 'Old notes', 'old', 90),
  ],
}

describe('names for new items', () => {
  it('give "Untitled", then the first free number, ignoring case', () => {
    expect(uniqueName('Untitled', ['Physics'])).toBe('Untitled')
    expect(uniqueName('Untitled', ['untitled'])).toBe('Untitled 2')
    expect(uniqueName('Untitled', ['Untitled', 'Untitled 2', 'Untitled 4'])).toBe('Untitled 3')
  })
})

describe('folders', () => {
  it('know their path from the top level, and what is inside what', () => {
    expect(folderPath(library, 'lab').map((f) => f.name)).toEqual(['Physics', 'Waves', 'Lab'])
    expect(folderPath(library, null)).toEqual([])
    expect(isWithin(library, 'lab', 'phys')).toBe(true)
    expect(isWithin(library, 'phys', 'lab')).toBe(false)
  })

  it('stop at a loop in damaged entries instead of running forever', () => {
    const loop: Library = { notes: [], folders: [folder('x', 'X', 'y'), folder('y', 'Y', 'x')] }
    expect(folderPath(loop, 'x').map((f) => f.id)).toEqual(['y', 'x'])
  })

  it('show only what is in sight: not deleted, and not inside a deleted folder', () => {
    expect(contents(library, null).folders.map((f) => f.id)).toEqual(['phys', 'math'])
    expect(contents(library, null).notes.map((n) => n.id)).toEqual(['n1'])
    expect(contents(library, 'math').notes).toEqual([])
    expect(hidden(library, library.notes.find((n) => n.id === 'n5')!)).toBe(true)
    expect(counts(library, 'phys')).toEqual({ folders: 1, notes: 1 })
  })
})

describe('moving', () => {
  it('never puts a folder into itself or one of its own folders', () => {
    expect(canMove(library, { kind: 'folder', id: 'phys' }, 'phys')).toBe(false)
    expect(canMove(library, { kind: 'folder', id: 'phys' }, 'lab')).toBe(false)
    expect(canMove(library, { kind: 'folder', id: 'lab' }, 'math')).toBe(true)
    expect(canMove(library, { kind: 'folder', id: 'wave' }, null)).toBe(true)
  })

  it('goes only into folders in sight', () => {
    expect(canMove(library, { kind: 'note', id: 'n1' }, 'lab')).toBe(true)
    expect(canMove(library, { kind: 'note', id: 'n1' }, 'old')).toBe(false)
    expect(canMove(library, { kind: 'note', id: 'n1' }, 'nowhere')).toBe(false)
    expect(canMove(library, { kind: 'note', id: 'nobody' }, null)).toBe(false)
  })
})

describe('sorting and searching', () => {
  it('sorts newest or oldest first by a date, then by name, leaving the list given as it was', () => {
    const notes = contents(library, null).notes.concat(library.notes.slice(1, 3))
    expect(sorted(notes, 'edited', 'newest').map((n) => n.id)).toEqual(['n3', 'n2', 'n1'])
    expect(sorted(notes, 'created', 'oldest').map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
    expect(notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
    const ties = [note('b', 'Beta', null, 1), note('a', 'Alpha', null, 1)]
    expect(sorted(ties, 'edited', 'newest').map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('finds titles anywhere in the library, ignoring case and accents, every word counting', () => {
    expect(search(library, 'resume').notes.map((n) => n.id)).toEqual(['n3'])
    expect(search(library, 'WAVES of').notes.map((n) => n.id)).toEqual(['n3'])
    expect(search(library, 'wave').folders.map((f) => f.id)).toEqual(['wave'])
    // Deleted items, and items in deleted folders, are not found; nor is anything for an empty search.
    expect(search(library, 'algebra').notes).toEqual([])
    expect(search(library, 'old').notes).toEqual([])
    expect(search(library, '  ')).toEqual({ folders: [], notes: [] })
  })
})

describe('Recently deleted', () => {
  it('shows the items deleted themselves, not what is only inside a deleted folder', () => {
    const bin = deletedItems(library)
    expect(bin.folders.map((f) => f.id)).toEqual(['old'])
    expect(bin.notes.map((n) => n.id)).toEqual(['n4'])
  })

  it('keeps an item 30 days, then it is due to go for good', () => {
    expect(daysLeft(0, 0)).toBe(30)
    expect(daysLeft(0, 29.5 * DAY)).toBe(1)
    expect(daysLeft(0, 31 * DAY)).toBe(0)
    expect(expired(library, 1000 + 30 * DAY)).toEqual([])
    expect(expired(library, 2000 + 30 * DAY + 1)).toEqual([
      { kind: 'folder', id: 'old' },
      { kind: 'note', id: 'n4' },
    ])
  })

  it('removes a folder for good with everything inside it, and pictures only those notes used', () => {
    expect(inside(library, 'phys')).toEqual({ folders: ['phys', 'wave', 'lab'], notes: ['n2', 'n3'] })
    // a2 is still used by n3, so only a1 may go with n2.
    expect(onlyUsedBy(library, new Set(['n2']), ['a1', 'a2'])).toEqual(['a1'])
    expect(onlyUsedBy(library, new Set(['n2', 'n3']), ['a1', 'a2'])).toEqual(['a1', 'a2'])
  })
})

describe('a note’s entry', () => {
  it('says whether the note has changes not in a file', () => {
    const fresh = createDoc()
    expect(blank(fresh)).toBe(true)
    expect(blank(createDoc({ title: 'Untitled 3' }))).toBe(true)
    expect(blank(MIXED)).toBe(false)
    expect(unsaved(fresh, undefined)).toBe(false)
    expect(unsaved(MIXED, undefined)).toBe(true)
    expect(unsaved(MIXED, { rev: MIXED.rev })).toBe(false)
    expect(unsaved(MIXED, { rev: MIXED.rev - 1 })).toBe(true)
  })

  it('keeps where the note is, when it was made and whether it is deleted, from the entry it had', () => {
    const before = note(MIXED.id, 'Old title', 'phys', 5, { created: 1, deleted: 7 })
    const entry = entryFor(MIXED, { name: 'waves.shellnote', rev: MIXED.rev, savedAt: 9 }, 100, before)
    expect(entry).toEqual({
      id: MIXED.id,
      title: MIXED.title,
      folder: 'phys',
      created: 1,
      edited: 100,
      pages: 3,
      assets: Object.keys(MIXED.asset),
      unsaved: false,
      file: { name: 'waves.shellnote', savedAt: 9 },
      deleted: 7,
    })
    expect(entryFor(MIXED, undefined, 100, undefined, 'math')).toMatchObject({ folder: 'math', created: 100, unsaved: true })
  })
})
