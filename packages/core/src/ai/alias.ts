// Per-request aliases: the model sees a, b, c instead of
// real ids. Small models miscopy long ids, and short ones cost fewer tokens.
//
// What is selected comes first, in reading order: whole blocks, and words
// chosen inside a block (protocol v1.1), each piece of words with its own
// alias. A block whose words are chosen is not itself selected: only those
// words are. Then one neighbour before and one after, which the model may use
// only as a place ("after c"), and not at all when a Select box marks the
// place: new things then go only into the box.
import { linearise } from '../linearise.js'
import type { Doc, Id } from '../schema/doc.js'
import type { Selection, WordRange } from '../select/selection.js'

export interface Near {
  alias: string
  id: Id
  /** Where the neighbour sits relative to the selection. */
  side: 'before' | 'after'
}

/** One selected thing: a whole block, or words chosen inside one. */
export interface Selected {
  alias: string
  /** The block, or for words the block they are in. */
  id: Id
  /** For words: where they are in the block's text. */
  words?: WordRange
}

export interface Aliases {
  selected: Selected[]
  near: Near[]
  /**
   * Every alias a `ref` may name: what is selected (words standing for the
   * block they are in), then the neighbours. Inside a Select box only the
   * whole selected blocks, for a move among them: new things go "here".
   */
  refs: string[]
  /** Aliases of the whole selected blocks, without the words. */
  blocks: string[]
  /** Aliases of the chosen words. */
  pieces: string[]
  /** The real id behind an alias; for words, the id of their block. */
  id(alias: string): Id
  /** A block's alias: its own, a neighbour's, or for a block whose words are chosen, its first piece's. */
  alias(id: Id): string | undefined
  /** The words behind an alias, when it names words. */
  words(alias: string): WordRange | undefined
}

/** a … z, then aa, ab … */
export function letters(index: number): string {
  let out = ''
  let n = index
  do {
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** The words a selection chose inside blocks: a Select box's pieces, or one typed range. */
export function piecesOf(selection: Selection): WordRange[] {
  const pieces = selection.words ?? (selection.range ? [selection.range] : [])
  return pieces.filter((piece) => piece.end > piece.start)
}

/** Whether the place is a Select box drawn on the page: then new things may go only into it. */
export function inBox(selection: Selection): boolean {
  return selection.here !== undefined && 'page' in selection.here
}

/**
 * What new things follow in a Select box (protocol v1.1): the last thing it
 * holds in reading order, words or a block (in a text column, or placed on
 * the page, such as a picture). Undefined when it holds nothing: the box is
 * empty paper, and new things fill it.
 */
export function boxAnchor(doc: Doc, aliases: Aliases): Selected | undefined {
  return [...aliases.selected].reverse().find((s) => s.words !== undefined || doc.block[s.id] !== undefined)
}

/** Where new things go in a Select box: right after the chosen words, right after the chosen blocks, or filling empty paper. */
export function boxPlace(doc: Doc, aliases: Aliases): 'words' | 'blocks' | 'empty' {
  const anchor = boxAnchor(doc, aliases)
  return anchor === undefined ? 'empty' : anchor.words ? 'words' : 'blocks'
}

export function makeAliases(doc: Doc, selection: Selection): Aliases {
  // Content blocks in reading order. Frames are containers, not content.
  const order = linearise(doc)
    .filter((item) => item.block.type !== 'frame')
    .map((item) => item.block.id)
  const pieces = piecesOf(selection)
  const withWords = new Set(pieces.map((piece) => piece.block))
  const chosen = new Set(selection.blocks.filter((id) => !withWords.has(id)))
  const toAlias = new Map<Id, string>()
  const toId = new Map<string, Id>()
  const toWords = new Map<string, WordRange>()
  let count = 0
  const name = (id: Id, words?: WordRange): string => {
    const alias = letters(count++)
    toId.set(alias, id)
    if (words) toWords.set(alias, words)
    else toAlias.set(id, alias)
    return alias
  }

  const selected: Selected[] = []
  for (const id of order) {
    if (chosen.has(id)) selected.push({ alias: name(id), id })
    else if (withWords.has(id)) {
      for (const words of pieces.filter((p) => p.block === id).sort((a, b) => a.start - b.start)) selected.push({ alias: name(id, words), id, words })
    }
  }

  const near: Near[] = []
  const add = (id: Id | undefined, side: Near['side']): void => {
    if (id !== undefined && !chosen.has(id) && !withWords.has(id) && !toAlias.has(id)) near.push({ alias: name(id), id, side })
  }
  if (selected.length > 0) {
    add(order[order.indexOf(selected[0]!.id) - 1], 'before')
    add(order[order.indexOf(selected.at(-1)!.id) + 1], 'after')
  } else if (selection.here && 'parent' in selection.here) {
    const frame = doc.block[selection.here.parent]
    if (frame?.type === 'frame') {
      add(frame.kids[selection.here.at - 1], 'before')
      add(frame.kids[selection.here.at], 'after')
    }
  }

  const blocks = selected.filter((s) => s.words === undefined).map((s) => s.alias)
  return {
    selected,
    near,
    refs: inBox(selection) ? blocks : [...selected.map((s) => s.alias), ...near.map((n) => n.alias)],
    blocks,
    pieces: selected.filter((s) => s.words !== undefined).map((s) => s.alias),
    id(alias) {
      const id = toId.get(alias)
      if (id === undefined) throw new Error(`Unknown alias ${alias}`)
      return id
    },
    alias: (id) => toAlias.get(id) ?? selected.find((s) => s.id === id)?.alias,
    words: (alias) => toWords.get(alias),
  }
}
