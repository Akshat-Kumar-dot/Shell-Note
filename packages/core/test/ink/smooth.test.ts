// Smoothing that is never late, prediction, and the points a finished stroke keeps.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pathLength, pointsOf, resample, segmentDistance, simplify, triplesOf, type Pt } from '../../src/ink/geometry.js'
import { finish, heldBack, KEEP_CHUNK, KEEP_PRESSURE, KEEP_TOLERANCE, keptIndexes, OneEuro, PointFilter, predict, StrokeModel, type TimedPt } from '../../src/ink/smooth.js'
import { drawn, random } from './strokes.js'

/** A pen moving along y = 0 at `speed` units a millisecond, a point every 4 ms (240 Hz), with jitter. */
function moving(speed: number, count: number, jitter: number, seed = 1): TimedPt[] {
  const rand = random(seed)
  return Array.from({ length: count }, (_, i) => ({ x: i * 4 * speed, y: (rand() - 0.5) * 2 * jitter, p: 128, t: i * 4 }))
}

const spread = (values: readonly number[]): number => {
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
}

describe('the 1€ filter', () => {
  it('passes a still value through unchanged, and starts where the pen starts', () => {
    const filter = new OneEuro(1.5, 0.01)
    expect(filter.filter(500, 0)).toBe(500)
    for (let t = 4; t < 400; t += 4) expect(filter.filter(500, t)).toBeCloseTo(500, 9)
  })

  it('smooths a slow pen a lot, and keeps up with a fast one', () => {
    const level = new PointFilter(2)
    const slow = moving(0.5, 200, 20).map((pt) => level.add(pt))
    // Jitter of ±20 across a slow line: much less of it left.
    expect(spread(slow.slice(20).map((pt) => pt.y))).toBeLessThan(spread(moving(0.5, 200, 20).slice(20).map((pt) => pt.y)) / 2)
    // A fast pen: the filtered point is never far behind the pen.
    const fast = new PointFilter(2)
    const raw = moving(20, 60, 0)
    const out = raw.map((pt) => fast.add(pt))
    expect(raw.at(-1)!.x - out.at(-1)!.x).toBeLessThan(0.15 * 20 * 4 * 3)
  })

  it('is off at level 0: points come back as they went in, pressure blended', () => {
    const off = new PointFilter(0)
    expect(off.add({ x: 10, y: 20, p: 100, t: 0 })).toEqual({ x: 10, y: 20, p: 100, t: 0 })
    expect(off.add({ x: 30, y: 40, p: 200, t: 4 })).toEqual({ x: 30, y: 40, p: 150, t: 4 })
  })

  it('copes with points that share a time stamp', () => {
    const filter = new PointFilter(3)
    filter.add({ x: 0, y: 0, p: 128, t: 10 })
    const pt = filter.add({ x: 100, y: 0, p: 128, t: 10 })
    expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true)
  })
})

describe('prediction', () => {
  it('runs on along a straight line at the same speed', () => {
    const ahead = predict(moving(2, 10, 0), 8)!
    expect(ahead.x).toBeCloseTo(9 * 8 + 16, 6)
    expect(ahead.y).toBe(0)
    expect(ahead.t).toBe(36 + 8)
  })

  it('never jumps further than the pen went in its last step, times the frames ahead', () => {
    const jerk: TimedPt[] = [{ x: 0, y: 0, p: 128, t: 0 }, { x: 1, y: 0, p: 128, t: 4 }, { x: 200, y: 0, p: 128, t: 8 }]
    const ahead = predict(jerk, 8)!
    expect(ahead.x - 200).toBeLessThanOrEqual(199 * 2 + 1e-9)
  })

  it('needs three points', () => {
    expect(predict(moving(2, 2, 0), 8)).toBeUndefined()
  })

  it("keeps the browser's guess when it is near, and holds a wild one to the same reach, in its direction", () => {
    const pens = moving(2, 10, 0)
    // The pen went 8 units in its last 4 ms: 8 ms ahead it may go 16.
    expect(heldBack(pens, { x: 72 + 10, y: 3 }, 8)).toEqual({ x: 82, y: 3 })
    const wild = heldBack(pens, { x: 72 + 9773, y: 0 }, 8)
    expect(wild.x).toBeCloseTo(72 + 16, 9)
    expect(wild.y).toBe(0)
  })

  it('never lets a guess go further than predict would', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.double({ min: -1e5, max: 1e5, noNaN: true }), (speed, gx, gy) => {
        const pens = moving(speed, 6, 0)
        const c = pens.at(-1)!
        const held = heldBack(pens, { x: gx, y: gy }, 8)
        const own = predict(pens, 8)!
        return Math.hypot(held.x - c.x, held.y - c.y) <= Math.hypot(own.x - c.x, own.y - c.y) + 1e-6
      }),
    )
  })
})

