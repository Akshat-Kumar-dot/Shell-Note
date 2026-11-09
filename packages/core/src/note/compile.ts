// The note's commands made into the note's own operations: each command, its inputs
// checked, becomes a list of ops for `apply`, the only door that changes a note. Places are relative only: after or
// before a block, or at the top or the end of a page; code works out where in which frame. Blocks are named as the
// model says them (refer.ts); words come as written under the command and are rewritten by diff
// (rewrite.ts).
import { diagramHint, diagramKind, mendFlowchart } from '../ai/mermaid.js'
import { newId } from '../ids.js'
import { parseInline, plainText } from '../markdown/inline.js'
import type { AnyColor, Block, BlockType, Doc, Role } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { MARGIN } from '../units.js'
import { texHint, texOf } from './maths.js'
import { compareRows, definitionMd, featuresOf, qaParts, sectionParts, shapeOf, stepParts, type Features, type Part } from './recipes.js'
import { boxesOn, placeWord, PLACES, roomyPlaces, sizeOutOfText, spanned, spotIn, spotNear, type PlaceWord, type Span } from './place.js'
import { kindOf, pageFacts, quoted } from './picture.js'
import { pictureFrom, type PictureSource } from './pictures.js'
import { referTo, type ReferContext } from './refer.js'
import { rewriteBlocks } from './rewrite.js'
import { addColumn, addRows, columnOf, removeColumn, removeRow, rewriteTable, rowOf, tableOf } from './table.js'

type Text = Extract<Block, { type: 'text' }>

/** The inputs of the note's commands, from the one vocabulary (command/spec.ts), with the words written under the line. */
export interface NoteInput {
  block?: string
  after?: string
  before?: string
  at?: 'top' | 'end'
  page?: number
  role?: 'paragraph' | 'heading' | 'quote' | 'bullet' | 'numbered' | 'todo'
  level?: number
  style?: 'bullet' | 'numbered' | 'todo'
  words?: string
  size?: 'small' | 'medium' | 'large'
  colour?: AnyColor
  font?: string
  align?: 'left' | 'center' | 'right'
  on?: boolean
  // Tables and pictures (step 3).
  row?: string
  column?: string
  design?: 'grid' | 'lines' | 'banded' | 'header'
  head?: boolean
  picture?: string
  // Places on a page and pages (step 4).
  to?: string | number
  beside?: string
  below?: string
  span?: Span
  paper?: 'blank' | 'ruled' | 'squares' | 'dots'
}

/**
 * Where a request is read: the page it is about, the boxes drawn, the blocks earlier lines made; which ids are taken;
 * and the pictures of the person's other notes, which the door reads from the library for picture.add.
 */
export interface NoteContext extends ReferContext {
  taken?: (id: string) => boolean
  pictures?: readonly PictureSource[]
}

/**
 * A command made into ops: what to apply, the blocks it adds (for $1), and what to tell the model. Besides, for the
 * door to do before it applies them, as core cannot: the diagrams Mermaid must read (`diagrams`), the pictures whose
 * bytes the note must hold (`assets`, by hash).
 */
export interface Compiled {
  ops: Op[]
  made: string[]
  said: string
  diagrams?: string[]
  assets?: string[]
  /** The shape a recipe or the shape rules chose, and the content's features (no words): for the choices log (cl1). */
  choice?: { shape: string; by: 'rules' | 'recipe'; features: Features }
}

/** The roles a block may be given, in the note's own codes. */
const ROLE_OF: Record<NonNullable<NoteInput['role']>, Role> = { paragraph: 'p', heading: 'h2', quote: 'quote', bullet: 'li', numbered: 'oli', todo: 'todo' }
const SIZE_OF = { small: 's', medium: 'm', large: 'l' } as const
const LIST_ROLES: ReadonlySet<Role> = new Set(['li', 'oli', 'todo'])
const WHAT: Record<Role, string> = { p: 'paragraph', h1: 'heading 1', h2: 'heading 2', h3: 'heading 3', li: 'point', oli: 'numbered item', todo: 'to-do', quote: 'quote' }

const roleOf = (input: NoteInput): Role => {
  const role = input.role ?? (input.level !== undefined ? 'heading' : 'paragraph')
  if (role !== 'heading') return ROLE_OF[role]
  const level = input.level ?? 2
  if (![1, 2, 3].includes(level)) throw new Error(`A heading's level is 1, 2 or 3, not ${level}.`)
  return `h${level}` as Role
}

/** The paragraphs of words written under a line: parted by blank lines, each on one line. */
export const paragraphsOf = (words: string): string[] =>
  words
    .split(/\n\s*\n/u)
    .map((part) => part.replace(/\s*\n\s*/gu, ' ').trim())
    .filter(Boolean)

/** A heading's or a quote's own Markdown sign, written before its words by a model, taken off: ## Summary, > Quoted. */
const unsigned = (text: string, role: Role): string => (/^h[1-3]$/u.test(role) ? text.replace(/^#{1,6}\s+/u, '') : role === 'quote' ? text.replace(/^>\s*/u, '') : text)

/** A list's items, a line each, with the signs models write before them taken off, and their levels in from the spaces before. */
export function itemsOf(words: string): { md: string; indent: number; done: boolean }[] {
  const lines = words.split('\n').filter((line) => line.trim() !== '')
  const lead = (line: string): number => (/^[ \t]*/u.exec(line)![0].replace(/\t/gu, '  ').length)
  const base = Math.min(...lines.map(lead))
  return lines.map((line) => {
    const sign = /^\s*(?:[-*+•–]|\d+[.)]|[a-z][.)])?\s*(?:\[([ xX✓])\])?\s*/u.exec(line)!
    return { md: line.slice(sign[0].length).trim(), indent: Math.min(8, Math.floor((lead(line) - base) / 2)), done: sign[1] !== undefined && sign[1] !== ' ' }
  }).filter((item) => item.md !== '')
}

