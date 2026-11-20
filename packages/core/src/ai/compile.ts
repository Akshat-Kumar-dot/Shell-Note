// Turning an AI operation into internal operations.
// Code does everything a model is never asked to: find indexes and positions,
// keep formatting, size new blocks, and check the operation fits the blocks it
// names. A mismatch comes back as a teaching error for the model's retry.
import { parseInline, plainText, serializeInline } from '../markdown/inline.js'
import { markRange, replaceRange, textLength, type MarkChange } from '../markdown/range.js'
import { parsePipeTable } from '../markdown/table.js'
import { chartOps, emptySpot, fitOps as fitted, stepOps } from '../board/layout.js'
import { readFlowchart } from '../board/mermaid.js'
import { isEndless, MAX_LABEL, MAX_LINKS, sized, type Block, type Doc, type Frame, type FreeBlock, type Id, type InkBlock, type Link, type NodeBlock, type Role, type TextBlock } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import type { AiOp, AiOpOf, InsertOp, MarkOp, StyleOp } from '../schema/protocol.js'
import { besideFree, type Spot } from '../select/place.js'
import { cutWords, removalOps } from '../select/remove.js'
import type { Selection, WordRange } from '../select/selection.js'
import { MARGIN } from '../units.js'
import { spliceFor } from '../splice.js'
import { ValidationError, type ErrorCode } from '../validate/errors.js'
import { boxAnchor, type Aliases } from './alias.js'

export interface CompileInput {
  doc: Doc
  aliases: Aliases
  selection: Selection
  /** Written by the content step, or sent inline, for rewrite, insert and convert. */
  content?: string
  /** The address for mark with link: true. */
  href?: string
  /** Ids for new blocks and pages. */
  newId: () => Id
  /**
   * Where each item of words is now, for the operations of one reply: an
   * earlier one may have changed the length of the text before it. Kept up to
   * date by compile itself; missing, the words are where the aliases say.
   */
  places?: Map<string, WordRange>
}

/** Style values that are the theme's default: setting one removes the field. */
const DEFAULT_STYLE = { size: 'm', color: 'ink', font: 'sans', align: 'left' } as const
/** Starting heights of new free blocks, before the editor measures them: 15 mm and 60 mm. */
const HEIGHT = { math: 1500, diagram: 6000, text: 0, table: 0 } as const

/** What insert and convert make. */
type Made = 'text' | 'math' | 'diagram' | 'table'

export { spliceFor }

/**
 * One AI operation, in the model's terms (aliases and words), as the internal operations `apply` takes. Nothing is
 * applied here. An operation that does not fit the blocks it names throws a teaching error (`teach`), which goes back
 * to the model for its retry, in words it can act on.
 */
export function compile(op: AiOp, input: CompileInput): Op[] {
  switch (op.op) {
    case 'style':
      return style(op, input)
    case 'mark':
      return mark(op, input)
    case 'rewrite':
      return rewrite(op, input)
    case 'insert':
      return insert(op, input)
    case 'delete':
      return remove(op, input)
    case 'move':
      return move(op, input)
    case 'none':
      return []
    case 'convert':
      return convert(op, input)
    case 'calc':
      // Math actions need Compute Engine, which arrives in phase 4. Until then the
      // choice is recorded (the benchmark scores it) and the formula is left as it is.
      return []
    case 'link':
      return link(op, input)
  }
}

// ----- style and mark ---------------------------------------------------------

/** Changes that act on words: bold and the like (and colour, when words are selected). */
const WORD_KEYS = ['bold', 'italic', 'strike', 'code', 'highlight', 'underline', 'sub', 'sup', 'link'] as const

