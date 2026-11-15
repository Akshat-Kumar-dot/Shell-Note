// Logical pages: what lies across a page's line moves whole to the next page's writing area, what is in its way
// there moves down together, and only ink taller than a whole writing area is cut. A4 here: 210 × 297 mm, margins of
// 20 mm, so the writing area runs from 20 mm (2000) to 277 mm (27700).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  apply,
  bodyOf,
  isPlacedBlock,
  liesInOneBand,
  MAKE_ROOM_GAP,
  SCHEMA_VERSION,
  settle,
  splitStrokeAt,
  validateDoc,
  type Block,
  type Doc,
  type FreeBlock,
  type InkBlock,
  type Page,
  type Stroke,
} from '../../src/index.js'
import { sameContent } from '../../src/sync/diff.js'

const A4 = { w: 21000, h: 29700 }
const LINE = 27700
const TOP = 2000

const page = (id: string, size: { w: number; h: number } = A4): Page => ({ id, ...size, bg: 'blank', free: [] })

/** An ink block whose one stroke runs corner to corner of its box: its body is its box. */
const ink = (id: string, on: string, x: number, y: number, w: number, h: number): InkBlock => ({
  id,
  r: 0,
  type: 'ink',
  page: on,
  x,
  y,
  w,
  h,
  strokes: [{ pts: [0, 0, 128, w, h, 128], color: 'ink', width: 'm' }],
})

const picture = (id: string, on: string, x: number, y: number, w: number, h: number): Block => ({ id, r: 0, type: 'image', page: on, x, y, w, h, asset: 'a1b2c3d4' })

const frame = (id: string, on: string, x: number, y: number, w: number, h: number): Block => ({ id, r: 0, type: 'frame', page: on, x, y, w, h, kids: [] })

function note(pages: Page[], blocks: Block[]): Doc {
  const doc: Doc = {
    v: SCHEMA_VERSION,
    id: 'd1',
    title: 'Settling',
    rev: 0,
    pages: pages.map((p) => p.id),
    page: Object.fromEntries(pages.map((p) => [p.id, { ...p, free: [] as string[] }])),
    block: {},
    asset: { a1b2c3d4: { mime: 'image/png', w: 400, h: 300, bytes: 4 } },
    rules: [],
  }
  for (const block of blocks) {
    doc.block[block.id] = block
    if ('page' in block) doc.page[block.page]!.free.push(block.id)
  }
  return validateDoc(doc)
}

/** The note after settling these blocks, and the operations. */
function settled(doc: Doc, touched: string[] = Object.keys(doc.block)): { after: Doc; ops: ReturnType<typeof settle> } {
  const ops = settle(doc, touched)
  return { after: ops.length === 0 ? doc : apply(doc, ops).doc, ops }
}

const at = (doc: Doc, id: string): FreeBlock => doc.block[id] as FreeBlock

