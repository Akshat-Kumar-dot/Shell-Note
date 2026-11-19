// The path of a link, from the two nodes it joins. It is never kept in the note: it is worked out each time, so a
// node that moves brings its links, and the screen, the print and the library's small picture draw the same line.
//
// A link leaves one side of its node and enters one side of the other, at the middle of each (geometry.ts). Which
// sides follows from where the two lie along the way the chart runs:
//   ahead:   out of the far side, into the near one; straight when they are in line, else with two bends halfway
//   behind:  round the side, out and back, so the line does not cross the nodes between (a way back in a loop)
//   beside:  out of the side that faces the other, into the side that faces back
// In right angles unless the link says straight (port to port) or curved (a curve between the same two ports).
import type { Box } from '../ink/geometry.js'
import type { NodeShape } from '../schema/doc.js'
import { portOf, type Side } from './geometry.js'
import type { Flow } from './mermaid.js'

export interface Point {
  x: number
  y: number
}

export interface Route {
  kind: 'angled' | 'straight' | 'curved'
  /**
   * Angled and straight: the corners of the line, from the first node's side to the second's. Curved: the start, two
   * control points and the end of one cubic curve.
   */
  points: Point[]
  /** The sides the link leaves by and arrives at. */
  from: Side
  to: Side
  /** The middle of the path, where its words go. */
  label: Point
}

/** How far a link that goes back runs out from the nodes' sides before it turns: 8 mm. */
const OUT = 800
/** Two nodes this close across the flow count as in line: 0.5 mm. */
const IN_LINE = 50

/** The four sides as a chart running `flow` sees them: the side it runs to, the side it comes from, and the two beside. */
const SIDES: Readonly<Record<Flow, { far: Side; near: Side; plus: Side; minus: Side }>> = {
  down: { far: 'bottom', near: 'top', plus: 'right', minus: 'left' },
  up: { far: 'top', near: 'bottom', plus: 'right', minus: 'left' },
  right: { far: 'right', near: 'left', plus: 'bottom', minus: 'top' },
  left: { far: 'left', near: 'right', plus: 'bottom', minus: 'top' },
}

const round = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) })

/** The point halfway along a line of straight pieces. */
function halfway(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((point, i) => Math.abs(point.x - points[i]!.x) + Math.abs(point.y - points[i]!.y))
  let left = lengths.reduce((sum, length) => sum + length, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!
    if (left <= length && length > 0) {
      const [a, b] = [points[i]!, points[i + 1]!]
      return round({ x: a.x + ((b.x - a.x) * left) / length, y: a.y + ((b.y - a.y) * left) / length })
    }
    left -= length
  }
  return round(points[0]!)
}

/**
 * The path of a link between two nodes, given each one's shape and box, the way their chart runs, and how the link
 * says it is drawn (in right angles when it says nothing). `others`: the boxes of the board's other nodes, which a
 * link that goes back keeps clear of.
 */
