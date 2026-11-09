// Straight lines and shapes, on synthetic hand-drawn strokes: each shape is
// found across many hands (seeds), and curves, handwriting and scribbles are
// left alone.
import { describe, expect, it } from 'vitest'
import { pathLength } from '../../src/ink/geometry.js'
import { drawShape, recognise, straightLine } from '../../src/ink/shapes.js'
import { around, cursive, drawn, zigzag } from './strokes.js'

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const kindOf = (points: ReturnType<typeof drawn>, held = true): string | undefined => recognise(points, held)?.kind

/** How many of the seeds give `kind`. */
function rate(make: (seed: number) => ReturnType<typeof drawn>, kind: string): number {
  return SEEDS.filter((seed) => kindOf(make(seed)) === kind).length / SEEDS.length
}

describe("the brief's straight-line rule", () => {
  it('straightens lines drawn by hand, and snaps them level within 4°', () => {
    for (const seed of SEEDS) {
      const line = straightLine(drawn([{ x: 0, y: 0 }, { x: 8000, y: 300 }], { jitter: 15, wobble: 0.004, seed }))
      expect(line, `seed ${seed}`).toBeDefined()
      expect(Math.round(line!.b.y)).toBe(Math.round(line!.a.y))
    }
  })

  it('leaves curves, short strokes and handwriting alone', () => {
    expect(straightLine(drawn([{ x: 0, y: 0 }, { x: 4000, y: 600 }, { x: 8000, y: 0 }]))).toBeUndefined()
    expect(straightLine(drawn([{ x: 0, y: 0 }, { x: 800, y: 0 }]))).toBeUndefined()
    expect(straightLine(cursive(0, 0, 5))).toBeUndefined()
  })
})

