// The scope rule, checked on the whole note once an AI edit
// is compiled, whatever the model was told: it changes only what was
// selected, whole blocks or, inside a block, only the chosen words; and it adds
// only where it may, inside a Select box, or next to the selection.
//
// Compiling already keeps to this by construction. This is the second line:
// a mistake in code, or a reply that slipped through, is refused here before
// the note changes.
import { lettersOf } from '../markdown/range.js'
import type { Block, Doc, Frame, Id } from '../schema/doc.js'
import type { Here, Selection, WordRange } from '../select/selection.js'
import { inBox, type Aliases } from './alias.js'

type Letter = { ch: string; style: string }

/** Null when an edit keeps to its scope, or what it did outside it, in words a model can act on. */
export function outsideScope(before: Doc, after: Doc, selection: Selection, aliases: Aliases): string | null {
  const whole = new Set(aliases.selected.filter((s) => s.words === undefined).map((s) => s.id))
  const pieces = new Map<Id, WordRange[]>()
  for (const s of aliases.selected) if (s.words) pieces.set(s.id, [...(pieces.get(s.id) ?? []), s.words])
  const near = new Set(aliases.near.map((n) => n.id))
  const box = inBox(selection) ? (selection.here as Extract<Here, { page: Id }>) : undefined

  if (before.title !== after.title || JSON.stringify(before.rules) !== JSON.stringify(after.rules)) {
    return 'The note\'s title and rules are not part of the selection: leave them as they are.'
  }
  if (box && JSON.stringify(before.pages) !== JSON.stringify(after.pages)) return 'New things go only into the box, never onto another page.'

  for (const id of new Set([...Object.keys(before.block), ...Object.keys(after.block)])) {
    const old = before.block[id]
    const now = after.block[id]
    if (old && now) {
      if (same(old, now) || whole.has(id)) continue
      if (old.type === 'frame' && now.type === 'frame') {
        // A frame changes only by its blocks coming and going, which are checked one by one.
        if (same({ ...old, kids: [] }, { ...now, kids: [] })) continue
        return 'A text column changes only by its blocks coming and going: leave the column itself as it is.'
      }
      const words = pieces.get(id)
      if (words && old.type === 'text' && now.type === 'text') {
        if (same({ ...old, md: '' }, { ...now, md: '' }) && sameOutside(old.md, now.md, words)) continue
        return `Only the chosen words of ${aliases.alias(id) ?? 'a block'} may change: the rest of its text, and the block itself, stay as they are.`
      }
      return 'Only what is selected may change: leave the other blocks as they are.'
    }
    if (old && !now) {
      if (whole.has(id)) continue
      const words = pieces.get(id)
      // Deleting all of a block's words takes the block along.
      if (words && old.type === 'text' && onlyWords(old.md, words)) continue
      // A frame goes when all its blocks have gone; they are checked one by one.
      if (old.type === 'frame' && old.kids.every((kid) => after.block[kid] === undefined)) continue
      return 'Only what is selected may be removed.'
    }
    if (!old && now) {
      const problem = placed(now, before, after, whole, pieces, near, box)
      if (problem) return problem
    }
  }
  return null
}

/** A block the same, apart from the revision it was last changed in. */
function same(a: Block, b: Block): boolean {
  return JSON.stringify({ ...a, r: 0 }) === JSON.stringify({ ...b, r: 0 })
}

