// A note's page size and which way up its pages are: what each page holds fits the new page, the margins stay,
// typed text keeps its size, and drawings and pictures are made smaller when the writing area is, never bigger.
import { describe, expect, it } from 'vitest'
import { apply, isPlacedBlock, liesInOneBand, resizeOps, SCHEMA_VERSION, sheetOf, sheetSize, sized, validateDoc, type Block, type Doc, type FreeBlock, type InkBlock } from '../../src/index.js'
import { sameContent } from '../../src/sync/diff.js'

function note(blocks: Block[], size = { w: 21000, h: 29700 }): Doc {
  const doc: Doc = {
    v: SCHEMA_VERSION,
    id: 'd1',
    title: 'Sizes',
    rev: 0,
    pages: ['p1'],
    page: { p1: { id: 'p1', ...size, bg: 'ruled', free: blocks.map((b) => b.id) } },
    block: Object.fromEntries(blocks.map((b) => [b.id, b])),
    asset: { a1b2c3d4: { mime: 'image/png', w: 400, h: 300, bytes: 4 } },
    rules: [],
  }
  return validateDoc(doc)
}

const frame: Block = { id: 'f', r: 0, type: 'frame', page: 'p1', x: 2000, y: 2000, w: 17000, h: 3000, kids: [] }
const picture: Block = { id: 'g', r: 0, type: 'image', page: 'p1', x: 2000, y: 8000, w: 17000, h: 9000, asset: 'a1b2c3d4' }
const ink: InkBlock = { id: 'k', r: 0, type: 'ink', page: 'p1', x: 4000, y: 20000, w: 6000, h: 2000, strokes: [{ pts: [0, 0, 128, 6000, 2000, 128], color: 'blue', width: 'm' }] }

const at = (doc: Doc, id: string): FreeBlock => doc.block[id] as FreeBlock

describe('the sheets', () => {
  it('knows each page size either way up, and none for a size of its own', () => {
    expect(sheetOf({ w: 21000, h: 29700 })).toEqual({ sheet: 'A4', turn: 'upright' })
    expect(sheetOf({ w: 29700, h: 21000 })).toEqual({ sheet: 'A4', turn: 'across' })
    expect(sheetOf({ w: 21590, h: 27940 })).toEqual({ sheet: 'Letter', turn: 'upright' })
    expect(sheetOf({ w: 20000, h: 30000 }).sheet).toBeUndefined()
    expect(sheetSize('A6', 'across')).toEqual({ w: 14800, h: 10500 })
  })
})

describe('changing the page size', () => {
  it('to a smaller sheet: the column narrows, typed text keeps its size, drawings and pictures shrink, margins stay', () => {
    const doc = note([frame, picture, ink])
    const after = apply(doc, resizeOps(doc, sheetSize('A5', 'upright'))).doc
    expect(after.page.p1).toMatchObject({ w: 14800, h: 21000 })
    // The frame is as wide as the new column, from the same margin.
    expect(at(after, 'f')).toMatchObject({ x: 2000, y: 2000, w: 14800 - 4000, h: 3000 })
    const s = Math.min((14800 - 4000) / (21000 - 4000), (21000 - 4000) / (29700 - 4000))
    const g = at(after, 'g')
    expect(g.w).toBe(Math.round(17000 * s))
    expect(g.h).toBe(Math.round(9000 * s))
    const k = after.block.k as InkBlock
    expect(k.strokes[0]!.pts).toEqual([0, 0, 128, Math.round(6000 * s), Math.round(2000 * s), 128])
    expect(k.strokes[0]!.color).toBe('blue')
    for (const block of Object.values(after.block)) if (isPlacedBlock(block)) expect(liesInOneBand(block, sized(after.page[block.page]!))).toBe(true)
  })

  it('to a bigger sheet: nothing grows, and the column widens', () => {
    const small = apply(note([frame, ink]), resizeOps(note([frame, ink]), sheetSize('A5', 'upright'))).doc
    const big = apply(small, resizeOps(small, sheetSize('A4', 'upright'))).doc
    expect(at(big, 'f')).toMatchObject({ x: 2000, w: 17000 })
    expect(at(big, 'k').w).toBe(at(small, 'k').w)
  })

  it('turned across: wider and shorter, and whatever no longer fits moves on to a page of its own', () => {
    const doc = note([frame, picture, ink])
    const after = apply(doc, resizeOps(doc, sheetSize('A4', 'across'))).doc
    for (const id of after.pages) expect(after.page[id]).toMatchObject({ w: 29700, h: 21000 })
    expect(at(after, 'f').w).toBe(29700 - 4000)
    for (const block of Object.values(after.block)) if (isPlacedBlock(block)) expect(liesInOneBand(block, sized(after.page[block.page]!))).toBe(true)
  })

  it('is one change that undo takes back exactly, and nothing when the pages are that size already', () => {
    const doc = note([frame, picture, ink])
    expect(resizeOps(doc, sheetSize('A4', 'upright'))).toEqual([])
    const done = apply(doc, resizeOps(doc, sheetSize('A6', 'across')))
    expect(sameContent(apply(done.doc, done.inverse).doc, doc)).toBe(true)
  })
})
