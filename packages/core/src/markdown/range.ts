// Changing part of a block's text: the words a person selected. Used by the
// AI operations `mark` (bold, colour, link… on the selected words) and
// `rewrite` of a selection.
//
// Positions count characters of plainText(): the words without markup, where
// inline math reads as $…$. A formula is one unit: a range that touches part
// of it takes all of it.
import type { AnyColor } from '../schema/doc.js'
import { normalize, parseInline, plainText, serializeInline, type Inline, type Mark, type Size } from './inline.js'

/** A stretch of text with the formatting that applies to all of it. */
interface Run {
  kind: 'text' | 'code' | 'math'
  /** The characters as plainText() shows them (math includes its $ signs). */
  text: string
  marks: Mark[]
  color?: AnyColor
  href?: string
  size?: Size
  font?: string
}

/** One formatting change. For booleans, true adds and false removes. */
export interface MarkChange {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  highlight?: boolean
  code?: boolean
  /** "ink", the default colour, removes the colour, unless `inkOwn` is set. */
  color?: AnyColor
  /** Set by people: "ink" stays as the words' own colour, so words inside a coloured block show in ink, as in Word. */
  inkOwn?: boolean
  /** A link address to add, or null to remove the link. */
  link?: string | null
  /** From version 2, set by people: underline, subscript and superscript. */
  underline?: boolean
  sub?: boolean
  sup?: boolean
  /** From version 2, set by people: a size or a font for the words, or null to give them the block's. */
  size?: Size | null
  font?: string | null
}

const MARK_ORDER: readonly Mark[] = ['b', 'i', 's', 'hl', 'u', 'sub', 'sup']
const FLAG: Record<'bold' | 'italic' | 'strike' | 'highlight' | 'underline' | 'sub' | 'sup', Mark> = {
  bold: 'b',
  italic: 'i',
  strike: 's',
  highlight: 'hl',
  underline: 'u',
  sub: 'sub',
  sup: 'sup',
}

/** Apply a formatting change to characters [start, end) of a block's md. */
export function markRange(md: string, start: number, end: number, change: MarkChange): string {
  const runs = cut(toRuns(parseInline(md)), start, end)
  return serializeInline(
    fromRuns(
      runs.map(({ run, inside }) => (inside ? changed(run, change) : run)),
    ),
  )
}

/** Replace characters [start, end) of a block's md with new md, which keeps the formatting it replaces. */
export function replaceRange(md: string, start: number, end: number, replacement: string): string {
  const pieces = cut(toRuns(parseInline(md)), start, end)
  // New words take the formatting of the first word they replace, or of the text just before them.
  const like = pieces.find((p) => p.inside)?.run ?? pieces.findLast((p) => p.end <= start)?.run
  const added = toRuns(parseInline(replacement)).map((run) => (like ? inherit(run, like) : run))
  const before = pieces.filter((p) => !p.inside && p.end <= start).map((p) => p.run)
  const after = pieces.filter((p) => !p.inside && p.begin >= end).map((p) => p.run)
  return serializeInline(fromRuns([...before, ...added, ...after]))
}

/**
 * Every match of `pattern` (with the g flag) in characters [start, end) of a
 * block's text, replaced by the words `by` gives for it, each keeping the
 * formatting of the words it replaces: find and replace (ai/swap.ts). A match
 * that touches code or a formula is left as it is; a link keeps its address.
 */
export function replaceMatches(md: string, pattern: RegExp, by: (found: string) => string, start = 0, end = Number.POSITIVE_INFINITY): string {
  const runs = toRuns(parseInline(md))
  const text = runs.map((run) => run.text).join('')
  // Where code and formulas are, which no match may touch.
  const kept: [number, number][] = []
  let at = 0
  for (const run of runs) {
    if (run.kind !== 'text') kept.push([at, at + run.text.length])
    at += run.text.length
  }
  const hits = [...text.matchAll(pattern)].filter((hit) => {
    const to = hit.index + hit[0].length
    return hit[0].length > 0 && hit.index >= start && to <= end && kept.every(([from, until]) => to <= from || hit.index >= until)
  })
  // From the last match back, so the positions of the earlier ones still hold.
  let out = md
  for (const hit of hits.reverse()) out = replaceRange(out, hit.index, hit.index + hit[0].length, serializeInline([{ t: 'text', v: by(hit[0]) }]))
  return out
}

/**
 * A block's text one character at a time, each with its formatting written
 * as a short key, so two texts can be compared letter by letter, formatting
 * and all (the AI's scope check, ai/scope.ts).
 */
export function lettersOf(md: string): { ch: string; style: string }[] {
  return toRuns(parseInline(md)).flatMap((run) => {
    const style = JSON.stringify([run.kind, [...run.marks].sort(), run.color ?? '', run.href ?? '', run.size ?? '', run.font ?? ''])
    // Units of the string, as text positions count them, so an emoji is two.
    return run.text.split('').map((ch) => ({ ch, style }))
  })
}

/** The length of a block's text, in the positions these functions use. */
export function textLength(md: string): number {
  return plainText(parseInline(md)).length
}

/** What wraps a run besides its marks: a colour, a link, a size, a font. */
type Wrap = Pick<Run, 'color' | 'href' | 'size' | 'font'>

