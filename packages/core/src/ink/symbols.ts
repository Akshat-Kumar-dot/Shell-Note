// Symbols, corrected the moment the pen lifts: ( ) [ ] { }, and @. Unlike
// shapes they need no hold, so each test is strict, and a letter that looks
// alike stays a letter: a c is as wide as it is tall, an l hardly bends, an L
// has two straight pieces, a 3 points its middle inward, an a or an e turns
// about once. A symbol is kept as a shape (schema/doc.ts): its box, and for the
// brackets which way it opens. These rules are general, for anyone; once a
// person records their own symbols, those decide instead (learn.ts).
import type { SymbolKind } from '../schema/doc.js'
import { angleAt, boxOf, dist, meanPressure, median, pathLength, resample, respace, type Box, type Pt } from './geometry.js'
import { corners, drawShape, scaledShape, type RecognisedShape } from './shapes.js'
import { describedOn, onScreen, SYMBOL_LABELS, type SymbolLabel, type Taught } from './learn.js'

const DEG = Math.PI / 180

/** A stroke as the tests below look at it: points every 0.4 mm, each the average of itself and its neighbours, so no jitter is left. */
function cleaned(points: readonly Pt[]): Pt[] {
  let out = respace(points, 40)
  for (let pass = 0; pass < 2; pass++) {
    out = out.map((pt, i) => (i === 0 || i === out.length - 1 ? pt : { x: (out[i - 1]!.x + 2 * pt.x + out[i + 1]!.x) / 4, y: (out[i - 1]!.y + 2 * pt.y + out[i + 1]!.y) / 4, p: pt.p }))
  }
  return out
}

/** How much a stroke turns in all, and how many times it changes the way it bends, looked at in pieces of about a millimetre, up to `most`. */
function turning(points: readonly Pt[], most = 24): { total: number; net: number; changes: number; sharpest: number } {
  const pieces = Math.max(6, Math.min(most, Math.round(pathLength(points) / 100)))
  const ring = resample(points, pieces + 1)
  let total = 0
  let net = 0
  let changes = 0
  let bend = 0
  let run = 0
  let sharpest = 0
  for (let i = 1; i + 1 < ring.length; i++) {
    let turn = Math.atan2(ring[i + 1]!.y - ring[i]!.y, ring[i + 1]!.x - ring[i]!.x) - Math.atan2(ring[i]!.y - ring[i - 1]!.y, ring[i]!.x - ring[i - 1]!.x)
    if (turn > Math.PI) turn -= 2 * Math.PI
    if (turn < -Math.PI) turn += 2 * Math.PI
    total += Math.abs(turn)
    net += turn
    sharpest = Math.max(sharpest, Math.abs(turn))
    run = run === 0 || Math.sign(turn) === Math.sign(run) ? run + turn : turn
    if (Math.abs(run) > 20 * DEG && Math.sign(run) !== bend) {
      if (bend !== 0) changes++
      bend = Math.sign(run)
    }
  }
  return { total, net, changes, sharpest }
}

const made = (kind: SymbolKind, key: number[], pressure: number): RecognisedShape => {
  const whole = key.map(Math.round)
  return { kind, key: whole, points: drawShape(kind, whole, pressure) }
}
const boxKey = (box: Box, side?: 0 | 1): number[] => (side === undefined ? [box.x, box.y, box.w, box.h] : [box.x, box.y, box.w, box.h, side])

/** ( or ): one smooth bend one way, at least twice as tall as wide, ends one above the other, bulging out to one side. */
function paren(points: readonly Pt[], box: Box): 0 | 1 | undefined {
  if (box.h < 300 || box.h < 2 * box.w) return undefined
  const { total, changes, sharpest } = turning(points)
  if (changes > 0 || sharpest > 50 * DEG || total < 50 * DEG || total > 210 * DEG) return undefined
  // It bends all along, each half doing at least a quarter of it: a J is straight, then hooks.
  const middle = Math.floor(points.length / 2)
  const halves = [turning(points.slice(0, middle + 1), 12).total, turning(points.slice(middle), 12).total]
  if (Math.min(...halves) < 0.25 * (halves[0]! + halves[1]!)) return undefined
  const a = points[0]!
  const b = points.at(-1)!
  if (Math.abs(b.y - a.y) < 0.75 * box.h) return undefined
  // Which way it bulges: the middle of the stroke against the line between its ends.
  const halfway = resample(points, 21)[10]!
  const across = halfway.x - (a.x + b.x) / 2
  if (Math.abs(across) < 0.25 * box.w) return undefined
  return across < 0 ? 0 : 1
}

