// Two devices keep one library in a folder a cloud service copies between
// them. Whatever each wrote, and however the service copied it, both end with
// the same notes and no word lost.
import { apply, createDoc, pack, sameContent, unpack, type Doc, type Frame, type Op, type TextBlock } from '@shellnote/core'
import { EditorStore } from '@shellnote/editor'
import { describe, expect, it } from 'vitest'
import { BIN } from '../../src/library/folder/layout.js'
import { Clock, Cloud, device, edit, restarted, type Device } from './devices.js'

const text = (id: string, parent: string, md: string, at?: number): Op => ({ op: 'add', block: { id, r: 0, type: 'text', parent, role: 'p', indent: 0, md }, ...(at === undefined ? {} : { at }) })
const words = (doc: Doc): string[] => Object.values(doc.block).flatMap((block) => (block.type === 'text' ? [block.md] : []))
const md = (doc: Doc, id: string): string => (doc.block[id] as TextBlock).md
const live = async (on: Device) => (await on.library.list()).notes.filter((note) => note.deleted === undefined)
const paths = async (on: Device): Promise<string[]> => (await on.folder.list()).map((info) => info.path).filter((path) => !path.startsWith('.shellnote')).sort()

/** A laptop and a phone with one note, "Trip", holding paragraphs a and b, in step. */
async function pair(conflicts: 'copies' | 'overwrites' = 'copies') {
  const clock = new Clock()
  const cloud = new Cloud(conflicts)
  const laptop = device(clock)
  const phone = device(clock)
  const note = await laptop.library.newNote(null)
  const frame = Object.keys((await laptop.library.open(note.id)).doc.block)[0]!
  await edit(laptop, note.id, { op: 'update', id: note.id, set: { title: 'Trip' } }, text('a', frame, 'Pack the tent and the stove.'), text('b', frame, 'Leave on Friday morning.'))
  await cloud.settle(laptop, phone)
  return { clock, cloud, laptop, phone, id: note.id, frame }
}

/** Both devices hold the same note, and their files say the same. */
async function inStep(id: string, ...devices: Device[]): Promise<Doc> {
  const docs = await Promise.all(devices.map(async (each) => (await each.library.open(id)).doc))
  for (const doc of docs) expect(sameContent(doc, docs[0]!)).toBe(true)
  const entries = await Promise.all(devices.map(async (each) => (await each.library.list()).notes.find((note) => note.id === id)!))
  for (const entry of entries) expect({ ...entry, created: 0 }).toEqual({ ...entries[0]!, created: 0 })
  return docs[0]!
}

