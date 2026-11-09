// Page overflow: what moves where when a frame runs past the bottom margin.
import { apply, createDoc, MARGIN, type Block, type Doc, type Frame } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { heightOp, overflowOps } from '../src/index.js'

/** A new note whose frame holds five lines, t0 to t4. */
function fiveLines(): { doc: Doc; frame: string } {
  const doc = createDoc()
  const frame = doc.page[doc.pages[0]!]!.free[0]!
  const lines = [0, 1, 2, 3, 4].map((n) => ({ op: 'add' as const, block: { id: `t${n}`, r: 0, type: 'text', parent: frame, role: 'p', indent: 0, md: `Line ${n}` } as Block }))
  return { doc: apply(doc, lines).doc, frame }
}

/** Bottom edges, as drawn, that put lines from `first` on past the margin of an A4 page. */
function bottoms(first: number): Map<string, number> {
  const limit = 29700 - MARGIN
  return new Map([0, 1, 2, 3, 4].map((n) => [`t${n}`, n < first ? limit - 1000 + n * 100 : limit + 100 + n * 100]))
}

describe('a frame that runs past the bottom margin', () => {
  it('has nothing to push while every line fits', () => {
    const { doc, frame } = fiveLines()
    expect(overflowOps(doc, frame, bottoms(5))).toEqual([])
  })

  it('pushes the lines that do not fit, whole, into a new frame on a new page after this one', () => {
    const { doc, frame } = fiveLines()
    const ops = overflowOps(doc, frame, bottoms(3))
    const after = apply(doc, ops).doc
    expect(after.pages).toHaveLength(2)
    const first = after.block[frame] as Frame
    const next = after.block[first.next!] as Frame
    expect(first.kids).toEqual(['t0', 't1', 't2'])
    expect(next.kids).toEqual(['t3', 't4'])
    // At the top of the new page, as wide as the frame it continues.
    expect(next).toMatchObject({ page: after.pages[1], x: first.x, y: MARGIN, w: first.w })
  })

  it('pushes into the continuation frame it already has, in front of what is there', () => {
    const { doc, frame } = fiveLines()
    const once = apply(doc, overflowOps(doc, frame, bottoms(4))).doc
    const twice = apply(once, overflowOps(once, frame, bottoms(3))).doc
    expect(twice.pages).toHaveLength(2)
    expect((twice.block[(twice.block[frame] as Frame).next!] as Frame).kids).toEqual(['t3', 't4'])
  })

  it('uses the next page when it is empty, and never pushes the first line, however tall', () => {
    const { doc, frame } = fiveLines()
    const blank = apply(doc, [{ op: 'page', add: { id: 'p2', w: 21000, h: 29700, bg: 'blank', free: [] } }]).doc
    const after = apply(blank, overflowOps(blank, frame, bottoms(2))).doc
    expect(after.pages).toEqual([doc.pages[0], 'p2'])
    expect(overflowOps(doc, frame, bottoms(0)).filter((op) => op.op === 'move').map((op) => (op as { id: string }).id)).toEqual(['t1', 't2', 't3', 't4'])
  })
})

describe("a frame's height", () => {
  it('is written as drawn when it is more than 1 mm off', () => {
    const { doc, frame } = fiveLines()
    const f = doc.block[frame] as Frame
    expect(heightOp(f, 50)).toBeUndefined()
    expect(heightOp(f, 3456.4)).toEqual({ op: 'update', id: frame, set: { h: 3456 } })
  })
})
