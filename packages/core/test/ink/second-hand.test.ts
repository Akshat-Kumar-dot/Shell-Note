// A second, made-up hand, unlike the person's: bigger, slanted writing, its own
// brackets, commas, shapes, lines, scratch-outs and shading. Taught as Teach my
// pen teaches (taughtProfile: the measures on this hand's own footing, the
// margins worked out from its own strokes), it must be learned as well as the
// is (recordings.test.ts): strokes it has never seen, drawn the same way, are found,
// and its writing left alone.
import { describe, expect, it } from 'vitest'
import { exampleOf, FAMILY, heldShape, Learner, PenProfile, PointFilter, scratchTest, straightOnLift, symbolOf, taughtProfile, type InkLabel, type PenExample, type Pt, type Taught } from '../../src/index.js'
import { around, cursive, drawn, random } from './strokes.js'

const smoothed = (points: readonly Pt[]): Pt[] => {
  const filter = new PointFilter(1)
  return points.map((pt, i) => filter.add({ ...pt, t: i * 4 }))
}
/** This hand: everything 1.6 times the size, leaning right. */
const hand = (points: readonly { x: number; y: number }[]): { x: number; y: number }[] => points.map((pt) => ({ x: 1.6 * (pt.x + 0.35 * (3000 - pt.y)), y: 1.6 * pt.y }))
const as = (corners: readonly { x: number; y: number }[], seed: number, jitter = 8): Pt[] => smoothed(drawn(hand(corners), { seed, jitter, wobble: 0.01 }))

const writing = (seed: number): Pt[] => {
  const rand = random(seed)
  return smoothed(cursive(1000 + rand() * 3000, 3000, 1 + (seed % 5), seed).map((pt) => ({ ...hand([pt])[0]!, p: pt.p })))
}
const STROKES: Record<string, (seed: number) => Pt[]> = {
  paren0: (seed) => as([{ x: 300, y: 0 }, { x: 60, y: 300 }, { x: 0, y: 550 }, { x: 60, y: 800 }, { x: 300, y: 1100 }], seed),
  paren1: (seed) => as([{ x: 0, y: 0 }, { x: 240, y: 300 }, { x: 300, y: 550 }, { x: 240, y: 800 }, { x: 0, y: 1100 }], seed),
  bracket0: (seed) => as([{ x: 350, y: 0 }, { x: 0, y: 20 }, { x: 10, y: 1100 }, { x: 360, y: 1090 }], seed),
  bracket1: (seed) => as([{ x: 0, y: 0 }, { x: 350, y: 20 }, { x: 340, y: 1100 }, { x: -10, y: 1090 }], seed),
  comma: (seed) => as([{ x: 60, y: 0 }, { x: 70, y: 120 }, { x: 30, y: 260 }, { x: -40, y: 360 }], seed, 4),
  ellipse: (seed) => as(around(3000, 3000, 2200, 1300, seed / 3), seed),
  rect: (seed) => as([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2500 }, { x: 0, y: 2500 }, { x: 0, y: 30 }], seed),
  triangle: (seed) => as([{ x: 2000, y: 0 }, { x: 4000, y: 3200 }, { x: 0, y: 3200 }, { x: 1980, y: 40 }], seed),
  arrow: (seed) => as([{ x: 0, y: 3000 }, { x: 4000, y: 1000 }, { x: 3300, y: 900 }, { x: 4000, y: 1000 }, { x: 3700, y: 1600 }], seed),
  line: (seed) => as([{ x: 0, y: 1000 + (seed % 7) * 60 }, { x: 5000, y: 1500 }], seed),
  scratch: (seed) => as(Array.from({ length: 11 }, (_, i) => ({ x: 1000 + (i % 2) * 1800, y: 1000 + i * 50 })), seed),
  shade: (seed) => as(Array.from({ length: 13 }, (_, k) => ({ x: (k % 2) * 3000, y: (3000 * k) / 12 + (k % 2) * 500 })), seed),
}
const SYMBOLS = ['paren0', 'paren1', 'bracket0', 'bracket1', 'comma'] as const
const SHAPES = ['ellipse', 'rect', 'triangle', 'arrow'] as const

/** What this hand recorded: 6 of each thing, and 320 strokes of writing. */
function recorded(): PenExample[] {
  const examples: PenExample[] = []
  for (const [label, make] of Object.entries(STROKES)) for (let seed = 1; seed <= 6; seed++) examples.push(exampleOf(label as InkLabel, make(seed), 'recorder')!)
  for (let seed = 1; seed <= 320; seed++) examples.push(exampleOf('none', writing(seed), 'recorder')!)
  return examples
}

describe('a second hand, taught by Teach my pen', () => {
  const profile = taughtProfile(undefined, recorded(), new Date(0))
  const taught: Taught = { learner: Learner.of(profile), zoom: 1 }
  // Strokes it has not seen: other seeds.
  const fresh = Array.from({ length: 10 }, (_, i) => 100 + i)
  const unseen = Array.from({ length: 200 }, (_, i) => writing(1000 + i))

  it('keeps margins worked out from its own strokes, as whole thousandths', () => {
    expect(profile.tuned).toBeDefined()
    expect(PenProfile.parse(profile)).toEqual(profile)
    for (const margin of Object.values(profile.tuned!)) expect(Number.isInteger(margin) && margin >= 1000).toBe(true)
  })

  it('finds its symbols, at least 90 %, never as another, and takes under 1 % of its writing', () => {
    const symbol = (points: Pt[]): string => {
      const shape = symbolOf(points, ['paren', 'bracket', 'brace', 'comma', 'at'], [], taught)
      return shape ? `${shape.kind}${shape.key[4] ?? ''}` : 'none'
    }
    const got = SYMBOLS.flatMap((label) => fresh.map((seed) => [label, symbol(STROKES[label]!(seed))] as const))
    expect(got.filter(([label, g]) => g === label).length / got.length).toBeGreaterThanOrEqual(0.9)
    expect(got.filter(([label, g]) => g !== 'none' && g !== label)).toEqual([])
    expect(unseen.filter((points) => symbol(points) !== 'none').length).toBeLessThanOrEqual(2)
  })

  it('snaps its held shapes to what was drawn, at least 95 %', () => {
    const got = SHAPES.flatMap((label) => fresh.map((seed) => [label, heldShape(STROKES[label]!(seed), taught)] as const))
    const right = got.filter(([label, shape]) => shape && FAMILY[shape.kind] === label).length
    expect(right / got.length).toBeGreaterThanOrEqual(0.95)
  })

  it('straightens its lines and leaves its writing alone', () => {
    expect(fresh.every((seed) => straightOnLift(STROKES.line!(seed), taught) !== undefined)).toBe(true)
    expect(unseen.filter((points) => straightOnLift(points, taught)).length).toBeLessThanOrEqual(2)
  })

  it('takes its scratch-outs, at least 90 %, and neither its shading nor under 1 % of its writing', () => {
    const test = scratchTest(taught)
    expect(fresh.filter((seed) => test(STROKES.scratch!(seed))).length).toBeGreaterThanOrEqual(9)
    expect(fresh.filter((seed) => test(STROKES.shade!(seed)))).toEqual([])
    expect(unseen.filter((points) => test(points)).length).toBeLessThanOrEqual(2)
  })
})