describe('one device after another', () => {
  it('shows a note made on one device on the other, and takes the other device’s edit back', async () => {
    const { cloud, laptop, phone, id, frame } = await pair()
    expect((await phone.library.list()).notes.map((note) => note.title)).toEqual(['Trip'])
    expect(phone.heard.some((change) => change.library)).toBe(true)
    phone.heard.length = 0
    await edit(phone, id, text('c', frame, 'Back by Sunday.'))
    await cloud.settle(laptop, phone)
    const doc = await inStep(id, laptop, phone)
    expect(words(doc)).toEqual(['Pack the tent and the stove.', 'Leave on Friday morning.', 'Back by Sunday.'])
    // The laptop heard that the note changed; the phone, which wrote it, did not.
    expect(laptop.heard.some((change) => change.notes.has(id))).toBe(true)
    expect(phone.heard.some((change) => change.notes.has(id))).toBe(false)
    // Nothing is written again once both agree.
    const before = (await laptop.folder.info('Trip.shellnote'))!.modified
    await cloud.settle(laptop, phone)
    expect((await laptop.folder.info('Trip.shellnote'))!.modified).toBe(before)
  })

  it('renames, moves and deletes alike on both', async () => {
    const { cloud, laptop, phone, id } = await pair()
    const folder = await laptop.library.newFolder(null)
    await laptop.library.rename({ kind: 'folder', id: folder.id }, 'Plans')
    await laptop.library.move({ kind: 'note', id }, (await laptop.library.list()).folders[0]!.id)
    await laptop.library.rename({ kind: 'note', id }, 'The trip')
    await cloud.settle(laptop, phone)
    expect(await paths(phone)).toEqual(['Plans', 'Plans/The trip.shellnote'])
    await inStep(id, laptop, phone)
    await phone.library.delete({ kind: 'note', id })
    await cloud.settle(laptop, phone)
    expect(await paths(laptop)).toEqual(['Plans', BIN, `${BIN}/The trip.shellnote`])
    expect((await inStep(id, laptop, phone)).title).toBe('The trip')
    expect((await laptop.library.list()).notes[0]!.deleted).toBeGreaterThan(0)
    await laptop.library.restore({ kind: 'note', id })
    await cloud.settle(laptop, phone)
    expect((await phone.library.list()).notes[0]).toMatchObject({ title: 'The trip', folder: (await phone.library.list()).folders[0]!.id })
    expect((await phone.library.list()).notes[0]!.deleted).toBeUndefined()
    await phone.library.deleteForever({ kind: 'note', id })
    await cloud.settle(laptop, phone)
    // Gone from the folder for a while: gone for good on the other device too.
    expect((await laptop.library.list()).notes).toHaveLength(1)
    laptop.heard.length = 0
    await cloud.settle(laptop, phone)
    expect((await laptop.library.list()).notes).toHaveLength(1)
  })

  it('takes a note removed for good on one device from the other, once it has stayed gone', async () => {
    const { clock, cloud, laptop, phone, id } = await pair()
    await phone.library.deleteForever({ kind: 'note', id })
    await cloud.settle(laptop, phone)
    clock.wait(5000)
    await cloud.settle(laptop, phone)
    expect((await laptop.library.list()).notes).toEqual([])
    await expect(laptop.library.open(id)).rejects.toThrow(/not in the library/u)
  })
})