/** [ or ]: three straight pieces, short, long and upright, short, with square corners, the short ones pointing the same way. */
function bracket(points: readonly Pt[], box: Box): 0 | 1 | undefined {
  if (box.h < 300 || box.h < 1.8 * box.w) return undefined
  const ring = resample(points, 64)
  const at = corners(ring, 3)
  if (at.length !== 4) return undefined
  const [p0, p1, p2, p3] = at.map((i) => ring[i]!) as [Pt, Pt, Pt, Pt]
  // Each piece nearly straight.
  for (let k = 0; k < 3; k++) {
    const from = at[k]!
    const to = at[k + 1]!
    if (dist(ring[from]!, ring[to]!) < 0.88 * pathLength(ring.slice(from, to + 1))) return undefined
  }
  const spine = dist(p1, p2)
  if (Math.abs(p2.x - p1.x) > 0.25 * Math.abs(p2.y - p1.y) || spine < 0.7 * box.h) return undefined
  for (const [end, corner] of [
    [p0, p1],
    [p3, p2],
  ] as const) {
    if (Math.abs(end.y - corner.y) > 0.6 * Math.abs(end.x - corner.x) || dist(end, corner) > 0.7 * spine || dist(end, corner) < 0.08 * spine) return undefined
  }
  const spineX = (p1.x + p2.x) / 2
  const left = p0.x < spineX && p3.x < spineX
  const right = p0.x > spineX && p3.x > spineX
  if (!left && !right) return undefined
  // [ has its short pieces to the right of the upright one.
  return right ? 0 : 1
}

/** { or }: tall, its ends on one side, its middle a sharp point that is the furthest out on the other. */
function brace(points: readonly Pt[], box: Box): 0 | 1 | undefined {
  if (box.h < 300 || box.h < 1.8 * box.w) return undefined
  const ring = resample(points, 48)
  const a = ring[0]!
  const b = ring.at(-1)!
  if (Math.abs(b.y - a.y) < 0.75 * box.h) return undefined
  const endsX = (a.x + b.x) / 2
  // The point furthest from the ends' side, in the middle third of the height.
  const opening = endsX > box.x + box.w / 2 ? 0 : 1
  let tip = 0
  for (let i = 1; i < ring.length; i++) if (opening === 0 ? ring[i]!.x < ring[tip]!.x : ring[i]!.x > ring[tip]!.x) tip = i
  const t = ring[tip]!
  if (t.y < box.y + box.h / 3 || t.y > box.y + (2 * box.h) / 3) return undefined
  if (Math.abs(t.x - endsX) < 0.6 * box.w) return undefined
  if (angleAt(ring[Math.max(0, tip - 4)]!, t, ring[Math.min(ring.length - 1, tip + 4)]!) > 130 * DEG) return undefined
  // Each half bends both ways (in at the end, out to the point), unlike one smooth bracket.
  const { changes } = turning(points)
  if (changes < 2) return undefined
  return opening
}

/** A comma: small, a short tick down and to the left, taller than wide, no loop. Beside writing, much smaller than its letters. */
function comma(points: readonly Pt[], box: Box, near: readonly Box[]): boolean {
  const diagonal = Math.hypot(box.w, box.h)
  if (diagonal < 80 || box.h > 450 || box.h < 1.1 * box.w) return false
  if (near.length >= 2 && box.h > 0.65 * median(near.map((b) => b.h))) return false
  const a = points[0]!
  const b = points.at(-1)!
  if (b.y - a.y < 0.6 * box.h || b.x > a.x + 0.2 * box.h) return false
  return pathLength(points) < 1.6 * diagonal
}

/**
 * @: about round, turning round more than one and a half times, the inner a
 * (the first 30 % of the way) well inside the ring the rest draws, clear of
 * its edges. An O gone over twice runs along the edge instead.
 */