describe('a thing lying across a page line', () => {
  it('moves whole to the top of the next page’s writing area, and nothing else moves when there is room', () => {
    const doc = note([page('p1'), page('p2')], [ink('w', 'p1', 3000, 27000, 4000, 1200), ink('k', 'p2', 3000, 15000, 4000, 1000)])
    const { after } = settled(doc, ['w'])
    expect(at(after, 'w')).toMatchObject({ page: 'p2', x: 3000, y: TOP })
    expect(at(after, 'k')).toMatchObject({ page: 'p2', y: 15000 })
  })

  it('leaves a page’s top margin to write in: a line from it down into the writing area stays where it is', () => {
    const doc = note([page('p1')], [ink('t', 'p1', 3000, 600, 9000, 2400), picture('g', 'p1', 2000, 1000, 5000, 3000)])
    expect(settle(doc, ['t', 'g'])).toEqual([])
  })

  it('leaves alone what lies in the writing area, or wholly in a margin', () => {
    const doc = note([page('p1')], [ink('a', 'p1', 3000, 10000, 4000, 1000), ink('b', 'p1', 3000, 28000, 4000, 1000), ink('c', 'p1', 3000, 500, 4000, 1000)])
    expect(settle(doc, ['a', 'b', 'c'])).toEqual([])
  })

  it('moves everything lower on the next page down together, by just enough, when its place is taken', () => {
    const doc = note(
      [page('p1'), page('p2')],
      [ink('w', 'p1', 3000, 27000, 4000, 1200), frame('f', 'p2', 2000, 2000, 8000, 4000), picture('g', 'p2', 12000, 2000, 5000, 4000), ink('z', 'p2', 2000, 20000, 3000, 1000)],
    )
    const { after } = settled(doc, ['w'])
    const by = TOP + 1200 + MAKE_ROOM_GAP - 2000
    expect(at(after, 'w')).toMatchObject({ page: 'p2', y: TOP })
    // The paragraph and the picture beside it stay side by side, and what is further down keeps its gap.
    expect(at(after, 'f').y).toBe(2000 + by)
    expect(at(after, 'g').y).toBe(2000 + by)
    expect(at(after, 'z').y).toBe(20000 + by)
  })

  it('takes the words on its line with it, and what it touches, keeping where they lie to each other', () => {
    const doc = note(
      [page('p1'), page('p2')],
      [ink('a', 'p1', 3000, 27400, 2500, 900), ink('b', 'p1', 6500, 27300, 2500, 380), ink('box', 'p1', 12000, 24000, 4000, 3000), ink('arrow', 'p1', 13000, 26900, 300, 1300)],
    )
    const { after } = settled(doc, ['a', 'arrow'])
    // All four go as one, the box's top at the top of the writing area: what sat side by side still does.
    expect(at(after, 'box')).toMatchObject({ page: 'p2', y: TOP })
    expect(at(after, 'arrow')).toMatchObject({ page: 'p2', y: TOP + 26900 - 24000 })
    expect(at(after, 'a')).toMatchObject({ page: 'p2', y: TOP + 27400 - 24000 })
    expect(at(after, 'b')).toMatchObject({ page: 'p2', y: TOP + 27300 - 24000 })
  })

  it('reaching over the top of its page, comes down onto that page’s writing area', () => {
    const doc = note([page('p1')], [ink('u', 'p1', 3000, -500, 4000, 1500), ink('k', 'p1', 3000, 2500, 4000, 1000)])
    const { after } = settled(doc, ['u'])
    expect(at(after, 'u')).toMatchObject({ page: 'p1', y: TOP })
    expect(at(after, 'k').y).toBe(TOP + 1500 + MAKE_ROOM_GAP)
  })

  it('makes a page like the last at the end when there is none after', () => {
    const doc = note([{ ...page('p1', { w: 14800, h: 21000 }), bg: 'dots' }], [ink('w', 'p1', 3000, 18500, 3000, 1000)])
    const { after } = settled(doc, ['w'])
    expect(after.pages).toHaveLength(2)
    const added = after.page[after.pages[1]!]!
    expect(added).toMatchObject({ w: 14800, h: 21000, bg: 'dots' })
    expect(at(after, 'w')).toMatchObject({ page: added.id, y: TOP })
  })

  it('carries on down the pages: what is pushed across the next page’s line moves on in turn', () => {
    const doc = note([page('p1'), page('p2')], [ink('w', 'p1', 3000, 27000, 4000, 3000), ink('low', 'p2', 3000, 4000, 4000, 23000)])
    const { after } = settled(doc, ['w'])
    expect(at(after, 'w')).toMatchObject({ page: 'p2', y: TOP })
    expect(at(after, 'low')).toMatchObject({ page: after.pages[2], y: TOP })
  })

  it('never moves a frame of typed text, whose lines flow by their own rule', () => {
    const doc = note([page('p1')], [frame('f', 'p1', 2000, 26000, 17000, 3000)])
    expect(settle(doc, ['f'])).toEqual([])
  })

  it('settles the same way every time, and once settled, settles no further', () => {
    const doc = note([page('p1')], [ink('t', 'p1', 3000, 5000, 200, 40000), ink('w', 'p1', 9000, 27000, 4000, 1500)])
    expect(settle(doc, ['t', 'w'])).toEqual(settle(doc, ['t', 'w']))
    const { after } = settled(doc, ['t', 'w'])
    expect(settle(after, Object.keys(after.block))).toEqual([])
  })

  it('is one change that undo takes back exactly', () => {
    const doc = note([page('p1'), page('p2')], [ink('w', 'p1', 3000, 27000, 4000, 1200), frame('f', 'p2', 2000, 2000, 8000, 4000)])
    const ops = settle(doc, ['w'])
    const done = apply(doc, ops)
    expect(sameContent(apply(done.doc, done.inverse).doc, doc)).toBe(true)
  })
})