for (const conflicts of ['copies', 'overwrites'] as const) {
  describe(`two devices that wrote apart, when the cloud service ${conflicts === 'copies' ? 'keeps a conflicted copy' : 'lets the later file overwrite the earlier'}`, () => {
    it('keeps both edits to one note, on both devices', async () => {
      const { cloud, laptop, phone, id, frame } = await pair(conflicts)
      await edit(laptop, id, { op: 'update', id: 'a', set: { md: 'Pack the tent, the stove and a lamp.' } })
      await edit(phone, id, text('c', frame, 'Back by Sunday.'), { op: 'update', id: 'b', set: { md: 'Leave on Saturday morning.' } })
      await cloud.settle(laptop, phone)
      const doc = await inStep(id, laptop, phone)
      expect(words(doc)).toEqual(['Pack the tent, the stove and a lamp.', 'Leave on Saturday morning.', 'Back by Sunday.'])
      // One note, in one file; the conflicted copy, if the service made one, waits in Recently deleted.
      expect((await live(laptop)).map((note) => note.id)).toEqual([id])
      expect((await live(phone)).map((note) => note.id)).toEqual([id])
      expect((await paths(laptop)).filter((path) => !path.startsWith(BIN))).toEqual(['Trip.shellnote'])
      expect(await paths(laptop)).toEqual(await paths(phone))
    })

    it('merges edits to different words of one paragraph, and keeps both paragraphs when the words are the same', async () => {
      const { cloud, laptop, phone, id } = await pair(conflicts)
      await edit(laptop, id, { op: 'update', id: 'b', set: { md: 'Leave on Saturday morning.' } }, { op: 'update', id: 'a', set: { md: 'Pack the tent.' } })
      await edit(phone, id, { op: 'update', id: 'b', set: { md: 'Leave on Friday morning. Bring maps.' } }, { op: 'update', id: 'a', set: { md: 'Pack the stove.' } })
      await cloud.settle(laptop, phone)
      const doc = await inStep(id, laptop, phone)
      expect(md(doc, 'b')).toBe('Leave on Saturday morning. Bring maps.')
      expect(words(doc)).toEqual(expect.arrayContaining(['Pack the tent.', 'Pack the stove.']))
      expect(words(doc)).toHaveLength(3)
    })

    it('keeps the pictures both added', async () => {
      const { cloud, laptop, phone, id } = await pair(conflicts)
      const add = async (on: Device, hash: string, byte: number): Promise<void> => {
        const opened = await on.library.open(id)
        const page = opened.doc.pages[0]!
        const doc = apply(opened.doc, [
          { op: 'asset', hash, meta: { mime: 'image/png', bytes: 1 } },
          { op: 'add', block: { id: `pic${byte}`, r: 0, type: 'image', page, x: 0, y: byte * 100, w: 100, h: 100, asset: hash } },
        ]).doc
        await on.library.exchange({ doc, since: opened.doc, blob: (wanted) => (wanted === hash ? new Blob([new Uint8Array([byte])], { type: 'image/png' }) : undefined) })
      }
      await add(laptop, 'aaaa11', 1)
      await add(phone, 'bbbb22', 2)
      await cloud.settle(laptop, phone)
      await inStep(id, laptop, phone)
      for (const each of [laptop, phone]) {
        const opened = await each.library.open(id)
        expect([...opened.assets.keys()].sort()).toEqual(['aaaa11', 'bbbb22'])
        expect(new Uint8Array(await opened.assets.get('bbbb22')!.arrayBuffer())).toEqual(new Uint8Array([2]))
      }
    })

    it('keeps a move on one device and an edit made on the other meanwhile', async () => {
      const { cloud, laptop, phone, id, frame } = await pair(conflicts)
      const folder = await laptop.library.newFolder(null)
      await laptop.library.move({ kind: 'note', id }, folder.id)
      await edit(phone, id, text('c', frame, 'Written on the phone during the move.'))
      await cloud.settle(laptop, phone)
      await cloud.settle(laptop, phone)
      const doc = await inStep(id, laptop, phone)
      expect(words(doc)).toContain('Written on the phone during the move.')
      for (const each of [laptop, phone]) {
        const notes = await live(each)
        expect(notes.map((note) => note.id)).toEqual([id])
        expect(notes[0]!.folder).toBe(folder.id)
      }
      expect((await paths(laptop)).filter((path) => !path.startsWith(BIN))).toEqual(['Untitled folder', 'Untitled folder/Trip.shellnote'])
    })

    it('brings a note back when it was deleted on one device and changed on the other', async () => {
      const { cloud, laptop, phone, id, frame } = await pair(conflicts)
      await laptop.library.delete({ kind: 'note', id })
      await edit(phone, id, text('c', frame, 'Still writing here.'))
      await cloud.settle(laptop, phone)
      await cloud.settle(laptop, phone)
      const doc = await inStep(id, laptop, phone)
      expect(words(doc)).toContain('Still writing here.')
      for (const each of [laptop, phone]) expect((await live(each)).map((note) => note.id)).toEqual([id])
    })

    it('on many edits and syncs in any order, ends with the same note on both and every paragraph written', async () => {
      const { cloud, laptop, phone, id, frame } = await pair(conflicts)
      // A small generator of its own, so a failure replays.
      let seed = conflicts === 'copies' ? 12345 : 6789
      const random = (n: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed % n
      }
      const written: string[] = []
      for (let step = 0; step < 60; step++) {
        const on = random(2) === 0 ? laptop : phone
        const what = random(5)
        if (what <= 1) {
          const line = `${on === laptop ? 'laptop' : 'phone'} wrote line ${step}`
          written.push(line)
          const at = random(((await on.library.open(id)).doc.block[frame] as Frame).kids.length + 1)
          await edit(on, id, text(`${on === laptop ? 'l' : 'p'}${step}`, frame, line, at))
        } else if (what === 2) await cloud.sync(on.folder)
        else if (what === 3) await on.library.sync()
        else {
          await cloud.sync(on.folder)
          await on.library.sync()
          await cloud.sync(on.folder)
        }
      }
      await cloud.settle(laptop, phone)
      await cloud.settle(laptop, phone)
      const doc = await inStep(id, laptop, phone)
      for (const line of written) expect(words(doc)).toContain(line)
      expect(words(doc)).toHaveLength(written.length + 2)
      expect((await live(laptop)).map((note) => note.id)).toEqual([id])
    })
  })
}