function style(op: StyleOp, input: CompileInput): Op[] {
  const out: Op[] = []
  for (const alias of op.ids) {
    const block = blockOf(input, alias)
    if (block.type === 'node') {
      out.push(...nodeLook(op, alias, block))
      continue
    }
    if (op.shape !== undefined) throw teach('bad_value', `${alias} is not a step of a flowchart: only a step of a board has a shape.`)
    const words = WORD_KEYS.filter((key) => op[key] !== undefined)
    if (wordsOf(input, alias)) {
      // Words chosen inside a block take a colour (and, in the merged shape, the word changes); the rest belongs to whole blocks.
      const others = (['size', 'font', 'align', 'role', 'indent', 'done'] as const).filter((key) => op[key] !== undefined)
      if (others.length > 0) throw teach('bad_value', `${alias} is words, not a block: style changes only their color. To change ${others.join(', ')}, choose a whole block.`)
      const change: Record<string, unknown> = { op: 'mark', id: alias }
      for (const key of words) change[key] = op[key]
      if (op.color !== undefined) change.color = op.color
      out.push(...mark(change as MarkOp, input))
      continue
    }
    if (block.type === 'ink') {
      if (words.length > 0) throw teach('wrong_type', `${alias} is handwriting: only its color can change.`)
      out.push(...recolour(op, alias, block))
      continue
    }
    if (block.type !== 'text') {
      throw teach('wrong_type', `${alias} is a ${block.type} block: style changes text blocks, and the colour of handwriting. To change what it says or shows, use rewrite.`)
    }
    // Word changes (the merged shape) go to all the words of a whole block.
    if (words.length > 0) {
      const change: Record<string, unknown> = { op: 'mark', id: alias }
      for (const key of words) change[key] = op[key]
      out.push(...mark(change as MarkOp, input))
    }
    const set: Record<string, unknown> = {}
    const next: Record<string, string | undefined> = { ...(block.style ?? {}) }
    for (const key of ['size', 'color', 'font', 'align'] as const) {
      const value = op[key]
      if (value === undefined) continue
      if (value === DEFAULT_STYLE[key]) delete next[key]
      else next[key] = value
    }
    if (JSON.stringify(next) !== JSON.stringify(block.style ?? {})) set.style = Object.keys(next).length > 0 ? next : null
    const role = op.role ?? block.role
    if (op.role !== undefined && op.role !== block.role) set.role = op.role
    if (op.indent !== undefined) {
      const indent = Math.min(8, Math.max(0, block.indent + (op.indent === 'in' ? 1 : -1)))
      if (indent !== block.indent) set.indent = indent
    }
    if (op.done !== undefined) {
      if (role !== 'todo') throw teach('bad_value', `${alias} is not a to-do item, so it cannot be ticked. Add the change {"role":"todo"} first.`)
      if (op.done && !block.done) set.done = true
      if (!op.done && block.done) set.done = null
    }
    if (Object.keys(set).length > 0) out.push({ op: 'update', id: block.id, set })
  }
  return out
}

/** Recolouring handwriting replaces each stroke with a recoloured copy: exact to undo. */
/** A step's look (v1.2): its colour and its shape. A step in a new shape fits its words again, about the same middle. */
function nodeLook(op: StyleOp, alias: string, node: NodeBlock): Op[] {
  const other = (['size', 'font', 'align', 'role', 'indent', 'done', ...WORD_KEYS] as const).filter((key) => op[key] !== undefined)
  if (other.length > 0) throw teach('wrong_type', `${alias} is a step of a flowchart: style changes its shape and its color, not ${other.join(', ')}. To change its words, use rewrite.`)
  const set: Record<string, unknown> = {}
  if (op.color !== undefined && op.color !== (node.color ?? 'ink')) set.color = op.color === 'ink' ? null : op.color
  const shape = op.shape ?? node.shape
  if (shape !== node.shape) set.shape = shape
  return [...(Object.keys(set).length > 0 ? [{ op: 'update', id: node.id, set } as Op] : []), ...(shape === node.shape ? [] : fitted(node, shape, node.md))]
}

function recolour(op: StyleOp, alias: string, block: InkBlock): Op[] {
  // (Word changes on handwriting were refused by the caller.)
  const others = (['size', 'font', 'align', 'role', 'indent', 'done'] as const).filter((key) => op[key] !== undefined)
  if (op.color === undefined || others.length > 0) throw teach('wrong_type', `${alias} is handwriting: only its color can change.`)
  // A named colour, or (file format version 3) a colour code the request gave.
  const color = op.color
  return block.strokes.flatMap((stroke, at): Op[] =>
    stroke.color === color
      ? []
      : [
          { op: 'stroke', id: block.id, at, remove: true },
          { op: 'stroke', id: block.id, at, add: { ...stroke, color } },
        ],
  )
}

