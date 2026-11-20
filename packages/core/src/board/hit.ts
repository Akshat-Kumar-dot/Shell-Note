// What lies under a point of a board: the step whose outline holds it, so a diamond's corner is not the diamond, and
// how far a link's line passes from it. Geometry alone, with no browser, so the screen, the pen and their tests agree.
// Units are 0.01 mm.
import type { Box } from '../ink/geometry.js'
import { segmentDistance } from '../ink/geometry.js'
import type { Doc, Id, NodeBlock, NodeShape } from '../schema/doc.js'
import { leanOf } from './geometry.js'
import type { Point, Route } from './route.js'

/** Whether a point lies inside a rectangle with its corners rounded by `r`. */
function inRounded(u: number, v: number, w: number, h: number, r: number): boolean {
  const cx = u < r ? r : u > w - r ? w - r : u
  const cy = v < r ? r : v > h - r ? h - r : v
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r
}

/** Whether a point lies inside a polygon, by the crossings of a ray to its right. */
function inPolygon(u: number, v: number, corners: readonly (readonly [number, number])[]): boolean {
  let inside = false
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [xi, yi] = corners[i]!
    const [xj, yj] = corners[j]!
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Whether a point lies inside the outline of a step of a shape drawn in a box (geometry.ts draws the same outline). */
export function insideShape(shape: NodeShape, box: Box, x: number, y: number): boolean {
  const u = x - box.x
  const v = y - box.y
  const { w, h } = box
  if (u < 0 || v < 0 || u > w || v > h) return false
  const k = leanOf(shape, w, h)
  switch (shape) {
    case 'diamond':
      return Math.abs(u - w / 2) / (w / 2) + Math.abs(v - h / 2) / (h / 2) <= 1
    case 'circle':
    case 'double-circle':
      return ((u - w / 2) / (w / 2)) ** 2 + ((v - h / 2) / (h / 2)) ** 2 <= 1
    case 'pill':
      return inRounded(u, v, w, h, Math.min(w, h) / 2)
    case 'round':
      return inRounded(u, v, w, h, Math.min(400, w / 2, h / 2))
    case 'hexagon':
      return inPolygon(u, v, [[k, 0], [w - k, 0], [w, h / 2], [w - k, h], [k, h], [0, h / 2]])
    case 'slant':
      return inPolygon(u, v, [[k, 0], [w, 0], [w - k, h], [0, h]])
    case 'slant-back':
      return inPolygon(u, v, [[0, 0], [w - k, 0], [w, h], [k, h]])
    case 'trapezoid':
      return inPolygon(u, v, [[k, 0], [w - k, 0], [w, h], [0, h]])
    case 'trapezoid-down':
      return inPolygon(u, v, [[0, 0], [w, 0], [w - k, h], [k, h]])
    case 'flag':
      return inPolygon(u, v, [[0, 0], [w, 0], [w, h], [0, h], [k, h / 2]])
    default:
      // A box, a subroutine, a cylinder: their box.
      return true
  }
}

/** The step of a board's page under a point: the one in front when two overlap; none when the point is on no step. */
export function nodeAt(doc: Doc, pageId: Id, x: number, y: number, except?: ReadonlySet<Id>): NodeBlock | undefined {
  const free = doc.page[pageId]?.free ?? []
  for (let i = free.length - 1; i >= 0; i--) {
    const block = doc.block[free[i]!]
    if (block?.type === 'node' && !except?.has(block.id) && insideShape(block.shape, block, x, y)) return block
  }
  return undefined
}

/** The points a curve is drawn through, enough to measure it or walk along it. */
const CURVE_STEPS = 24

/** A link's path as straight pieces: its corners as they are, or a curve walked in small steps. */
export function pathPoints(route: Pick<Route, 'kind' | 'points'>): Point[] {
  if (route.kind !== 'curved') return route.points
  const [a, b, c, d] = route.points as [Point, Point, Point, Point]
  const out: Point[] = []
  for (let i = 0; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS
    const s = 1 - t
    out.push({ x: s ** 3 * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t ** 3 * d.x, y: s ** 3 * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t ** 3 * d.y })
  }
  return out
}

/** How far a point lies from a link's line. */
export function distanceToRoute(route: Pick<Route, 'kind' | 'points'>, x: number, y: number): number {
  const points = pathPoints(route)
  let best = Infinity
  for (let i = 1; i < points.length; i++) best = Math.min(best, segmentDistance({ x, y }, points[i - 1]!, points[i]!))
  return best
}

/** The box a link's line lies in. */
export function routeBox(route: Pick<Route, 'kind' | 'points'>): Box {
  const points = route.kind === 'curved' ? pathPoints(route) : route.points
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