function at(points: readonly Pt[], box: Box): boolean {
  if (box.w < 400 || box.h < 400 || box.w > 1.7 * box.h || box.h > 1.7 * box.w) return false
  const { net } = turning(points, 48)
  if (Math.abs(net) < 1.4 * 2 * Math.PI || Math.abs(net) > 3 * 2 * Math.PI) return false
  const total = pathLength(points)
  let walked = 0
  let split = 0
  while (split + 1 < points.length && walked < 0.3 * total) {
    walked += dist(points[split]!, points[split + 1]!)
    split++
  }
  const ring = boxOf(points.slice(split))
  const mx = 0.12 * ring.w
  const my = 0.12 * ring.h
  const inner = points.slice(0, split)
  const inside = inner.filter((pt) => pt.x >= ring.x + mx && pt.x <= ring.x + ring.w - mx && pt.y >= ring.y + my && pt.y <= ring.y + ring.h - my).length
  return inside >= 0.9 * inner.length
}

/** The label a recognised symbol has in a pen profile. */
const labelOf = (kind: SymbolKind, side: number | undefined): SymbolLabel => (side === undefined ? kind : `${kind}${side}`) as SymbolLabel

/**
 * The symbol a stroke is, among those switched on, or undefined. `near`: the
 * boxes of strokes written just before it, to tell a comma from a letter.
 * `taught`: the person's own strokes (learn.ts). A symbol they have recorded
 * is found by those alone; one they have not, by the rules below, unless the
 * stroke is plainly their writing.
 */
export function symbolOf(stroke: readonly Pt[], on: readonly SymbolKind[], near: readonly Box[] = [], taught?: Taught): RecognisedShape | undefined {
  if (stroke.length < 3 || on.length === 0) return undefined
  // Judged at the size it was drawn on the screen, with the strokes beside it (the pen review's R5); kept in page units.
  const zoom = taught?.zoom ?? 1
  const onPage = (shape: RecognisedShape | undefined): RecognisedShape | undefined => shape && scaledShape(shape, 1 / zoom)
  const drawn = cleaned(zoom === 1 ? stroke : onScreen(stroke, zoom))
  const beside = zoom === 1 ? near : near.map((b) => ({ x: b.x * zoom, y: b.y * zoom, w: b.w * zoom, h: b.h * zoom }))
  const box = boxOf(drawn)
  const pressure = Math.round(meanPressure(drawn))
  const learner = taught?.learner
  const d = learner && describedOn(stroke, zoom)
  let rules = on
  if (learner && d) {
    const known = (Object.keys(SYMBOL_LABELS) as SymbolLabel[]).filter((label) => on.includes(SYMBOL_LABELS[label][0]) && learner.knows(label))
    const picked = learner.pick(d, known, learner.margin.symbol) as SymbolLabel | undefined
    if (picked) {
      const [kind, side] = SYMBOL_LABELS[picked]
      // Beside writing, a comma is well under the height of the letters before it, whoever writes it.
      if (kind === 'comma' && beside.length >= 2 && box.h > 0.65 * median(beside.map((b) => b.h))) return undefined
      return onPage(made(kind, boxKey(box, side), pressure))
    }
    rules = on.filter((kind) => !known.some((label) => SYMBOL_LABELS[label][0] === kind))
  }
  const found = byRules(drawn, box, pressure, rules, beside)
  if (found && learner && d && learner.plain(d, labelOf(found.kind as SymbolKind, found.key[4]), learner.margin.symbol)) return undefined
  return onPage(found)
}

/** The symbol a cleaned stroke is by the general rules, among `on`. */
function byRules(drawn: readonly Pt[], box: Box, pressure: number, on: readonly SymbolKind[], near: readonly Box[]): RecognisedShape | undefined {
  if (on.includes('comma') && comma(drawn, box, near)) return made('comma', boxKey(box), pressure)
  if (on.includes('bracket')) {
    const side = bracket(drawn, box)
    if (side !== undefined) return made('bracket', boxKey(box, side), pressure)
  }
  if (on.includes('brace')) {
    const side = brace(drawn, box)
    if (side !== undefined) return made('brace', boxKey(box, side), pressure)
  }
  if (on.includes('paren')) {
    const side = paren(drawn, box)
    if (side !== undefined) return made('paren', boxKey(box, side), pressure)
  }
  if (on.includes('at') && at(drawn, box)) return made('at', boxKey(box), pressure)
  return undefined
}
