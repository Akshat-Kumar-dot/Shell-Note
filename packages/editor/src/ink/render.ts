// How a stroke is drawn (in place of perfect-freehand): a
// line through its points, with round ends and joins, its width following the
// pressure. The live layer draws each new piece once, as the pen moves, and the
// finished stroke in the page is the same drawing, so nothing changes when the
// pen lifts. Corners stay sharp: a snapped rectangle is four straight sides.
//
// Widths are rounded to sixteenths of the stroke's own width, too small to
// see, and change step only when the width truly moves (Widths); the pieces of one width are one SVG path, so a stroke is a handful of
// elements however long it is.
import { sizeOf, strokeWidths, type PenKind, type Stroke } from '@shellnote/core'

/** How each pen looks besides its width: how see-through, and whether it is drawn under the words. */
export interface PenLook {
  opacity: number
  /** Drawn under the words and other ink: see-through, multiplied with what is behind. */
  under?: true
}

export const LOOKS: Readonly<Record<PenKind | 'pen', PenLook>> = {
  pen: { opacity: 1 },
  fountain: { opacity: 1 },
  pencil: { opacity: 0.82 },
  marker: { opacity: 1 },
  highlighter: { opacity: 0.5, under: true },
}

export const lookOf = (tool: PenKind | undefined): PenLook => LOOKS[tool ?? 'pen']

/** A width rounded to its step, a sixteenth of the stroke's own width, so normal pressure draws exactly that width. */
export function stepped(width: number, size: number): number {
  const step = size / 16
  return Math.max(step, Math.round(width / step) * step)
}

/**
 * The widths a stroke's pieces are drawn at, piece by piece: each the
 * average of its two ends, stepped, but a new step only once the width has
 * moved most of a step away from the last, so a width resting near the line
 * between two steps never flickers between them (each change is a seam).
 * The live layer and the page use the same, so they draw alike.
 */
export class Widths {
  #width = -1
  constructor(readonly size: number) {}

  /** A copy, to work out widths ahead without moving on. */
  copy(): Widths {
    const copy = new Widths(this.size)
    copy.#width = this.#width
    return copy
  }

  /** The width to draw the piece from point i - 1 to point i at. */
  next(widths: readonly number[], i: number): number {
    return this.between(widths[Math.max(0, i - 1)]!, widths[i]!)
  }

  /** The width to draw a piece at, from the widths at its two ends. */
  between(before: number, after: number): number {
    const w = (before + after) / 2
    if (this.#width < 0 || Math.abs(w - this.#width) > 0.75 * (this.size / 16)) this.#width = stepped(w, this.size)
    return this.#width
  }
}

/** One width of a stroke and the pieces drawn at it, as an SVG path. */
export interface Run {
  width: number
  d: string
}

// Document units are 0.01 mm; a tenth of that is finer than any screen.
const r = (v: number): number => Math.round(v * 10) / 10

/** A turn sharper than this between three kept points is a corner, kept sharp: the tip of an A, the joins of a k. */
const CORNER = (50 * Math.PI) / 180

function turnAt(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  let turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)
  if (turn > Math.PI) turn -= 2 * Math.PI
  if (turn < -Math.PI) turn += 2 * Math.PI
  return Math.abs(turn)
}

type XY = { x: number; y: number }

/** A stretch of a stroke drawn at one width: its points, or one point for a dot. */
export interface Stretch {
  width: number
  points: XY[]
}

/**
 * A stroke cut into stretches, each drawn at one width, in drawing order; a
 * stroke of one point is a dot. The page (strokeRuns) and the live layer
 * (drawStroke) both draw from these, so they draw alike. `level` carries the
 * width steps on from a stroke drawn so far.
 */
export function stretchesOf(points: readonly XY[], widths: readonly number[], size: number, level = new Widths(size)): Stretch[] {
  const built = new Stretches(size, level)
  points.forEach((pt, i) => built.add(pt, widths[i]!))
  return built.done()
}

/**
 * Stretches built a point at a time, as the pen goes: the same as
 * stretchesOf for the same points and widths. The live layer keeps one for
 * the part of a stroke that can no longer change and carries on from a copy
 * of it for the rest, so a pen move works out only the stroke's end (the pen
 * review's R1, 16 October 2026).
 */
export class Stretches {
  readonly #size: number
  readonly #level: Widths
  readonly #out: Stretch[]
  #last: { xy: XY; width: number } | undefined

  constructor(size: number, level = new Widths(size), out: Stretch[] = [], last?: { xy: XY; width: number }) {
    this.#size = size
    this.#level = level
    this.#out = out
    this.#last = last
  }