describe('something taller than a whole writing area', () => {
  it('is cut at the line when it is ink, the two parts meeting at the same point', () => {
    const doc = note([page('p1'), page('p2')], [ink('t', 'p1', 3000, 5000, 400, 30000)])
    const { after } = settled(doc, ['t'])
    const top = after.block.t as InkBlock
    const rest = Object.values(after.block).find((b): b is InkBlock => b.type === 'ink' && b.id !== 't')!
    expect(rest.page).toBe('p2')
    // The last point of the part above lies on the line; the first of the part below at the top of the next page.
    const lastAbove = top.strokes[0]!.pts.slice(-3)
    const firstBelow = rest.strokes[0]!.pts.slice(0, 3)
    expect(top.y + lastAbove[1]!).toBe(LINE)
    expect(rest.y + firstBelow[1]!).toBe(TOP)
    expect(top.x + lastAbove[0]!).toBe(rest.x + firstBelow[0]!)
    expect(lastAbove[2]).toBe(firstBelow[2])
    expect(liesInOneBand(top, after.page.p1!)).toBe(true)
    expect(liesInOneBand(rest, after.page.p2!)).toBe(true)
  })

  it('is cut on each page it runs over', () => {
    const doc = note([page('p1')], [ink('t', 'p1', 3000, 3000, 400, 70000)])
    const { after } = settled(doc, ['t'])
    expect(after.pages.length).toBeGreaterThanOrEqual(3)
    for (const block of Object.values(after.block)) {
      if (isPlacedBlock(block)) expect(liesInOneBand(block, after.page[block.page]!)).toBe(true)
    }
  })

  it('is made smaller to fit, keeping its shape, when it is a picture', () => {
    const doc = note([page('p1'), page('p2')], [picture('g', 'p1', 2000, 3000, 12000, 30000)])
    const { after } = settled(doc, ['g'])
    const g = at(after, 'g')
    expect(g).toMatchObject({ page: 'p2', y: TOP, h: LINE - TOP })
    expect(g.w).toBe(Math.round((12000 * (LINE - TOP)) / 30000))
  })
})

describe('a stroke split at a line', () => {
  const stroke: Stroke = { pts: [0, 0, 100, 1000, 2000, 200, 2000, 0, 50], color: 'red', width: 'l', tilt: [10, 30, 50], shape: { kind: 'line', key: [0, 0, 1, 1] } }

  it('keeps every point on its side, adds the crossing to both parts, and drops the shape it no longer is', () => {
    const { above, below } = splitStrokeAt(stroke, 1000)
    expect(above.map((s) => s.pts)).toEqual([
      [0, 0, 100, 500, 1000, 150],
      [1500, 1000, 125, 2000, 0, 50],
    ])
    expect(below.map((s) => s.pts)).toEqual([[500, 1000, 150, 1000, 2000, 200, 1500, 1000, 125]])
    expect(above[0]!.tilt).toEqual([10, 20])
    for (const part of [...above, ...below]) {
      expect(part.shape).toBeUndefined()
      expect(part).toMatchObject({ color: 'red', width: 'l' })
    }
  })

  it('leaves a stroke on one side whole', () => {
    expect(splitStrokeAt(stroke, 5000).above).toEqual([{ pts: stroke.pts, color: 'red', width: 'l', tilt: [10, 30, 50] }])
    expect(splitStrokeAt(stroke, -1).below).toHaveLength(1)
  })
})

