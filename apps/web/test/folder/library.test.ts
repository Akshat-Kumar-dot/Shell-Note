// The library in a folder: every action of the storage interface, on real
// files (kept in memory here): folders as folders, each note one .shellnote
// file, Recently deleted a folder of its own.
import { apply, createDoc, pack, unpack, type TextBlock } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { MIXED, PHYSICS } from '../../../../packages/core/test/fixtures/index.js'
import { MemoryFiles } from '../../src/library/folder/files.js'
import { BIN } from '../../src/library/folder/layout.js'
import { FolderLibrary } from '../../src/library/folder/library.js'
import { KEPT_DAYS, type Library } from '../../src/library/store.js'
import { Clock, device, edit, restarted, type Device } from './devices.js'

const paths = async (on: Device): Promise<string[]> => (await on.folder.list()).map((info) => info.path).filter((path) => !path.startsWith('.shellnote')).sort()
const noteIn = (library: Library, title: string) => library.notes.find((note) => note.title === title)!
const folderIn = (library: Library, name: string) => library.folders.find((folder) => folder.name === name)!
const picture = (): Map<string, Blob> => new Map(Object.keys(MIXED.asset).map((hash) => [hash, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })]))
const DAY = 24 * 60 * 60 * 1000

async function started(): Promise<{ clock: Clock; on: Device }> {
  const clock = new Clock()
  return { clock, on: device(clock) }
}