function mark(op: MarkOp, input: CompileInput): Op[] {
  // A whole block's colour is the block's own, exactly as style sets it.
  const target = blockOf(input, op.id)
  const chosen = wordsOf(input, op.id)
  if (op.color !== undefined && chosen === undefined && (target.type === 'text' || target.type === 'ink')) {
    const words: Record<string, unknown> = { ...op }
    delete words.color
    const more = WORD_KEYS.some((key) => words[key] !== undefined)
    return [...style({ op: 'style', ids: [op.id], color: op.color }, input), ...(more ? mark(words as MarkOp, input) : [])]
  }
  const block = textBlock(input, op.id, 'mark changes words inside text blocks; to change what it says or shows, use rewrite')
  const range = chosen ?? { start: 0, end: textLength(block.md) }
  const change: MarkChange = {}
  for (const key of ['bold', 'italic', 'strike', 'code', 'highlight', 'underline', 'sub', 'sup', 'color'] as const) {
    if (op[key] !== undefined) (change as Record<string, unknown>)[key] = op[key]
  }
  if (op.link === true) {
    if (input.href === undefined) throw teach('bad_value', 'No link address was given. Ask the person for it with none.')
    change.link = input.href
  }
  if (op.link === false) change.link = null
  const md = markRange(block.md, range.start, range.end, change)
  return md === block.md ? [] : [spliceFor(block.id, 'md', block.md, md)]
}

// ----- rewrite, insert, convert -------------------------------------------------

function rewrite(op: AiOpOf<'rewrite'>, input: CompileInput): Op[] {
  const content = written(input)
  const block = blockOf(input, op.id)
  switch (block.type) {
    case 'text': {
      const words = wordsOf(input, op.id)
      if (!words) {
        const md = tidy(content)
        return md === block.md ? [] : [spliceFor(block.id, 'md', block.md, md)]
      }
      // Only the chosen words change; the new ones keep their formatting.
      const md = replaceRange(block.md, words.start, words.end, content)
      moved(input, block.id, words.start, words.end, textLength(content))
      return md === block.md ? [] : [spliceFor(block.id, 'md', block.md, md)]
    }
    case 'math':
      return content === block.tex ? [] : [spliceFor(block.id, 'tex', block.tex, content)]
    case 'diagram':
      return content === block.src ? [] : [spliceFor(block.id, 'src', block.src, content)]
    case 'image':
      return content === (block.alt ?? '') ? [] : [{ op: 'update', id: block.id, set: { alt: content === '' ? null : content } }]
    case 'ink':
      return content === (block.text ?? '') ? [] : [{ op: 'update', id: block.id, set: { text: content === '' ? null : content } }]
    case 'node': {
      // A step's words, whole, on one line; the step then fits them.
      const md = tidy(content.replace(/\s*\n\s*/gu, ' ').trim())
      return md === block.md ? [] : [spliceFor(block.id, 'md', block.md, md), ...fitted(block, block.shape, md)]
    }
    case 'table': {
      // The whole table comes back as a pipe table (v1.1). New columns get equal widths.
      const { rows, head } = table(content)
      if (JSON.stringify(rows) === JSON.stringify(block.rows) && head === (block.head === true)) return []
      const set: Record<string, unknown> = { rows, head: head ? true : null }
      if (block.cols !== undefined && block.cols.length !== rows[0]!.length) set.cols = null
      return [{ op: 'update', id: block.id, set }]
    }
    case 'frame':
      throw teach('wrong_type', `${op.id} is a frame, which holds blocks but has no words of its own.`)
  }
}

/**
 * A new block, placed by code: the model says only `after` or `before` a block, or `here` (the place the person marked,
 * or their Select box). Beside a block in a frame it joins the frame; beside one placed on the page, it goes in free
 * space near it, or on the next page when there is none.
 */