/** Whether a new block stands where the AI may add: inside the box, or next to the selection. */
function placed(block: Block, before: Doc, after: Doc, whole: Set<Id>, pieces: Map<Id, WordRange[]>, near: Set<Id>, box: Extract<Here, { page: Id }> | undefined): string | null {
  if ('parent' in block) {
    // In a new frame: the frame is checked itself.
    if (before.block[block.parent] === undefined) return null
    const kids = (after.block[block.parent] as Frame).kids
    const at = kids.indexOf(block.id)
    const old = (from: number, step: number): Id | undefined => {
      for (let i = from; i >= 0 && i < kids.length; i += step) if (before.block[kids[i]!] !== undefined) return kids[i]
      return undefined
    }
    const previous = old(at - 1, -1)
    const following = old(at + 1, 1)
    const chosen = (id: Id | undefined): boolean => id !== undefined && (whole.has(id) || pieces.has(id))
    // Blocks that stood where the new one stands, and have gone: convert puts new blocks in the place of chosen ones.
    const was = (before.block[block.parent] as Frame).kids
    const from = previous === undefined ? -1 : was.indexOf(previous)
    const to = following === undefined ? was.length : was.indexOf(following)
    if (was.slice(from + 1, to < 0 ? was.length : to).some(chosen)) return null
    // In a box, new blocks follow what it holds; elsewhere they may also stand before it, or next to a neighbour.
    if (box ? chosen(previous) : chosen(previous) || chosen(following) || near.has(previous ?? '') || near.has(following ?? '')) return null
    return 'A new block goes only next to what is selected.'
  }
  if (!box) return null
  const inside = block.page === box.page && block.x >= box.x && block.y >= box.y && block.x + block.w <= box.x + box.w && (block.h === 0 || block.y + block.h <= box.y + box.h)
  // Or right below a block the box holds that is placed on the page, such as a picture, in its column.
  const below = [...whole].some((id) => {
    const held = before.block[id]
    return held !== undefined && 'page' in held && held.page === block.page && held.x === block.x && held.w === block.w && block.y >= held.y + held.h
  })
  return inside || below ? null : 'New things go only into the box, or right below what it holds.'
}

/** Whether a block's text is only the chosen words, and spaces. */
function onlyWords(md: string, words: readonly WordRange[]): boolean {
  return lettersOf(md).every((letter, i) => /\s/u.test(letter.ch) || words.some((w) => i >= w.start && i < w.end))
}

/**
 * Whether the text outside the chosen words is the same, letter by letter and
 * formatting and all, and in the same order: the words themselves may change,
 * grow, shrink or go, and new words may follow them. Deleting whole words takes
 * one space beside them along, so a stretch of text between chosen words may
 * lose one space at either end.
 */
export function sameOutside(beforeMd: string, afterMd: string, words: readonly WordRange[]): boolean {
  const was = lettersOf(beforeMd)
  const now = lettersOf(afterMd)
  const sorted = [...words].sort((a, b) => a.start - b.start)
  const stretches: Letter[][] = []
  let at = 0
  for (const w of sorted) {
    stretches.push(was.slice(at, w.start))
    at = w.end
  }
  stretches.push(was.slice(at))

  const equal = (a: Letter, b: Letter | undefined): boolean => b !== undefined && a.ch === b.ch && a.style === b.style
  const fits = (stretch: Letter[], from: number): boolean => stretch.every((letter, i) => equal(letter, now[from + i]))
  // A stretch as it was, or without the one space a delete beside it took.
  const forms = (stretch: Letter[], first: boolean, last: boolean): Letter[][] => {
    const out = [stretch]
    const space = (letter: Letter | undefined): boolean => letter !== undefined && /\s/u.test(letter.ch)
    if (!first && space(stretch[0])) out.push(stretch.slice(1))
    if (!last && space(stretch.at(-1))) out.push(stretch.slice(0, -1))
    if (!first && !last && stretch.length > 1 && space(stretch[0]) && space(stretch.at(-1))) out.push(stretch.slice(1, -1))
    return out
  }

  // The first stretch starts the text and the last ends it; those between follow in order.
  // Each takes the form that ends earliest, which leaves the most room for the rest.
  const heads = forms(stretches[0]!, true, false).filter((form) => fits(form, 0))
  if (heads.length === 0) return false
  let pos = Math.min(...heads.map((form) => form.length))
  for (let i = 1; i < stretches.length - 1; i++) {
    let end = -1
    for (const form of forms(stretches[i]!, false, false)) {
      for (let j = pos; j + form.length <= now.length; j++) {
        if (fits(form, j)) {
          if (end < 0 || j + form.length < end) end = j + form.length
          break
        }
      }
    }
    if (end < 0) return false
    pos = end
  }
  return forms(stretches.at(-1)!, false, true).some((form) => now.length - form.length >= pos && fits(form, now.length - form.length))
}
