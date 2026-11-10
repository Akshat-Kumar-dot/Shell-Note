// Adding, moving and resizing pictures, as operations and boxes.
import { apply, createDoc, type Frame, type Op } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { MIXED, PHYSICS } from '../../core/test/fixtures/index.js'
import { moveBox, PAGE_GAP, pageAt, pictureOps, pictureSize, resizeBox, type NewPicture } from '../src/index.js'

const png = (w: number, h: number, hash = 'ab12'): NewPicture => ({ hash, meta: { mime: 'image/png', w, h, bytes: 1000 } })
const A4 = { w: 21000, h: 29700 }
const added = (ops: Op[]) => ops.flatMap((op) => (op.op === 'add' ? [op.block as Record<string, unknown>] : []))

describe('the size of a new picture', () => {
  it('is its pixels at 96 to the inch', () => {
    // 96 pixels are an inch, 25.4 mm, which is 2540 units.
    expect(pictureSize(png(96, 48).meta, A4)).toEqual({ w: 2540, h: 1270 })
  })

  it('shrinks to the width between the margins, and to half the height', () => {
    expect(pictureSize(png(1600, 1200).meta, A4)).toEqual({ w: 17000, h: 12750 })
    expect(pictureSize(png(600, 3000).meta, A4)).toEqual({ w: 2570, h: 12850 })
  })

  it('is 80 by 60 mm when the picture gives none', () => {
    expect(pictureSize({ mime: 'image/png', bytes: 10 }, A4)).toEqual({ w: 8000, h: 6000 })
  })
})

describe('adding pictures to a page', () => {
  const doc = createDoc()
  const page = doc.pages[0]!
  const frame = doc.page[page]!.free[0]!

  it('adds the asset, then the picture in the first free space under the text as drawn', () => {
    const ops = pictureOps(doc, [png(96, 96)], { page }, { [frame]: 5000 })
    expect(ops[0]).toEqual({ op: 'asset', hash: 'ab12', meta: { mime: 'image/png', w: 96, h: 96, bytes: 1000 } })
    // The frame starts at 20 mm and is drawn 50 mm tall; 5 mm is left under it.
    expect(added(ops)).toEqual([expect.objectContaining({ type: 'image', page, x: 2000, y: 7500, w: 2540, h: 2540, asset: 'ab12' })])
    expect(apply(doc, ops).doc.block[added(ops)[0]!.id as string]).toMatchObject({ type: 'image', asset: 'ab12' })
  })

  it('stores the same picture once, and puts a second copy under the first', () => {
    const ops = pictureOps(doc, [png(96, 96), png(96, 96)], { page })
    expect(ops.map((op) => op.op)).toEqual(['asset', 'add', 'add'])
    const [first, second] = added(ops)
    expect(second!.y).toBe((first!.y as number) + 2540 + 500)
    expect(first!.id).not.toBe(second!.id)
  })

  it('centres dropped pictures on the point, on the page, and fans them out', () => {
    const ops = pictureOps(doc, [png(96, 96, 'aa11'), png(96, 96, 'bb22')], { page, x: 10000, y: 10000 })
    expect(added(ops).map((b) => [b.x, b.y])).toEqual([
      [8730, 8730],
      [9230, 9230],
    ])
    const corner = pictureOps(doc, [png(96, 96)], { page, x: 0, y: 29700 })
    expect(added(corner).map((b) => [b.x, b.y])).toEqual([[0, 29700 - 2540]])
  })

  it('does not add an asset the note already has', () => {
    const ops = pictureOps(PHYSICS, [png(1600, 1200, 'a91f')], { page: 'p1' })
    expect(ops.map((op) => op.op)).toEqual(['add'])
    expect(() => apply(PHYSICS, ops)).not.toThrow()
  })
})

describe('adding pictures to a frame', () => {
  it('puts them in the text at the index, in order', () => {
    const ops = pictureOps(MIXED, [png(10, 10, 'aa11'), png(10, 10, 'bb22')], { frame: 'fa', at: 1 })
    expect(added(ops).map((b) => [b.parent, b.asset])).toEqual([
      ['fa', 'aa11'],
      ['fa', 'bb22'],
    ])
    const kids = (apply(MIXED, ops).doc.block.fa as Frame).kids
    expect(kids.slice(1, 3)).toEqual(added(ops).map((b) => b.id))
  })

  it('puts them at the end when the frame has fewer blocks than the index', () => {
    const ops = pictureOps(MIXED, [png(10, 10)], { frame: 'fa', at: 999 })
    const kids = (apply(MIXED, ops).doc.block.fa as Frame).kids
    expect(kids.at(-1)).toBe(added(ops)[0]!.id)
  })
})

describe('dragging a picture', () => {
  const box = { x: 2000, y: 3000, w: 4000, h: 2000 }

  it('moves it, but not off the page', () => {
    expect(moveBox(box, 100, -100, A4)).toEqual({ x: 2100, y: 2900, w: 4000, h: 2000 })
    expect(moveBox(box, -5000, 99999, A4)).toEqual({ x: 0, y: 29700 - 2000, w: 4000, h: 2000 })
  })

  it('resizes it from a corner, keeping its shape and the opposite corner', () => {
    // Pulling the south-east corner out along the diagonal by the box's own size doubles it.
    expect(resizeBox(box, 'se', 4000, 2000, A4)).toEqual({ x: 2000, y: 3000, w: 8000, h: 4000 })
    // A pull straight in shrinks it too: the corner follows the pointer along the diagonal.
    expect(resizeBox(box, 'se', -2000, 0, A4)).toEqual({ x: 2000, y: 3000, w: 2400, h: 1200 })
    // Pulling the north-west corner up and left: the south-east corner stays at (6000, 5000).
    expect(resizeBox(box, 'nw', -1000, -500, A4)).toEqual({ x: 1000, y: 2500, w: 5000, h: 2500 })
  })

  it('keeps it at least 5 mm, and on the page', () => {
    expect(resizeBox(box, 'se', -99999, -99999, A4)).toEqual({ x: 2000, y: 3000, w: 1000, h: 500 })
    // The north-west corner can go no further than the page's edge.
    expect(resizeBox(box, 'nw', -99999, 0, A4)).toEqual({ x: 0, y: 2000, w: 6000, h: 3000 })
  })
})

describe('the page in view', () => {
  it('is the page at the middle of the screen, or the nearer one in a gap', () => {
    // Pages 100 px tall, a gap above each: page 0 ends at gap + 100, and the gap below it is split halfway.
    const middle = PAGE_GAP + 100 + PAGE_GAP / 2
    expect(pageAt([100, 100, 100], 50)).toBe(0)
    expect(pageAt([100, 100, 100], middle - 1)).toBe(0)
    expect(pageAt([100, 100, 100], middle)).toBe(1)
    expect(pageAt([100, 100, 100], 9999)).toBe(2)
  })
})