function insert(op: InsertOp, input: CompileInput): Op[] {
  const { doc, selection } = input
  if (op.kind === 'step' || op.kind === 'flowchart') return onBoard(op, input)
  if (op.shape !== undefined) throw teach('bad_value', 'Only a step has a shape: leave "shape" out, or insert kind "step" on a board.')
  const content = written(input)
  const kind: Made = op.kind
  const role: Role = kind === 'text' ? (op.role ?? 'p') : 'p'
  if (op.at === 'here') {
    const here = selection.here
    if (!here && doc.kind === 'board') return looseOnBoard(input, kind, content, role)
    if (!here) throw teach('bad_value', 'No place was marked as "here". Insert after or before a block.')
    if ('parent' in here) {
      const kids = (doc.block[here.parent] as Frame).kids
      const beside = doc.block[kids[here.at - 1] ?? kids[here.at] ?? '']
      return [{ op: 'add', block: make(input, kind, content, { parent: here.parent }, role, indentBeside(beside, role)), at: here.at }]
    }
    // A Select box (v1.1): new things go only into it. New words follow the
    // chosen words; anything else follows the paragraph or block the box ends
    // with; on empty paper, they fill the box.
    const anchor = boxAnchor(doc, input.aliases)
    if (anchor === undefined) return placeFree(input, kind, content, role, here)
    if (anchor.words && kind === 'text') return wordsAfter(input, anchor.alias, content)
    const block = blockOf(input, anchor.alias)
    if (!('parent' in block)) {
      // A block placed on the page, such as a picture: just below it, in its column.
      const h = HEIGHT[kind]
      return placeFree(input, kind, content, role, besideFree(doc, block, 'after', h) ?? nextPageSpot(input, block, h))
    }
    const frame = doc.block[block.parent] as Frame
    return [{ op: 'add', block: make(input, kind, content, { parent: frame.id }, role, indentBeside(block, role)), at: frame.kids.indexOf(block.id) + 1 }]
  }
  const ref = blockOf(input, op.ref!)
  if ('parent' in ref) {
    const frame = doc.block[ref.parent] as Frame
    const at = frame.kids.indexOf(ref.id) + (op.at === 'after' ? 1 : 0)
    return [{ op: 'add', block: make(input, kind, content, { parent: frame.id }, role, indentBeside(ref, role)), at }]
  }
  const h = HEIGHT[kind]
  const spot = besideFree(doc, ref, op.at, h) ?? nextPageSpot(input, ref, h)
  return placeFree(input, kind, content, role, spot)
}

// ----- a board (v1.2) ---------------------------------------------------------------

/** A board's one page; or a teaching error, as steps and flowcharts go only on a board. */
function boardPage(doc: Doc): Id {
  const id = doc.pages[0]
  const page = id === undefined ? undefined : doc.page[id]
  if (doc.kind !== 'board' || !page || !isEndless(page)) throw teach('wrong_type', 'A step and a flowchart go on a board. In a note of pages, a flowchart is a diagram: insert kind "diagram".')
  return id!
}

/**
 * A step after or before a step, or on its own where the board has room; or a whole flowchart, read from its Mermaid
 * and laid out where the board has room. Code does every place.
 */
function onBoard(op: InsertOp, input: CompileInput): Op[] {
  const { doc } = input
  const page = boardPage(doc)
  const content = written(input)
  if (op.kind === 'flowchart') {
    if (op.shape !== undefined) throw teach('bad_value', 'A flowchart gives each of its steps a shape in its Mermaid: leave "shape" out.')
    return chartOps(doc, page, readFlowchart(content), input.newId).ops
  }
  const md = tidy(content.replace(/\s*\n\s*/gu, ' ').trim())
  const shape = op.shape ?? 'box'
  if (op.at === 'here') return chartOps(doc, page, { flow: 'down', nodes: [{ key: 'step', shape, md }], links: [] }, input.newId).ops
  const ref = blockOf(input, op.ref!)
  if (ref.type !== 'node') {
    const what = ref.type === 'frame' ? 'a text column' : `a ${ref.type} block`
    throw teach('wrong_type', `${op.ref} is ${what}, not a step: a new step goes after or before a step of the flowchart. To put words beside it, insert kind "text".`)
  }
  return stepOps(doc, ref.id, op.at, { md, shape }, input.newId).ops
}

/** Words, a table, a formula or a diagram put "here" on a board with no place marked: where the board has room. */
function looseOnBoard(input: CompileInput, kind: Made, content: string, role: Role): Op[] {
  const page = boardPage(input.doc)
  const size = kind === 'math' ? { w: 8000, h: 1500 } : kind === 'diagram' ? { w: 12000, h: 6000 } : { w: 6000, h: 1200 }
  const at = emptySpot(input.doc, page, size)
  return placeFree(input, kind, content, role, { page, ...at, w: size.w, h: kind === 'math' || kind === 'diagram' ? size.h : 0 })
}

