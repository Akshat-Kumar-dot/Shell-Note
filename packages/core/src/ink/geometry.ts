// The geometry of pen strokes, which the rest of ink/ builds on. A stroke's
// points are stored flat, x, y, pressure repeated (schema/doc.ts); here they
// are objects, easier to reason about. Units are 0.01 mm throughout, and
// pressure is 0 to 255.

export interface Pt {
  x: number
  y: number
  /** Pressure, 0 to 255. */
  p: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A stroke's flat x, y, pressure triples as points. */
export function pointsOf(pts: readonly number[]): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i + 2 < pts.length; i += 3) out.push({ x: pts[i]!, y: pts[i + 1]!, p: pts[i + 2]! })
  return out
}

/** Points as a stroke's flat triples: whole numbers, pressure kept from 0 to 255. */
export function triplesOf(points: readonly Pt[]): number[] {
  const out: number[] = []
  for (const pt of points) out.push(Math.round(pt.x), Math.round(pt.y), Math.max(0, Math.min(255, Math.round(pt.p))))
  return out
}

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)

export function pathLength(points: readonly Pt[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1]!, points[i]!)
  return length
}

/** The box around points; zero size for no points. */
export function boxOf(points: readonly { x: number; y: number }[]): Box {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pt of points) {
    if (pt.x < minX) minX = pt.x
    if (pt.y < minY) minY = pt.y
    if (pt.x > maxX) maxX = pt.x
    if (pt.y > maxY) maxY = pt.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** The box around a stroke's flat triples, without making points. */
export function boxOfFlat(pts: readonly number[]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const x = pts[i]!
    const y = pts[i + 1]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return minX === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export const diagonal = (box: Box): number => Math.hypot(box.w, box.h)

/** Whether two boxes overlap or touch. */
export const overlaps = (a: Box, b: Box): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

/** A box grown by `by` on every side. */
export const grown = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by })

/** The point `t` of the way from a to b, pressure too. */
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t })

/** `n` points spaced evenly along the path, the first and last kept. */
export function resample(points: readonly Pt[], n: number): Pt[] {
  if (points.length === 0 || n < 2) return [...points]
  const total = pathLength(points)
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0]! }))
  const step = total / (n - 1)
  const out: Pt[] = [{ ...points[0]! }]
  let walked = 0
  let target = step
  for (let i = 1; i < points.length && out.length < n - 1; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const d = dist(a, b)
    while (d > 0 && walked + d >= target && out.length < n - 1) {
      out.push(lerp(a, b, (target - walked) / d))
      target += step
    }
    walked += d
  }
  out.push({ ...points.at(-1)! })
  return out
}

/** Points spaced about `spacing` apart along the path, the first and last kept. */
export function respace(points: readonly Pt[], spacing: number): Pt[] {
  const n = Math.max(2, Math.round(pathLength(points) / Math.max(1, spacing)) + 1)
  return resample(points, n)
}

/** How far a point is from the segment a–b. */
export function segmentDistance(pt: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return dist(pt, a)
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / length2))
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy))
}

/** How far a point is from the infinite line through a and b. */
export function lineDistance(pt: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const length = dist(a, b)
  if (length === 0) return dist(pt, a)
  return Math.abs((b.x - a.x) * (a.y - pt.y) - (a.x - pt.x) * (b.y - a.y)) / length
}

/**
 * Fewer points for the same line (Ramer–Douglas–Peucker): points closer than
 * `tolerance` to the line between their neighbours go, unless the pressure
 * there changes by more than `pressureStep`.
 */
export function simplify(points: readonly Pt[], tolerance: number, pressureStep = 24): Pt[] {
  if (points.length <= 2) return [...points]
  return simplifyIndexes(points, 0, points.length - 1, tolerance, pressureStep).map((i) => points[i]!)
}

/** The same for the points from `from` to `to` alone, both kept: the indexes of the points kept, in order. */
export function simplifyIndexes(points: readonly Pt[], from: number, to: number, tolerance: number, pressureStep = 24): number[] {
  if (to <= from) return [from]
  if (to === from + 1) return [from, to]
  const keep = new Uint8Array(to - from + 1)
  keep[0] = 1
  keep[to - from] = 1
  const stack: [number, number][] = [[from, to]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let worst = -1
    let at = -1
    for (let i = first + 1; i < last; i++) {
      const pt = points[i]!
      const off = segmentDistance(pt, points[first]!, points[last]!)
      // Pressure that moves away from the straight blend between the ends counts as distance too.
      const blend = points[first]!.p + ((points[last]!.p - points[first]!.p) * (i - first)) / (last - first)
      const score = Math.max(off / tolerance, Math.abs(pt.p - blend) / pressureStep)
      if (score > worst) {
        worst = score
        at = i
      }
    }
    if (worst > 1 && at > 0) {
      keep[at - from] = 1
      stack.push([first, at], [at, last])
    }
  }
  const out: number[] = []
  for (let i = 0; i < keep.length; i++) if (keep[i] === 1) out.push(from + i)
  return out
}

/** Whether a point lies inside a polygon (even-odd rule). */
export function insidePolygon(pt: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** The average pressure of points, 128 when there are none. */
export function meanPressure(points: readonly Pt[]): number {
  return points.length === 0 ? 128 : points.reduce((sum, pt) => sum + pt.p, 0) / points.length
}

/** The centre of points. */
export function centroid(points: readonly Pt[]): { x: number; y: number } {
  const n = Math.max(1, points.length)
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n }
}

/** The angle at b, from a to c, in radians, 0 to π. */
export function angleAt(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (d === 0) return Math.PI
  return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d)))
}

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** One millimetre, in document units. */
export const MM = 100
