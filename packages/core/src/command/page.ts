// The open note's blocks as lines, page by page (note.blocks, the terminal's
// `blocks`), and one block in full (note.block, `block <id>`): each block's id,
// what it is, its first words and its box on its page, and what each page is
// about, so the person and the agent can name blocks and places without
// guessing. A first, plain piece of the text picture of a page (the design 2)
// that note control will draw. A block inside a frame has no place of its own
// in the data: its box is measured where the page is drawn, and given in by the
// caller.
import { distance } from '../ai/tier0.js'
import type { Box } from '../ink/geometry.js'
import { parseInline, plainText } from '../markdown/inline.js'
import type { Block, Doc } from '../schema/doc.js'

const ROLE: Record<string, string> = { p: 'paragraph', h1: 'heading 1', h2: 'heading 2', h3: 'heading 3', li: 'list item', oli: 'numbered item', todo: 'to-do', quote: 'quote' }

/** How many characters of a block's words a line shows. */
const WORDS = 48

const mm = (units: number): string => String(Math.round(units / 10) / 10)

/**
 * Words on one line, cut short with … when long. They are the note's words, which go back to the model: data, never
 * instructions, so a quote inside is made an apostrophe (it cannot end the quoting) and backticks are
 * plain (they cannot close the model's block), as picture.ts's quoted() does.
 */
function short(text: string): string {
  const one = plain(text)
  return one.length > WORDS ? `${one.slice(0, WORDS - 1)}…` : one
}

/** The note's words on one line, whole: its quotes made apostrophes, its backticks plain (see short). */
const plain = (text: string): string => text.replace(/`+/gu, "'").replace(/["“”]/gu, "'").replace(/\s+/gu, ' ').trim()

/** A box in words: where on the page, and how big. */
const boxWords = (box: Box): string => `at ${mm(box.x)}, ${mm(box.y)} mm, ${mm(box.w)} × ${mm(box.h)} mm`

/**
 * A block's box. One placed on the page has its own (its drawing may be larger: handwriting is drawn over the whole
 * page); a frame's grows with its text, and a block inside a frame has none, so theirs are measured where the page is
 * drawn.
 */
function boxOf(block: Block, boxes: ReadonlyMap<string, Box> | undefined): Box | undefined {
  const own = 'page' in block ? { x: block.x, y: block.y, w: block.w, h: block.h } : undefined
  if (own && block.type !== 'frame') return own
  return boxes?.get(block.id) ?? own
}

/** What a block is, and its first words. */
function whatOf(block: Block): string {
  switch (block.type) {
    case 'frame':
      return `text frame, ${block.kids.length} ${block.kids.length === 1 ? 'block' : 'blocks'}${block.next ? `, flows on into ${block.next}` : ''}`
    case 'text':
      return `${ROLE[block.role] ?? block.role}${block.indent > 0 ? `, indent ${block.indent}` : ''} · "${short(block.md)}"`
    case 'math':
      return `math · ${short(block.tex)}`
    case 'image':
      return `picture${block.alt ? ` · "${short(block.alt)}"` : ''}`
    case 'diagram':
      return `diagram · ${short(block.src)}`
    case 'ink':
      return `handwriting, ${block.strokes.length} ${block.strokes.length === 1 ? 'stroke' : 'strokes'}${block.text ? ` · read as "${short(block.text)}"` : ''}`
    case 'table':
      return `table, ${block.rows.length} ${block.rows.length === 1 ? 'row' : 'rows'}${block.rows[0] ? ` · ${short(block.rows[0].join(' | '))}` : ''}`
  }
}

/** One block as a line: its id, what it is, its words, its box. */
function lineOf(block: Block, boxes: ReadonlyMap<string, Box> | undefined): string {
  const box = boxOf(block, boxes)
  return `${block.id} · ${whatOf(block)}${box ? ` · ${boxWords(box)}` : ''}`
}

/** The blocks placed on a page, top to bottom. */
function placedOn(doc: Doc, page: string): Block[] {
  return Object.values(doc.block)
    .filter((block) => 'page' in block && block.page === page)
    .sort((a, b) => ('y' in a && 'y' in b ? a.y - b.y || a.x - b.x : 0))
}

/** What a page is about: its first heading, else the first words written on it. */
function aboutOf(doc: Doc, page: string): string | undefined {
  const texts = placedOn(doc, page).flatMap((block) => (block.type === 'frame' ? block.kids.map((kid) => doc.block[kid]) : [block])).filter((block): block is Extract<Block, { type: 'text' }> => block?.type === 'text' && block.md.trim() !== '')
  const first = texts.find((block) => block.role === 'h1' || block.role === 'h2' || block.role === 'h3') ?? texts[0]
  return first ? short(first.md) : undefined
}

/**
 * The note's blocks, page by page, top to bottom; a frame's own blocks under it, in their order. With `only`, a page
 * number from 1, that page's alone. `boxes`: blocks' boxes as drawn.
 */
export function blocksList(doc: Doc, only?: number, boxes?: ReadonlyMap<string, Box>): string {
  if (only !== undefined && (only < 1 || only > doc.pages.length)) throw new Error(`The note has ${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'}: no page ${only}.`)
  const out: string[] = [`note "${plain(doc.title)}" (${doc.id}) · ${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'}`]
  doc.pages.forEach((page, index) => {
    if (only !== undefined && index + 1 !== only) return
    const about = aboutOf(doc, page)
    const size = doc.page[page]
    out.push(`page ${index + 1} (${page})${size ? ` · ${mm(size.w)} × ${mm(size.h)} mm` : ''}${about ? ` · about "${about}"` : ''}`)
    const placed = placedOn(doc, page)
    if (placed.length === 0) out.push('  empty')
    for (const block of placed) {
      out.push(`  ${lineOf(block, boxes)}`)
      if (block.type !== 'frame') continue
      for (const kid of block.kids) {
        const child = doc.block[kid]
        if (child) out.push(`    ${lineOf(child, boxes)}`)
      }
    }
  })
  return out.join('\n')
}

/** A block's own words, as the person reads them: a text's (no Markdown), a picture's description, handwriting as read… */
export function wordsOf(block: Block): string | undefined {
  switch (block.type) {
    case 'text':
      return plainText(parseInline(block.md))
    case 'image':
      return block.alt ?? block.caption
    case 'ink':
      return block.text
    case 'math':
      return block.tex
    case 'diagram':
      return block.src
    case 'table':
      return block.rows[0]?.join(' | ')
    case 'frame':
      return undefined
  }
}

const tidy = (text: string): string => text.replace(/\s+/gu, ' ').trim().toLowerCase()

/** The ids a letter or two off one that is not in the note, closest first. */
function nearIds(written: string, doc: Doc): string[] {
  const wrong = written.toLowerCase()
  const most = Math.max(1, Math.min(2, Math.floor(written.length / 3)))
  return Object.keys(doc.block)
    .map((id) => ({ id, d: distance(wrong, id.toLowerCase()) }))
    .filter(({ d }) => d <= most)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ id }) => id)
}

