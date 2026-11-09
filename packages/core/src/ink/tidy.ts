// Tidying the handwriting in a note (stage 2): words found on the page, tidied (neaten.ts) and, a line at a time,
// levelled, as operations for apply(). The pen tidies each word as the next one starts and each line as the next one
// starts; the Tidy button does a whole note. Strokes are named by their block, their place in it
// and their points on the page, and one changed or taken away since is left alone.
import type { Doc, Id, InkBlock, Stroke } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { boxOf, pointsOf, triplesOf, type Box, type Pt } from './geometry.js'
import { editInk } from './group.js'
import { bandOf, baselineOf, changes, letterShifts, levelShifts, rowsOf, spacingShifts, tidied, tidiedTilt, tidyStroke, tidyWord, type LevelWord, type LineAnchor, type TidyRules, type WordGapChoice, ALL_TIDY_RULES } from './neaten.js'

/** A stroke in a block: the block, its place there, and its points on the page when last seen. */
export interface InkRef {
  block: Id
  index: number
  page: Pt[]
}

/** Handwriting: a stroke that is not a shape, a line straightened, or the highlighter's. */
export const isWriting = (stroke: Stroke): boolean => !stroke.shape && !stroke.straight && stroke.tool !== 'highlighter'

/** A block's stroke, its points on the page. */
export const pagePoints = (block: { x: number; y: number }, stroke: Stroke): Pt[] => pointsOf(stroke.pts).map((pt) => ({ ...pt, x: pt.x + block.x, y: pt.y + block.y }))

/** Whether two lines are the very same points. */
export const samePoints = (a: readonly Pt[], b: readonly Pt[]): boolean => a.length === b.length && a.every((pt, i) => pt.x === b[i]!.x && pt.y === b[i]!.y)

/** The handwriting stroke a ref names, if it is still as it was seen. */
function found(doc: Doc, ref: InkRef): { block: InkBlock; stroke: Stroke } | undefined {
  const block = doc.block[ref.block]
  if (block?.type !== 'ink') return undefined
  const stroke = block.strokes[ref.index]
  if (!stroke || !isWriting(stroke) || !samePoints(pagePoints(block, stroke), ref.page)) return undefined
  return { block, stroke }
}

/** Strokes to replace, by block and place. */
type Replacements = Map<Id, Map<number, Stroke>>

/**
 * Words tidied into `into`: each word's strokes tidied at the letter size of
 * all of them, and with `line`, as one finished line: each
 * separate letter onto its word's baseline, the words onto the first word's
 * baseline, and evenly spaced. Each ref changed, with the ref it becomes,
 * into `moved`.
 */
/** How a finished line is levelled and spaced: the person's choices (PenSettings' anchor and wordGap). */
export interface LineChoices {
  anchor: LineAnchor
  wordGap: WordGapChoice
  /** The rules tried one by one in developer mode; all, as built, when not given. */
  rules?: TidyRules
}
const AS_PICKED: LineChoices = { anchor: 'first', wordGap: 'usual' }

function tidyInto(doc: Doc, words: readonly (readonly InkRef[])[], line: boolean, into: Replacements, moved: Map<InkRef, InkRef>, choices: LineChoices = AS_PICKED): void {
  const rules = choices.rules ?? ALL_TIDY_RULES
  const present = words.map((word) => word.flatMap((ref) => (found(doc, ref) ? [ref] : []))).filter((word) => word.length > 0)
  const live = rules.marks ? withMarks(present) : present.map((word) => [...word])
  const size = bandOf(live.flat().map((ref) => ref.page))?.size
  const after = live.map((word) => {
    const tidy = rules.ends ? tidyWord(word.map((ref) => ref.page), size) : word.map((ref) => ({ from: 0, to: ref.page.length - 1 }))
    const pages = word.map((ref, i) => tidied(ref.page, tidy[i]!))
    const lift = line && size !== undefined && rules.letters ? letterShifts(pages, size, rules) : pages.map(() => 0)
    return word.map((ref, i) => ({ ref, tidy: tidy[i]!, page: lift[i] === 0 ? pages[i]! : pages[i]!.map((pt) => ({ ...pt, y: pt.y + lift[i]! })), lift: lift[i]! }))
  })
  // Where the line's words sit as written: the middle of their baselines, for a word whose own is a tie (baselineOf).
  const sits = after.flatMap((word) => {
    const base = baselineOf(word.map((s) => s.page), size ?? 300, undefined, rules)
    return base === undefined ? [] : [base]
  })
  sits.sort((a, b) => a - b)
  const line_ = sits[sits.length >> 1]
  const dy = line && rules.level ? levelShifts(after.map((word) => levelWord(word.map((s) => s.page), size, line_, rules)), choices.anchor) : after.map(() => 0)
  const dx =
    line && size !== undefined && rules.gaps
      ? spacingShifts(after.map((word) => ((b: Box) => ({ x0: b.x, x1: b.x + b.w }))(boxOf(word.flatMap((s) => s.page)))), size, rules.margin ? rightOf(doc, live[0]?.[0]) : undefined, choices.wordGap)
      : after.map(() => 0)
  after.forEach((word, w) => {
    for (const { ref, tidy, page, lift } of word) {
      if (!changes(tidy, ref.page.length) && lift === 0 && dy[w] === 0 && dx[w] === 0) continue
      const shifted = dy[w] === 0 && dx[w] === 0 ? page : page.map((pt) => ({ ...pt, x: pt.x + dx[w]!, y: pt.y + dy[w]! }))
      place(doc, ref, tidy, shifted, into, moved)
    }
  })
}