/** A link from one step to another (v1.2): made, its words and look changed when sent again, taken away with on: false. */
function link(op: AiOpOf<'link'>, input: CompileInput): Op[] {
  const from = blockOf(input, op.from)
  const to = blockOf(input, op.to)
  if (from.type !== 'node') throw teach('wrong_type', `${op.from} is not a step: a link joins two steps of a board.`)
  if (to.type !== 'node') throw teach('wrong_type', `${op.to} is not a step: a link joins two steps of a board.`)
  if (from.id === to.id) throw teach('bad_value', 'A step does not point to itself: choose another step as "to".')
  const list = from.to ?? []
  const had = list.findIndex((each) => each.node === to.id)
  if (op.on === false) {
    if (had < 0) return []
    const kept = list.filter((_, i) => i !== had)
    return [{ op: 'update', id: from.id, set: { to: kept.length > 0 ? kept : null } }]
  }
  if (had < 0 && list.length >= MAX_LINKS) throw teach('bad_value', `${op.from} points to ${MAX_LINKS} steps already, the most a step has.`)
  const label = cut((op.label ?? '').replace(/\s+/gu, ' ').trim(), MAX_LABEL).trim()
  const made: Link = { node: to.id, ...(label === '' ? {} : { label }), ...(op.path ? { path: op.path } : {}), ...(op.line ? { line: op.line } : {}), ...(op.head ? { head: op.head } : {}) }
  const next = had < 0 ? [...list, made] : list.map((each, i) => (i === had ? made : each))
  return JSON.stringify(next) === JSON.stringify(list) ? [] : [{ op: 'update', id: from.id, set: { to: next } }]
}

/** Text at most `most` long, never cutting a character in two. */
function cut(text: string, most: number): string {
  let out = ''
  for (const char of text) {
    if (out.length + char.length > most) break
    out += char
  }
  return out
}

/**
 * Blocks turned into another kind: what is made goes where the first of them was, and they are removed. A picture is
 * the exception: it stays, and the result goes right after it. Text and tables can only live in a frame, so on the
 * bare page a new frame is made to hold them.
 */
function convert(op: AiOpOf<'convert'>, input: CompileInput): Op[] {
  const { doc } = input
  const content = written(input)
  const blocks = op.ids.map((alias) => blockOf(input, alias))
  const step = op.ids.find((_, i) => blocks[i]!.type === 'node')
  if (step !== undefined) throw teach('wrong_type', `${step} is a step of a flowchart, which is not converted: rewrite its words, or style its shape.`)
  // A picture turned into a table or text stays, and the result goes right after it.
  const picture = [...blocks].reverse().find((block) => block.type === 'image')
  const first = picture ?? blocks[0]!
  const made: { kind: Made; content: string; role: Role }[] =
    op.into === 'list' || op.into === 'steps'
      ? content
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => ({ kind: 'text', content: line.trim(), role: op.into === 'list' ? 'li' : 'oli' }))
      : op.into === 'paragraph'
        ? [{ kind: 'text', content: content.replace(/\s*\n\s*/gu, ' '), role: 'p' }]
        : [{ kind: op.into, content, role: 'p' }]
  if (made.length === 0) throw new Error('The content step wrote nothing to convert into.')

  let adds: Op[]
  if ('parent' in first) {
    const frame = doc.block[first.parent] as Frame
    const at = frame.kids.indexOf(first.id) + (picture ? 1 : 0)
    adds = made.map((m, i) => ({ op: 'add', block: make(input, m.kind, m.content, { parent: frame.id }, m.role), at: at + i }))
  } else {
    const kind = made[0]!.kind
    // Where the first block was; for a picture, which stays, just below it.
    const spot: Spot & { add?: Op } = picture
      ? (besideFree(doc, first, 'after', HEIGHT[kind]) ?? nextPageSpot(input, first, HEIGHT[kind]))
      : { page: first.page, x: first.x, y: first.y, w: first.w, h: first.h }
    const prefix = spot.add ? [spot.add] : []
    if (kind === 'text' || kind === 'table') {
      // Text and tables live in a frame: a new one there.
      const frame = makeFrame(input, spot)
      adds = [...prefix, { op: 'add', block: frame }, ...made.map((m, i): Op => ({ op: 'add', block: make(input, m.kind, m.content, { parent: frame.id }, m.role), at: i }))]
    } else {
      adds = [...prefix, { op: 'add', block: make(input, kind, made[0]!.content, spot, 'p') }]
    }
  }
  return [...adds, ...blocks.filter((block) => block.type !== 'image').map((b): Op => ({ op: 'remove', id: b.id }))]
}