export function routeLink(from: { shape: NodeShape; box: Box }, to: { shape: NodeShape; box: Box }, flow: Flow = 'down', path?: 'straight' | 'curved', others: readonly Box[] = []): Route {
  const sides = SIDES[flow]
  const upright = flow === 'down' || flow === 'up'
  // Along the way the chart runs, each box from its start to its end; across it, from one side to the other.
  const sign = flow === 'down' || flow === 'right' ? 1 : -1
  const along = (box: Box): [number, number] => {
    const [start, size] = upright ? [box.y, box.h] : [box.x, box.w]
    return sign === 1 ? [start, start + size] : [-(start + size), -start]
  }
  const across = (box: Box): [number, number] => (upright ? [box.x, box.x + box.w] : [box.y, box.y + box.h])
  const [fromA, toA] = [along(from.box), along(to.box)]
  const [fromC, toC] = [across(from.box), across(to.box)]
  /** A point from its place along and across the flow. */
  const at = (a: number, c: number): Point => (upright ? { x: c, y: sign * a } : { x: sign * a, y: c })
  const place = (point: Point): [number, number] => (upright ? [sign * point.y, point.x] : [sign * point.x, point.y])

  let out: Side
  let into: Side
  let corners: Point[]
  const toMiddle = (toC[0] + toC[1]) / 2
  if (toA[0] >= fromA[1] && (toMiddle > fromC[1] || toMiddle < fromC[0])) {
    // Ahead and clear to one side, as a decision's branch is: out of the side that faces it, one bend, into its
    // near side.
    ;[out, into] = [toMiddle > fromC[1] ? sides.plus : sides.minus, sides.near]
    const [a, b] = [portOf(from.shape, from.box, out), portOf(to.shape, to.box, into)]
    corners = [a, at(place(a)[0], place(b)[1]), b]
  } else if (toA[0] >= fromA[1]) {
    // Ahead: far side to near side.
    ;[out, into] = [sides.far, sides.near]
    const [a, b] = [portOf(from.shape, from.box, out), portOf(to.shape, to.box, into)]
    const [[a1, c1], [a2, c2]] = [place(a), place(b)]
    const mid = (a1 + a2) / 2
    corners = Math.abs(c1 - c2) <= IN_LINE ? [a, b] : [a, at(mid, c1), at(mid, c2), b]
  } else if (toA[1] <= fromA[0]) {
    // Behind: round the side the other lies to, or the further side when they are in line.
    const plus = toMiddle >= (fromC[0] + fromC[1]) / 2
    out = into = plus ? sides.plus : sides.minus
    const [a, b] = [portOf(from.shape, from.box, out), portOf(to.shape, to.box, into)]
    const [[a1], [a2]] = [place(a), place(b)]
    // Out past the two nodes, and past any other node lying between them that the line would run through.
    const between = others.map((box) => ({ a: along(box), c: across(box) })).filter(({ a }) => a[1] > toA[0] && a[0] < fromA[1])
    let lane = plus ? Math.max(fromC[1], toC[1]) + OUT : Math.min(fromC[0], toC[0]) - OUT
    for (let tries = 0; tries < 20; tries++) {
      const inner = plus ? Math.min(fromC[0], toC[0]) : Math.max(fromC[1], toC[1])
      const hit = between.find(({ c }) => (plus ? c[1] > lane - OUT && c[0] < lane && c[1] > inner : c[0] < lane + OUT && c[1] > lane && c[0] < inner))
      if (!hit) break
      lane = plus ? hit.c[1] + OUT : hit.c[0] - OUT
    }
    corners = [a, at(a1, lane), at(a2, lane), b]
  } else {
    // Beside: the sides that face each other.
    const plus = toMiddle >= (fromC[0] + fromC[1]) / 2
    ;[out, into] = plus ? [sides.plus, sides.minus] : [sides.minus, sides.plus]
    const [a, b] = [portOf(from.shape, from.box, out), portOf(to.shape, to.box, into)]
    const [[a1, c1], [a2, c2]] = [place(a), place(b)]
    const mid = (c1 + c2) / 2
    corners = Math.abs(a1 - a2) <= IN_LINE ? [a, b] : [a, at(a1, mid), at(a2, mid), b]
  }
  corners = corners.map(round)
  const [start, end] = [corners[0]!, corners.at(-1)!]

  if (path === 'straight') return { kind: 'straight', points: [start, end], from: out, to: into, label: halfway([start, end]) }
  if (path === 'curved') {
    // One curve between the same two ports, leaving each at a right angle to its side.
    const reach = Math.max(600, (Math.abs(end.x - start.x) + Math.abs(end.y - start.y)) / 2)
    const pull = (point: Point, side: Side): Point =>
      round(side === 'top' ? { x: point.x, y: point.y - reach } : side === 'bottom' ? { x: point.x, y: point.y + reach } : side === 'left' ? { x: point.x - reach, y: point.y } : { x: point.x + reach, y: point.y })
    const [c1, c2] = [pull(start, out), pull(end, into)]
    // The curve's own middle (at half its way).
    const label = round({ x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 })
    return { kind: 'curved', points: [start, c1, c2, end], from: out, to: into, label }
  }
  return { kind: 'angled', points: corners, from: out, to: into, label: halfway(corners) }
}