/** A text block's id, named in words, or why not. */
function textOf(doc: Doc, written: string | undefined, context: NoteContext, what = 'block'): Text {
  if (written === undefined) throw new Error(`Name the ${what}: block=… (its id, $1, or words such as "the second paragraph").`)
  const found = referTo(doc, written, context)
  if (!found.ok) throw new Error(found.why)
  const block = doc.block[found.id]!
  if (block.type !== 'text') throw new Error(`${found.id} is ${block.type === 'frame' ? 'a text frame' : `a ${block.type}`}, not text: this works on a heading, a paragraph, a quote or a list's item.`)
  return block
}

/** A block of one kind, named in words: a table, a formula, a diagram, a picture; or why not. */
function blockOfType<T extends BlockType>(doc: Doc, written: string | undefined, context: NoteContext, type: T, what: string): Extract<Block, { type: T }> {
  if (written === undefined) throw new Error(`Name the ${what}: block=… (its id, $1, or words such as "the ${what}").`)
  const found = referTo(doc, written, context)
  if (!found.ok) throw new Error(found.why)
  const block = doc.block[found.id]!
  if (block.type !== type) throw new Error(`${found.id} is ${/^[aeiou]/iu.test(kindOf(block)) ? 'an' : 'a'} ${kindOf(block)}, not a ${what}.`)
  return block as Extract<Block, { type: T }>
}

/**
 * A pie chart's slices written on one line, parted by commas ("Sleep": 8, "Work": 8), as Mermaid reads none: a line
 * each (Gemma 4 E4B, round 1 of the note test, 25 October 2026). Every other line, and every other kind, as written.
 */
function mendPie(src: string): string {
  if (diagramKind(src) !== 'pie') return src
  return src
    .split('\n')
    .flatMap((line) => (/^\s*"[^"]+"\s*:\s*[\d.]+\s*,/u.test(line) ? line.split(/,\s*(?="[^"]+"\s*:)/u).map((slice) => `  ${slice.trim()}`) : [line]))
    .join('\n')
}

/** A diagram's Mermaid as written under the line: its common slips mended (as the AI box mends them), or why it cannot go in. */
function diagramOf(words: string, keep?: string): string {
  const src = mendPie(mendFlowchart(words.trim()))
  const hint = diagramHint(src, keep)
  if (hint !== null) throw new Error(`The diagram cannot go in: ${hint}`)
  return src
}

/** A formula's LaTeX as written under the line, its delimiters taken off, or why it cannot go in. */
function formulaOf(words: string): string {
  const tex = texOf(words)
  const hint = texHint(tex)
  if (hint !== null) throw new Error(`The formula cannot go in: ${hint}`)
  return tex
}

/** The words of a caption or a description: one line. */
const oneLine = (words: string): string => words.replace(/\s*\n\s*/gu, ' ').trim()

/** Where a new block goes: a frame and an index in it, and the block it follows (whose role a list takes on). */
interface Place {
  parent: string
  at: number
  after?: Text
  said: string
}

function placeOf(doc: Doc, input: NoteInput, context: NoteContext): Place {
  if (input.after !== undefined && input.before !== undefined) throw new Error('Give after=… or before=…, not both.')
  const near = input.after ?? input.before
  if (near !== undefined) {
    const found = referTo(doc, near, context)
    if (!found.ok) throw new Error(found.why)
    const block = doc.block[found.id]!
    if (!('parent' in block)) throw new Error(`${found.id} is placed on the page, not in the text: put it after or before a block of the text (boxes come with a later step).`)
    const frame = doc.block[block.parent]
    if (frame?.type !== 'frame') throw new Error(`${found.id} is in no text frame.`)
    const index = frame.kids.indexOf(found.id)
    return input.after !== undefined
      ? { parent: frame.id, at: index + 1, ...(block.type === 'text' ? { after: block } : {}), said: `after ${found.id}` }
      : { parent: frame.id, at: index, said: `before ${found.id}` }
  }
  // At the top or the end of a page: before its first block of text, or after its last, or in its empty frame.
  const page = input.page ?? context.page
  const facts = pageFacts(doc, page, context.drawn)
  const inText = facts.blocks.filter((one) => one.frame !== undefined)
  const end = input.at !== 'top'
  const edge = end ? inText.at(-1) : inText[0]
  if (edge) {
    const block = doc.block[edge.id]!
    const frame = doc.block[(block as Text).parent] as Extract<Block, { type: 'frame' }>
    const index = frame.kids.indexOf(edge.id)
    return end ? { parent: frame.id, at: index + 1, ...(block.type === 'text' ? { after: block } : {}), said: `at the end of page ${page}` } : { parent: frame.id, at: index, said: `at the top of page ${page}` }
  }
  const empty = facts.emptyFrames[0]
  if (empty) return { parent: empty.id, at: end ? (doc.block[empty.id] as Extract<Block, { type: 'frame' }>).kids.length : 0, said: `on page ${page}` }
  throw new Error(`Page ${page} has no text frame to write in (boxes come with a later step).`)
}

/** Ids for new blocks, none taken and none twice. */
function ids(doc: Doc, context: NoteContext): () => string {
  const made = new Set<string>()
  return () => {
    const id = newId((one) => (context.taken ? context.taken(one) : one in doc.block || one === doc.id || one in doc.page) || made.has(one))
    made.add(id)
    return id
  }
}

const needWords = (input: NoteInput): string => {
  if (input.words === undefined || input.words.trim() === '') throw new Error('No words: write them on the lines under the command, then a line end.')
  return input.words
}

type Frame = Extract<Block, { type: 'frame' }>

/** A page named as the model says it: "2", "page 2", first, last, "the last page". Its index, or why not. */
function pageIndex(doc: Doc, written: string | number): number {
  // p1 as a block's id is written, end and the start as a place is (the note test's baseline, 25 October 2026).
  const said = String(written).trim().toLowerCase().replace(/^(?:the\s+)?(?:page\s*)?/u, '').replace(/\s+page$/u, '').replace(/^p(?=\d+$)/u, '')
  const n = said === 'first' || said === 'start' || said === 'top' || said === 'front' ? 1 : said === 'last' || said === 'end' || said === 'bottom' ? doc.pages.length : /^\d+$/u.test(said) ? Number(said) : NaN
  if (!Number.isInteger(n) || n < 1 || n > doc.pages.length) throw new Error(`The note has ${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'}: name one by its number, 1 to ${doc.pages.length}.`)
  return n - 1
}