describe('a change arriving into the note that is open', () => {
  it('joins what is being typed, and undo still takes back only what was typed', async () => {
    const { cloud, laptop, phone, id, frame } = await pair()
    // The laptop has the note open, and types.
    const opened = await laptop.library.open(id)
    const store = new EditorStore(opened.doc)
    let since = opened.doc
    store.apply([{ op: 'splice', id: 'a', field: 'md', at: 28, del: 0, ins: ' And a lamp.' }])
    // The phone's edit arrives meanwhile.
    await edit(phone, id, text('c', frame, 'Back by Sunday.'), { op: 'splice', id: 'a', field: 'md', at: 0, del: 4, ins: 'Bring' })
    await cloud.settle(phone)
    await cloud.sync(laptop.folder)
    laptop.heard.length = 0
    await laptop.library.sync()
    expect(laptop.heard.some((change) => change.notes.has(id))).toBe(true)
    // More is typed before the screen has looked.
    store.apply([{ op: 'update', id: 'b', set: { md: 'Leave on Friday morning, early.' } }])
    const sent = store.doc
    const kept = await laptop.library.exchange({ doc: sent, since, blob: () => undefined })
    expect(kept.merged).toBeDefined()
    // And typed again while the library answered.
    store.apply([{ op: 'splice', id: 'b', field: 'md', at: 0, del: 0, ins: 'We ' }])
    expect(store.absorb(sent, kept.merged!.doc)).toBe(true)
    since = kept.merged!.doc
    expect(md(store.doc, 'a')).toBe('Bring the tent and the stove. And a lamp.')
    expect(md(store.doc, 'b')).toBe('We Leave on Friday morning, early.')
    expect(words(store.doc)).toContain('Back by Sunday.')
    // The next keep hands nothing back, and both devices end the same.
    const again = await laptop.library.exchange({ doc: store.doc, since, blob: () => undefined })
    expect(again.merged).toBeUndefined()
    await cloud.settle(laptop, phone)
    const doc = await inStep(id, laptop, phone)
    expect(sameContent(doc, { ...store.doc })).toBe(true)
    // Undo steps back through the typing only.
    store.undo()
    store.undo()
    store.undo()
    expect(store.canUndo).toBe(false)
    expect(md(store.doc, 'a')).toBe('Bring the tent and the stove.')
    expect(md(store.doc, 'b')).toBe('Leave on Friday morning.')
    expect(words(store.doc)).toContain('Back by Sunday.')
  })
})

