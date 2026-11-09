// The general rules judge a stroke at the size the hand drew it on the screen
// (the pen review's R5, 16 October 2026), as the learner does, whatever the
// page's zoom; what they make is kept in the page's units. Before, at 400 % a
// line drawn 30 mm long on the screen was 7.5 mm on the page, too short to
// straighten, and at 50 % a letter's 8 mm stroke was 16 mm, long enough.
import { describe, expect, it } from 'vitest'
import { boxOf, type Pt } from '../../src/ink/geometry.js'
import { heldShape, scratchTest, straightOnLift } from '../../src/ink/learn.js'
import { symbolOf } from '../../src/ink/symbols.js'
import { drawn } from './strokes.js'

/** A stroke drawn on the screen, as it lands on a page shown at `zoom` (4 is 400 %). */
const atZoom = (points: readonly Pt[], zoom: number): Pt[] => points.map((pt) => ({ ...pt, x: pt.x / zoom, y: pt.y / zoom }))

describe('the rules, at any zoom', () => {
  it('straighten a line drawn 30 mm long on the screen at 400 %, kept at its 7.5 mm on the page', () => {
    const screen = drawn([{ x: 1000, y: 1000 }, { x: 4000, y: 1050 }], { jitter: 4, seed: 3 })
    const page = atZoom(screen, 4)
    const line = straightOnLift(page, { zoom: 4 })
    expect(line).toBeDefined()
    expect(line!.a.x).toBeCloseTo(page[0]!.x, 0)
    expect(Math.hypot(line!.b.x - line!.a.x, line!.b.y - line!.a.y)).toBeCloseTo(750, -1)
    // Judged on the page, as before: too short.
    expect(straightOnLift(page)).toBeUndefined()
  })

  it('leave alone a letter stroke drawn 8 mm long on the screen at 50 %, 16 mm on the page', () => {
    const screen = drawn([{ x: 1000, y: 1000 }, { x: 1800, y: 1020 }], { jitter: 3, seed: 5 })
    const page = atZoom(screen, 0.5)
    expect(straightOnLift(page, { zoom: 0.5 })).toBeUndefined()
    // Judged on the page, as before: long enough, and it was straightened.
    expect(straightOnLift(page)).toBeDefined()
  })

  it('snap a circle held at 400 % at the size the hand drew it, kept at its size on the page', () => {
    const ring = Array.from({ length: 41 }, (_, i) => ({ x: 3000 + 1000 * Math.cos((i / 40) * 2 * Math.PI), y: 3000 + 1000 * Math.sin((i / 40) * 2 * Math.PI) }))
    const page = atZoom(drawn(ring, { jitter: 4, seed: 7 }), 4)
    const shape = heldShape(page, { zoom: 4 })
    expect(shape?.kind).toBe('circle')
    // [cx, cy, r] on the page: a quarter of the 10 mm the hand drew.
    expect(shape!.key[2]).toBeCloseTo(250, -1)
    const box = boxOf(shape!.points)
    expect(box.w).toBeGreaterThan(450)
    expect(box.w).toBeLessThan(550)
  })

  it('take a small zigzag at 50 % for no scratch-out: it is 2.1 mm corner to corner on the screen, 4.2 mm on the page', () => {
    const zigzag = drawn([{ x: 1000, y: 1000 }, { x: 1150, y: 1030 }, { x: 1000, y: 1060 }, { x: 1150, y: 1090 }, { x: 1000, y: 1120 }, { x: 1150, y: 1150 }], { jitter: 1, seed: 9 })
    const page = atZoom(zigzag, 0.5)
    expect(scratchTest({ zoom: 0.5 })(page)).toBe(false)
    expect(scratchTest()(page)).toBe(true)
  })

  it('find a bracket drawn at 400 % and keep it at its size on the page', () => {
    // An opening bracket "(" 9 mm tall on the screen.
    const arc = Array.from({ length: 25 }, (_, i) => {
      const a = Math.PI / 2 + (i / 24) * Math.PI
      return { x: 2000 + 250 * Math.cos(a) * 1.2, y: 2000 - 450 * Math.sin(a) }
    })
    const page = atZoom(drawn(arc, { jitter: 2, seed: 11 }), 4)
    const symbol = symbolOf(page, ['paren', 'bracket', 'brace', 'comma', 'at'], [], { zoom: 4 })
    expect(symbol?.kind).toBe('paren')
    // [x, y, w, h, side] on the page: 9 mm drawn, 2.25 mm kept.
    expect(symbol!.key[3]).toBeGreaterThan(180)
    expect(symbol!.key[3]).toBeLessThan(260)
  })
})