function toRuns(nodes: readonly Inline[], marks: Mark[] = [], wrap: Wrap = {}): Run[] {
  const style = { marks, ...wrap }
  return nodes.flatMap((node): Run[] => {
    switch (node.t) {
      case 'text':
        return [{ kind: 'text', text: node.v, ...style }]
      case 'code':
        return [{ kind: 'code', text: node.v, ...style }]
      case 'math':
        return [{ kind: 'math', text: `$${node.v}$`, ...style }]
      case 'link':
        return toRuns(node.c, marks, { ...wrap, href: node.href })
      case 'color':
        return toRuns(node.c, marks, { ...wrap, color: node.color })
      case 'size':
        return toRuns(node.c, marks, { ...wrap, size: node.size })
      case 'font':
        return toRuns(node.c, marks, { ...wrap, font: node.font })
      default:
        return toRuns(node.c, marks.includes(node.t) ? marks : [...marks, node.t], wrap)
    }
  })
}

/** Split runs at `start` and `end`, marking which pieces fall inside. Math is never split. */
function cut(runs: Run[], start: number, end: number): { run: Run; inside: boolean; begin: number; end: number }[] {
  const out: { run: Run; inside: boolean; begin: number; end: number }[] = []
  let at = 0
  for (const run of runs) {
    const from = at
    const to = at + run.text.length
    at = to
    if (run.kind === 'math') {
      out.push({ run, inside: to > start && from < end, begin: from, end: to })
      continue
    }
    const points = [from, Math.min(Math.max(start, from), to), Math.min(Math.max(end, from), to), to]
    for (let i = 0; i < 3; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      if (b > a) out.push({ run: { ...run, text: run.text.slice(a - from, b - from) }, inside: a >= start && b <= end, begin: a, end: b })
    }
  }
  return out
}

function changed(run: Run, change: MarkChange): Run {
  const next: Run = { ...run, marks: [...run.marks] }
  for (const [flag, mark] of Object.entries(FLAG) as [keyof typeof FLAG, Mark][]) {
    const on = change[flag]
    if (on === true && !next.marks.includes(mark)) next.marks.push(mark)
    if (on === false) next.marks = next.marks.filter((m) => m !== mark)
  }
  // Subscript and superscript exclude each other, as in Word.
  if (change.sub === true) next.marks = next.marks.filter((m) => m !== 'sup')
  if (change.sup === true) next.marks = next.marks.filter((m) => m !== 'sub')
  if (change.size !== undefined) {
    if (change.size === null) delete next.size
    else next.size = change.size
  }
  if (change.font !== undefined) {
    if (change.font === null) delete next.font
    else next.font = change.font
  }
  if (change.color !== undefined) {
    if (change.color === 'ink' && change.inkOwn !== true) delete next.color
    else next.color = change.color
  }
  if (change.link !== undefined) {
    if (change.link === null) delete next.href
    else next.href = change.link
  }
  if (change.code === true && next.kind === 'text') next.kind = 'code'
  if (change.code === false && next.kind === 'code') next.kind = 'text'
  return next
}

/** Give new text the formatting of the text it replaces, on top of its own. */
function inherit(run: Run, from: Run): Run {
  return {
    ...run,
    // Words typed into a code span stay code.
    kind: from.kind === 'code' && run.kind === 'text' ? 'code' : run.kind,
    marks: [...new Set([...from.marks, ...run.marks])],
    ...(run.color === undefined && from.color !== undefined ? { color: from.color } : {}),
    ...(run.href === undefined && from.href !== undefined ? { href: from.href } : {}),
    ...(run.size === undefined && from.size !== undefined ? { size: from.size } : {}),
    ...(run.font === undefined && from.font !== undefined ? { font: from.font } : {}),
  }
}

/**
 * Rebuild nodes from runs. Neighbouring runs that share a link, a colour, a
 * size, a font or a mark are grouped under one node, from the outside in:
 * link, colour, size, font, then the marks in the order b, i, s, hl, u, sub, sup.
 */
function fromRuns(runs: readonly Run[]): Inline[] {
  return normalize(group(runs, 0))
}

const LAYERS = ['link', 'color', 'size', 'font', ...MARK_ORDER] as const

function group(runs: readonly Run[], layer: number): Inline[] {
  if (layer === LAYERS.length) return runs.map(leaf)
  const name = LAYERS[layer]!
  const keyOf = (run: Run): string | undefined =>
    name === 'link' ? run.href : name === 'color' ? run.color : name === 'size' ? run.size : name === 'font' ? run.font : run.marks.includes(name) ? name : undefined
  const out: Inline[] = []
  for (let i = 0; i < runs.length; ) {
    const key = keyOf(runs[i]!)
    let j = i + 1
    while (j < runs.length && keyOf(runs[j]!) === key) j++
    const inner = group(runs.slice(i, j), layer + 1)
    if (key === undefined) out.push(...inner)
    else if (name === 'link') out.push({ t: 'link', href: key, c: inner })
    else if (name === 'color') out.push({ t: 'color', color: key as AnyColor, c: inner })
    else if (name === 'size') out.push({ t: 'size', size: key as Size, c: inner })
    else if (name === 'font') out.push({ t: 'font', font: key, c: inner })
    else out.push({ t: name, c: inner })
    i = j
  }
  return out
}

function leaf(run: Run): Inline {
  if (run.kind === 'math') return { t: 'math', v: run.text.slice(1, -1) }
  return run.kind === 'code' ? { t: 'code', v: run.text } : { t: 'text', v: run.text }
}