/**
 * A line is spaced no further right than it was written, or than EDGE from the
 * right edge of its page, whichever is further: not into the margin (a test
 * line spaced to 4 mm from the edge, 17 October 2026).
 */
const EDGE = 1500

function rightOf(doc: Doc, ref: InkRef | undefined): number | undefined {
  if (!ref) return undefined
  const page = doc.pages.map((id) => doc.page[id]).find((p) => p?.free.includes(ref.block))
  return page ? page.w - EDGE : undefined
}

/**
 * A mark (withMarks): smaller than SMALL of the line's usual stroke height, and round or flat, no taller than ROUND
 * times its width (a dot, a little circle, a dash). A short i stem is as small, but tall and thin: a letter.
 */
const SMALL = 0.5
const ROUND = 1.5

/**
 * The words with any made of marks alone (an i's dot taken for a word of its own) put with the word nearest them
 * across: levelled by its own bottom and spaced as a word, a dot drawn as a little circle went onto the line beside
 * its i, and once beside "Hell", looked like its o.
 */
function withMarks(words: readonly (readonly InkRef[])[]): InkRef[][] {
  const boxes = new Map<InkRef, Box>(words.flat().map((ref) => [ref, boxOf(ref.page)]))
  const heights = [...boxes.values()].map((b) => b.h).sort((a, b) => a - b)
  const usual = heights[heights.length >> 1] ?? 0
  const small = (ref: InkRef): boolean => {
    const b = boxes.get(ref)!
    return Math.max(b.w, b.h) < SMALL * usual && b.h <= ROUND * Math.max(1, b.w)
  }
  const out = words.map((word) => [...word])
  const span = (word: readonly InkRef[]): { x0: number; x1: number } => {
    const bs = word.map((ref) => boxes.get(ref)!)
    return { x0: Math.min(...bs.map((b) => b.x)), x1: Math.max(...bs.map((b) => b.x + b.w)) }
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const word = out[i]!
    if (!word.every(small)) continue
    const me = span(word)
    let nearest = -1
    let gap = Infinity
    out.forEach((other, j) => {
      if (j === i || other.every(small)) return
      const them = span(other)
      const apart = Math.max(0, them.x0 - me.x1, me.x0 - them.x1)
      if (apart < gap) {
        gap = apart
        nearest = j
      }
    })
    if (nearest < 0) continue
    out[nearest]!.push(...word)
    out.splice(i, 1)
  }
  return out
}

/** A stroke as tidied and moved, into the replacements, and its ref as it becomes. */
function place(doc: Doc, ref: InkRef, tidy: { from: number; to: number; before?: Pt; after?: Pt }, page: readonly Pt[], into: Replacements, moved: Map<InkRef, InkRef>): void {
  const { block, stroke } = found(doc, ref)!
  const next: Stroke = { ...stroke, pts: triplesOf(page.map((pt) => ({ ...pt, x: pt.x - block.x, y: pt.y - block.y }))) }
  if (stroke.tilt) next.tilt = tidiedTilt(stroke.tilt, tidy)
  const forBlock = into.get(ref.block) ?? new Map<number, Stroke>()
  forBlock.set(ref.index, next)
  into.set(ref.block, forBlock)
  moved.set(ref, { block: ref.block, index: ref.index, page: pagePoints(block, next) })
}

/** A word as levelling sees it: where it starts and ends, where its letters sit (none for a dot or a dash), and its letter size. */
function levelWord(strokes: readonly (readonly Pt[])[], lineSize: number | undefined, near: number | undefined, rules: TidyRules): LevelWord {
  const size = lineSize ?? bandOf(strokes)?.size ?? 300
  const xs = strokes.flatMap((s) => s.map((pt) => pt.x))
  let baseline = baselineOf(strokes, size, near, rules)
  // A word of one glyph, a digit above all: on its base, its lowest point once the little flicks at its ends are left
  // out, when that is nearer the line than where its bottoms say (the project's rule for digits, 17 October 2026); a
  // y stays on its join, its tail far under the line.
  const letters = strokes.filter((s) => {
    const b = boxOf(s)
    return Math.max(b.w, b.h) >= SMALL * size || b.h > ROUND * Math.max(1, b.w)
  })
  if (rules.base && near !== undefined && letters.length > 0 && letters.length <= 2) {
    const base = Math.max(...letters.map((s) => baseOf(s, size)))
    if (baseline === undefined || Math.abs(base - near) < Math.abs(baseline - near)) baseline = base
  }
  return { x: Math.min(...xs), x1: Math.max(...xs), size, ...(baseline === undefined ? {} : { baseline }) }
}

