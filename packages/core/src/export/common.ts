// What the Markdown and text exporters share: walking the reading order and
// numbering lists. Neither keeps the layout; they keep the reading order.
import { linearise } from '../linearise.js'
import { parseInline, plainText } from '../markdown/inline.js'
import type { Block, Doc, TextBlock } from '../schema/doc.js'

export interface Placed {
  block: Block
  /** For a list item: the nesting level to write it at. */
  level: number
  /** For an item of an ordered list: its number. */
  number: number
  /** Items of one list share a run number; anything else has run 0. */
  run: number
}

export interface Chunk {
  text: string
  run: number
}

const BULLET = new Set(['li', 'todo'])

/** Where a block stands in a list: none, or its level and, in a numbered list, its number. */
export interface ListMark {
  kind: '' | 'bullet' | 'ordered'
  level: number
  number: number
  /** The first item of a new list. */
  starts: boolean
}

/**
 * Numbers list items as they come, one frame at a time: the rule the exports
 * and the editor share. Items at the same indent are one level and count on,
 * however deep that indent is; a deeper item opens one level more, never two
 * (four extra spaces would make a Markdown code block). A new frame, a
 * non-list block, or a switch between bullets and numbers starts a new list.
 */
export function listNumbering(): { reset(): void; next(block: Block): ListMark } {
  // The indents of the list levels open now, outermost first, and each level's count.
  let indents: number[] = []
  let counters: number[] = []
  let runKind = ''
  return {
    reset() {
      indents = []
      counters = []
    },
    next(block) {
      const kind = block.type !== 'text' ? '' : BULLET.has(block.role) ? 'bullet' : block.role === 'oli' ? 'ordered' : ''
      if (block.type !== 'text' || kind === '') {
        indents = []
        counters = []
        return { kind: '', level: 0, number: 0, starts: false }
      }
      // Close the levels deeper than this item; open one if it is deeper than every open level.
      while (indents.length > 0 && indents.at(-1)! > block.indent) indents.pop()
      const opens = indents.length === 0 || indents.at(-1)! < block.indent
      if (opens) indents.push(block.indent)
      const level = indents.length - 1
      // A level just opened counts from the start.
      counters = counters.slice(0, opens ? level : level + 1)
      const starts = level === 0 && (counters.length === 0 || kind !== runKind)
      if (starts) {
        runKind = kind
        counters = []
      }
      counters[level] = kind === 'ordered' ? (counters[level] ?? 0) + 1 : 0
      return { kind, level, number: counters[level]!, starts }
    },
  }
}

/** A caption, written out as the paragraph it reads as. */
export function captionBlock(md: string): TextBlock {
  return { id: 'caption', r: 0, type: 'text', parent: 'caption', role: 'p', indent: 0, md }
}

/** The blocks to export, in reading order, without frames, numbered by listNumbering. */
export function blocksInOrder(doc: Doc): Placed[] {
  const out: Placed[] = []
  const numbering = listNumbering()
  let run = 0
  let runs = 0
  for (const { block, depth } of linearise(doc)) {
    if (depth === 0) numbering.reset()
    if (block.type === 'frame') continue
    const mark = numbering.next(block)
    if (mark.kind === '') {
      out.push({ block, level: 0, number: 0, run: 0 })
      continue
    }
    if (mark.starts) run = ++runs
    out.push({ block, level: mark.level, number: mark.number, run })
  }
  return out
}

/** The title, unless the document already opens with a level-1 heading saying the same. */
export function titleToShow(doc: Doc, blocks: Placed[]): string | undefined {
  const title = doc.title.trim()
  const first = blocks[0]?.block
  if (title === '') return undefined
  if (first?.type === 'text' && first.role === 'h1' && plainText(parseInline(first.md)).trim() === title) return undefined
  return title
}

/** Join exported chunks: a blank line between blocks, none between items of one list. */
export function joinChunks(chunks: Chunk[]): string {
  let out = ''
  chunks.forEach((chunk, i) => {
    const previous = chunks[i - 1]
    if (previous) out += chunk.run !== 0 && chunk.run === previous.run ? '\n' : '\n\n'
    out += chunk.text
  })
  return out === '' ? '' : `${out}\n`
}