describe('shapes, when the pen is held', () => {
  it('finds each shape as people draw it', () => {
    const rates = {
      line: rate((seed) => drawn([{ x: 0, y: 0 }, { x: 6000, y: 2500 }], { seed, wobble: 0.01 }), 'line'),
      circle: rate((seed) => drawn(around(3000, 3000, 2000, 2000, seed), { seed, wobble: 0.02 }), 'circle'),
      ellipse: rate((seed) => drawn(around(4000, 3000, 3500, 1600, seed), { seed, wobble: 0.015 }), 'ellipse'),
      triangle: rate((seed) => drawn([{ x: 0, y: 4000 }, { x: 2500, y: 0 }, { x: 5000, y: 4000 }, { x: 60, y: 3950 }], { seed, wobble: 0.005 }), 'triangle'),
      rect: rate((seed) => drawn([{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 0, y: 3000 }, { x: 40, y: 60 }], { seed, wobble: 0.004 }), 'rect'),
      square: rate((seed) => drawn([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 }, { x: 40, y: 60 }], { seed, wobble: 0.004 }), 'square'),
      arrow: rate((seed) => drawn([{ x: 0, y: 0 }, { x: 7000, y: 0 }, { x: 6000, y: 700 }], { seed }), 'arrow'),
      arc: rate((seed) => drawn(around(3000, 3000, 2500, 2500, Math.PI, -0.5), { seed, wobble: 0.01 }), 'arc'),
      star: rate((seed) => {
        const tips = Array.from({ length: 11 }, (_, i) => {
          const r = i % 2 === 0 ? 3000 : 1150
          const a = -Math.PI / 2 + (i * Math.PI) / 5
          return { x: 3000 + r * Math.cos(a), y: 3000 + r * Math.sin(a) }
        })
        return drawn(tips, { seed, jitter: 10 })
      }, 'star'),
      rhombus: rate((seed) => drawn([{ x: 2500, y: 0 }, { x: 5000, y: 1600 }, { x: 2500, y: 3200 }, { x: 0, y: 1600 }, { x: 2480, y: 40 }], { seed, wobble: 0.004 }), 'rhombus'),
      pentagon: rate((seed) => drawn(Array.from({ length: 6 }, (_, i) => ({ x: 3000 + 2500 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5), y: 3000 + 2500 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5) })), { seed, wobble: 0.004 }), 'polygon'),
      angle: rate((seed) => drawn([{ x: 0, y: 0 }, { x: 2000, y: 4000 }, { x: 4000, y: 0 }], { seed }), 'polygon'),
      curve: rate((seed) => drawn(Array.from({ length: 41 }, (_, i) => ({ x: i * 150, y: 1500 * Math.sin((i / 40) * 2 * Math.PI) })), { seed, wobble: 0.005 }), 'curve'),
      heart: rate((seed) => {
        const edge = Array.from({ length: 81 }, (_, i) => {
          const t = (i / 80) * 2 * Math.PI
          return { x: 3000 + 160 * 16 * Math.sin(t) ** 3, y: 3000 - 160 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) }
        })
        return drawn(edge, { seed, wobble: 0.01 })
      }, 'heart'),
      cloud: rate((seed) => {
        // Eight bumps round an ellipse, meeting in notches.
        const edge = Array.from({ length: 161 }, (_, i) => {
          const t = (i / 160) * 2 * Math.PI
          const bump = 1 + 0.12 * Math.abs(Math.sin(4 * t))
          return { x: 4000 + 3500 * bump * Math.cos(t), y: 3000 + 2200 * bump * Math.sin(t) }
        })
        return drawn(edge, { seed, wobble: 0.005 })
      }, 'cloud'),
    }
    for (const [kind, found] of Object.entries(rates)) expect(found, kind).toBeGreaterThanOrEqual(0.9)
  })

  it('is quick enough to run as the pen lifts', () => {
    const strokes = SEEDS.flatMap((seed) => [drawn(around(3000, 3000, 2000, 2000, seed), { seed, wobble: 0.02 }), cursive(0, 0, 6, seed)])
    const start = performance.now()
    for (const stroke of strokes) recognise(stroke)
    expect((performance.now() - start) / strokes.length).toBeLessThan(5)
  })

  it('never smooths a sharp corner into a curve', () => {
    for (const seed of SEEDS) {
      // A tent with bowed sides: an angle, or left as drawn, never a curve.
      const tent = drawn([{ x: 0, y: 4000 }, { x: 1200, y: 1500 }, { x: 2500, y: 0 }, { x: 3800, y: 1500 }, { x: 5000, y: 4000 }].map((pt, i) => (i % 2 === 1 ? { x: pt.x - 250, y: pt.y } : pt)), { seed, wobble: 0.01 })
      expect(kindOf(tent), `tent ${seed}`).not.toBe('curve')
      expect(kindOf(tent), `tent ${seed}`).not.toBe('arc')
    }
  })

  it('leaves handwriting and scribbles as drawn', () => {
    for (const seed of SEEDS) {
      expect(kindOf(cursive(0, 0, 6, seed)), `cursive ${seed}`).toBeUndefined()
      expect(kindOf(cursive(0, 0, 3, seed)), `short cursive ${seed}`).toBeUndefined()
      expect(kindOf(zigzag(0, 0, 4000, 600, 6, seed)), `zigzag ${seed}`).toBeUndefined()
    }
  })

  it('draws a shape out again from its key, closed shapes closed', () => {
    const circle = drawShape('circle', [0, 0, 1000])
    expect(circle[0]).toEqual(expect.objectContaining({ x: 1000, y: 0 }))
    expect(Math.abs(pathLength(circle) - 2 * Math.PI * 1000)).toBeLessThan(40)
    // Traced every 0.5 mm it would have 126 points.
    expect(circle.length).toBeLessThan(126 / 2 + 1)
    const square = drawShape('square', [0, 0, 1000, 0, 1000, 1000, 0, 1000], 140)
    expect(square.at(-1)).toEqual({ x: 0, y: 0, p: 140 })
    for (const kind of ['line', 'arrow', 'arc', 'curve', 'triangle', 'rect', 'rhombus', 'polygon', 'star', 'ellipse', 'heart', 'cloud', 'bubble'] as const) {
      const key = { line: [0, 0, 1000, 0], arrow: [0, 0, 1000, 0, 300], arc: [0, 0, 1000, 0, 2000], curve: [0, 0, 500, 400, 1000, 0], triangle: [0, 0, 1000, 0, 500, 800], rect: [0, 0, 1000, 0, 1000, 500, 0, 500], rhombus: [500, 0, 1000, 500, 500, 1000, 0, 500], polygon: [0, 0, 1000, 0, 1000, 1000], star: [0, 0, 1000, 400, 0], ellipse: [0, 0, 1000, 500, 0], heart: [0, 0, 1000, 1000], cloud: [0, 0, 1000, 600], bubble: [0, 0, 1000, 800] }[kind]
      const points = drawShape(kind, key)
      // Only the points that change the line are kept: a line is its two ends.
      if (kind === 'line') expect(points).toEqual([{ x: 0, y: 0, p: 128 }, { x: 1000, y: 0, p: 128 }])
      else expect(points.length, kind).toBeGreaterThan(2)
      expect(points.every((pt) => Number.isInteger(pt.x) && Number.isInteger(pt.y)), kind).toBe(true)
    }
  })
})