/** A block's box as the page has it: its own when placed on the page, else as drawn; and the page it is on. */
function boxOfBlock(doc: Doc, id: string, context: NoteContext): { box: { x: number; y: number; w: number; h: number }; page: string } {
  const block = doc.block[id]!
  if ('page' in block && block.type !== 'frame') return { box: { x: block.x, y: block.y, w: block.w, h: block.h }, page: block.page }
  const seen = context.drawn?.get(id)
  const parent = 'parent' in block ? doc.block[block.parent] : block
  const page = seen?.page ?? (parent && 'page' in parent ? parent.page : undefined)
  if (!seen || page === undefined) throw new Error(`${id} is not drawn now, so where it is on its page is not known: screen.page draws its page.`)
  return { box: { x: seen.x, y: seen.y, w: seen.w, h: seen.h }, page }
}

/** Why there is no room for a block of a size on a page, and where there is. */
function noRoom(doc: Doc, pageId: string, what: string, size: { w: number; h: number }, others: Parameters<typeof spotIn>[4]): Error {
  const room = roomyPlaces(doc, pageId, size, others)
  const n = doc.pages.indexOf(pageId) + 1
  return new Error(`No room ${what} on page ${n} for it at its size, without covering another block.${room.length > 0 ? ` Page ${n} has room at the ${room.join(', the ')}.` : ` Page ${n} has no room for it: block: resize makes it smaller, page: add makes a new page.`}`)
}

/**
 * Where a block of a size goes on a page, by the input's words (step 4): to= a part of the page, beside= or
 * below= a block. The page: page= when given, else the block named beside or below, else the one the request is about.
 */
function spotFor(doc: Doc, input: NoteInput, context: NoteContext, size: { w: number; h: number }, ignore: ReadonlySet<string>): { page: string; x: number; y: number; said: string } {
  const nearWritten = input.beside ?? input.below
  if (nearWritten !== undefined) {
    const found = referTo(doc, nearWritten, context)
    if (!found.ok) throw new Error(found.why)
    if (ignore.has(found.id)) throw new Error('A block cannot go beside or below itself.')
    const { box, page } = boxOfBlock(doc, found.id, context)
    const others = boxesOn(doc, page, context.drawn, ignore)
    const side = input.beside !== undefined ? 'beside' : 'below'
    const spot = spotNear(doc, page, box, side, size, others)
    if (!spot) throw noRoom(doc, page, `${side} ${found.id}`, size, others)
    return { page, ...spot, said: `${side} ${found.id}` }
  }
  const n = input.page ?? context.page
  const page = doc.pages[n - 1]
  if (page === undefined) throw new Error(`The note has ${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'}: no page ${n}.`)
  const word: PlaceWord | undefined = input.to === undefined ? 'top' : placeWord(String(input.to))
  if (word === undefined) throw new Error(`"${String(input.to)}" is no part of a page: to= ${PLACES.join(', ')}.`)
  const others = boxesOn(doc, page, context.drawn, ignore)
  const spot = spotIn(doc, page, word, size, others)
  if (!spot) throw noRoom(doc, page, `at the ${word}`, size, others)
  return { page, ...spot, said: `at the ${word} of page ${n}` }
}

/** A text block's words, for what the terminal says: first words only, quoted as the note's words always are. */
const shown = (md: string): string => quoted(plainText(parseInline(md)))

