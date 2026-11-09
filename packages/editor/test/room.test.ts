// A frame that grows moves what lies below it, in its column, down out of its
// way, in the same undo step as the change that made it
// grow; what lies beside it, or far enough below, stays where it is.
import { apply, createDoc, type Block, type Doc, type Op } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { content } from '../../core/test/helpers.js'
import { EditorStore, roomOps } from '../src/index.js'

/** A frame placed on the page: x, y, w and h in 0.01 mm. */
const frameAt = (id: string, page: string, x: number, y: number, w: number, h: number): Op => ({
  op: 'add',
  block: { id, r: 0, type: 'frame', page, x, y, w, h, kids: [] } as Block,
})

/**
 * An A4 page: the frame `ff`, 20 mm from the top and 30 mm tall, in the left
 * column; `fb` 2 mm under it, `fe` 2 mm under that, `fc` far below, `fd`
 * beside it in the right column, and `fz` at the foot of the page.
 */
function page(): Doc {
  const doc = createDoc()
  const p = doc.pages[0]!
  return apply(doc, [
    { op: 'remove', id: doc.page[p]!.free[0]! },
    frameAt('ff', p, 2000, 2000, 8000, 3000),
    frameAt('fb', p, 2000, 5200, 8000, 2000),
    frameAt('fe', p, 2000, 7400, 8000, 1000),
    frameAt('fc', p, 2000, 20000, 8000, 2000),
    frameAt('fd', p, 11000, 5200, 8000, 2000),
    frameAt('fz', p, 2000, 27000, 8000, 2000),
  ]).doc
}

const yOf = (doc: Doc, id: string): number => (doc.block[id] as { y: number }).y

describe('a frame that grows', () => {
  it('moves what is just below it down, keeping its gap, and what that reaches in turn', () => {
    const doc = page()
    // 30 mm grows to 60 mm: its foot goes from 50 mm to 80 mm.
    const after = apply(doc, roomOps(doc, 'ff', 6000)).doc
    expect(yOf(after, 'fb')).toBe(8000 + 200)
    expect(yOf(after, 'fe')).toBe(8200 + 2000 + 200)
  })

  it('leaves what is beside it, or far enough below, where it is', () => {
    const doc = page()
    const after = apply(doc, roomOps(doc, 'ff', 6000)).doc
    expect(yOf(after, 'fd')).toBe(5200)
    expect(yOf(after, 'fc')).toBe(20000)
    // Grown far enough, the two it pushes reach that one too, which keeps 5 mm at most of its old gap.
    const far = apply(doc, roomOps(doc, 'ff', 21000)).doc
    expect(yOf(far, 'fe')).toBe(2000 + 21000 + 200 + 2000 + 200)
    expect(yOf(far, 'fc')).toBe(yOf(far, 'fe') + 1000 + 500)
  })

  it('never moves anything off its page, and never up', () => {
    const doc = page()
    const after = apply(doc, roomOps(doc, 'ff', 26000)).doc
    expect(yOf(after, 'fz')).toBe(29700 - 2000)
    expect(roomOps(doc, 'ff', 3000)).toEqual([])
    expect(roomOps(doc, 'ff', 1000)).toEqual([])
  })

  it('makes room in the same undo step as the change that made it grow', () => {
    const doc = page()
    const store = new EditorStore(doc)
    // Words typed into the frame, then the layout they set off, joined to them as the editor does.
    store.apply([{ op: 'add', block: { id: 't1', r: 0, type: 'text', parent: 'ff', role: 'p', indent: 0, md: 'More words' } as Block, at: 0 }])
    store.apply([{ op: 'update', id: 'ff', set: { h: 6000 } }, ...roomOps(store.doc, 'ff', 6000)], { origin: 'layout', join: true })
    expect(yOf(store.doc, 'fb')).toBe(8200)
    store.undo()
    expect(content(store.doc)).toEqual(content(doc))
  })
})