/** A flick at a stroke's end, this share of the letter size of line or less, dipping under the rest, is left out of its base. */
const FLICK = 0.3

/** A stroke's base: its lowest point, a short flick at either end that dips under the rest of it left out. */
function baseOf(stroke: readonly Pt[], size: number): number {
  let from = 0
  let to = stroke.length - 1
  const cut = (start: number, step: 1 | -1): number => {
    let walked = 0
    let k = start
    while (k + step >= 0 && k + step < stroke.length && walked + Math.hypot(stroke[k + step]!.x - stroke[k]!.x, stroke[k + step]!.y - stroke[k]!.y) <= FLICK * size) {
      walked += Math.hypot(stroke[k + step]!.x - stroke[k]!.x, stroke[k + step]!.y - stroke[k]!.y)
      k += step
    }
    return k
  }
  const lowest = (a: number, b: number): number => Math.max(...stroke.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.y))
  const endCut = cut(stroke.length - 1, -1)
  if (endCut > 0 && lowest(endCut + 1, stroke.length - 1) > lowest(0, endCut)) to = endCut
  const startCut = cut(0, 1)
  if (startCut < to && lowest(0, startCut - 1) > lowest(startCut, to)) from = startCut
  return lowest(from, to)
}

/** The operations for the replacements: one edit of each block, its box kept round its ink. */
function opsOf(doc: Doc, replacements: Replacements): Op[] {
  const ops: Op[] = []
  for (const [id, strokes] of replacements) ops.push(...editInk(doc, id, { replace: new Map([...strokes].map(([index, stroke]) => [index, [stroke]])) }))
  return ops
}

/**
 * Tidying words, and with `line`, as one finished line (la1,
 * lc1): the operations, none when nothing changes, and each ref changed
 * with the ref it becomes (a block that grows left or up moves its strokes
 * within it, so refs go by points on the page).
 */
export function tidyOps(doc: Doc, words: readonly (readonly InkRef[])[], line: boolean, choices: LineChoices = AS_PICKED): { ops: Op[]; moved: Map<InkRef, InkRef> } {
  const replacements: Replacements = new Map()
  const moved = new Map<InkRef, InkRef>()
  tidyInto(doc, words, line, replacements, moved, choices)
  return { ops: opsOf(doc, replacements), moved }
}

/**
 * A stroke tidied as the pen lifts, the strokes before it in its
 * word as they are, at the letter size given: the operations, none when
 * nothing changes, and the stroke as it becomes.
 */
export function tidyStrokeOps(doc: Doc, ref: InkRef, earlier: readonly InkRef[], size: number, rules: TidyRules = ALL_TIDY_RULES): { ops: Op[]; now: InkRef } {
  if (!rules.ends || !found(doc, ref)) return { ops: [], now: ref }
  const tidy = tidyStroke(
    ref.page,
    earlier.flatMap((e) => (found(doc, e) ? [e.page] : [])),
    size,
  )
  if (!changes(tidy, ref.page.length)) return { ops: [], now: ref }
  const replacements: Replacements = new Map()
  const moved = new Map<InkRef, InkRef>()
  place(doc, ref, tidy, tidied(ref.page, tidy), replacements, moved)
  return { ops: opsOf(doc, replacements), now: moved.get(ref)! }
}

/** A page's handwriting, in the order written: its ink blocks oldest first, each block's strokes in order. */
export function writingOn(doc: Doc, page: Id): InkRef[] {
  const refs: InkRef[] = []
  for (const id of doc.page[page]?.free ?? []) {
    const block = doc.block[id]
    if (block?.type !== 'ink') continue
    block.strokes.forEach((stroke, index) => {
      if (isWriting(stroke)) refs.push({ block: id, index, page: pagePoints(block, stroke) })
    })
  }
  return refs
}

/** Some handwriting, in the order written, tidied as rows of words (rowsOf; tidyInto, as finished lines), into the replacements. */
function tidyLines(doc: Doc, refs: readonly InkRef[], into: Replacements, choices: LineChoices): void {
  for (const row of rowsOf(refs.map((ref) => ref.page))) tidyInto(doc, row.map((word) => word.map((i) => refs[i]!)), true, into, new Map(), choices)
}

/** The whole note tidied (the wand's Whole note): every page's handwriting as lines of words, each tidied as a finished line. One set of operations. */
export function tidyNoteOps(doc: Doc, choices: LineChoices = AS_PICKED): Op[] {
  const replacements: Replacements = new Map()
  for (const page of doc.pages) tidyLines(doc, writingOn(doc, page), replacements, choices)
  return opsOf(doc, replacements)
}

/**
 * The handwriting in a box on a page tidied (the wand, then a box
 * dragged over the writing): the strokes whose middle is in the box, as
 * lines of words, each tidied as a finished line. One set of operations.
 */
export function tidyBoxOps(doc: Doc, page: Id, box: Box, choices: LineChoices = AS_PICKED): Op[] {
  const inside = writingOn(doc, page).filter((ref) => {
    const b = boxOf(ref.page)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
  })
  const replacements: Replacements = new Map()
  tidyLines(doc, inside, replacements, choices)
  return opsOf(doc, replacements)
}