describe('settling any note', () => {
  const SIZES = [
    { w: 21000, h: 29700 },
    { w: 29700, h: 21000 },
    { w: 14800, h: 21000 },
    { w: 10500, h: 14800 },
    { w: 21590, h: 27940 },
  ]
  const thing = fc.record({ kind: fc.constantFrom('ink', 'ink', 'image', 'frame'), page: fc.nat(2), x: fc.integer({ min: 0, max: 15000 }), y: fc.integer({ min: -3000, max: 32000 }), w: fc.integer({ min: 100, max: 6000 }), h: fc.integer({ min: 100, max: 45000 }) })
  const notes = fc.record({ size: fc.constantFrom(...SIZES), pages: fc.integer({ min: 1, max: 3 }), things: fc.array(thing, { minLength: 1, maxLength: 9 }) })

  const make = ({ size, pages, things }: { size: { w: number; h: number }; pages: number; things: { kind: string; page: number; x: number; y: number; w: number; h: number }[] }): Doc => {
    const list = Array.from({ length: pages }, (_, i) => page(`p${i + 1}`, size))
    const blocks = things.map((t, i) => {
      const on = `p${Math.min(t.page, pages - 1) + 1}`
      return t.kind === 'ink' ? ink(`k${i}`, on, t.x, t.y, t.w, t.h) : t.kind === 'image' ? picture(`g${i}`, on, t.x, t.y, t.w, t.h) : frame(`f${i}`, on, t.x, Math.max(0, t.y), t.w, Math.min(t.h, 6000))
    })
    return note(list, blocks)
  }
  const strict = (a: FreeBlock, b: FreeBlock): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  it('loses nothing, crosses no line, piles nothing up, and undoes exactly', () => {
    fc.assert(
      fc.property(notes, (spec) => {
        const doc = make(spec)
        const ops = settle(doc, Object.keys(doc.block))
        const done = apply(doc, ops)
        const after = done.doc
        // Nothing lost: every block is still there, its kind and what it shows kept; ink only ever gains points.
        let before = 0
        let now = 0
        for (const block of Object.values(doc.block)) {
          const kept = after.block[block.id]
          expect(kept?.type).toBe(block.type)
          if (block.type === 'image') expect(kept).toMatchObject({ asset: block.asset })
          if (block.type === 'ink') before += block.strokes.reduce((n, s) => n + s.pts.length, 0)
        }
        for (const block of Object.values(after.block)) if (block.type === 'ink') now += block.strokes.reduce((n, s) => n + s.pts.length, 0)
        expect(now).toBeGreaterThanOrEqual(before)
        // No line runs through anything placed.
        for (const block of Object.values(after.block)) if (isPlacedBlock(block)) expect(liesInOneBand(block, after.page[block.page]!)).toBe(true)
        // Nothing is put over something it was not over before, as it lay then.
        const free = Object.values(after.block).filter((b): b is FreeBlock => 'page' in b)
        for (const a of free) {
          for (const b of free) {
            if (a.id >= b.id || a.page !== b.page || !strict(a, b)) continue
            const was = [doc.block[a.id], doc.block[b.id]] as (FreeBlock | undefined)[]
            if (!was[0] || !was[1] || (a.type === 'ink' && a.strokes !== (was[0] as InkBlock).strokes) || (b.type === 'ink' && b.strokes !== (was[1] as InkBlock).strokes)) continue
            if (a.w !== was[0].w || b.w !== was[1].w) continue
            expect(strict(was[0], was[1])).toBe(true)
            expect([a.x - b.x, a.y - b.y]).toEqual([was[0].x - was[1].x, was[0].y - was[1].y])
          }
        }
        // Settled once is settled; and undo brings back the very note.
        expect(settle(after, Object.keys(after.block))).toEqual([])
        expect(sameContent(apply(after, done.inverse).doc, doc)).toBe(true)
        // A cut leaves each part's body within its band.
        for (const block of Object.values(after.block)) if (block.type === 'ink') expect(bodyOf(block).h).toBeLessThanOrEqual(after.page[block.page]!.h)
      }),
      { numRuns: 400 },
    )
  })
})
