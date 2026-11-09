// Rewriting by diff (note control, step 2, piece 5, 24 October 2026): the model writes the new
// words of the blocks it names, never operations by id or offset; code compares them with the old and changes only
// what changed. Blocks whose words stayed are kept as they are (their ids, marks and look), changed ones are updated,
// new ones added after the one before them, missing ones removed. Inside a changed block, the words that stayed keep
// their marks (bold, a colour, a link), so a rewrite in plain words loses none of them. "Great at rewriting, terrible
// at patching" ([the research](../../../../)).
import { newId } from '../ids.js'
import { plainText, parseInline } from '../markdown/inline.js'
import { fromRuns, toRuns, type Marks, type Run } from '../markdown/runs.js'
import type { Block, Doc } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'

type Text = Extract<Block, { type: 'text' }>

/** A piece of a paragraph to compare: a word, the space between words, or a formula, with its marks. */
type Token = { text: string; marks: Marks } | { math: string; marks: Marks }

const keyOf = (token: Token): string => ('math' in token ? `$${token.math}$` : token.text)
const hasMarks = (marks: Marks): boolean => Object.keys(marks).length > 0
const sameMarks = (a: Marks, b: Marks): boolean => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

/** A word, a space, or one mark of punctuation: the same pieces whatever runs the marks cut the words into ("energy," is two). */
const PIECE = /\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu

function tokensOf(runs: readonly Run[]): Token[] {
  return runs.flatMap((run): Token[] => ('math' in run ? [run] : (run.text.match(PIECE) ?? []).map((text) => ({ text, marks: run.marks }))))
}

/** Pairs of equal tokens, in order: the longest common run of the two (old index, new index). */
export function common(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length
  const m = b.length
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) pairs.push([i++, j++])
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }
  return pairs
}

/** How many tokens two paragraphs may have, multiplied, before the marks are kept by a plain replace instead (a guard). */
const MOST = 400_000

/** A word or a formula: what is paired with the old words. Spaces and punctuation are not: they follow the words around them. */
const isWord = (token: Token): boolean => 'math' in token || /[\p{L}\p{N}]/u.test(token.text)

/**
 * A text block's inline Markdown with its words rewritten: the words that stayed keep their marks; new words take the
 * marks they were written with, or else those of the kept words on both sides when the old text had them in one run
 * (a word changed inside a bold phrase stays bold). Spaces and punctuation take the marks the words on both sides
 * share. Only words and formulas are paired with the old ones: paired spaces once gave a rewrite's spaces the old link
 * and colour, and its new words the code marks of a formula far away (Gemma 4 E4B, the note check of 24 October 2026).
 */
export function rewriteMd(old: string, words: string): string {
  const before = tokensOf(toRuns(old))
  const after = tokensOf(toRuns(words.replace(/\s*\n\s*/gu, ' ').trim()))
  if (before.length * after.length > MOST) return fromRuns(after.map((token) => ('math' in token ? { math: token.math, marks: token.marks } : { text: token.text, marks: token.marks })))
  const oldWords = before.flatMap((token, i) => (isWord(token) ? [i] : []))
  const newWords = after.flatMap((token, j) => (isWord(token) ? [j] : []))
  const pairs = common(oldWords.map((i) => keyOf(before[i]!)), newWords.map((j) => keyOf(after[j]!)))
  const kept = new Map(pairs.map(([i, j]) => [newWords[j]!, oldWords[i]!]))
  /** Whether every old word from one kept word to another has these marks: a run the new words sit inside. */
  const inOneRun = (from: number, to: number, marks: Marks): boolean => before.slice(from, to + 1).every((token) => !isWord(token) || sameMarks(token.marks, marks))
  /**
   * A marked word's run in the old text: the words next to it with the same marks. A kept word keeps the run's marks
   * when the run is the word alone (*energy*) or another of its words is kept within two words of it: a lone "v"
   * paired with the v of an old `v = f λ` is no code; "very … wave" of an old **very big wave** stays bold.
   */
  const keptOld = new Set(kept.values())
  const runOf = (i: number): number[] => {
    const marks = before[i]!.marks
    const at = oldWords.indexOf(i)
    let from = at
    while (from > 0 && sameMarks(before[oldWords[from - 1]!]!.marks, marks)) from--
    let to = at
    while (to + 1 < oldWords.length && sameMarks(before[oldWords[to + 1]!]!.marks, marks)) to++
    return oldWords.slice(from, to + 1)
  }
  const newOf = new Map([...kept].map(([j, i]) => [i, newWords.indexOf(j)]))
  const keepsRun = (i: number): boolean => {
    const run = runOf(i)
    if (run.length === 1) return true
    // Another word of the run kept close by, within two words: the run is still there, its words reworded.
    const here = newOf.get(i)!
    return run.some((k) => k !== i && keptOld.has(k) && Math.abs(newOf.get(k)! - here) <= 2)
  }
  const marked: Token[] = after.map((token, j) => {
    if (!isWord(token)) return token
    const was = kept.get(j)
    // Kept: its old marks, unless it was written with marks of its own.
    if (was !== undefined) return hasMarks(token.marks) || (hasMarks(before[was]!.marks) && !keepsRun(was)) ? token : before[was]!
    // A formula never takes its neighbours' marks: code, say, cannot hold one.
    if (hasMarks(token.marks) || 'math' in token) return token
    // New: the marks of the kept words on both sides, when the old text had them in one run.
    let left: number | undefined
    // Only kept words that keep their run's marks count (keepsRun).
    for (let k = j - 1; k >= 0; k--) if (kept.has(k)) { left = keepsRun(kept.get(k)!) ? kept.get(k) : undefined; break }
    let right: number | undefined
    for (let k = j + 1; k < after.length; k++) if (kept.has(k)) { right = keepsRun(kept.get(k)!) ? kept.get(k) : undefined; break }
    if (left === undefined || right === undefined || left > right) return token
    const marks = before[left]!.marks
    return hasMarks(marks) && sameMarks(marks, before[right]!.marks) && inOneRun(left, right, marks) ? { ...token, marks } : token
  })
  // Spaces and punctuation: the marks the words on both sides share, or none.
  const out: Token[] = marked.map((token, j) => {
    if (isWord(token) || hasMarks(token.marks)) return token
    let left: Token | undefined
    for (let k = j - 1; k >= 0; k--) if (isWord(marked[k]!)) { left = marked[k]; break }
    let right: Token | undefined
    for (let k = j + 1; k < marked.length; k++) if (isWord(marked[k]!)) { right = marked[k]; break }
    return left && right && hasMarks(left.marks) && sameMarks(left.marks, right.marks) ? { ...token, marks: left.marks } : token
  })
  const runs = out.map((token): Run => ('math' in token ? { math: token.math, marks: token.marks } : { text: token.text, marks: token.marks }))
  const md = fromRuns(runs)
  // The same words, the same marks: the block as it was, byte for byte.
  return plainText(parseInline(md)) === plainText(parseInline(old)) && JSON.stringify(toRuns(md)) === JSON.stringify(toRuns(old)) ? old : md
}

