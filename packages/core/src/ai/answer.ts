// "Insert answer" in Ask mode: the answer in the side
// panel goes into the note as an ordinary edit, with no model call. Its
// paragraphs, list items, pipe tables, formulas and Mermaid diagrams become
// blocks, placed where an AI insert would go: into the Select box, or after
// the selection. The side panel's scratch pad puts what the AI made
// into the note the same way.
import { parseInline, serializeInline } from '../markdown/inline.js'
import { parsePipeTable } from '../markdown/table.js'
import type { Block, Doc, Frame, Id, Role } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { besideFree, type Spot } from '../select/place.js'
import type { Selection } from '../select/selection.js'
import { boxAnchor, inBox, makeAliases } from './alias.js'

/** One block an answer becomes. */
export interface AnswerBlock {
  kind: 'text' | 'table' | 'math' | 'diagram'
  /** md for text, a pipe table, LaTeX, or a Mermaid diagram's source. */
  content: string
  role: Role
  indent: number
}

const ITEM = /^(\s*)(?:([-*+•])|(\d{1,3})[.)])\s+(.*)$/u

/** A Mermaid diagram fenced as Markdown writes it: ```mermaid, its lines, ```. */
const FENCED_DIAGRAM = /```mermaid[ \t]*\n([\s\S]*?)\n```/gu

/** The blocks an answer becomes: one per paragraph, list item, pipe table, $$formula$$ or fenced Mermaid diagram, and # headings. */
export function answerBlocks(answer: string): AnswerBlock[] {
  const out: AnswerBlock[] = []
  // A diagram's lines may hold blank lines: each is taken out whole before the rest is split into paragraphs, a
  // private-use character marking its place.
  const diagrams: string[] = []
  const text = answer.replace(/\r\n/gu, '\n').replace(FENCED_DIAGRAM, (_whole, src: string) => `\n\n${diagrams.push(src.trim()) - 1}\n\n`)
  for (const chunk of text.split(/\n\s*\n/u)) {
    const fenced = /^(\d+)$/u.exec(chunk.trim())
    if (fenced) {
      out.push({ kind: 'diagram', content: diagrams[Number(fenced[1])]!, role: 'p', indent: 0 })
      continue
    }
    const text = chunk.trim()
    if (text === '') continue
    if (parsePipeTable(text)) {
      out.push({ kind: 'table', content: text, role: 'p', indent: 0 })
      continue
    }
    const formula = /^\$\$([\s\S]+)\$\$$/u.exec(text) ?? /^\\\[([\s\S]+)\\\]$/u.exec(text)
    if (formula) {
      out.push({ kind: 'math', content: formula[1]!.trim(), role: 'p', indent: 0 })
      continue
    }
    const lines = text.split('\n')
    if (lines.every((line) => ITEM.test(line))) {
      for (const line of lines) {
        const [, space, bullet, , words] = ITEM.exec(line)!
        out.push({ kind: 'text', content: words!.trim(), role: bullet ? 'li' : 'oli', indent: Math.min(8, Math.floor(space!.length / 2)) })
      }
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(text)
    if (heading && lines.length === 1) {
      out.push({ kind: 'text', content: heading[2]!.trim(), role: (['h1', 'h2', 'h3'] as const)[heading[1]!.length - 1]!, indent: 0 })
      continue
    }
    out.push({ kind: 'text', content: lines.map((line) => line.trim()).join(' '), role: 'p', indent: 0 })
  }
  return out
}

/**
 * The operations that put an answer into the note, as one undo step: into a
 * Select box (after what it ends with, or filling empty paper), after the
 * selection, or at a marked place. Empty when there is nowhere to put it.
 */
export function answerOps(doc: Doc, selection: Selection, answer: string, newId: () => Id): Op[] {
  const blocks = answerBlocks(answer)
  if (blocks.length === 0) return []
  const aliases = makeAliases(doc, selection)
  const here = selection.here
  // Where the first block goes: a frame and an index in it, or a spot for a new frame.
  let into: { parent: Id; at: number } | { spot: Spot } | undefined
  if (here && 'parent' in here) into = { parent: here.parent, at: here.at }
  else {
    const last = inBox(selection) ? boxAnchor(doc, aliases) : aliases.selected.at(-1)
    const block = last === undefined ? undefined : doc.block[last.id]
    if (block && 'parent' in block) into = { parent: block.parent, at: (doc.block[block.parent] as Frame).kids.indexOf(block.id) + 1 }
    else if (block) {
      const spot = besideFree(doc, block, 'after', 0)
      if (spot) into = { spot }
    } else if (here) into = { spot: { page: here.page, x: here.x, y: here.y, w: here.w, h: here.h } }
  }
  if (into === undefined) return []
  const ops: Op[] = []
  let parent: Id
  let at: number
  if ('spot' in into) {
    parent = newId()
    const { page, x, y, w } = into.spot
    ops.push({ op: 'add', block: { id: parent, r: 0, type: 'frame', page, x, y, w, h: 0, kids: [] } })
    at = 0
  } else {
    parent = into.parent
    at = into.at
  }
  for (const made of blocks) ops.push({ op: 'add', block: child(made, parent, newId()), at: at++ })
  return ops
}

function child(made: AnswerBlock, parent: Id, id: Id): Block {
  if (made.kind === 'math') return { id, r: 0, type: 'math', parent, tex: made.content }
  if (made.kind === 'diagram') return { id, r: 0, type: 'diagram', parent, lang: 'mermaid', src: made.content }
  if (made.kind === 'table') {
    const { rows, head } = parsePipeTable(made.content)!
    return { id, r: 0, type: 'table', parent, rows, ...(head ? { head: true } : {}) }
  }
  return { id, r: 0, type: 'text', parent, role: made.role, indent: made.indent, md: serializeInline(parseInline(made.content)) }
}
