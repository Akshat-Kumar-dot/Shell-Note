// The server's notes from a library's folder. The app and the server are two
// devices on one folder of one computer: each has its own copies, and each
// sees what the other wrote the next time it looks.
import { mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, ValidationError, type Doc, type TextBlock } from '@shellnote/core'
import { FolderLibrary } from '@shellnote/library'
import { afterAll, describe, expect, it } from 'vitest'
import { PHYSICS } from '../../../packages/core/test/fixtures/index.js'
import { Clock, device, edit, type Device } from '../../../packages/library/test/devices.js'
import { FolderHost, openFolderHost } from '../src/folderHost.js'
import { NoteError } from '../src/host.js'
import { NodeFiles } from '../src/nodeFiles.js'

const words = (doc: Doc, id: string): string => (doc.block[id] as TextBlock).md
/** The sample note's picture, as bytes: a note is never kept without those of the pictures it shows. */
const pictures = (): Map<string, Blob> => new Map(Object.keys(PHYSICS.asset).map((hash) => [hash, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })]))

/** The app with one note in its library, and a server on the same folder. */
async function together(): Promise<{ app: Device; server: Device; host: FolderHost; note: string }> {
  const clock = new Clock()
  const app = device(clock)
  const entry = await app.library.newNote(null, { doc: PHYSICS, assets: pictures() })
  const server = device(clock, app.folder)
  return { app, server, host: new FolderHost(server.library), note: entry.id }
}

describe('the notes a server is given', () => {
  it('are those in sight, with their folders by name, and never what is in Recently deleted', async () => {
    const { app, host, note } = await together()
    const work = await app.library.newFolder(null)
    await app.library.rename({ kind: 'folder', id: work.id }, 'Work')
    const inWork = await app.library.newNote((await app.library.list()).folders[0]!.id)
    const gone = await app.library.newNote(null)
    await app.library.delete({ kind: 'note', id: gone.id })

    const listing = await host.list()
    expect(listing.folders).toEqual(['Work'])
    expect(listing.notes.map((each) => [each.title, each.folder])).toEqual([['Physics lecture 4', ''], ['Untitled', 'Work']])
    expect(listing.notes.find((each) => each.id === note)).toMatchObject({ pages: 1 })
    expect(listing.notes.some((each) => each.id === gone.id)).toBe(false)

    await expect(host.read(gone.id)).rejects.toMatchObject({ code: 'deleted_note' })
    await expect(host.change(gone.id, (doc) => apply(doc, [{ op: 'update', id: doc.id, set: { title: 'x' } }]))).rejects.toBeInstanceOf(NoteError)
    await expect(host.read('no-such-note')).rejects.toMatchObject({ code: 'unknown_note' })
    await expect(host.read('../../device')).rejects.toMatchObject({ code: 'unknown_note' })
    expect((await host.read(inWork.id)).title).toBe('Untitled')
  })

  it('are read as they are now: what the app wrote a moment ago is there', async () => {
    const { app, host, note } = await together()
    expect(words(await host.read(note), 't1')).toBe("Newton's laws")
    await edit(app, note, { op: 'update', id: 't1', set: { md: 'The laws of motion' } })
    expect(words(await host.read(note), 't1')).toBe('The laws of motion')
  })
})