/** What a rewrite did, block by block. */
export interface Rewritten {
  ops: Op[]
  /** The ids of the blocks it added, in order. */
  made: string[]
  kept: string[]
  changed: string[]
  removed: string[]
}

/**
 * Blocks of one frame, in order, rewritten as new paragraphs (the words under the command, a paragraph each, or a line
 * each for a list's items): kept, changed, added or removed, so only what changed changes. A new block takes the role
 * and indent of the block it follows (or of the first, at the start); `roleOf` may give each its own.
 */
export function rewriteBlocks(doc: Doc, ids: readonly string[], parts: readonly string[], taken: (id: string) => boolean, roleOf?: (part: number) => Pick<Text, 'role' | 'indent'>): Rewritten {
  const blocks = ids.map((id) => doc.block[id])
  if (blocks.length === 0 || blocks.some((block) => block?.type !== 'text')) throw new Error('Only text blocks are rewritten by their words: a heading, a paragraph, a quote or a list.')
  const texts = blocks as Text[]
  const parent = texts[0]!.parent
  if (texts.some((block) => block.parent !== parent)) throw new Error('The blocks rewritten together must be in one text frame.')
  const frame = doc.block[parent]
  if (frame?.type !== 'frame') throw new Error(`Block ${texts[0]!.id} is in no text frame.`)
  const words = texts.map((block) => plainText(parseInline(block.md)))
  const pairs = common(words.map((one) => one.replace(/\s+/gu, ' ').trim()), parts.map((one) => one.replace(/\s+/gu, ' ').trim()))
  const out: Rewritten = { ops: [], made: [], kept: [], changed: [], removed: [] }
  const made = new Set<string>()
  const fresh = (): string => {
    const id = newId((one) => taken(one) || made.has(one))
    made.add(id)
    return id
  }
  // Where the next new block goes: after the last block kept or changed, in the frame as it is then; before any, where
  // the first of them was.
  const kids = [...frame.kids]
  const start = kids.indexOf(texts[0]!.id)
  let last: Text | undefined
  const addAfter = (part: number, like: Text): void => {
    const id = fresh()
    const at = last ? kids.indexOf(last.id) + 1 : start
    const shape = roleOf?.(part) ?? { role: like.role, indent: like.indent }
    const block: Text = { id, r: 0, type: 'text', parent, role: shape.role, indent: shape.indent, md: parts[part]!.replace(/\s*\n\s*/gu, ' ').trim() }
    out.ops.push({ op: 'add', block, at })
    kids.splice(at, 0, id)
    out.made.push(id)
    last = block
  }
  let i = 0
  let j = 0
  for (const [oi, nj] of [...pairs, [texts.length, parts.length] as [number, number]]) {
    // The gap before this pair: old blocks oi..i paired with new parts in order, changed; the rest added or removed.
    const olds = texts.slice(i, oi)
    const news = parts.slice(j, nj)
    for (let k = 0; k < Math.max(olds.length, news.length); k++) {
      const block = olds[k]
      if (block && k < news.length) {
        const md = rewriteMd(block.md, news[k]!)
        const shape = roleOf?.(j + k)
        const set: Record<string, unknown> = md === block.md ? {} : { md }
        if (shape && shape.role !== block.role) set.role = shape.role
        if (shape && shape.indent !== block.indent) set.indent = shape.indent
        if (Object.keys(set).length > 0) {
          out.ops.push({ op: 'update', id: block.id, set })
          out.changed.push(block.id)
        } else out.kept.push(block.id)
        last = block
      } else if (block) {
        out.ops.push({ op: 'remove', id: block.id })
        kids.splice(kids.indexOf(block.id), 1)
        out.removed.push(block.id)
      } else addAfter(j + k, last ?? texts[0]!)
    }
    if (oi < texts.length) {
      // The same words: kept, unless its role or indent is to change (a list item moved in a level).
      const block = texts[oi]!
      const shape = roleOf?.(nj)
      const set: Record<string, unknown> = {}
      if (shape && shape.role !== block.role) set.role = shape.role
      if (shape && shape.indent !== block.indent) set.indent = shape.indent
      if (Object.keys(set).length > 0) {
        out.ops.push({ op: 'update', id: block.id, set })
        out.changed.push(block.id)
      } else out.kept.push(block.id)
      last = block
    }
    i = oi + 1
    j = nj + 1
  }
  return out
}