describe('files that are not as they should be', () => {
  it('never takes a half-written file for the note, and takes the whole one when it comes', async () => {
    const { cloud, laptop, phone, id, frame } = await pair()
    await edit(phone, id, text('c', frame, 'Back by Sunday.'))
    await cloud.sync(phone.folder)
    // The laptop's cloud client has written only the first half of the phone's file.
    const whole = phone.folder.peek('Trip.shellnote')!
    laptop.folder.put('Trip.shellnote', whole.slice(0, whole.length >> 1))
    await laptop.library.sync()
    expect((await laptop.library.list()).notes.map((note) => note.title)).toEqual(['Trip'])
    expect(words((await laptop.library.open(id)).doc)).toEqual(['Pack the tent and the stove.', 'Leave on Friday morning.'])
    // Typing goes on meanwhile, and is not written over the file while it is still arriving.
    await edit(laptop, id, text('d', frame, 'Typed while the file arrived.'))
    expect(laptop.folder.peek('Trip.shellnote')).toHaveLength(whole.length >> 1)
    laptop.folder.put('Trip.shellnote', whole)
    await laptop.library.sync()
    await cloud.settle(laptop, phone)
    expect(words(await inStep(id, laptop, phone)).sort()).toEqual(['Back by Sunday.', 'Leave on Friday morning.', 'Pack the tent and the stove.', 'Typed while the file arrived.'])
  })

  it('writes the note again over a file that stays broken', async () => {
    const { clock, laptop, id, frame } = await pair()
    laptop.folder.put('Trip.shellnote', new Uint8Array([1, 2, 3, 4]))
    await laptop.library.sync()
    clock.wait(10_000)
    await edit(laptop, id, text('d', frame, 'Still here.'))
    expect(words(unpack(laptop.folder.peek('Trip.shellnote')!).doc)).toContain('Still here.')
  })

  it('takes nothing as deleted when the folder cannot be reached, or is not the library any more', async () => {
    const { clock, cloud, laptop, phone, id, frame } = await pair()
    laptop.folder.unreachable = true
    await laptop.library.sync()
    expect(laptop.library.problem()).toMatch(/cannot be reached/u)
    // The note is still there, and what is typed is kept on this device.
    await edit(laptop, id, text('d', frame, 'Typed with the drive away.')).catch(() => undefined)
    laptop.folder.unreachable = false
    for (const info of await laptop.folder.list()) await laptop.folder.remove(info.path)
    clock.wait(10_000)
    await laptop.library.sync()
    await laptop.library.sync()
    expect(laptop.library.problem()).toMatch(/not this library's/u)
    expect((await laptop.library.list()).notes.map((note) => note.id)).toEqual([id])
    expect(await laptop.folder.list()).toEqual([])
    // The phone still has the note: the empty folder took nothing from it either.
    await cloud.settle(phone)
    expect((await phone.library.list()).notes.map((note) => note.id)).toEqual([id])
  })

  it('keeps what was typed while the folder was away, and writes it once it is back', async () => {
    const { clock, laptop, id, frame } = await pair()
    const opened = await laptop.library.open(id)
    laptop.folder.unreachable = true
    const doc = apply(opened.doc, [text('d', frame, 'Typed with the drive away.')]).doc
    await expect(laptop.library.exchange({ doc, since: opened.doc, blob: () => undefined })).rejects.toThrow(/cannot be reached/u)
    // Kept on the device all the same: it is there after the app starts again.
    const again = restarted(clock, laptop)
    expect(words((await again.library.open(id)).doc)).toContain('Typed with the drive away.')
    laptop.folder.unreachable = false
    await again.library.sync()
    expect(words(unpack(laptop.folder.peek('Trip.shellnote')!).doc)).toContain('Typed with the drive away.')
  })

  it('keeps both notes side by side when two versions cannot be merged', async () => {
    const { laptop, id, frame } = await pair()
    await edit(laptop, id, text('x1', frame, 'On the laptop.'))
    // A file holding the same note, in which x1 is a page: the two cannot be one note.
    const other = createDoc({ title: 'Trip' })
    const theirs: Doc = apply({ ...other, id }, [{ op: 'page', add: { id: 'x1', w: 21000, h: 29700, bg: 'blank', free: [] } }]).doc
    laptop.folder.put('Trip (from elsewhere).shellnote', pack(theirs))
    await laptop.library.sync()
    const notes = await live(laptop)
    expect(notes.map((note) => note.title).sort()).toEqual(['Trip', expect.stringMatching(/^Trip \(conflicted copy \d{4}-\d\d-\d\d\)$/u)])
    expect(words((await laptop.library.open(id)).doc)).toContain('On the laptop.')
    const beside = notes.find((note) => note.id !== id)!
    expect((await laptop.library.open(beside.id)).doc.pages).toHaveLength(2)
    // Looked at again, nothing more is made.
    await laptop.library.sync()
    expect(await live(laptop)).toHaveLength(2)
  })

  it('leaves alone a file made by a newer ShellNote', async () => {
    const { laptop, id, frame } = await pair()
    const newer = pack({ ...(await laptop.library.open(id)).doc, v: 999 as never })
    laptop.folder.put('Trip.shellnote', newer)
    await laptop.library.sync()
    await edit(laptop, id, text('d', frame, 'Typed on the older app.'))
    expect(laptop.folder.peek('Trip.shellnote')).toEqual(newer)
    expect(words((await laptop.library.open(id)).doc)).toContain('Typed on the older app.')
  })
})