describe('new notes and folders', () => {
  it('makes "Untitled", then "Untitled 2", each a file of its own', async () => {
    const { on } = await started()
    const first = await on.library.newNote(null)
    const second = await on.library.newNote(null)
    expect([first.title, second.title]).toEqual(['Untitled', 'Untitled 2'])
    expect(await paths(on)).toEqual(['Untitled 2.shellnote', 'Untitled.shellnote'])
    expect(first).toMatchObject({ folder: null, unsaved: false, pages: 1, file: { name: 'Untitled.shellnote' } })
    // The file is a note as any other, and says what it has seen.
    const file = unpack(on.folder.peek('Untitled.shellnote')!)
    expect(file.doc.id).toBe(first.id)
    expect(file.lineage?.seen).toEqual({ [file.lineage!.by]: 0 })
  })

  it('makes folders as real folders, one inside another', async () => {
    const { on } = await started()
    const outer = await on.library.newFolder(null)
    const inner = await on.library.newFolder(outer.id)
    const other = await on.library.newFolder(null)
    expect([outer.name, inner.name, other.name]).toEqual(['Untitled folder', 'Untitled folder', 'Untitled folder 2'])
    expect(inner.parent).toBe(outer.id)
    expect(await paths(on)).toEqual(['Untitled folder', 'Untitled folder 2', 'Untitled folder/Untitled folder'])
    const note = await on.library.newNote(inner.id)
    expect(note.folder).toBe(inner.id)
    expect(await paths(on)).toContain('Untitled folder/Untitled folder/Untitled.shellnote')
  })

  it('takes in a document given, with its pictures, and keeps the same file opened twice apart', async () => {
    const { on } = await started()
    const first = await on.library.newNote(null, { doc: MIXED, assets: picture() })
    const second = await on.library.newNote(null, { doc: MIXED, assets: picture() })
    expect(first.id).toBe(MIXED.id)
    expect(second.id).not.toBe(MIXED.id)
    const opened = await on.library.open(first.id)
    expect(opened.doc).toEqual(MIXED)
    expect([...opened.assets.keys()]).toEqual(Object.keys(MIXED.asset))
    expect(new Uint8Array(await [...opened.assets.values()][0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(opened.assets.values().next().value!.type).toBe('image/png')
    // The pictures are in the note's own file.
    expect(Object.keys(unpack(on.folder.peek(first.file!.name)!).assets)).toEqual(Object.keys(MIXED.asset))
  })
})

describe('keeping a note', () => {
  it('writes the note to its file, and names the file after a new title', async () => {
    const { on } = await started()
    const note = await on.library.newNote(null)
    const frame = Object.keys((await on.library.open(note.id)).doc.block)[0]!
    const doc = await edit(on, note.id, { op: 'add', block: { id: 'a', r: 0, type: 'text', parent: frame, role: 'p', indent: 0, md: 'Hello.' } }, { op: 'update', id: note.id, set: { title: 'Shopping: list?' } })
    expect(await paths(on)).toEqual(['Shopping- list-.shellnote'])
    const file = unpack(on.folder.peek('Shopping- list-.shellnote')!)
    expect((file.doc.block.a as TextBlock).md).toBe('Hello.')
    expect(file.doc.title).toBe('Shopping: list?')
    const entry = noteIn(await on.library.list(), 'Shopping: list?')
    expect(entry).toMatchObject({ id: note.id, title: doc.title, unsaved: false })
  })

  it('keeps a note the library does not have as a new one, as save does', async () => {
    const { on } = await started()
    const entry = await on.library.save({ doc: PHYSICS, blob: () => new Blob([new Uint8Array([9])], { type: 'image/png' }) })
    expect(entry).toMatchObject({ id: PHYSICS.id, title: PHYSICS.title, folder: null })
    expect((await on.library.open(PHYSICS.id)).doc).toEqual(PHYSICS)
  })

  it('is all there after the app starts again', async () => {
    const { clock, on } = await started()
    const folder = await on.library.newFolder(null)
    const note = await on.library.newNote(folder.id, { doc: MIXED, assets: picture() })
    const again = restarted(clock, on)
    const library = await again.library.list()
    expect(library.notes).toEqual([{ ...note, edited: library.notes[0]!.edited }])
    expect(library.folders.map((f) => f.id)).toEqual([folder.id])
    expect((await again.library.open(note.id)).doc).toEqual(MIXED)
  })
})

describe('renaming', () => {
  it('renames a note through its title, and a folder as the folder it is', async () => {
    const { on } = await started()
    const folder = await on.library.newFolder(null)
    const note = await on.library.newNote(folder.id)
    await on.library.rename({ kind: 'note', id: note.id }, '  Plans  ')
    await on.library.rename({ kind: 'folder', id: folder.id }, 'Work')
    expect(await paths(on)).toEqual(['Work', 'Work/Plans.shellnote'])
    const library = await on.library.list()
    expect((await on.library.open(note.id)).doc.title).toBe('Plans')
    expect(noteIn(library, 'Plans').folder).toBe(folderIn(library, 'Work').id)
  })

  it('refuses an empty name, a name taken, and the names the library keeps', async () => {
    const { on } = await started()
    const one = await on.library.newFolder(null)
    await on.library.newFolder(null)
    await expect(on.library.rename({ kind: 'folder', id: one.id }, ' ')).rejects.toThrow('A name cannot be empty.')
    await expect(on.library.rename({ kind: 'folder', id: one.id }, 'Untitled folder 2')).rejects.toThrow(/is here already/u)
    await expect(on.library.rename({ kind: 'folder', id: one.id }, BIN)).rejects.toThrow(/keeps that name/u)
    await expect(on.library.rename({ kind: 'note', id: 'nope' }, 'x')).rejects.toThrow(/not in the library/u)
    expect(await paths(on)).toEqual(['Untitled folder', 'Untitled folder 2'])
  })

  it('gives two notes of one title two files', async () => {
    const { on } = await started()
    const one = await on.library.newNote(null)
    const two = await on.library.newNote(null)
    await on.library.rename({ kind: 'note', id: two.id }, 'Untitled')
    expect(await paths(on)).toEqual(['Untitled 2.shellnote', 'Untitled.shellnote'])
    expect((await on.library.list()).notes.map((n) => n.title)).toEqual(['Untitled', 'Untitled'])
    expect((await on.library.open(one.id)).doc.title).toBe('Untitled')
  })
})

describe('moving', () => {
  it('moves a note and a folder, with what the folder holds', async () => {
    const { on } = await started()
    const a = await on.library.newFolder(null)
    const b = await on.library.newFolder(null)
    const note = await on.library.newNote(a.id)
    await on.library.move({ kind: 'folder', id: a.id }, b.id)
    expect(await paths(on)).toEqual(['Untitled folder 2', 'Untitled folder 2/Untitled folder', 'Untitled folder 2/Untitled folder/Untitled.shellnote'])
    await on.library.move({ kind: 'note', id: note.id }, null)
    expect(await paths(on)).toContain('Untitled.shellnote')
    expect(noteIn(await on.library.list(), 'Untitled').folder).toBeNull()
  })

  it('never moves a folder into itself, or anything to a place that is gone', async () => {
    const { on } = await started()
    const outer = await on.library.newFolder(null)
    const inner = await on.library.newFolder(outer.id)
    const note = await on.library.newNote(null)
    await expect(on.library.move({ kind: 'folder', id: outer.id }, inner.id)).rejects.toThrow(/cannot go into itself/u)
    await expect(on.library.move({ kind: 'note', id: note.id }, 'gone')).rejects.toThrow(/not in the library any more/u)
  })
})

describe('Recently deleted', () => {
  it('holds a deleted note as a file in its own folder, and gives it back to where it was', async () => {
    const { on } = await started()
    const folder = await on.library.newFolder(null)
    const note = await on.library.newNote(folder.id)
    await on.library.delete({ kind: 'note', id: note.id })
    expect(await paths(on)).toEqual([BIN, `${BIN}/Untitled.shellnote`, 'Untitled folder'])
    const gone = noteIn(await on.library.list(), 'Untitled')
    expect(gone.deleted).toBeGreaterThan(0)
    expect(gone.folder).toBe(folder.id)
    await on.library.restore({ kind: 'note', id: note.id })
    expect(await paths(on)).toEqual([BIN, 'Untitled folder', 'Untitled folder/Untitled.shellnote'])
    const back = noteIn(await on.library.list(), 'Untitled')
    expect(back.deleted).toBeUndefined()
    expect(back.folder).toBe(folder.id)
  })

  it('takes a folder with what it holds, and gives a note back to the top level when its folder is gone', async () => {
    const { on } = await started()
    const folder = await on.library.newFolder(null)
    const kept = await on.library.newNote(folder.id)
    const lone = await on.library.newNote(folder.id)
    await on.library.delete({ kind: 'note', id: lone.id })
    await on.library.delete({ kind: 'folder', id: folder.id })
    let library = await on.library.list()
    const deleted = folderIn(library, 'Untitled folder')
    expect(deleted.deleted).toBeGreaterThan(0)
    // What a deleted folder holds is out of sight through its folder, not deleted itself.
    expect(library.notes.find((n) => n.id === kept.id)).toMatchObject({ folder: deleted.id })
    expect(library.notes.find((n) => n.id === kept.id)!.deleted).toBeUndefined()
    await on.library.restore({ kind: 'note', id: lone.id })
    library = await on.library.list()
    expect(library.notes.find((n) => n.id === lone.id)).toMatchObject({ folder: null })
    await on.library.restore({ kind: 'folder', id: deleted.id })
    expect(await paths(on)).toEqual([BIN, 'Untitled 2.shellnote', 'Untitled folder', 'Untitled folder/Untitled.shellnote'])
    await expect(on.library.restore({ kind: 'note', id: lone.id })).rejects.toThrow(/not in Recently deleted/u)
  })

  it('removes for good, with the pictures no other note uses', async () => {
    const { on } = await started()
    const one = await on.library.newNote(null, { doc: MIXED, assets: picture() })
    const two = await on.library.newNote(null, { doc: MIXED, assets: picture() })
    const hash = Object.keys(MIXED.asset)[0]!
    await on.library.setPreview(one.id, new Blob(['thumb']))
    await on.library.deleteForever({ kind: 'note', id: one.id })
    expect(await on.own.info(`assets/${hash}`)).toBeDefined()
    expect(await on.library.preview(one.id)).toBeUndefined()
    await expect(on.library.open(one.id)).rejects.toThrow(/not in the library/u)
    await on.library.deleteForever({ kind: 'note', id: two.id })
    expect(await on.own.info(`assets/${hash}`)).toBeUndefined()
    expect(await paths(on)).toEqual([])
    expect((await on.library.list()).notes).toEqual([])
  })

  it('empties, and lets go of what has waited 30 days', async () => {
    const { clock, on } = await started()
    const folder = await on.library.newFolder(null)
    await on.library.newNote(folder.id)
    const old = await on.library.newNote(null)
    await on.library.delete({ kind: 'note', id: old.id })
    await on.library.delete({ kind: 'folder', id: folder.id })
    expect(await on.library.purgeExpired(clock.now())).toBe(0)
    clock.wait((KEPT_DAYS + 1) * DAY)
    const young = await on.library.newNote(null)
    await on.library.delete({ kind: 'note', id: young.id })
    expect(await on.library.purgeExpired(clock.now())).toBe(2)
    // The young one's name was taken in Recently deleted when it went there.
    expect(await paths(on)).toEqual([BIN, `${BIN}/Untitled 2.shellnote`])
    await on.library.emptyBin()
    expect(await paths(on)).toEqual([BIN])
    expect(await on.library.list()).toEqual({ notes: [], folders: [] })
  })
})

describe('what belongs to the library and to no note', () => {
  it('keeps a thumbnail for a note that is there, and the pen profile', async () => {
    const { on } = await started()
    const note = await on.library.newNote(null)
    await on.library.setPreview(note.id, new Blob(['thumb']))
    await on.library.setPreview('nope', new Blob(['thumb']))
    expect(await (await on.library.preview(note.id))!.text()).toBe('thumb')
    expect(await on.library.preview('nope')).toBeUndefined()
    expect(await on.library.penProfile()).toBeUndefined()
    const profile = { v: 1 as const, updated: '2026-11-11T10:00:00.000Z', examples: [] }
    await on.library.setPenProfile(profile)
    expect(await on.library.penProfile()).toEqual(profile)
    await on.library.setPenProfile(undefined)
    expect(await on.library.penProfile()).toBeUndefined()
  })
})

describe('the folder itself', () => {
  it('shows a note and a folder put there by hand', async () => {
    const { on } = await started()
    await on.library.list()
    const doc = createDoc({ title: 'From elsewhere' })
    on.folder.put('Dropped/any name at all.shellnote', pack(doc))
    await on.library.sync()
    const library = await on.library.list()
    expect(library.folders.map((f) => f.name)).toEqual(['Dropped'])
    expect(noteIn(library, 'From elsewhere')).toMatchObject({ id: doc.id, folder: library.folders[0]!.id })
    expect(on.heard.at(-1)).toMatchObject({ library: true })
    // Its file is left as it was until the note changes.
    expect(unpack(on.folder.peek('Dropped/any name at all.shellnote')!).lineage).toBeUndefined()
  })

  it('makes a note copied by hand a note of its own', async () => {
    const { on } = await started()
    const note = await on.library.newNote(null)
    on.folder.put('Untitled - Copy.shellnote', on.folder.peek('Untitled.shellnote')!)
    await on.library.sync()
    const library = await on.library.list()
    expect(library.notes).toHaveLength(2)
    expect(new Set(library.notes.map((n) => n.id)).size).toBe(2)
    expect(library.notes.some((n) => n.id === note.id)).toBe(true)
    expect(library.notes.every((n) => n.deleted === undefined)).toBe(true)
  })
})

describe('two windows of the app on one library', () => {
  it('each sees what the other kept, and neither writes over the other', async () => {
    const clock = new Clock()
    const shared = new MemoryFiles(clock.now)
    const local = new MemoryFiles(clock.now)
    // What the windows share: a word each can read and set, and one piece of work at a time.
    let word: string | null = null
    const mark = { read: () => word, write: (value: string) => void (word = value) }
    let turn: Promise<unknown> = Promise.resolve()
    const lock = <T>(work: () => Promise<T>): Promise<T> => {
      const next = turn.then(work)
      turn = next.catch(() => undefined)
      return next
    }
    const one = new FolderLibrary({ shared, local, now: clock.now, mark, lock })
    const two = new FolderLibrary({ shared, local, now: clock.now, mark, lock })
    const note = await one.newNote(null)
    expect((await two.list()).notes.map((n) => n.id)).toEqual([note.id])
    const frame = Object.keys((await two.open(note.id)).doc.block)[0]!
    const add = async (library: FolderLibrary, id: string, md: string): Promise<void> => {
      const opened = await library.open(note.id)
      const doc = apply(opened.doc, [{ op: 'add', block: { id, r: 0, type: 'text', parent: frame, role: 'p', indent: 0, md } }]).doc
      await library.exchange({ doc, since: opened.doc, blob: () => undefined })
    }
    await add(two, 'a', 'From the second window.')
    await add(one, 'b', 'From the first window.')
    await two.rename({ kind: 'note', id: note.id }, 'Both')
    for (const library of [one, two]) {
      const doc = (await library.open(note.id)).doc
      expect(doc.title).toBe('Both')
      expect(Object.keys(doc.block)).toEqual(expect.arrayContaining(['a', 'b']))
    }
    expect(Object.keys(unpack(shared.peek('Both.shellnote')!).doc.block)).toEqual(expect.arrayContaining(['a', 'b']))
    expect((await one.list()).notes).toHaveLength(1)
  })
})

describe('a note removed for good while it is open', () => {
  it('is not brought back by a screen with nothing new to keep, and is kept when the screen holds new words', async () => {
    const { on } = await started()
    const note = await on.library.newNote(null)
    const opened = await on.library.open(note.id)
    await on.library.deleteForever({ kind: 'note', id: note.id })
    const same = apply(opened.doc, [{ op: 'update', id: note.id, set: { title: 'x' } }]).doc
    const back = apply(same, [{ op: 'update', id: note.id, set: { title: opened.doc.title } }]).doc
    await expect(on.library.exchange({ doc: back, since: opened.doc, blob: () => undefined })).rejects.toThrow(/removed for good/u)
    expect((await on.library.list()).notes).toEqual([])
    const typed = apply(opened.doc, [{ op: 'update', id: note.id, set: { title: 'Typed since' } }]).doc
    await on.library.exchange({ doc: typed, since: opened.doc, blob: () => undefined })
    expect((await on.library.list()).notes.map((n) => n.title)).toEqual(['Typed since'])
  })
})

describe('names and files the library must be careful with', () => {
  it('gives a note a file name the library can see and Windows can keep, whatever its title', async () => {
    const { on } = await started()
    const hidden = await on.library.newNote(null)
    const device = await on.library.newNote(null)
    await on.library.rename({ kind: 'note', id: hidden.id }, '.plans')
    await on.library.rename({ kind: 'note', id: device.id }, 'CON')
    expect(await paths(on)).toEqual(['Note CON.shellnote', 'plans.shellnote'])
    // Looked at again, both are still there under their titles.
    await on.library.sync()
    expect((await on.library.list()).notes.map((note) => note.title).sort()).toEqual(['.plans', 'CON'])
    const folder = await on.library.newFolder(null)
    await on.library.rename({ kind: 'folder', id: folder.id }, 'nul')
    expect(await paths(on)).toContain('Folder nul')
  })

  it('never removes a file that is not a note, even with the folder it is in', async () => {
    const { on } = await started()
    const folder = await on.library.newFolder(null)
    const note = await on.library.newNote(folder.id)
    on.folder.put('Untitled folder/taxes.pdf', new Uint8Array([1, 2, 3]))
    on.folder.put('Untitled folder/desktop.ini', new Uint8Array([4]))
    await on.library.delete({ kind: 'folder', id: folder.id })
    const binned = (await on.library.list()).folders[0]!
    expect(binned.deleted).toBeGreaterThan(0)
    await expect(on.library.deleteForever({ kind: 'folder', id: binned.id })).rejects.toThrow(/never removes/u)
    // Its notes are gone; the folder is back, with the file that was no note.
    expect(await paths(on)).toEqual([BIN, 'Untitled folder', 'Untitled folder/taxes.pdf'])
    expect((await on.library.list()).notes.find((n) => n.id === note.id)).toBeUndefined()
    expect((await on.library.list()).folders.map((f) => [f.name, f.deleted])).toEqual([['Untitled folder', undefined]])
    // Emptying Recently deleted leaves such a file too.
    await on.library.delete({ kind: 'folder', id: (await on.library.list()).folders[0]!.id })
    await on.library.emptyBin()
    expect(await paths(on)).toEqual([BIN, 'Untitled folder', 'Untitled folder/taxes.pdf'])
  })
})