  /** The next point of the stroke, and its width. */
  add(xy: XY, width: number): void {
    const last = this.#last
    this.#last = { xy, width }
    if (!last) return
    const w = this.#level.between(last.width, width)
    const current = this.#out.at(-1)
    if (current?.width === w) current.points.push(xy)
    else this.#out.push({ width: w, points: [last.xy, xy] })
  }

  /** A copy to carry on from, leaving this one as it is. */
  copy(): Stretches {
    const out = this.#out.slice()
    const current = out.at(-1)
    if (current) out[out.length - 1] = { width: current.width, points: current.points.slice() }
    return new Stretches(this.#size, this.#level.copy(), out, this.#last)
  }

  /** The stretches so far; a stroke of one point is a dot. */
  done(): Stretch[] {
    if (this.#out.length === 0 && this.#last) return [{ width: stepped(this.#last.width, this.#size), points: [this.#last.xy] }]
    return this.#out
  }
}

/** Stretches of one width together, as one path each: where they cross, a line is drawn once, not twice over. */
function byWidth(stretches: readonly Stretch[]): Map<number, Stretch[]> {
  const out = new Map<number, Stretch[]>()
  for (const stretch of stretches) {
    const same = out.get(stretch.width)
    if (same) same.push(stretch)
    else out.set(stretch.width, [stretch])
  }
  return out
}

/**
 * Trace a stretch: curves through the middles between its points, bending at
 * each point, so the line turns smoothly where straight joins would show
 * small corners when zoomed in (as Windows Ink fits curves to its strokes);
 * a real corner stays sharp. `to` and `curve` draw it, in SVG or on a canvas.
 */
function trace(points: readonly XY[], line: (p: XY) => void, curve: (c: XY, p: XY) => void): void {
  const n = points.length
  const mid = (i: number): XY => ({ x: (points[i]!.x + points[i + 1]!.x) / 2, y: (points[i]!.y + points[i + 1]!.y) / 2 })
  if (n < 3) return line(points[n - 1]!)
  line(mid(0))
  for (let i = 1; i < n - 1; i++) {
    if (turnAt(points[i - 1]!, points[i]!, points[i + 1]!) > CORNER) {
      line(points[i]!)
      line(mid(i))
    } else curve(points[i]!, mid(i))
  }
  line(points[n - 1]!)
}

/** A stretch as an SVG path; a dot as a line of no length, which round ends draw as a circle. */
function svgPath(stretch: Stretch): string {
  const at = (p: XY): string => `${r(p.x)} ${r(p.y)}`
  const [first] = stretch.points
  if (stretch.points.length === 1) return `M${at(first!)}h0`
  let d = `M${at(first!)}`
  trace(
    stretch.points,
    (p) => (d += `L${at(p)}`),
    (c, p) => (d += `Q${at(c)} ${at(p)}`),
  )
  return d
}

const runs = new WeakMap<Stroke, { dx: number; dy: number; runs: Run[] }>()

/** The strokes drawn lately by what they are on the page (strokeSignature), for one moved with its block's corner. */
const byContent = new Map<string, { stroke: Stroke; dx: number; dy: number; runs: Run[] }>()
/** As many as a few pages of handwriting; the oldest go first. */
const BY_CONTENT = 5000

/**
 * A finished stroke as SVG paths, one for each width it is drawn at, worked
 * out once. dx, dy: where its block's corner is on the page, so the paths are
 * in page units, and stay the very same strings when the block's corner moves
 * and its strokes move the other way: the page then redraws none of them, and
 * (the pen review's R3, 16 October 2026) works none of them out again, though
 * the moved strokes are new objects: when a block grew left or up, every one
 * of its strokes was worked out afresh, 14 ms in a block of 1,000.
 */
export function strokeRuns(stroke: Stroke, dx = 0, dy = 0): Run[] {
  const known = runs.get(stroke)
  if (known && known.dx === dx && known.dy === dy) return known.runs
  const signature = strokeSignature(stroke, dx, dy)
  const same = byContent.get(signature)
  let out: Run[]
  if (same && samePlace(same.stroke, same.dx, same.dy, stroke, dx, dy)) out = same.runs
  else {
    const pts = stroke.pts
    const points: XY[] = []
    for (let i = 0; i + 1 < pts.length; i += 3) points.push({ x: pts[i]! + dx, y: pts[i + 1]! + dy })
    const stretches = stretchesOf(points, strokeWidths(stroke), sizeOf(stroke))
    out = [...byWidth(stretches)].map(([width, alike]) => ({ width, d: alike.map(svgPath).join('') }))
  }
  runs.set(stroke, { dx, dy, runs: out })
  byContent.delete(signature)
  byContent.set(signature, { stroke, dx, dy, runs: out })
  if (byContent.size > BY_CONTENT) byContent.delete(byContent.keys().next().value!)
  return out
}

const signatures = new WeakMap<Stroke, { dx: number; dy: number; signature: string }>()

/**
 * What a stroke is on the page, as a short string: its points where they land
 * (dx, dy: its block's corner), its pressures, tilts and look, hashed. The same
 * for the same stroke however its block's corner moves; the page keys each
 * stroke's drawing by it (the pen review's R2), so erasing one stroke leaves
 * the drawings of the others as they are, where keys by place in the block
 * made every stroke after it be drawn again.
 */
export function strokeSignature(stroke: Stroke, dx = 0, dy = 0): string {
  const known = signatures.get(stroke)
  if (known && known.dx === dx && known.dy === dy) return known.signature
  // FNV-1a over whole numbers.
  let hash = 0x811c9dc5
  const mix = (value: number): void => {
    hash = Math.imul(hash ^ (value | 0), 0x01000193)
  }
  const pts = stroke.pts
  for (let i = 0; i + 2 < pts.length; i += 3) {
    mix(pts[i]! + dx)
    mix(pts[i + 1]! + dy)
    mix(pts[i + 2]!)
  }
  for (const tilt of stroke.tilt ?? []) mix(tilt)
  const signature = `${(hash >>> 0).toString(36)}.${pts.length / 3}.${stroke.color}.${stroke.width}.${stroke.tool ?? ''}`
  signatures.set(stroke, { dx, dy, signature })
  return signature
}

/** Whether two strokes are the very same ink on the page, each at its block's corner. */
function samePlace(a: Stroke, adx: number, ady: number, b: Stroke, bdx: number, bdy: number): boolean {
  if (a.pts.length !== b.pts.length || a.color !== b.color || a.width !== b.width || a.tool !== b.tool || (a.tilt?.length ?? 0) !== (b.tilt?.length ?? 0)) return false
  for (let i = 0; i + 2 < a.pts.length; i += 3) {
    if (a.pts[i]! + adx !== b.pts[i]! + bdx || a.pts[i + 1]! + ady !== b.pts[i + 1]! + bdy || a.pts[i + 2] !== b.pts[i + 2]) return false
  }
  return (a.tilt ?? []).every((tilt, i) => tilt === b.tilt![i])
}

/** Where a page's units land on a canvas: canvas pixels are units times scale, plus dx, dy. */
export interface Mapping {
  scale: number
  dx: number
  dy: number
}

/**
 * Draw stretches on a canvas exactly as the page draws them in SVG: one path
 * for each width, stroked once. (Drawn piece by piece, each piece's soft edge
 * would be painted again where the next overlaps it, and the live line would
 * look a fifth thicker than the page's.) The canvas's stroke and fill colour,
 * round ends and joins are set by the caller.
 */
export function drawStretches(ctx: CanvasRenderingContext2D, stretches: readonly Stretch[], map: Mapping): void {
  const at = (p: XY): XY => ({ x: p.x * map.scale + map.dx, y: p.y * map.scale + map.dy })
  for (const [width, same] of byWidth(stretches)) {
    const w = Math.max(0.5, width * map.scale)
    ctx.beginPath()
    for (const stretch of same) {
      const first = at(stretch.points[0]!)
      if (stretch.points.length === 1) {
        // A dot: the canvas drops a line of no length, so it is a circle as wide as the line.
        ctx.moveTo(first.x + w / 2, first.y)
        ctx.arc(first.x, first.y, w / 2, 0, 2 * Math.PI)
        continue
      }
      ctx.moveTo(first.x, first.y)
      trace(
        stretch.points,
        (p) => {
          const q = at(p)
          ctx.lineTo(q.x, q.y)
        },
        (c, p) => {
          const a = at(c)
          const b = at(p)
          ctx.quadraticCurveTo(a.x, a.y, b.x, b.y)
        },
      )
    }
    if (same.length === 1 && same[0]!.points.length === 1) ctx.fill()
    else {
      ctx.lineWidth = w
      ctx.stroke()
    }
  }
}

/** Draw a whole stroke, given as points and widths, on a canvas, as strokeRuns draws it in SVG. */
export function drawStroke(ctx: CanvasRenderingContext2D, points: readonly XY[], widths: readonly number[], size: number, map: Mapping): void {
  drawStretches(ctx, stretchesOf(points, widths, size), map)
}

/** Draw one straight piece on a canvas with round ends, as for the short guess past the pen; a piece of no length is a dot. */
export function drawPiece(ctx: CanvasRenderingContext2D, a: XY, b: XY, width: number, map: Mapping): void {
  drawStretches(ctx, [{ width, points: a.x === b.x && a.y === b.y ? [a] : [a, b] }], map)
}