// ----- move ---------------------------------------------------------------------

function move(op: AiOpOf<'move'>, input: CompileInput): Op[] {
  const { doc } = input
  const block = blockOf(input, op.id)
  const ref = blockOf(input, op.ref)
  if (block.id === ref.id) throw teach('bad_value', 'A block cannot move next to itself. Choose another block as "ref".')
  if (block.type === 'node' || ref.type === 'node') throw teach('wrong_type', 'A step of a board stands where its links lead, and ShellNote places it: to change where it comes, link it differently.')
  if ('parent' in ref) {
    if (block.type === 'frame' || block.type === 'ink') throw teach('wrong_type', `${op.id} is placed on the page and cannot go into a text column.`)
    const frame = doc.block[ref.parent] as Frame
    const kids = frame.kids.filter((id) => id !== block.id)
    const at = kids.indexOf(ref.id) + (op.at === 'after' ? 1 : 0)
    // Already there: nothing to do (and the edit loop asks the model once more).
    if ('parent' in block && block.parent === frame.id && frame.kids.indexOf(block.id) === at) return []
    return [{ op: 'move', id: block.id, to: { parent: frame.id, at } }]
  }
  if ('parent' in block) {
    throw teach('wrong_type', `${op.id} sits in a text column and ${op.ref} is placed on the page. Move it next to a block in a text column.`)
  }
  const spot = besideFree(doc, ref, op.at, block.h, [block.id])
  if (!spot) throw teach('bad_value', `There is no room ${op.at === 'after' ? 'below' : 'above'} ${op.ref} on its page.`)
  if (spot.page === block.page && spot.x === block.x && spot.y === block.y) return []
  return [{ op: 'move', id: block.id, to: { page: spot.page, x: spot.x, y: spot.y } }]
}

// ----- making blocks --------------------------------------------------------------

type Place = { parent: Id } | Spot

/** A new list item next to an item of the same kind takes its indent, as pressing Enter in a list does. */
function indentBeside(block: Block | undefined, role: Role): number {
  return block?.type === 'text' && block.role === role && (role === 'li' || role === 'oli' || role === 'todo') ? block.indent : 0
}

function make(input: CompileInput, kind: Made, content: string, place: Place, role: Role, indent = 0): Block {
  const base = { id: input.newId(), r: 0 }
  if (kind === 'text') {
    if (!('parent' in place)) throw new Error('A text block needs a frame.')
    return { ...base, type: 'text', parent: place.parent, role, indent, md: tidy(content) } as TextBlock
  }
  if (kind === 'table') {
    if (!('parent' in place)) throw new Error('A table needs a frame.')
    const { rows, head } = table(content)
    return { ...base, type: 'table', parent: place.parent, rows, ...(head ? { head: true } : {}) } as Block
  }
  const where = 'parent' in place ? { parent: place.parent } : { page: place.page, x: place.x, y: place.y, w: place.w, h: place.h }
  return (kind === 'math' ? { ...base, type: 'math', ...where, tex: content } : { ...base, type: 'diagram', ...where, lang: 'mermaid', src: content }) as Block
}

function makeFrame(input: CompileInput, spot: Spot): Frame {
  return { id: input.newId(), r: 0, type: 'frame', page: spot.page, x: spot.x, y: spot.y, w: spot.w, h: 0, kids: [] }
}

/** A free block for math or a diagram; for text or a table, a new frame there holding it. */
function placeFree(input: CompileInput, kind: Made, content: string, role: Role, spot: Spot & { add?: Op }): Op[] {
  const prefix = spot.add ? [spot.add] : []
  if (kind === 'math' || kind === 'diagram') return [...prefix, { op: 'add', block: make(input, kind, content, { ...spot, h: spot.h || HEIGHT[kind] }, role) }]
  const frame = makeFrame(input, spot)
  return [...prefix, { op: 'add', block: frame }, { op: 'add', block: make(input, kind, content, { parent: frame.id }, role), at: 0 }]
}

