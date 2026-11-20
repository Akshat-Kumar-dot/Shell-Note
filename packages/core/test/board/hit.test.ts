// What lies under a point of a board: a step by its outline, so a diamond's corner is not the diamond, and how far a
// link's line passes from a point.
import { describe, expect, it } from 'vitest'
import { distanceToRoute, insideShape, nodeAt, pathPoints, routeBox, routeLink } from '../../src/index.js'
import { BOARD } from '../fixtures/index.js'

const BOX = { x: 0, y: 0, w: 4000, h: 2000 }

describe('a point inside a step', () => {
  it('is inside a box anywhere in its box, and outside beyond it', () => {
    expect(insideShape('box', BOX, 1, 1)).toBe(true)
    expect(insideShape('box', BOX, 4000, 2000)).toBe(true)
    expect(insideShape('box', BOX, 4001, 1000)).toBe(false)
  })

  it('is not inside a diamond in its box’s corner, nor a circle, a pill or a rounded box there', () => {
    for (const shape of ['diamond', 'circle', 'double-circle', 'pill', 'round'] as const) {
      expect(insideShape(shape, BOX, 2000, 1000), shape).toBe(true)
      expect(insideShape(shape, BOX, 30, 30), shape).toBe(false)
    }
    // A diamond's middle of a side is on its outline; just outside it, between two corners, is not.
    expect(insideShape('diamond', BOX, 2000, 5)).toBe(true)
    expect(insideShape('diamond', BOX, 600, 400)).toBe(false)
  })

  it('follows the slanted sides of a hexagon, a slant, a trapezoid and a flag', () => {
    expect(insideShape('hexagon', BOX, 100, 100)).toBe(false)
    expect(insideShape('hexagon', BOX, 100, 1000)).toBe(true)
    expect(insideShape('slant', BOX, 100, 100)).toBe(false)
    expect(insideShape('slant', BOX, 100, 1900)).toBe(true)
    expect(insideShape('trapezoid', BOX, 100, 100)).toBe(false)
    expect(insideShape('trapezoid-down', BOX, 100, 1900)).toBe(false)
    // A flag's notch on its left side.
    expect(insideShape('flag', BOX, 100, 1000)).toBe(false)
    expect(insideShape('flag', BOX, 100, 100)).toBe(true)
  })
})

describe('the step under a point', () => {
  it('is found on a board, and none where there is no step', () => {
    expect(nodeAt(BOARD, 'p1', 2000, 800)?.id).toBe('n1')
    expect(nodeAt(BOARD, 'p1', 2000, 6600)?.id).toBe('n3')
    expect(nodeAt(BOARD, 'p1', 20000, 20000)).toBeUndefined()
  })

  it('is never the diamond in its box’s corner, nor one left out', () => {
    // n3 is a diamond in the box -500, 5200, 5000 × 2800.
    expect(nodeAt(BOARD, 'p1', -400, 5300)).toBeUndefined()
    expect(nodeAt(BOARD, 'p1', 2000, 6600, new Set(['n3']))).toBeUndefined()
  })
})

describe('a link’s line', () => {
  it('is measured from a point to its nearest piece', () => {
    const route = routeLink({ shape: 'box', box: { x: 0, y: 0, w: 4000, h: 1600 } }, { shape: 'box', box: { x: 0, y: 4000, w: 4000, h: 1600 } })
    expect(distanceToRoute(route, 2000, 2800)).toBe(0)
    expect(distanceToRoute(route, 2300, 2800)).toBe(300)
    expect(routeBox(route)).toEqual({ x: 2000, y: 1600, w: 0, h: 2400 })
  })

  it('walks a curve in small straight pieces, from its start to its end', () => {
    const route = routeLink({ shape: 'box', box: { x: 0, y: 0, w: 4000, h: 1600 } }, { shape: 'box', box: { x: 6000, y: 4000, w: 4000, h: 1600 } }, 'down', 'curved')
    const points = pathPoints(route)
    expect(points.length).toBeGreaterThan(10)
    expect(points[0]).toEqual(route.points[0])
    expect(points.at(-1)).toEqual(route.points.at(-1))
    expect(distanceToRoute(route, route.label.x, route.label.y)).toBeLessThan(5)
  })
})