describe('a finished stroke', () => {
  it('keeps fewer points, every one it drops within 0.01 mm of the line kept', () => {
    for (const seed of [1, 2, 3]) {
      // As the editor does: the pen's points through the filter at 240 Hz, then finished.
      const filter = new PointFilter(2)
      const stroke = drawn([{ x: 0, y: 0 }, { x: 3000, y: 800 }, { x: 5000, y: 0 }], { seed, jitter: 2, wobble: 0.01 }).map((pt, i) => filter.add({ ...pt, t: i * 4 }))
      const kept = finish(stroke)
      expect(kept.length).toBeLessThan(stroke.length / 2)
      expect(kept[0]).toEqual(stroke[0])
      expect(kept.at(-1)).toEqual(stroke.at(-1))
      // Every dropped point is near some kept segment.
      for (const pt of stroke) {
        const near = Math.min(...kept.slice(1).map((b, i) => segmentDistance(pt, kept[i]!, b)))
        expect(near).toBeLessThanOrEqual(KEEP_TOLERANCE + 1e-9)
      }
    }
  })

  it('keeps a long stroke chunk by chunk: a chunk the pen has moved past never changes, so the live layer works it out once', () => {
    // A long scrawl: 1,000 points, four times round a wobbling loop, as a drawing stroke.
    const filter = new PointFilter(1)
    const stroke = Array.from({ length: 1000 }, (_, i) => filter.add({ x: 5000 + 3000 * Math.cos(i / 40) + 40 * Math.sin(i / 3), y: 5000 + 2000 * Math.sin(i / 40), p: 100 + (i % 50), t: i * 4 }))
    const all = keptIndexes(stroke)
    expect(all[0]).toBe(0)
    expect(all.at(-1)).toBe(999)
    // Worked out from any chunk's start on, the same points as the whole stroke from there.
    for (const from of [KEEP_CHUNK, 3 * KEEP_CHUNK, 7 * KEEP_CHUNK]) expect(keptIndexes(stroke, from)).toEqual(all.filter((i) => i >= from))
    // And with more points after it, a chunk already passed keeps the same points.
    const longer = keptIndexes([...stroke, ...stroke.slice(0, 300)])
    expect(longer.filter((i) => i <= 6 * KEEP_CHUNK)).toEqual(all.filter((i) => i <= 6 * KEEP_CHUNK))
    // About as many points as simplifying the whole stroke in one go (0.8 % more over the person's recorded
    // strokes), and every point left out within 0.01 mm of the line kept.
    const kept = finish(stroke)
    expect(kept.length).toBeLessThanOrEqual(simplify(stroke, KEEP_TOLERANCE, KEEP_PRESSURE).length + Math.ceil(stroke.length / KEEP_CHUNK))
    for (const pt of stroke) {
      const near = Math.min(...kept.slice(1).map((b, i) => segmentDistance(pt, kept[i]!, b)))
      expect(near).toBeLessThanOrEqual(KEEP_TOLERANCE + 1e-9)
    }
  })

  it('keeps a point where the pressure changes, even on a straight line', () => {
    const line: Pt[] = Array.from({ length: 21 }, (_, i) => ({ x: i * 100, y: 0, p: i === 10 ? 250 : 100 }))
    expect(simplify(line, KEEP_TOLERANCE).map((pt) => pt.x)).toContain(1000)
  })
})

describe('geometry', () => {
  it('flat triples and points go back and forth, as whole numbers with pressure 0 to 255', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: -1e6, max: 1e6 }), fc.integer({ min: -1e6, max: 1e6 }), fc.integer({ min: 0, max: 255 })), { maxLength: 50 }), (triples) => {
        const pts = triples.flat()
        expect(triplesOf(pointsOf(pts))).toEqual(pts)
      }),
    )
    expect(triplesOf([{ x: 1.4, y: -2.6, p: 300 }])).toEqual([1, -3, 255])
  })

  it('resamples to evenly spaced points along the same path', () => {
    const path: Pt[] = [{ x: 0, y: 0, p: 0 }, { x: 1000, y: 0, p: 0 }, { x: 1000, y: 1000, p: 0 }]
    const even = resample(path, 21)
    expect(even).toHaveLength(21)
    expect(even[10]).toEqual(expect.objectContaining({ x: 1000, y: 0 }))
    expect(pathLength(even)).toBeCloseTo(2000, 6)
  })
})