/** A pipe table written by the content step, as rows of cells; refused, for a content retry, when it is not one. */
function table(content: string): { rows: string[][]; head: boolean } {
  const parsed = parsePipeTable(content)
  if (!parsed) throw new ValidationError('content', 'Write the table as a Markdown pipe table: one row per line, the cells between | signs, a line of dashes under the header.')
  return parsed
}

/** The top of the next page; a new page is added when the note has none. */
function nextPageSpot(input: CompileInput, ref: FreeBlock, h: number): Spot & { add?: Op } {
  const { doc } = input
  const index = doc.pages.indexOf(ref.page)
  const next = doc.pages[index + 1]
  if (next !== undefined) return { page: next, x: ref.x, y: MARGIN, w: ref.w, h }
  const page = sized(doc.page[ref.page]!)
  const id = input.newId()
  return {
    page: id,
    x: ref.x,
    y: MARGIN,
    w: ref.w,
    h,
    add: { op: 'page', add: { id, w: page.w, h: page.h, bg: page.bg, free: [] }, at: index + 1 },
  }
}

// ----- helpers ----------------------------------------------------------------------

// ----- words chosen inside blocks (protocol v1.1) ------------------------------------

/** Where an item of words is now, or undefined when the alias names a whole block. */
function wordsOf(input: CompileInput, alias: string): WordRange | undefined {
  return input.places?.get(alias) ?? input.aliases.words(alias)
}

/** After the text [start, end) of a block became `length` characters long, the words chosen after it move along. */
function moved(input: CompileInput, block: Id, start: number, end: number, length: number): void {
  if (!input.places) return
  const delta = length - (end - start)
  for (const [alias, words] of input.places) {
    if (words.block !== block) continue
    if (words.start >= end) input.places.set(alias, { ...words, start: words.start + delta, end: words.end + delta })
    else if (words.start >= start && words.end <= end) input.places.set(alias, { ...words, start, end: start + length })
  }
}

/** New words right after chosen words, in the same block (a Select box over text, v1.1). */
function wordsAfter(input: CompileInput, alias: string, content: string): Op[] {
  const words = wordsOf(input, alias)!
  const block = textBlock(input, alias, 'new words go after words in a text block')
  const before = plainText(parseInline(block.md)).slice(0, words.end)
  // One space between, unless there is one already or the new words start with punctuation.
  const added = /^[\s.,;:!?)]/u.test(content) || /\s$/u.test(before) ? content : ` ${content}`
  const md = replaceRange(block.md, words.end, words.end, added)
  moved(input, block.id, words.end, words.end, textLength(added))
  return md === block.md ? [] : [spliceFor(block.id, 'md', block.md, md)]
}

/** Delete whole blocks, and cut chosen words out of their text, as Delete in the editor does. */
function remove(op: AiOpOf<'delete'>, input: CompileInput): Op[] {
  const blocks: Id[] = []
  const pieces: WordRange[] = []
  for (const alias of op.ids) {
    const words = wordsOf(input, alias)
    if (words) pieces.push(words)
    else blocks.push(blockOf(input, alias).id)
  }
  for (const id of new Set(pieces.map((piece) => piece.block))) {
    const block = input.doc.block[id]
    if (block?.type !== 'text' || blocks.includes(id)) continue
    for (const cut of cutWords(block.md, pieces.filter((piece) => piece.block === id)).cuts) moved(input, id, cut.start, cut.end, 0)
  }
  return removalOps(input.doc, blocks, pieces)
}

function blockOf(input: CompileInput, alias: string): Block {
  const block = input.doc.block[input.aliases.id(alias)]
  if (!block) throw teach('unknown_id', `Block ${alias} is gone: an earlier operation in this reply removed it. Use one operation.`, { got: alias })
  return block
}

function textBlock(input: CompileInput, alias: string, why: string): TextBlock {
  const block = blockOf(input, alias)
  if (block.type !== 'text') throw teach('wrong_type', `${alias} is a ${block.type} block: ${why}.`)
  return block
}

function written(input: CompileInput): string {
  if (input.content === undefined) throw new Error('This operation needs content from the content step.')
  return input.content
}

/** Content md in its canonical form. */
function tidy(md: string): string {
  return serializeInline(parseInline(md))
}

function teach(code: ErrorCode, hint: string, details: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(code, hint, details)
}
