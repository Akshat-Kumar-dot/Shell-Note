// Three devices, and a cloud service between them, doing whatever comes: lines
// written, changed and removed, the note moved, renamed, deleted and brought
// back, folders renamed, and syncs in any order. At the end every device holds
// the same library, and every line a device wrote and kept is in the note.
import { sameContent, type Doc, type Frame, type Op } from '@shellnote/core'
import { expect, it } from 'vitest'
import { Clock, Cloud, device, edit, type Device } from './devices.js'

const text = (id: string, parent: string, md: string, at?: number): Op => ({ op: 'add', block: { id, r: 0, type: 'text', parent, role: 'p', indent: 0, md }, ...(at === undefined ? {} : { at }) })
const words = (doc: Doc): string[] => Object.values(doc.block).flatMap((block) => (block.type === 'text' ? [block.md] : []))

for (const conflicts of ['copies', 'overwrites'] as const) {
  it(`ends the same on every device with nothing lost, when the cloud service ${conflicts === 'copies' ? 'keeps conflicted copies' : 'lets the later file overwrite'}`, async () => {
    for (let run = 0; run < 20; run++) {
      const clock = new Clock()
      const cloud = new Cloud(conflicts)
      const devices: Device[] = [device(clock), device(clock), device(clock)]
      const names = ['laptop', 'phone', 'pad']
      const note = await devices[0]!.library.newNote(null)
      const id = note.id
      const frame = Object.keys((await devices[0]!.library.open(id)).doc.block)[0]!
      await cloud.settle(...devices)
      let seed = 1000 + run * 77 + (conflicts === 'copies' ? 1 : 2)
      const random = (n: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return (seed >> 8) % n
      }
      // Each device's own lines, by block: the words it last gave each one it has not removed.
      const mine: Map<string, string>[] = [new Map(), new Map(), new Map()]
      const folders: (string | null)[] = [null]
      for (let step = 0; step < 70; step++) {
        const d = random(3)
        const on = devices[d]!
        const what = random(14)
        try {
          if (what <= 2) {
            const line = `${names[d]} wrote line ${step}`
            const doc = (await on.library.open(id)).doc
            const kids = (doc.block[frame] as Frame | undefined)?.kids
            if (!kids) continue
            const bid = `${names[d]![0]}${run}x${step}`
            await edit(on, id, text(bid, frame, line, random(kids.length + 1)))
            mine[d]!.set(bid, line)
          } else if (what === 3 && mine[d]!.size > 0) {
            const ids = [...mine[d]!.keys()]
            const bid = ids[random(ids.length)]!
            const doc = (await on.library.open(id)).doc
            if (!doc.block[bid]) continue
            const next = `${mine[d]!.get(bid)} +${step}`
            await edit(on, id, { op: 'update', id: bid, set: { md: next } })
            mine[d]!.set(bid, next)
          } else if (what === 4 && mine[d]!.size > 2) {
            const ids = [...mine[d]!.keys()]
            const bid = ids[random(ids.length)]!
            const doc = (await on.library.open(id)).doc
            if (!doc.block[bid]) continue
            await edit(on, id, { op: 'remove', id: bid })
            mine[d]!.delete(bid)
          } else if (what === 5) {
            const entry = (await on.library.list()).notes.find((n) => n.id === id)
            if (!entry || entry.deleted !== undefined) continue
            if (random(2) === 0) {
              const made = await on.library.newFolder(null)
              folders.push(made.id)
              await on.library.move({ kind: 'note', id }, made.id)
            } else await on.library.move({ kind: 'note', id }, null)
          } else if (what === 6) {
            const entry = (await on.library.list()).notes.find((n) => n.id === id)
            if (!entry || entry.deleted !== undefined) continue
            await on.library.rename({ kind: 'note', id }, `Title ${step}`)
          } else if (what === 12) {
            const entry = (await on.library.list()).notes.find((n) => n.id === id)
            if (!entry) continue
            if (entry.deleted === undefined) await on.library.delete({ kind: 'note', id })
            else await on.library.restore({ kind: 'note', id })
          } else if (what === 13 && folders.length > 1) {
            const all = (await on.library.list()).folders.filter((f) => f.deleted === undefined)
            if (all.length === 0) continue
            await on.library.rename({ kind: 'folder', id: all[random(all.length)]!.id }, `Folder ${step}`).catch(() => undefined)
          } else if (what === 7) await cloud.sync(on.folder)
          else if (what === 8) await on.library.sync()
          else {
            await cloud.sync(on.folder)
            await on.library.sync()
            await cloud.sync(on.folder)
          }
        } catch (error) {
          throw new Error(`run ${run} step ${step} what ${what} on ${names[d]}: ${(error as Error).stack}`, { cause: error })
        }
        if (random(9) === 0) clock.wait(3000)
      }
      for (let i = 0; i < 4; i++) {
        await cloud.settle(...devices)
        clock.wait(5000)
      }
      const docs = await Promise.all(devices.map(async (each) => (await each.library.open(id)).doc))
      const where = `run ${run} ${conflicts}`
      for (const doc of docs) expect(sameContent(doc, docs[0]!), where).toBe(true)
      const lists = await Promise.all(devices.map(async (each) => (await each.library.list()).notes.filter((n) => n.id === id || n.deleted === undefined).map((n) => [n.id, n.title, n.folder, n.deleted !== undefined])))
      for (const list of lists) expect(list, where).toEqual(lists[0])
      expect(lists[0], where).toHaveLength(1)
      const have = words(docs[0]!)
      for (const each of mine) for (const line of each.values()) expect(have, `${where}: ${line}`).toContain(line)
      const files = await Promise.all(devices.map(async (each) => (await each.folder.list()).map((i) => i.path).sort()))
      for (const list of files) expect(list, where).toEqual(files[0])
    }
  }, 120_000)
}