describe('a change a server makes', () => {
  it('reaches the app the next time it looks, as another device\'s does', async () => {
    const { app, host, note } = await together()
    const read = await host.read(note)
    const kept = await host.change(note, (doc) => apply(doc, [{ op: 'update', id: 't1', set: { md: 'Three laws' } }], { baseRev: read.rev }))
    expect(kept.changed).toEqual(['t1'])
    expect(kept.doc.rev).toBeGreaterThan(read.rev)
    expect(words(kept.doc, 't1')).toBe('Three laws')
    // What would undo it is handed back too.
    expect(kept.inverse).toEqual([{ op: 'update', id: 't1', set: { md: "Newton's laws" } }])

    app.heard.length = 0
    await app.library.sync()
    expect(words((await app.library.open(note)).doc, 't1')).toBe('Three laws')
    expect(app.heard.some((change) => change.notes.has(note))).toBe(true)
  })

  it('is refused as stale when the person changed the same block since it was read, and nothing changes', async () => {
    const { app, host, note } = await together()
    const read = await host.read(note)
    await edit(app, note, { op: 'update', id: 't2', set: { md: 'Typed by the person meanwhile.' } })

    const stale = host.change(note, (doc) => apply(doc, [{ op: 'update', id: 't2', set: { md: 'Written by an agent.' } }], { baseRev: read.rev }))
    await expect(stale).rejects.toBeInstanceOf(ValidationError)
    await expect(stale).rejects.toMatchObject({ code: 'stale' })
    expect(words(await host.read(note), 't2')).toBe('Typed by the person meanwhile.')

    // Another block, read at the same time and not changed since, may still be edited.
    const kept = await host.change(note, (doc) => apply(doc, [{ op: 'update', id: 't1', set: { md: 'Three laws' } }], { baseRev: read.rev }))
    expect(words(kept.doc, 't1')).toBe('Three laws')
    expect(words(kept.doc, 't2')).toBe('Typed by the person meanwhile.')
    await app.library.sync()
    const now = (await app.library.open(note)).doc
    expect([words(now, 't1'), words(now, 't2')]).toEqual(['Three laws', 'Typed by the person meanwhile.'])
  })

  it('joins what the person is typing in the open note, and neither is lost', async () => {
    const { app, host, note } = await together()
    const open = await app.library.open(note)
    // The person types in t2; the screen has not kept it yet.
    const typed = apply(open.doc, [{ op: 'update', id: 't2', set: { md: 'Typed on the screen.' } }]).doc
    await host.change(note, (doc) => apply(doc, [{ op: 'update', id: 't1', set: { md: 'Three laws' } }], { baseRev: doc.rev }))

    const kept = await app.library.exchange({ doc: typed, since: open.doc, blob: () => undefined })
    const merged = kept.merged!.doc
    expect([words(merged, 't1'), words(merged, 't2')]).toEqual(['Three laws', 'Typed on the screen.'])
    expect(words(await host.read(note), 't2')).toBe('Typed on the screen.')
  })

  it('that changes nothing writes nothing, and one that throws leaves the note as it was', async () => {
    const { app, host, note } = await together()
    const before = await host.read(note)
    const none = await host.change(note, (doc) => apply(doc, []))
    expect(none).toEqual({ doc: before, changed: [], inverse: [] })
    await expect(host.change(note, (doc) => apply(doc, [{ op: 'remove', id: 'no-such-block' }]))).rejects.toBeInstanceOf(ValidationError)
    expect((await host.read(note)).rev).toBe(before.rev)
    await app.library.sync()
    expect(words((await app.library.open(note)).doc, 't1')).toBe("Newton's laws")
  })

  it('is refused in plain words while the folder cannot be reached', async () => {
    const { app, host, note } = await together()
    app.folder.unreachable = true
    await expect(host.list()).rejects.toMatchObject({ code: 'unreachable' })
    await expect(host.change(note, (doc) => apply(doc, [{ op: 'update', id: 't1', set: { md: 'x' } }]))).rejects.toMatchObject({ code: 'unreachable' })
    app.folder.unreachable = false
    expect(words(await host.read(note), 't1')).toBe("Newton's laws")
  })
})

