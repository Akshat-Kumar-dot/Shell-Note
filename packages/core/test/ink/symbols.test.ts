// Symbols neatened as the pen lifts: ( ) [ ] { } , @, each found as hands
// draw it, and the letters that look alike (c, l, L, 3, a, e, o, g, J, 1, an
// O gone over twice) left alone. Strokes go through the pen's smoothing first,
// as in the app.
import { describe, expect, it } from 'vitest'
import { drawShape, PointFilter, symbolOf, type Pt, type SymbolKind } from '../../src/index.js'
import { around, cursive, drawn, zigzag } from './strokes.js'

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const ALL: SymbolKind[] = ['paren', 'bracket', 'brace', 'comma', 'at']

/** A stroke as the pen's live layer keeps it: smoothed, a sample every 4 ms. */
const smoothed = (points: readonly Pt[]): Pt[] => {
  const filter = new PointFilter(1)
  return points.map((pt, i) => filter.add({ ...pt, t: i * 4 }))
}
/** A symbol as a hand draws it: its neat outline, with jitter and a slow wobble. */
const symbol = (kind: SymbolKind, key: number[]) => (seed: number) => smoothed(drawn(drawShape(kind, key).map(({ x, y }) => ({ x, y })), { seed, jitter: 8, wobble: 0.01 }))
const found = (points: Pt[], on = ALL): string => {
  const shape = symbolOf(points, on)
  return shape ? `${shape.kind}${shape.key[4] ?? ''}` : 'none'
}

describe('symbols on lifting', () => {
  it('finds each symbol, and which way a bracket opens', () => {
    const cases: [string, (seed: number) => Pt[]][] = [
      ['paren0', symbol('paren', [0, 0, 250, 900, 0])],
      ['paren1', symbol('paren', [0, 0, 250, 900, 1])],
      ['bracket0', symbol('bracket', [0, 0, 250, 900, 0])],
      ['bracket1', symbol('bracket', [0, 0, 250, 900, 1])],
      ['brace0', symbol('brace', [0, 0, 300, 900, 0])],
      ['brace1', symbol('brace', [0, 0, 300, 900, 1])],
      ['comma', symbol('comma', [0, 0, 90, 220])],
      ['at', symbol('at', [0, 0, 900, 900])],
    ]
    for (const [want, make] of cases) {
      const rate = SEEDS.filter((seed) => found(make(seed)) === want).length / SEEDS.length
      expect(rate, want).toBeGreaterThanOrEqual(0.9)
    }
  })

  it('leaves letters that look alike as they are', () => {
    const letters: Record<string, (seed: number) => Pt[]> = {
      c: (seed) => drawn(around(300, 300, 280, 300, -0.6, -0.2).slice(0, 68), { seed, jitter: 8 }),
      l: (seed) => drawn([{ x: 100, y: 0 }, { x: 60, y: 450 }, { x: 40, y: 900 }, { x: 90, y: 960 }], { seed, jitter: 8 }),
      L: (seed) => drawn([{ x: 0, y: 0 }, { x: 0, y: 900 }, { x: 450, y: 900 }], { seed, jitter: 8 }),
      '3': (seed) => drawn([...around(220, 220, 220, 220, -2.6, -0.62).slice(0, 62), ...around(220, 660, 240, 240, -1.6, -0.55).slice(0, 62)], { seed, jitter: 8 }),
      a: (seed) => drawn([...around(250, 300, 230, 280, -0.3, 0).slice(0, 81), { x: 480, y: 50 }, { x: 480, y: 560 }, { x: 540, y: 600 }], { seed, jitter: 8 }),
      o: (seed) => drawn(around(300, 300, 280, 300, -1.5, 0.08), { seed, jitter: 8 }),
      'O twice': (seed) => drawn(around(450, 450, 430, 440, -1.5, 1.0), { seed, jitter: 8 }),
      g: (seed) => drawn([...around(250, 250, 220, 230, -0.3, 0).slice(0, 81), { x: 470, y: 30 }, { x: 470, y: 700 }, ...around(250, 700, 220, 200, 0, -0.5).slice(0, 40)], { seed, jitter: 8 }),
      J: (seed) => drawn([{ x: 300, y: 0 }, { x: 300, y: 600 }, ...Array.from({ length: 13 }, (_, i) => ({ x: 150 + 150 * Math.cos((i / 12) * Math.PI), y: 600 + 220 * Math.sin((i / 12) * Math.PI) }))], { seed, jitter: 8 }),
      '1': (seed) => drawn([{ x: 120, y: 0 }, { x: 100, y: 450 }, { x: 70, y: 900 }], { seed, jitter: 8, wobble: 0.03 }),
      word: (seed) => cursive(0, 0, 5, seed),
      scratch: (seed) => zigzag(0, 0, 3000, 600, 5, seed),
    }
    for (const [name, make] of Object.entries(letters)) {
      for (const seed of SEEDS) expect(found(smoothed(make(seed))), `${name} ${seed}`).toBe('none')
    }
  })

  it('corrects only the symbols switched on', () => {
    const bracket = symbol('bracket', [0, 0, 250, 900, 0])(3)
    expect(found(bracket, ['paren', 'comma'])).toBe('none')
    expect(found(bracket, [])).toBe('none')
    expect(found(bracket, ['bracket'])).toBe('bracket0')
  })

  it('takes a small tick beside big letters for a comma, but not one as big as they are', () => {
    const tick = symbol('comma', [5000, 5000, 120, 300])(4)
    const letters = [0, 1, 2].map((i) => ({ x: 4000 + i * 300, y: 4800, w: 250, h: 600 }))
    expect(found(tick)).toBe('comma')
    expect(symbolOf(tick, ALL, letters)?.kind).toBe('comma')
    const small = [0, 1, 2].map((i) => ({ x: 4000 + i * 300, y: 4950, w: 250, h: 330 }))
    expect(symbolOf(tick, ALL, small)).toBeUndefined()
  })

  it('draws each symbol out again from its box, a comma wider at its head', () => {
    for (const kind of ALL) {
      const key = kind === 'comma' || kind === 'at' ? [0, 0, 400, 900] : [0, 0, 300, 900, 0]
      const points = drawShape(kind, key)
      expect(points.length, kind).toBeGreaterThan(3)
      expect(points.every((pt) => Number.isInteger(pt.x) && Number.isInteger(pt.y)), kind).toBe(true)
    }
    const comma = drawShape('comma', [0, 0, 100, 300])
    expect(comma[0]!.p).toBeGreaterThan(comma.at(-1)!.p * 2)
  })
})
