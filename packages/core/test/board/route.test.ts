// A link's path is never kept: it is worked out from the two nodes it joins, the same for the screen, the print and
// the library's small picture. And each shape's outline, with the point on each side where a link meets it.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { leanOf, NodeShape, portOf, routeLink, shapePath, type Flow, type Point, type Side } from '../../src/index.js'

type Box = { x: number; y: number; w: number; h: number }
const box = (x: number, y: number, w = 4000, h = 1600): { shape: 'box'; box: Box } => ({ shape: 'box', box: { x, y, w, h } })
/** Whether every piece of a line runs straight across or straight down. */
const square = (points: readonly Point[]): boolean => points.slice(1).every((point, i) => point.x === points[i]!.x || point.y === points[i]!.y)

describe('a link’s path', () => {
  it('to a node straight ahead is one straight line, from the middle of one side to the middle of the other', () => {
    const route = routeLink(box(0, 0), box(0, 4000))
    expect(route).toEqual({ kind: 'angled', points: [{ x: 2000, y: 1600 }, { x: 2000, y: 4000 }], from: 'bottom', to: 'top', label: { x: 2000, y: 2800 } })
  })

  it('to a node ahead and a little aside bends twice, halfway, in right angles', () => {
    const route = routeLink(box(0, 0), box(1000, 4000))
    expect(route.points).toEqual([{ x: 2000, y: 1600 }, { x: 2000, y: 2800 }, { x: 3000, y: 2800 }, { x: 3000, y: 4000 }])
    expect([route.from, route.to]).toEqual(['bottom', 'top'])
    expect(square(route.points)).toBe(true)
    // Its words sit at the middle of the line.
    expect(route.label).toEqual({ x: 2500, y: 2800 })
  })

  it('to a node ahead and clear to one side, as a decision’s branch, leaves by the side that faces it and bends once', () => {
    const right = routeLink(box(0, 0), box(6000, 4000))
    expect(right.points).toEqual([{ x: 4000, y: 800 }, { x: 8000, y: 800 }, { x: 8000, y: 4000 }])
    expect([right.from, right.to]).toEqual(['right', 'top'])
    const left = routeLink(box(0, 0), box(-6000, 4000))
    expect([left.from, left.to, left.points[0]]).toEqual(['left', 'top', { x: 0, y: 800 }])
  })

  it('to a node behind goes round the side, out and back, and clear of a wider node between the two', () => {
    const back = routeLink(box(0, 8000), box(0, 0))
    expect(back.points).toEqual([{ x: 4000, y: 8800 }, { x: 4800, y: 8800 }, { x: 4800, y: 800 }, { x: 4000, y: 800 }])
    expect([back.from, back.to]).toEqual(['right', 'right'])
    // A node between them, wider than both: the line runs outside it.
    const round = routeLink(box(0, 8000), box(0, 0), 'down', undefined, [{ x: -1000, y: 4000, w: 6500, h: 1600 }])
    expect(round.points[1]!.x).toBe(5500 + 800)
    // A node that lies behind and to the left is gone round on the left.
    expect(routeLink(box(0, 8000), box(-3000, 0)).from).toBe('left')
    // A node far aside, not between the two, changes nothing.
    expect(routeLink(box(0, 8000), box(0, 0), 'down', undefined, [{ x: 30_000, y: 4000, w: 4000, h: 1600 }]).points).toEqual(back.points)
  })

  it('to a node beside goes from the side that faces it to the side that faces back', () => {
    const route = routeLink(box(0, 0), box(7000, 0))
    expect(route.points).toEqual([{ x: 4000, y: 800 }, { x: 7000, y: 800 }])
    expect([route.from, route.to]).toEqual(['right', 'left'])
    const lower = routeLink(box(0, 0), box(7000, 600))
    expect(lower.points).toEqual([{ x: 4000, y: 800 }, { x: 5500, y: 800 }, { x: 5500, y: 1400 }, { x: 7000, y: 1400 }])
  })

  it('follows the way the chart runs: ahead is to the right in a chart that runs right, up in one that runs up', () => {
    const right = routeLink(box(0, 0), box(7000, 0), 'right')
    expect([right.from, right.to, right.points]).toEqual(['right', 'left', [{ x: 4000, y: 800 }, { x: 7000, y: 800 }]])
    const up = routeLink(box(0, 4000), box(0, 0), 'up')
    expect([up.from, up.to, up.points]).toEqual(['top', 'bottom', [{ x: 2000, y: 4000 }, { x: 2000, y: 1600 }]])
    const left = routeLink(box(7000, 0), box(0, 0), 'left')
    expect([left.from, left.to]).toEqual(['left', 'right'])
    // In a chart that runs right, a way back goes round below.
    const back = routeLink(box(7000, 0), box(0, 0), 'right')
    expect([back.from, back.to]).toEqual(['bottom', 'bottom'])
    expect(back.points[1]!.y).toBe(1600 + 800)
  })

  it('is one line when the link says straight, one curve when it says curved, between the same two sides', () => {
    const angled = routeLink(box(0, 0), box(1000, 4000))
    const straight = routeLink(box(0, 0), box(1000, 4000), 'down', 'straight')
    expect(straight).toMatchObject({ kind: 'straight', points: [angled.points[0], angled.points.at(-1)], label: { x: 2500, y: 2800 } })
    const curved = routeLink(box(0, 0), box(1000, 4000), 'down', 'curved')
    expect(curved.kind).toBe('curved')
    expect(curved.points).toHaveLength(4)
    expect([curved.points[0], curved.points[3]]).toEqual([angled.points[0], angled.points.at(-1)])
    // It leaves the first node straight down and comes into the second straight down.
    expect([curved.points[1]!.x, curved.points[2]!.x]).toEqual([2000, 3000])
    expect(curved.points[1]!.y).toBeGreaterThan(1600)
    expect(curved.points[2]!.y).toBeLessThan(4000)
  })

  it('wherever two nodes lie, starts and ends on their sides, runs in right angles, and is the same each time', () => {
    const place = fc.record({ x: fc.integer({ min: -300, max: 300 }), y: fc.integer({ min: -300, max: 300 }), w: fc.integer({ min: 10, max: 80 }), h: fc.integer({ min: 10, max: 80 }) })
    fc.assert(
      fc.property(place, place, fc.constantFrom<Flow>('down', 'right', 'up', 'left'), fc.constantFrom(...NodeShape.options), fc.constantFrom(...NodeShape.options), (a, b, flow, shapeA, shapeB) => {
        const from = { shape: shapeA, box: { x: a.x * 100, y: a.y * 100, w: a.w * 100, h: a.h * 100 } }
        const to = { shape: shapeB, box: { x: b.x * 100, y: b.y * 100, w: b.w * 100, h: b.h * 100 } }
        const route = routeLink(from, to, flow)
        expect(route.points[0]).toEqual(portOf(shapeA, from.box, route.from))
        expect(route.points.at(-1)).toEqual(portOf(shapeB, to.box, route.to))
        // A slanted side's middle is not on the box's edge, so the first and last pieces may lean by that much.
        const inner = route.points.slice(1, -1)
        if (inner.length > 1) expect(square(inner)).toBe(true)
        for (const point of [...route.points, route.label]) expect([Number.isInteger(point.x), Number.isInteger(point.y)]).toEqual([true, true])
        expect(routeLink(from, to, flow)).toEqual(route)
      }),
      { numRuns: 300 },
    )
  })
})

