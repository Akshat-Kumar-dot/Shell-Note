// Removing what a person (or the AI) chose: whole blocks, and words cut out of
// a block's text. One rule for both, so Delete in the editor and an AI delete
// leave the note alike.
import { parseInline, plainText } from '../markdown/inline.js'
import { replaceRange } from '../markdown/range.js'
import { spliceFor } from '../splice.js'
import type { Doc, Frame, Id } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import type { WordRange } from './selection.js'

/** One stretch of text taken out: [start, end) in the plain-text positions of the text before it. */
export interface Cut {
  start: number
  end: number
}

/**
 * A block's md with pieces of its text cut out, last piece first so the
 * earlier ones keep their positions. A piece of whole words takes one space
 * beside it along, so no double space is left; letters cut from part of a word
 * go alone, so the rest of the word stays as it was.
 */
export function cutWords(md: string, pieces: readonly { start: number; end: number }[]): { md: string; cuts: Cut[] } {
  let out = md
  const cuts: Cut[] = []
  for (const piece of [...pieces].sort((a, b) => b.start - a.start)) {
    const text = plainText(parseInline(out))
    let { start, end } = piece
    if (start >= end || end > text.length) continue
    const wholeWords = (start === 0 || /\s/u.test(text[start - 1]!)) && (end === text.length || /\s/u.test(text[end]!))
    if (wholeWords && text[end] === ' ') end++
    else if (wholeWords && text[start - 1] === ' ') start--
    out = replaceRange(out, start, end, '')
    cuts.push({ start, end })
  }
  return { md: out, cuts }
}

/**
 * The operations that remove chosen blocks and cut chosen words out of their
 * text. A text block left with no words goes, and a frame left with nothing
 * in it goes too.
 */
export function removalOps(doc: Doc, ids: readonly Id[], words: readonly WordRange[] = []): Op[] {
  const cut = new Map<Id, { before: string; after: string }>()
  for (const id of new Set(words.map((piece) => piece.block))) {
    const block = doc.block[id]
    if (block?.type !== 'text' || ids.includes(id)) continue
    const { md } = cutWords(
      block.md,
      words.filter((p) => p.block === id),
    )
    if (md !== block.md) cut.set(id, { before: block.md, after: md })
  }
  const emptied = [...cut].filter(([, { after }]) => plainText(parseInline(after)).trim() === '').map(([id]) => id)
  const chosen = new Set([...ids, ...emptied].filter((id) => doc.block[id] !== undefined))
  // Frames whose blocks are all chosen go whole, which takes their blocks with them.
  const frames = new Set<Id>()
  for (const id of chosen) {
    const block = doc.block[id]!
    if (block.type === 'frame') frames.add(id)
    else if ('parent' in block && (doc.block[block.parent] as Frame).kids.every((kid) => chosen.has(kid))) frames.add(block.parent)
  }
  const ops: Op[] = [...frames].map((id): Op => ({ op: 'remove', id }))
  for (const id of chosen) {
    const block = doc.block[id]!
    if (block.type !== 'frame' && !('parent' in block && frames.has(block.parent))) ops.push({ op: 'remove', id })
  }
  for (const [id, { before, after }] of cut) if (!chosen.has(id)) ops.push(spliceFor(id, 'md', before, after))
  return ops
}
