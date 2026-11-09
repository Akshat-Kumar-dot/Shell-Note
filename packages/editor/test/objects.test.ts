// Moving a table or a diagram out of its place in the text with its ⊕ handle,
// as operations: to another place in a frame, or onto bare paper, where a
// table gets a frame made for it and a diagram goes on its own, at the size it
// was drawn and keeping its shape, to be moved and resized there.
import { apply, createDoc, type Block, type Doc, type Frame } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { MIXED } from '../../core/test/fixtures/index.js'
import { moveOps } from '../src/objectDrag.js'

const frame = (doc: Doc, id: string): Frame => doc.block[id] as Frame

/** A new note whose one frame holds what is given, and nothing else. */
function holding(...blocks: Record<string, unknown>[]): { doc: Doc; frame: string; page: string } {
  const doc = createDoc()
  const page = doc.pages[0]!
  const id = doc.page[page]!.free[0]!
  return { doc: apply(doc, blocks.map((block) => ({ op: 'add', block: { r: 0, parent: id, ...block } as Block }))).doc, frame: id, page }
}

const graph = { id: 'gr', type: 'diagram', lang: 'mermaid', src: 'flowchart LR\n  1 ---|3| 2' }
const table = { id: 'tb', type: 'table', rows: [['a', 'b']] }

describe('a diagram dragged out of the text', () => {
  it('goes on its own onto bare paper, where it was dropped, at the size it was drawn', () => {
    const after = apply(MIXED, moveOps(MIXED, 'dc', { page: 'w1', x: 12000, y: 21000, w: 7000 }, { w: 8250, h: 4000 })).doc
    expect(after.block.dc).toMatchObject({ type: 'diagram', page: 'w1', x: 12000, y: 21000, w: 8250, h: 4000 })
    expect(after.block.dc).not.toHaveProperty('parent')
    expect(after.page.w1!.free).toContain('dc')
    expect(frame(after, 'fa').kids).not.toContain('dc')
    // Its source is untouched.
    expect((after.block.dc as { src: string }).src).toBe((MIXED.block.dc as { src: string }).src)
  })

  it('dropped near the foot or the edge of the page, comes in from it; too big for the page, shrinks to fit, keeping its shape', () => {
    const near = apply(MIXED, moveOps(MIXED, 'dc', { page: 'w1', x: 15000, y: 28000, w: 4000 }, { w: 8250, h: 4000 })).doc
    expect(near.block.dc).toMatchObject({ x: 21000 - 8250, y: 29700 - 4000, w: 8250, h: 4000 })
    const big = apply(MIXED, moveOps(MIXED, 'dc', { page: 'w1', x: 3000, y: 3000, w: 16000 }, { w: 42000, h: 21000 })).doc
    expect(big.block.dc).toMatchObject({ x: 0, y: 3000, w: 21000, h: 10500 })
  })

  it('without the size it was drawn, is as wide as a frame there and three fifths as tall', () => {
    const after = apply(MIXED, moveOps(MIXED, 'dc', { page: 'w1', x: 12000, y: 21000, w: 7000 })).doc
    expect(after.block.dc).toMatchObject({ x: 12000, y: 21000, w: 7000, h: 4200 })
  })

  it('goes between the blocks of another frame, and nowhere when dropped where it is', () => {
    const after = apply(MIXED, moveOps(MIXED, 'dc', { frame: 'fb', at: 1 })).doc
    expect(frame(after, 'fb').kids).toEqual(['b1', 'dc', 'b2'])
    expect(frame(after, 'fa').kids).not.toContain('dc')
    expect(moveOps(MIXED, 'dc', { frame: 'fa', at: frame(MIXED, 'fa').kids.indexOf('dc') })).toEqual([])
  })

  it('leaves no empty frame behind, unless text flows through it from page to page', () => {
    const alone = holding(graph)
    const after = apply(alone.doc, moveOps(alone.doc, 'gr', { page: alone.page, x: 2000, y: 2000, w: 8000 }, { w: 8000, h: 5000 })).doc
    expect(after.block[alone.frame]).toBeUndefined()
    expect(after.page[alone.page]!.free).toEqual(['gr'])
    // A frame the text runs into from the one before keeps its place, empty.
    const linked = apply(alone.doc, [
      { op: 'add', block: { id: 'fz', r: 0, type: 'frame', page: alone.page, x: 2000, y: 25000, w: 8000, h: 2000, kids: [], next: alone.frame } as Block },
    ]).doc
    const kept = apply(linked, moveOps(linked, 'gr', { page: alone.page, x: 2000, y: 2000, w: 8000 }, { w: 8000, h: 5000 })).doc
    expect(frame(kept, alone.frame).kids).toEqual([])
  })

  it('placed on the page already, is moved by its own box, not by these', () => {
    expect(moveOps(MIXED, 'df', { page: 'w1', x: 2000, y: 2000, w: 8000 }, { w: 8000, h: 5000 })).toEqual([])
  })
})

describe('a table dragged out of the text', () => {
  it('gets a frame made for it on bare paper, as wide as the frame there, and the frame it leaves empty goes', () => {
    const { doc, frame: from, page } = holding(table)
    const after = apply(doc, moveOps(doc, 'tb', { page, x: 3000, y: 9000, w: 12000 }, { w: 1, h: 1 })).doc
    const parent = (after.block.tb as { parent: string }).parent
    expect(parent).not.toBe(from)
    expect(after.block[parent]).toMatchObject({ type: 'frame', page, x: 3000, y: 9000, w: 12000, kids: ['tb'] })
    expect(after.block[from]).toBeUndefined()
  })
})