describe('the pen tip on a spring', () => {
  /** Run points through the model, the lift included. */
  const modelled = (points: readonly TimedPt[], level = 1): TimedPt[] => {
    const model = new StrokeModel(level)
    return [...points.flatMap((pt) => model.add(pt)), ...model.finish()]
  }

  it('passes the pen through untouched at level 0', () => {
    const pts = moving(2, 20, 5)
    expect(modelled(pts, 0)).toEqual(pts)
  })

  it('irons out jitter the hand did not mean', () => {
    // A slow straight line with ±10 units of jitter across it, at 200 Hz.
    const raw = moving(0.05, 300, 10, 3).map((pt) => ({ ...pt, t: pt.t * 1.25 }))
    const wobble = (pts: readonly TimedPt[]) => spread(pts.slice(20, -20).map((pt) => pt.y))
    expect(wobble(modelled(raw))).toBeLessThan(wobble(raw) / 2)
    // As the pen does it: the 1€ filter, then the spring.
    const filter = new PointFilter(1)
    expect(wobble(modelled(raw.map((pt) => filter.add(pt))))).toBeLessThan(wobble(raw) / 3)
  })

  it("shows, while the pen is down, the end exactly as lifting will draw it, and leaves the model as it was", () => {
    const raw = moving(3, 30, 4)
    const a = new StrokeModel(1)
    const b = new StrokeModel(1)
    for (const pt of raw) {
      a.add(pt)
      b.add(pt)
      // Looking ahead on one changes nothing on it.
      a.preview()
    }
    expect(a.add({ x: 400, y: 5, p: 128, t: 400 })).toEqual(b.add({ x: 400, y: 5, p: 128, t: 400 }))
    const shown = a.preview()
    expect(a.finish()).toEqual(shown)
  })

  it('ends exactly where the pen lifted', () => {
    const raw = moving(1, 40, 0)
    const line = modelled(raw)
    expect(line.at(-1)).toEqual(raw.at(-1))
  })

  it('keeps a circle written at speed round and its size', () => {
    // A 10 mm circle in 0.4 s, sampled at 200 Hz.
    const raw: TimedPt[] = Array.from({ length: 81 }, (_, i) => ({ x: 1000 * Math.cos((i / 80) * 2 * Math.PI), y: 1000 * Math.sin((i / 80) * 2 * Math.PI), p: 128, t: i * 5 }))
    const line = modelled(raw).slice(20, -10)
    for (const pt of line) expect(Math.abs(Math.hypot(pt.x, pt.y) - 1000)).toBeLessThan(80)
  })

  it('rounds a corner only a little at writing speed', () => {
    // Along 10 mm, then down 10 mm, at 50 mm a second.
    const raw: TimedPt[] = [...Array.from({ length: 41 }, (_, i) => ({ x: i * 25, y: 0, p: 128, t: i * 5 })), ...Array.from({ length: 40 }, (_, i) => ({ x: 1000, y: (i + 1) * 25, p: 128, t: 200 + (i + 1) * 5 }))]
    const line = modelled(raw)
    const nearest = Math.min(...line.map((pt) => Math.hypot(pt.x - 1000, pt.y)))
    expect(nearest).toBeLessThan(60)
  })

  it('fills in a pen that sends slowly, and trails it by only about 17 ms', () => {
    // 60 samples a second, as some touch screens send.
    const raw: TimedPt[] = Array.from({ length: 31 }, (_, i) => ({ x: i * 500 / 3, y: 0, p: 128, t: (i * 1000) / 60 }))
    const model = new StrokeModel(1)
    const line = raw.flatMap((pt) => model.add(pt))
    expect(line.length).toBeGreaterThanOrEqual(raw.length * 3 - 3)
    // Steady at 10 mm a second: behind the pen by the speed times the lag.
    const behind = raw.at(-1)!.x - line.at(-1)!.x
    const lag = behind / (500 / 3 / (1000 / 60))
    expect(lag).toBeGreaterThan(10)
    expect(lag).toBeLessThan(25)
  })
})