/** A note command made into ops. Throws an Error that says why, in words the model can act on. */
export function compileNote(doc: Doc, command: string, input: NoteInput, context: NoteContext): Compiled {
  // Nothing here changes `doc`: the ops go back to the door, which applies them. New blocks carry `r: 0` only because
  // the type needs one: apply sets it.
  const fresh = ids(doc, context)
  switch (command) {
    case 'text.add': {
      const role = roleOf(input)
      const place = placeOf(doc, input, context)
      const parts = LIST_ROLES.has(role) ? itemsOf(needWords(input)) : paragraphsOf(needWords(input)).map((md) => ({ md: unsigned(md, role), indent: 0, done: false }))
      if (parts.length === 0) throw new Error('No words: write them on the lines under the command, then a line end.')
      // A point added after a list's point starts at that point's level.
      const base = LIST_ROLES.has(role) && place.after && LIST_ROLES.has(place.after.role) ? place.after.indent : 0
      const blocks = parts.map((part): Text => ({ id: fresh(), r: 0, type: 'text', parent: place.parent, role, indent: Math.min(8, base + part.indent), md: part.md, ...(role === 'todo' && part.done ? { done: true as const } : {}) }))
      return { ops: blocks.map((block, i) => ({ op: 'add', block, at: place.at + i })), made: blocks.map((block) => block.id), said: `added ${blocks.length === 1 ? `${WHAT[role]} ${shown(blocks[0]!.md)} (${blocks[0]!.id})` : `${blocks.length} ${WHAT[role]}s (${blocks.map((block) => block.id).join(', ')})`}, ${place.said}` }
    }
    case 'list.add': {
      const role = ROLE_OF[input.style ?? 'bullet']
      const place = placeOf(doc, input, context)
      const items = itemsOf(needWords(input))
      if (items.length === 0) throw new Error('No items: write one a line under the command, then a line end.')
      const blocks = items.map((item): Text => ({ id: fresh(), r: 0, type: 'text', parent: place.parent, role, indent: item.indent, md: item.md, ...(role === 'todo' && item.done ? { done: true as const } : {}) }))
      return { ops: blocks.map((block, i) => ({ op: 'add', block, at: place.at + i })), made: blocks.map((block) => block.id), said: `added a list of ${blocks.length} ${WHAT[role]}${blocks.length === 1 ? '' : 's'} (${blocks.map((block) => block.id).join(', ')}), ${place.said}` }
    }
    case 'list.addItem': {
      // After the item named by after=, or at the end of the list block= is in.
      const named = textOf(doc, input.after ?? input.block, context, 'list')
      if (!LIST_ROLES.has(named.role)) throw new Error(`${named.id} is a ${WHAT[named.role]}, not a list's item: list.add makes a new list.`)
      const frame = doc.block[named.parent] as Extract<Block, { type: 'frame' }>
      let index = frame.kids.indexOf(named.id)
      // A list is the run of items of one role: a numbered list after a list of points is another list.
      if (input.after === undefined) while (index + 1 < frame.kids.length && (doc.block[frame.kids[index + 1]!] as Text | undefined)?.role === named.role) index++
      const like = doc.block[frame.kids[index]!] as Text
      const items = itemsOf(needWords(input))
      if (items.length === 0) throw new Error('No item: write it on the line under the command, then a line end.')
      const blocks = items.map((item): Text => ({ id: fresh(), r: 0, type: 'text', parent: frame.id, role: like.role, indent: Math.min(8, like.indent + item.indent), md: item.md, ...(like.role === 'todo' && item.done ? { done: true as const } : {}) }))
      return { ops: blocks.map((block, i) => ({ op: 'add', block, at: index + 1 + i })), made: blocks.map((block) => block.id), said: `added ${blocks.length === 1 ? `${WHAT[like.role]} ${shown(blocks[0]!.md)} (${blocks[0]!.id})` : `${blocks.length} items (${blocks.map((block) => block.id).join(', ')})`} after ${like.id}` }
    }
    case 'text.rewrite': {
      const block = textOf(doc, input.block, context)
      const words = needWords(input)
      // A list's item takes a line an item; anything else a paragraph a part.
      const list = LIST_ROLES.has(block.role)
      const items = list ? itemsOf(words) : []
      const parts = list ? items.map((item) => item.md) : paragraphsOf(words).map((md) => unsigned(md, block.role))
      if (parts.length === 0) throw new Error('No words: write them on the lines under the command, then a line end (block.remove takes a block away).')
      const done = rewriteBlocks(doc, [block.id], parts, context.taken ?? ((id) => id in doc.block), list ? (i) => ({ role: block.role, indent: Math.min(8, block.indent + items[i]!.indent) }) : undefined)
      const said = done.ops.length === 0 ? `${block.id} already says that: nothing changed` : `rewrote ${block.id}${done.made.length > 0 ? `, and added ${done.made.join(', ')} after it` : ''}`
      return { ops: done.ops, made: done.made, said }
    }
    case 'text.look': {
      const block = textOf(doc, input.block, context)
      const style: Record<string, unknown> = { ...block.style }
      if (input.size !== undefined) style.size = SIZE_OF[input.size]
      if (input.colour !== undefined) style.color = input.colour
      if (input.font !== undefined) style.font = input.font
      if (input.align !== undefined) style.align = input.align
      if (input.size === undefined && input.colour === undefined && input.font === undefined && input.align === undefined) throw new Error('Say the look: size=small|medium|large, colour=…, font=…, align=left|center|right.')
      const changes = [input.size && `size ${input.size}`, input.colour && `colour ${input.colour}`, input.font && `font ${input.font}`, input.align && `aligned ${input.align}`].filter(Boolean).join(', ')
      return { ops: [{ op: 'update', id: block.id, set: { style } }], made: [], said: `${block.id}: ${changes}` }
    }
    case 'text.role': {
      const block = textOf(doc, input.block, context)
      if (input.role === undefined && input.level === undefined) throw new Error('Say the role: role=paragraph|heading|quote|bullet|numbered|todo, and level=1|2|3 for a heading.')
      const role = roleOf(input)
      const set: Record<string, unknown> = { role }
      if (block.done && role !== 'todo') set.done = null
      return { ops: role === block.role ? [] : [{ op: 'update', id: block.id, set }], made: [], said: role === block.role ? `${block.id} is a ${WHAT[role]} already: nothing changed` : `${block.id} is now a ${WHAT[role]}` }
    }
    case 'text.indent':
    case 'text.outdent': {
      const block = textOf(doc, input.block, context)
      const indent = Math.max(0, Math.min(8, block.indent + (command === 'text.indent' ? 1 : -1)))
      return { ops: indent === block.indent ? [] : [{ op: 'update', id: block.id, set: { indent } }], made: [], said: indent === block.indent ? `${block.id} is at level ${indent} already: nothing changed` : `${block.id} is now at level ${indent}` }
    }
    case 'text.tick': {
      const block = textOf(doc, input.block, context, 'to-do')
      if (block.role !== 'todo') throw new Error(`${block.id} is a ${WHAT[block.role]}, not a to-do: text.role role=todo makes it one.`)
      const on = input.on ?? true
      const was = block.done === true
      return { ops: on === was ? [] : [{ op: 'update', id: block.id, set: { done: on ? true : null } }], made: [], said: `${block.id} ${on ? 'ticked' : 'unticked'}${on === was ? ' already: nothing changed' : ''}` }
    }
    case 'block.move': {
      if (input.block === undefined) throw new Error('Name the block: block=… (its id, $1, or words such as "the second paragraph").')
      const found = referTo(doc, input.block, context)
      if (!found.ok) throw new Error(found.why)
      const block = doc.block[found.id]!
      if (input.after === found.id || input.before === found.id) throw new Error('A block cannot go after or before itself.')
      // Onto the page, to a part of it or next to a block (step 4): a free spot found by code.
      if (input.to !== undefined || input.beside !== undefined || input.below !== undefined) {
        if (typeof input.to === 'number' || /^\d+$/u.test(String(input.to ?? ''))) throw new Error('to= a number moves a page (page: move); a block goes to a part of a page: to=top right, to=bottom…, or beside= or below= a block.')
        if (block.type === 'text') throw new Error(`${found.id} is text: it lives in a column of text. box: new makes a box of text on the page, beside= or below= a block.`)
        const inText = 'parent' in block
        const page = inText ? (context.drawn?.get(found.id)?.page ?? doc.pages[context.page - 1]!) : block.page
        const size = inText ? sizeOutOfText(doc, block, context.drawn, page) : { w: block.w, h: block.h }
        const spot = spotFor(doc, input, context, size, new Set([found.id]))
        return { ops: [{ op: 'move', id: found.id, to: { page: spot.page, x: spot.x, y: spot.y, w: size.w, h: size.h } }], made: [], said: `moved ${found.id}${inText ? ' out of the text' : ''} ${spot.said}` }
      }
      // A picture, a formula or a diagram placed on the page goes into the text as any block does (step 3: this
      // note's pictures are moved); a frame and handwriting stay on the page (moving them is step 4's).
      if (!('parent' in block)) {
        if (block.type === 'frame' || block.type === 'ink') throw new Error(`${found.id} is ${block.type === 'frame' ? 'a text frame' : 'handwriting'}, placed on the page: moving it to a place on the page comes with a later step.`)
        const place = placeOf(doc, input, context)
        return { ops: [{ op: 'move', id: found.id, to: { parent: place.parent, at: place.at } }], made: [], said: `moved ${found.id} into the text, ${place.said}` }
      }
      // The place is worked out as if the block were not there: its frame's list without it.
      const without = { ...doc, block: { ...doc.block, [block.parent]: { ...(doc.block[block.parent] as Extract<Block, { type: 'frame' }>), kids: (doc.block[block.parent] as Extract<Block, { type: 'frame' }>).kids.filter((kid) => kid !== found.id) } } } as Doc
      const place = placeOf(without, input, context)
      return { ops: [{ op: 'move', id: found.id, to: { parent: place.parent, at: place.at } }], made: [], said: `moved ${found.id} ${place.said}` }
    }
    // ----- recipes and the shape rules (step 5;) -----
    case 'recipe.qa':
    case 'recipe.section':
    case 'recipe.summary':
    case 'recipe.steps':
    case 'recipe.definition': {
      const words = needWords(input)
      const parts: Part[] =
        command === 'recipe.qa' ? qaParts(words)
        : command === 'recipe.section' ? sectionParts(words)
        : command === 'recipe.summary' ? sectionParts(words, 'Summary')
        : command === 'recipe.steps' ? stepParts(words)
        : [{ role: 'quote', md: definitionMd(words), indent: 0 }]
      if (parts.length === 0) throw new Error('No words: write them on the lines under the command, then a line end.')
      const place = placeOf(doc, input, context)
      const blocks = parts.map((part): Text => ({ id: fresh(), r: 0, type: 'text', parent: place.parent, role: part.role, indent: part.indent, md: part.md }))
      const what = { 'recipe.qa': `${parts.filter((part) => part.role === 'h3').length} questions and answers`, 'recipe.section': `a section ${shown(parts[0]!.md)} of ${parts.length - 1} points`, 'recipe.summary': `a summary of ${parts.length - 1} points`, 'recipe.steps': `${parts.length} steps, numbered`, 'recipe.definition': `the definition ${shown(parts[0]!.md)}` }[command]
      return { ops: blocks.map((block, i): Op => ({ op: 'add', block, at: place.at + i })), made: blocks.map((block) => block.id), said: `made ${what} (${blocks.map((block) => block.id).join(', ')}), ${place.said}`, choice: { shape: command.split('.')[1]!, by: 'recipe', features: featuresOf(words) } }
    }
    case 'recipe.compare': {
      const rows = compareRows(needWords(input))
      const place = placeOf(doc, input, context)
      const block = { id: fresh(), r: 0, type: 'table', parent: place.parent, rows, head: true, look: 'banded' } as Block
      return { ops: [{ op: 'add', block, at: place.at }], made: [block.id], said: `made a comparison of ${rows.length - 1} rows and ${rows[0]!.length} columns, a header row, banded (${block.id}), ${place.said}`, choice: { shape: 'compare', by: 'recipe', features: featuresOf(needWords(input)) } }
    }
    case 'write.add': {
      // The shape rules choose (sh1), and say which and why; the command of that shape writes it.
      const chosen = shapeOf(needWords(input))
      const as = { list: 'list.add', steps: 'recipe.steps', table: 'table.add', definition: 'recipe.definition', formula: 'maths.add', diagram: 'diagram.add', paragraphs: 'text.add' }[chosen.shape]
      const made = compileNote(doc, as, { ...input, ...(chosen.shape === 'paragraphs' ? { role: 'paragraph' as const } : {}) }, context)
      const shape = { list: 'a list', steps: 'numbered steps', table: 'a table', definition: 'a definition', formula: 'a formula', diagram: 'a diagram', paragraphs: 'paragraphs' }[chosen.shape]
      return { ...made, said: `wrote it as ${shape} (${chosen.why}): ${made.said}`, choice: { shape: chosen.shape, by: 'rules', features: chosen.features } }
    }
    // ----- resizing, boxes, pages (step 4) -----
    case 'block.resize': {
      if (input.block === undefined || input.span === undefined) throw new Error('Name the block and how wide: block=… span=half|third|full|wider|narrower.')
      const found = referTo(doc, input.block, context)
      if (!found.ok) throw new Error(found.why)
      const block = doc.block[found.id]!
      const span = input.span
      if (block.type === 'table') {
        // A table's width is in thousandths of its column's; at full, the field is removed (null).
        const now = block.width ?? 1000
        const share = span === 'full' ? 1000 : Math.max(200, Math.min(1000, Math.round(span === 'half' ? 500 : span === 'third' ? 333 : span === 'wider' ? now * 1.25 : now * 0.8)))
        if (share === now) return { ops: [], made: [], said: `${found.id} is that wide already: nothing changed` }
        return { ops: [{ op: 'update', id: found.id, set: { width: share === 1000 ? null : share } }], made: [], said: `${found.id} now ${Math.round(share / 10)} % of its column's width` }
      }
      // rs1: a block in the text follows its column; one on the page has a size of its own.
      if (!('page' in block)) throw new Error(`${found.id} sits in the text and follows its column's width: block: move block=${found.id} to=… places it on the page, where it can be resized (a table is resized where it is).`)
      if (block.type === 'ink') throw new Error(`${found.id} is handwriting: its strokes keep their size.`)
      const page = doc.page[block.page]!
      const w = spanned(block.w, span, page.w - 2 * MARGIN)
      // A picture, a formula, a diagram keeps its shape; a box only its width (its height is its text's).
      const h = block.type === 'frame' ? block.h : Math.max(100, Math.round((block.h * w) / Math.max(1, block.w)))
      if (w === block.w) return { ops: [], made: [], said: `${found.id} is that wide already: nothing changed` }
      // Where it was, moved in where it would run off; else the nearest room in its part of the page.
      const others = boxesOn(doc, page.id, context.drawn, new Set([found.id]))
      const x = Math.max(MARGIN, Math.min(block.x, page.w - MARGIN - w))
      const y = Math.max(MARGIN, Math.min(block.y, page.h - MARGIN - h))
      const free = others.every((o) => x + w <= o.x || o.x + o.w <= x || y + h <= o.y || o.y + o.h <= y)
      const across = (block.x + block.w / 2) / page.w
      const down = (block.y + block.h / 2) / page.h
      const part = placeWord(`${down < 1 / 3 ? 'top' : down > 2 / 3 ? 'bottom' : 'middle'} ${across < 1 / 3 ? 'left' : across > 2 / 3 ? 'right' : ''}`.trim()) ?? 'middle'
      const spot = free ? { x, y } : spotIn(doc, page.id, part, { w, h }, others)
      if (!spot) throw noRoom(doc, page.id, `at the ${part}`, { w, h }, others)
      return { ops: [{ op: 'move', id: found.id, to: { page: page.id, x: spot.x, y: spot.y, w, h } }], made: [], said: `${found.id} now ${Math.round(w / 100)} mm wide${free ? '' : `, moved to the ${part} to keep clear of the others`}` }
    }
    case 'box.new': {
      const parts = paragraphsOf(needWords(input))
      if (parts.length === 0) throw new Error('No words: write them on the lines under the command, then a line end.')
      const n = input.page ?? context.page
      const pageId = doc.pages[n - 1] ?? doc.pages[0]!
      const sheet = doc.page[pageId]!
      let w = Math.round((sheet.w - 2 * MARGIN) / 2)
      // Beside a block: as wide as the room beside it, up to half the page; below: as wide as it.
      if (input.beside !== undefined || input.below !== undefined) {
        const found = referTo(doc, (input.beside ?? input.below)!, context)
        if (!found.ok) throw new Error(found.why)
        const { box, page } = boxOfBlock(doc, found.id, context)
        const near = doc.page[page]!
        w = input.beside !== undefined ? Math.min(w, Math.max(near.w - MARGIN - (box.x + box.w + 300), box.x - 300 - MARGIN)) : box.w
        if (w < 3000) throw new Error(`There is no room beside ${found.id} for a box: below= puts one under it, to= in a part of the page.`)
      }
      // Its height before it is drawn: the lines its words take at about 1.9 mm a letter, 6 mm a line.
      const perLine = Math.max(10, Math.floor(w / 190))
      const h = parts.reduce((sum, part) => sum + Math.ceil(part.length / perLine), 0) * 600 + 400
      const spot = spotFor(doc, input, context, { w, h }, new Set())
      // Empty, its text added after it: `add` takes a frame only with no kids.
      const frame: Frame = { id: fresh(), r: 0, type: 'frame', page: spot.page, x: spot.x, y: spot.y, w, h, kids: [] }
      const blocks = parts.map((md): Text => ({ id: fresh(), r: 0, type: 'text', parent: frame.id, role: 'p', indent: 0, md }))
      return { ops: [{ op: 'add', block: frame }, ...blocks.map((block, i): Op => ({ op: 'add', block, at: i }))], made: blocks.map((block) => block.id), said: `added a box (${frame.id}) ${spot.said}, with ${blocks.length === 1 ? `the paragraph ${shown(blocks[0]!.md)} (${blocks[0]!.id})` : `${blocks.length} paragraphs (${blocks.map((block) => block.id).join(', ')})`}` }
    }
    case 'page.add': {
      if (input.after !== undefined && input.before !== undefined) throw new Error('Give after=… or before=…, not both.')
      const at = input.after !== undefined ? pageIndex(doc, input.after) + 1 : input.before !== undefined ? pageIndex(doc, input.before) : input.at === 'top' ? 0 : doc.pages.length
      // Its size and paper are those of the page before it (the first page's, at the front).
      const like = doc.page[doc.pages[Math.max(0, Math.min(at, doc.pages.length) - 1)] ?? doc.pages[0]!]!
      const id = fresh()
      // As a new note's page: one empty text frame inside the margins, so text can be written on it.
      const frame: Frame = { id: fresh(), r: 0, type: 'frame', page: id, x: MARGIN, y: MARGIN, w: Math.max(0, like.w - 2 * MARGIN), h: 0, kids: [] }
      return { ops: [{ op: 'page', add: { id, w: like.w, h: like.h, bg: like.bg, free: [] }, at }, { op: 'add', block: frame }], made: [], said: `added page ${at + 1} (${id}), with an empty text frame (${frame.id}); the note has ${doc.pages.length + 1} pages` }
    }
    case 'page.move': {
      if (input.page === undefined) throw new Error('Name the page: page= its number.')
      const from = pageIndex(doc, input.page)
      const id = doc.pages[from]!
      const rest = doc.pages.filter((one) => one !== id)
      // Counted in the list without the page, as `apply` takes it.
      const target = input.to !== undefined ? pageIndex(doc, input.to) : input.after !== undefined ? rest.indexOf(doc.pages[pageIndex(doc, input.after)]!) + 1 : input.before !== undefined ? rest.indexOf(doc.pages[pageIndex(doc, input.before)]!) : input.at === 'top' ? 0 : input.at === 'end' ? rest.length : undefined
      if (target === undefined) throw new Error('Say where: to= its new number, after= or before= another page, or at=top|end.')
      if ((input.after !== undefined && pageIndex(doc, input.after) === from) || (input.before !== undefined && pageIndex(doc, input.before) === from)) throw new Error('A page cannot go after or before itself.')
      if (target === from) return { ops: [], made: [], said: `page ${from + 1} is there already: nothing changed` }
      return { ops: [{ op: 'page', move: id, to: target }], made: [], said: `moved page ${from + 1} to be page ${target + 1}` }
    }
    case 'page.remove': {
      if (input.page === undefined) throw new Error('Name the page: page= its number.')
      if (doc.pages.length === 1) throw new Error('The note has one page: a note keeps at least one.')
      const index = pageIndex(doc, input.page)
      const id = doc.pages[index]!
      // Text flowing into a frame of the page stops where it is: the frame before it continues no more.
      const into = Object.values(doc.block).filter((block): block is Frame => block.type === 'frame' && block.page !== id && block.next !== undefined && (doc.block[block.next] as Frame | undefined)?.page === id)
      const count = doc.page[id]!.free.length
      return { ops: [...into.map((frame): Op => ({ op: 'update', id: frame.id, set: { next: null } })), { op: 'page', remove: id }], made: [], said: `removed page ${index + 1} and the ${count} ${count === 1 ? 'block' : 'blocks'} on it; the note has ${doc.pages.length - 1} pages` }
    }
    case 'page.paper': {
      if (input.paper === undefined) throw new Error('Say the paper: paper=blank|ruled|squares|dots.')
      const index = input.page !== undefined ? pageIndex(doc, input.page) : context.page - 1
      const id = doc.pages[index]
      if (id === undefined) throw new Error(`The note has ${doc.pages.length} pages: no page ${index + 1}.`)
      const bg = ({ blank: 'blank', ruled: 'ruled', squares: 'grid', dots: 'dots' } as const)[input.paper]
      if (doc.page[id]!.bg === bg) return { ops: [], made: [], said: `page ${index + 1} has ${input.paper} paper already: nothing changed` }
      return { ops: [{ op: 'update', id, set: { bg } }], made: [], said: `page ${index + 1} now on ${input.paper} paper` }
    }
    // ----- tables (step 3;) -----
    case 'table.add': {
      const written = tableOf(needWords(input))
      const place = placeOf(doc, input, context)
      const block = { id: fresh(), r: 0, type: 'table', parent: place.parent, rows: written.rows, ...(written.head ? { head: true } : {}) } as Block
      const [width, height] = [written.rows[0]!.length, written.rows.length]
      return { ops: [{ op: 'add', block, at: place.at }], made: [block.id], said: `added a table of ${height} row${height === 1 ? '' : 's'} and ${width} column${width === 1 ? '' : 's'}${written.head ? ', the first a header' : ''} (${block.id}), ${place.said}` }
    }
    case 'table.rewrite': {
      const table = blockOfType(doc, input.block, context, 'table', 'table')
      const set = rewriteTable(table, tableOf(needWords(input)))
      return { ops: set ? [{ op: 'update', id: table.id, set }] : [], made: [], said: set ? `rewrote the table ${table.id}` : `${table.id} already says that: nothing changed` }
    }
    case 'table.addRow': {
      const table = blockOfType(doc, input.block, context, 'table', 'table')
      const words = needWords(input)
      let rows = tableOf(words).rows
      // A row of several cells written with no | between them is not one cell: say how, never guess where it splits.
      if (table.rows[0]!.length > 1 && rows.every((row) => row.length === 1) && !/[|\t]/u.test(words)) throw new Error(`The table has ${table.rows[0]!.length} columns: write each new row's cells between | signs, as | ${table.rows[0]!.map((_, c) => `cell ${c + 1}`).join(' | ')} |`)
      // The header written again above the new rows, as models do, is not a row.
      const plain = (row: readonly string[]): string => row.map((cell) => plainText(parseInline(cell)).trim().toLowerCase()).join('|')
      if (rows.length > 1 && plain(rows[0]!) === plain(table.rows[0]!)) rows = rows.slice(1)
      const after = input.row !== undefined ? rowOf(table, input.row) : undefined
      const set = addRows(table, rows, after)
      return { ops: [{ op: 'update', id: table.id, set }], made: [], said: `added ${rows.length} row${rows.length === 1 ? '' : 's'} to ${table.id}, ${after === undefined ? 'at its end' : `after row ${after + 1}`}` }
    }
    case 'table.addColumn': {
      const table = blockOfType(doc, input.block, context, 'table', 'table')
      const words = needWords(input)
      const lines = words.split('\n').map((line) => line.trim()).filter(Boolean)
      // A line a cell, from the header down; or the column written across one line, between | signs.
      const cells = lines.length === 1 && /\|/u.test(lines[0]!) ? tableOf(lines[0]!).rows[0]! : lines.map((line) => line.replace(/^\|\s*|\s*\|$/gu, '').replace(/^[-*•]\s+/u, ''))
      const after = input.column !== undefined ? columnOf(table, input.column) : undefined
      const set = addColumn(table, cells, after)
      return { ops: [{ op: 'update', id: table.id, set }], made: [], said: `added a column to ${table.id}, ${after === undefined ? 'at its end' : `after column ${after + 1}`}` }
    }
    case 'table.removeRow': {
      const table = blockOfType(doc, input.block, context, 'table', 'table')
      if (input.row === undefined) throw new Error("Say which row: row= its number (the header row is 1) or its first cell's words.")
      const index = rowOf(table, input.row)
      return { ops: [{ op: 'update', id: table.id, set: removeRow(table, index) }], made: [], said: `took row ${index + 1} out of ${table.id}` }
    }
    case 'table.removeColumn': {
      const table = blockOfType(doc, input.block, context, 'table', 'table')
      if (input.column === undefined) throw new Error("Say which column: column= its number or its header's words.")
      const index = columnOf(table, input.column)
      return { ops: [{ op: 'update', id: table.id, set: removeColumn(table, index) }], made: [], said: `took column ${index + 1} out of ${table.id}` }
    }
    case 'table.look': {
      const table = blockOfType(doc, input.block, context, 'table', 'table')
      if (input.design === undefined && input.head === undefined) throw new Error('Say the look: design=grid|lines|banded|header, or head=on|off for a header row.')
      const set: Record<string, unknown> = {}
      // A setting back at its default is removed (null), not stored.
      if (input.design !== undefined && (table.look ?? 'grid') !== input.design) set.look = input.design === 'grid' ? null : input.design
      if (input.head !== undefined && (table.head === true) !== input.head) set.head = input.head ? true : null
      const changes = [input.design && `looks ${input.design}`, input.head !== undefined && (input.head ? 'its first row a header' : 'no header row')].filter(Boolean).join(', ')
      return { ops: Object.keys(set).length > 0 ? [{ op: 'update', id: table.id, set }] : [], made: [], said: Object.keys(set).length > 0 ? `${table.id}: ${changes}` : `${table.id} ${changes} already: nothing changed` }
    }
    // ----- maths (step 3;) -----
    case 'maths.add': {
      const tex = formulaOf(needWords(input))
      const place = placeOf(doc, input, context)
      const block = { id: fresh(), r: 0, type: 'math', parent: place.parent, tex } as Block
      return { ops: [{ op: 'add', block, at: place.at }], made: [block.id], said: `added the formula ${quoted(tex)} (${block.id}), ${place.said}` }
    }
    case 'maths.rewrite': {
      const maths = blockOfType(doc, input.block, context, 'math', 'formula')
      const tex = formulaOf(needWords(input))
      if (tex === maths.tex) return { ops: [], made: [], said: `${maths.id} already says that: nothing changed` }
      // The value worked out for the old formula is the old one's: it goes.
      return { ops: [{ op: 'update', id: maths.id, set: { tex, ...(maths.value !== undefined ? { value: null } : {}) } }], made: [], said: `rewrote the formula ${maths.id}: ${quoted(tex)}` }
    }
    // ----- diagrams (step 3: Mermaid, the kinds the AI box writes; Mermaid itself reads it at the door) -----
    case 'diagram.add': {
      const src = diagramOf(needWords(input))
      const place = placeOf(doc, input, context)
      const block = { id: fresh(), r: 0, type: 'diagram', parent: place.parent, lang: 'mermaid', src } as Block
      return { ops: [{ op: 'add', block, at: place.at }], made: [block.id], said: `added a ${diagramKind(src)} (${block.id}), ${place.said}`, diagrams: [src] }
    }
    case 'diagram.rewrite': {
      const diagram = blockOfType(doc, input.block, context, 'diagram', 'diagram')
      // A diagram may keep the kind it has, as the AI box lets it.
      const src = diagramOf(needWords(input), diagramKind(diagram.src))
      if (src === diagram.src) return { ops: [], made: [], said: `${diagram.id} already says that: nothing changed` }
      return { ops: [{ op: 'update', id: diagram.id, set: { src } }], made: [], said: `rewrote the ${diagramKind(src)} ${diagram.id}`, diagrams: [src] }
    }
    // ----- pictures (step 3;) -----
    case 'picture.add': {
      if (input.picture === undefined) throw new Error('Name the picture: picture= its description, caption or note.')
      if (!context.pictures) throw new Error("The library's pictures cannot be read here: only the pictures of the person's other notes may be placed.")
      const found = pictureFrom(input.picture, context.pictures)
      if (!found.ok) throw new Error(found.why)
      const source = found.source
      const place = placeOf(doc, input, context)
      const caption = input.words !== undefined && input.words.trim() !== '' ? oneLine(input.words) : source.caption
      const block = { id: fresh(), r: 0, type: 'image', parent: place.parent, asset: source.hash, ...(source.alt ? { alt: source.alt } : {}), ...(caption ? { caption } : {}) } as Block
      // The asset first when this note lacks it: apply refuses an image whose asset is not there. Its bytes are the
      // door's to bring (`assets`).
      const ops: Op[] = [...(doc.asset[source.hash] ? [] : [{ op: 'asset' as const, hash: source.hash, meta: source.meta }]), { op: 'add', block, at: place.at }]
      return { ops, made: [block.id], said: `added the picture ${quoted(source.alt ?? source.caption ?? 'with no description')} from “${source.note}” (${block.id}), ${place.said}`, assets: [source.hash] }
    }
    case 'picture.caption':
    case 'picture.describe': {
      const image = blockOfType(doc, input.block, context, 'image', 'picture')
      const words = oneLine(needWords(input))
      const field = command === 'picture.caption' ? 'caption' : 'alt'
      if (image[field] === words) return { ops: [], made: [], said: `${image.id} already has that ${command === 'picture.caption' ? 'caption' : 'description'}: nothing changed` }
      return { ops: [{ op: 'update', id: image.id, set: { [field]: words } }], made: [], said: `${image.id}: ${command === 'picture.caption' ? 'its caption' : 'its description'} ${quoted(words)}` }
    }
    case 'block.remove': {
      if (input.block === undefined) throw new Error('Name the block: block=… (its id, $1, or words such as "the second paragraph").')
      const found = referTo(doc, input.block, context)
      if (!found.ok) throw new Error(found.why)
      const block = doc.block[found.id]!
      if (block.type === 'frame') throw new Error(`${found.id} is a text frame with ${block.kids.length} blocks in it: remove its blocks one by one (a frame goes with a later step).`)
      return { ops: [{ op: 'remove', id: found.id }], made: [], said: `removed ${found.id}${block.type === 'text' ? ` ${shown(block.md)}` : ''}` }
    }
    default:
      throw new Error(`There is no note command ${command}.`)
  }
}
