// Moving the notes the app kept into a folder, once, and back: everything is
// copied and compared, nothing is removed from where it was, and doing it
// again copies nothing twice.
import { apply, sameContent } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { MIXED, PHYSICS } from '../../../../packages/core/test/fixtures/index.js'
import { copyLibrary } from '../../src/library/copy.js'
import { hidden } from '../../src/library/tree.js'
import { Clock, device, edit } from './devices.js'

const pictures = (doc: typeof MIXED): Map<string, Blob> => new Map(Object.keys(doc.asset).map((hash) => [hash, new Blob([new Uint8Array([7, 7])], { type: 'image/png' })]))

/** A library as the app might hold it: folders, a note in one, a picture, a thumbnail, something deleted, a pen profile. */
async function filled() {
  const clock = new Clock()
  const app = device(clock)
  const work = await app.library.newFolder(null)
  await app.library.rename({ kind: 'folder', id: work.id }, 'Work')
  const workId = (await app.library.list()).folders[0]!.id
  const inner = await app.library.newFolder(workId)
  const physics = await app.library.newNote(inner.id, { doc: PHYSICS, assets: pictures(PHYSICS) })
  const mixed = await app.library.newNote(null, { doc: MIXED, assets: pictures(MIXED) })
  await app.library.setPreview(mixed.id, new Blob(['thumb']))
  const gone = await app.library.newNote(workId)
  await app.library.delete({ kind: 'note', id: gone.id })
  await app.library.setPenProfile({ v: 1, updated: '2026-11-11T10:00:00.000Z', examples: [] })
  return { clock, app, physics, mixed, gone }
}

describe('copying a library into another', () => {
  it('copies folders, notes, pictures, thumbnails, Recently deleted and the pen profile, and changes nothing where they were', async () => {
    const { clock, app, physics, mixed, gone } = await filled()
    const before = JSON.stringify(await app.library.list())
    const folder = device(clock)
    const progress: string[] = []
    const copied = await copyLibrary(app.library, folder.library, { onProgress: (done, of) => progress.push(`${done}/${of}`) })
    expect(copied).toEqual({ notes: 3, there: 0, folders: 2 })
    expect(progress).toEqual(['1/3', '2/3', '3/3'])
    expect(JSON.stringify(await app.library.list())).toBe(before)

    const paths = (await folder.folder.list()).map((info) => info.path).filter((path) => !path.startsWith('.')).sort()
    expect(paths).toEqual(['Physics lecture 4.shellnote', 'Recently deleted', 'Recently deleted/Untitled.shellnote', 'Work', 'Work/Untitled folder', 'Work/Untitled folder/Physics lecture 4.shellnote'].map((path) => (path === 'Physics lecture 4.shellnote' ? `${MIXED.title.replace(/[\\/:*?"<>|]+/gu, '-')}.shellnote` : path)).sort())
    const library = await folder.library.list()
    for (const [id, doc] of [
      [physics.id, PHYSICS],
      [mixed.id, MIXED],
    ] as const) {
      const opened = await folder.library.open(id)
      expect(sameContent(opened.doc, doc)).toBe(true)
      expect([...opened.assets.keys()].sort()).toEqual(Object.keys(doc.asset).sort())
    }
    expect(await (await folder.library.preview(mixed.id))!.text()).toBe('thumb')
    expect(hidden(library, library.notes.find((note) => note.id === gone.id)!)).toBe(true)
    expect(await folder.library.penProfile()).toMatchObject({ v: 1 })
  })

  it('copies nothing twice when done again', async () => {
    const { clock, app } = await filled()
    const folder = device(clock)
    await copyLibrary(app.library, folder.library)
    const first = (await folder.folder.list()).map((info) => info.path).sort()
    expect(await copyLibrary(app.library, folder.library)).toEqual({ notes: 0, there: 3, folders: 0 })
    expect((await folder.folder.list()).map((info) => info.path).sort()).toEqual(first)
  })

  it('brings back what was made or changed in the folder, over the older copy the app kept', async () => {
    const { clock, app, mixed } = await filled()
    const folder = device(clock)
    await copyLibrary(app.library, folder.library)
    const made = await folder.library.newNote(null)
    await edit(folder, mixed.id, { op: 'update', id: mixed.id, set: { title: 'Changed in the folder' } })
    const copied = await copyLibrary(folder.library, app.library, { replace: true })
    expect(copied).toMatchObject({ notes: 2, there: 2 })
    const back = await app.library.list()
    expect(back.notes.map((note) => note.title)).toEqual(expect.arrayContaining(['Changed in the folder', made.title]))
    expect(back.notes).toHaveLength(4)
  })

  it('keeps both when a note differs and neither is known to be the later', async () => {
    const { clock, app, mixed } = await filled()
    const folder = device(clock)
    await copyLibrary(app.library, folder.library)
    await edit(app, mixed.id, { op: 'update', id: mixed.id, set: { title: 'Changed in the app' } })
    await edit(folder, mixed.id, { op: 'update', id: mixed.id, set: { title: 'Changed in the folder' } })
    await copyLibrary(app.library, folder.library)
    expect((await folder.library.list()).notes.map((note) => note.title)).toEqual(expect.arrayContaining(['Changed in the app', 'Changed in the folder']))
  })

  it('stops, with everything where it was, when a copy does not read back the same', async () => {
    const { clock, app } = await filled()
    const folder = device(clock)
    const open = folder.library.open.bind(folder.library)
    // A library that hands back something else than it was given.
    folder.library.open = async (id) => {
      const opened = await open(id)
      return { ...opened, doc: apply(opened.doc, [{ op: 'update', id: opened.doc.id, set: { title: 'Not what was written' } }]).doc }
    }
    const before = JSON.stringify(await app.library.list())
    await expect(copyLibrary(app.library, folder.library)).rejects.toThrow(/did not read back the same/u)
    expect(JSON.stringify(await app.library.list())).toBe(before)
  })
})