describe('a node’s shape', () => {
  const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

  it('has an outline for each of the fourteen, closed, inside its box', () => {
    for (const shape of NodeShape.options) {
      const path = shapePath(shape, 4000, 1600)
      expect(path, shape).toMatch(/^M[\d. ]+/u)
      expect(path, shape).toContain('Z')
      expect(path, shape).not.toMatch(/NaN|undefined|-\d/u)
      // Every place it names is inside the box (a radius is no larger than the box either).
      for (const number of path.match(/\d+(?:\.\d+)?/gu)!.map(Number)) expect(number, `${shape}: ${path}`).toBeLessThanOrEqual(4000)
    }
    expect(shapePath('box', 4000, 1600)).toBe('M0 0H4000V1600H0Z')
    expect(shapePath('diamond', 4000, 1600)).toBe('M2000 0L4000 800L2000 1600L0 800Z')
  })

  it('meets a link at the middle of each side, on its own outline', () => {
    const at = { x: 1000, y: 2000, w: 4000, h: 1600 }
    expect(SIDES.map((side) => portOf('box', at, side))).toEqual([{ x: 3000, y: 2000 }, { x: 5000, y: 2800 }, { x: 3000, y: 3600 }, { x: 1000, y: 2800 }])
    // A diamond's and a circle's sides meet their box at its middles, as a box's do.
    for (const shape of ['diamond', 'circle', 'pill', 'hexagon', 'cylinder'] as const) expect(SIDES.map((side) => portOf(shape, at, side)), shape).toEqual(SIDES.map((side) => portOf('box', at, side)))
    // A slanted side's middle lies half its lean inside the box; a flag's left side is its notch.
    const lean = leanOf('slant', at.w, at.h)
    expect(lean).toBe(640)
    expect([portOf('slant', at, 'left').x, portOf('slant', at, 'right').x]).toEqual([1000 + lean / 2, 5000 - lean / 2])
    expect([portOf('flag', at, 'left').x, portOf('flag', at, 'right').x]).toEqual([1000 + leanOf('flag', at.w, at.h), 5000])
    expect(leanOf('box', at.w, at.h)).toBe(0)
  })
})