/**
 * A block named by its id, or by its words: all of them, or how they start, in any case.
 * Never a guess: words two blocks share are refused with each one's id, and words none has with the closest.
 */
export function blockOf(doc: Doc, written: string): string {
  if (doc.block[written]) return written
  const wanted = tidy(written)
  const said = Object.values(doc.block).flatMap((block) => {
    const words = wordsOf(block)
    return words === undefined ? [] : [{ block, words: tidy(words) }]
  })
  const whole = said.filter(({ words }) => words === wanted)
  const starting = wanted.length >= 3 ? said.filter(({ words }) => words.startsWith(wanted)) : []
  const found = whole.length > 0 ? whole : starting
  if (found.length === 1) return found[0]!.block.id
  if (found.length > 1) throw new Error(`${found.length} blocks ${whole.length > 0 ? 'say' : 'start with'} "${written}": ${found.slice(0, 6).map(({ block }) => `${block.id} ${whatOf(block)}`).join('; ')}. Name one by its id.`)
  const close = [...new Set([...nearIds(written, doc), ...said.filter(({ words }) => wanted.length >= 3 && words.includes(wanted)).map(({ block }) => block.id)])].slice(0, 5)
  throw new Error(`No such block in this note: ${written} (no block has that id, or those words).${close.length > 0 ? ` The closest: ${close.join(', ')}.` : ''} note.blocks lists them all.`)
}

/** The page a block is on: its own, or its frame's. */
function pageOf(doc: Doc, block: Block): string | undefined {
  if ('page' in block) return block.page
  const parent = doc.block[block.parent]
  return parent && 'page' in parent ? parent.page : undefined
}

/** One block in full: what and where it is (its page, its frame, its box), when it last changed, then all its data. */
export function blockDetail(doc: Doc, written: string, boxes?: ReadonlyMap<string, Box>): string {
  const block = doc.block[blockOf(doc, written)]!
  const page = pageOf(doc, block)
  const where: string[] = []
  if (page) where.push(`page ${doc.pages.indexOf(page) + 1} (${page})`)
  if ('parent' in block) {
    const parent = doc.block[block.parent]
    if (parent?.type === 'frame') where.push(`in frame ${parent.id}, block ${parent.kids.indexOf(block.id) + 1} of ${parent.kids.length}`)
  }
  const box = boxOf(block, boxes)
  where.push(box ? boxWords(box) : 'not drawn now, so no box')
  return `${block.id} · ${whatOf(block)}\n${where.join(' · ')} · last changed at change ${block.r}\n${JSON.stringify(block)}`
}