describe('on a real disk', () => {
  const made: string[] = []
  const fresh = (name: string): string => {
    const folder = mkdtempSync(path.join(os.tmpdir(), `shellnote-host-${name}-`))
    made.push(folder)
    return folder
  }
  afterAll(() => {
    for (const folder of made) rmSync(folder, { recursive: true, force: true })
  })

  it('a server works only in a folder that is a library already, and its change is in the note\'s file', async () => {
    const base = fresh('library')
    const folder = path.join(base, 'Notes')
    await NodeFiles.open(folder, 'own') // Made here as a person would make it; the library's files below are its own.
    await expect(openFolderHost(folder, path.join(base, 'server'))).rejects.toThrow('not a ShellNote library')
    expect(existsSync(path.join(base, 'server'))).toBe(false)

    const app = new FolderLibrary({ shared: await NodeFiles.open(folder, 'shared'), local: await NodeFiles.open(path.join(base, 'app'), 'own') })
    const note = (await app.newNote(null, { doc: PHYSICS, assets: pictures() })).id

    const host = await openFolderHost(folder, path.join(base, 'server'))
    expect((await host.list()).notes.map((each) => each.title)).toEqual(['Physics lecture 4'])
    const read = await host.read(note)
    await host.change(note, (doc) => apply(doc, [{ op: 'update', id: 't1', set: { md: 'Three laws' } }], { baseRev: read.rev }))
    await app.sync()
    expect(words((await app.open(note)).doc, 't1')).toBe('Three laws')

    // A second server on the same place, as a second AI app starts: it sees what the first kept, and they take turns.
    const second = await openFolderHost(folder, path.join(base, 'server'))
    expect(words(await second.read(note), 't1')).toBe('Three laws')
    await Promise.all([
      host.change(note, (doc) => apply(doc, [{ op: 'update', id: 't1', set: { md: 'From the first' } }], { baseRev: doc.rev })),
      second.change(note, (doc) => apply(doc, [{ op: 'update', id: 't2', set: { md: 'From the second' } }], { baseRev: doc.rev })),
    ])
    const now = await host.read(note)
    expect([words(now, 't1'), words(now, 't2')]).toEqual(['From the first', 'From the second'])
    expect(await second.read(note)).toEqual(now)
    expect(existsSync(path.join(base, 'server', 'lock'))).toBe(false)
  })

  it('work in one place goes one piece at a time, and a lock left behind is taken over', async () => {
    const place = fresh('lock')
    const [one, two] = [await NodeFiles.open(place, 'own'), await NodeFiles.open(place, 'own')]
    const order: string[] = []
    const piece = (files: NodeFiles, name: string) =>
      files.lock(async () => {
        order.push(`${name} in`)
        await new Promise((resolve) => setTimeout(resolve, 30))
        order.push(`${name} out`)
      })
    await Promise.all([piece(one, 'a'), piece(two, 'b'), piece(one, 'c')])
    for (let i = 0; i < order.length; i += 2) expect(order[i]!.slice(0, 1)).toBe(order[i + 1]!.slice(0, 1))
    expect(order).toHaveLength(6)

    // A server that ended at work left its lock: it has not been touched for a minute.
    writeFileSync(path.join(place, 'lock'), 'left behind')
    const longAgo = new Date(Date.now() - 60_000)
    utimesSync(path.join(place, 'lock'), longAgo, longAgo)
    expect(await one.lock(async () => 'done')).toBe('done')
    expect(existsSync(path.join(place, 'lock'))).toBe(false)

    // Work that throws still lets the next one in.
    await expect(one.lock(async () => Promise.reject(new Error('failed')))).rejects.toThrow('failed')
    expect(await two.lock(async () => 'next')).toBe('next')
  })
})

describe('a folder that stops being a library', () => {
  it('is left alone: the server reads and writes nothing, and never puts the mark back', async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'shellnote-host-mark-'))
    try {
      const folder = path.join(base, 'Notes')
      await NodeFiles.open(folder, 'own')
      const app = new FolderLibrary({ shared: await NodeFiles.open(folder, 'shared'), local: await NodeFiles.open(path.join(base, 'app'), 'own') })
      await app.sync()
      const host = await openFolderHost(folder, path.join(base, 'server'))
      expect((await host.list()).notes).toEqual([])
      // The folder is emptied, as when another is put under its name.
      rmSync(path.join(folder, '.shellnote'), { recursive: true, force: true })
      await expect(host.list()).rejects.toMatchObject({ code: 'unreachable' })
      expect(existsSync(path.join(folder, '.shellnote'))).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('a copy under a note\'s name that is another note\'s is not read as it', async () => {
    const clock = new Clock()
    const app = device(clock)
    const one = (await app.library.newNote(null, { doc: PHYSICS, assets: pictures() })).id
    const two = (await app.library.newNote(null)).id
    const server = device(clock, app.folder)
    const host = new FolderHost(server.library)
    await host.read(one)
    // Another note's copy lies where this note's should, as two ids in other letters would on a disk that takes them for one name.
    server.own.put(`notes/${one}.doc.json`, server.own.peek(`notes/${two}.doc.json`)!)
    const again = new FolderHost(device(clock, app.folder, server.own).library)
    await expect(again.read(one)).rejects.toThrow("another note's")
  })
})
