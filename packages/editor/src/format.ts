// What the toolbar's buttons do, as operations. They use core's compile, the
// same code an AI edit's style and mark go through (phase 1), so "make this
// red" from a button and from a model make exactly the same change: colour
// goes to the selected words when there are some, and to the block otherwise.
// Under a Select box, the word buttons act on each piece of text it holds.
import { apply, compile, idTaken, libraryFont, makeAliases, markRange, newId, parseInline, plainText, spliceFor, textLength, toRuns, type AiOp, type AnyColor, type Color, type Doc, type Id, type MarkChange, type Op, type Role, type Selection, type Size, type TextBlock, type WordRange } from '@shellnote/core'

/** A change to whole blocks, as style takes it. */
export interface BlockChange {
  size?: 's' | 'm' | 'l' | 'xl'
  color?: Color
  font?: 'sans' | 'serif' | 'mono' | 'hand'
  align?: 'left' | 'center' | 'right'
  role?: Role
  indent?: 'in' | 'out'
  done?: boolean
}

/** A change to the selected words, as mark takes it; underline, subscript and superscript are for people until protocol v1.1. */
export interface WordChange {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  highlight?: boolean
  link?: boolean
  color?: Color
  underline?: boolean
  sub?: boolean
  sup?: boolean
}

/** The marks the AI's mark does not take yet (protocol v1): made here with core's markRange, as a person's colour code is. */
const PEOPLE_MARKS = ['underline', 'sub', 'sup'] as const

const fresh = (doc: Doc) => () => newId((id) => idTaken(doc, id))

/**
 * The text a Select box holds, as pieces: its word pieces, and the whole text
 * of each text block it holds. None for a selection made any other way.
 */
export function boxPieces(doc: Doc, selection: Selection): WordRange[] {
  if (selection.range || selection.here === undefined || !('page' in selection.here)) return []
  return chosenPieces(doc, selection)
}

/**
 * The words of blocks chosen as objects, by a Select box or a click: the whole
 * text of each chosen text block, then a box's pieces of text. Only for a
 * selection of objects; a caret's selection names its block too, and that
 * block is not chosen whole.
 */
export function chosenPieces(doc: Doc, selection: Selection): WordRange[] {
  if (selection.range) return []
  const whole = selection.blocks.flatMap((id): WordRange[] => {
    const block = doc.block[id]
    return block?.type === 'text' && block.md !== '' ? [{ block: id, start: 0, end: textLength(block.md) }] : []
  })
  return [...whole, ...(selection.words ?? [])].map((piece) => trimRange(doc, piece))
}

/**
 * A range of a block's words without the spaces at its ends, which a change of
 * format leaves alone: on Windows a double-click takes the space after a word
 * too (found in Edge), and the space should not be underlined. A range of
 * spaces only stays as it is.
 */
export function trimRange(doc: Doc, range: WordRange): WordRange {
  const block = doc.block[range.block]
  if (block?.type !== 'text') return range
  const text = plainText(parseInline(block.md))
  let { start, end } = range
  while (start < end && /\s/u.test(text[start] ?? '')) start++
  while (end > start && /\s/u.test(text[end - 1] ?? '')) end--
  return start < end && (start !== range.start || end !== range.end) ? { ...range, start, end } : range
}

/** A change to words, such as bold, for each piece of text in turn. */
export function wordOps(doc: Doc, pieces: readonly WordRange[], change: WordChange, href?: string): Op[] {
  const people: MarkChange = Object.fromEntries(PEOPLE_MARKS.flatMap((key) => (change[key] === undefined ? [] : [[key, change[key]]])))
  const byPeople = Object.keys(people).length > 0
  return overPieces(doc, pieces, (now, piece) => (!piece.range ? [] : byPeople ? rangeOps(now, piece.range, people) : markOps(now, piece, change, href)))
}

/** A change to a range of a block's words, through core's markRange. */
function rangeOps(doc: Doc, range: WordRange, change: MarkChange): Op[] {
  const block = doc.block[range.block]
  if (block?.type !== 'text') return []
  const md = markRange(block.md, range.start, range.end, change)
  return md === block.md ? [] : [spliceFor(block.id, 'md', block.md, md)]
}

/**
 * A colour, size or font for each piece of text in turn (the person's for size
 * and font). All the words of a line change the line's style, which the AI's
 * style also sets, and the same change on single words inside it goes, so the
 * whole line looks the same, as in Word; some of its words take a span of their
 * own. A span that only repeats the line's style is left out.
 */
function wordStyleOps(doc: Doc, pieces: readonly WordRange[], key: 'color' | 'size' | 'font', value: string): Op[] {
  let now = doc
  const ops: Op[] = []
  const step = (more: Op[]): void => {
    if (more.length === 0) return
    now = apply(now, more).doc
    ops.push(...more)
  }
  for (const piece of pieces) {
    const block = now.block[piece.block]
    if (block?.type !== 'text') continue
    const length = textLength(block.md)
    // All its words, spaces at the ends of the line aside, as trimRange leaves them.
    const words = trimRange(now, { block: block.id, start: 0, end: length })
    if (piece.start <= words.start && piece.end >= words.end) {
      step(rangeOps(now, { block: block.id, start: 0, end: length }, { [key]: key === 'color' ? 'ink' : null }))
      step(lineStyleOps(now, block.id, key, value))
      continue
    }
    const line = block.style?.[key] ?? (key === 'color' ? 'ink' : key === 'size' ? 'm' : 'sans')
    // Ink inside a coloured line is the words' own: without its span they would show the line's colour.
    const change: MarkChange = value === line ? { [key]: key === 'color' ? 'ink' : null } : value === 'ink' ? { color: 'ink', inkOwn: true } : { [key]: value }
    step(rangeOps(now, piece, change))
  }
  return ops
}

/** One style of a whole line: through core's style for the AI's tokens, else set here. */
function lineStyleOps(doc: Doc, id: Id, key: 'color' | 'size' | 'font', value: string): Op[] {
  if (key === 'color') return isCode(value as AnyColor) ? customColourOps(doc, { blocks: [id] }, value as AnyColor) : styleOps(doc, { blocks: [id] }, { color: value as Color })
  if (key === 'font' && libraryFont(value)) return customFontOps(doc, { blocks: [id] }, value)
  return styleOps(doc, { blocks: [id] }, { [key]: value } as BlockChange)
}

/** A colour, named or a code, for each piece of text in turn. */
export function colourOps(doc: Doc, pieces: readonly WordRange[], color: AnyColor): Op[] {
  return wordStyleOps(doc, pieces, 'color', color)
}

/** A size for each piece of text in turn: a whole line's, or some words' own. */
export function sizeOps(doc: Doc, pieces: readonly WordRange[], size: Size): Op[] {
  return wordStyleOps(doc, pieces, 'size', size)
}

/** A font for each piece of text in turn: a font style or a library font, a whole line's, or some words' own. */
export function fontOps(doc: Doc, pieces: readonly WordRange[], font: string): Op[] {
  return wordStyleOps(doc, pieces, 'font', font)
}

const isCode = (color: AnyColor): boolean => color.startsWith('#')

/**
 * Make a change to words for each piece in turn, as if each were selected on
 * its own, and give one splice per block. Marks and colours leave the text's
 * positions where they were, so every piece still points at its words.
 */
function overPieces(doc: Doc, pieces: readonly WordRange[], make: (doc: Doc, selection: Selection) => Op[]): Op[] {
  let now = doc
  for (const piece of pieces) {
    const ops = make(now, { blocks: [piece.block], range: piece })
    if (ops.length > 0) now = apply(now, ops).doc
  }
  return [...new Set(pieces.map((piece) => piece.block))].flatMap((id): Op[] => {
    const before = doc.block[id]
    const after = now.block[id]
    return before?.type === 'text' && after?.type === 'text' && before.md !== after.md ? [spliceFor(id, 'md', before.md, after.md)] : []
  })
}

/** A named colour for the words a Select box holds. Empty when it holds none. */
export function boxColourOps(doc: Doc, selection: Selection, color: Color): Op[] {
  return overPieces(doc, boxPieces(doc, selection), (now, piece) => styleOps(now, piece, { color }))
}

/** The operations for a change to the selected blocks. Blocks the change cannot apply to are left out. */
export function styleOps(doc: Doc, selection: Selection, change: BlockChange): Op[] {
  // Handwriting takes only a colour; math, images and diagrams take no style.
  const colourOnly = Object.keys(change).every((key) => key === 'color')
  // A size, font, alignment or role belongs to whole blocks, even with words selected in them
  // (to core, selected words are words, not a block); a colour goes to the selected words.
  const target: Selection = colourOnly ? selection : { blocks: selection.blocks }
  const aliases = makeAliases(doc, target)
  const ids = aliases.selected.filter(({ id }) => doc.block[id]?.type === 'text' || (colourOnly && doc.block[id]?.type === 'ink')).map(({ alias }) => alias)
  if (ids.length === 0) return []
  return compile({ op: 'style', ids, ...change } as AiOp, { doc, aliases, selection: target, newId: fresh(doc) })
}

/** The operations for a change to the selected words, or the words a Select box holds; none when no words are selected. */
export function markOps(doc: Doc, selection: Selection, change: WordChange, href?: string): Op[] {
  if (!selection.range) return overPieces(doc, boxPieces(doc, selection), (now, piece) => (piece.range ? markOps(now, piece, change, href) : []))
  const aliases = makeAliases(doc, selection)
  const alias = aliases.alias(selection.range.block)
  if (alias === undefined) return []
  return compile({ op: 'mark', id: alias, ...change } as AiOp, { doc, aliases, selection, newId: fresh(doc), ...(href === undefined ? {} : { href }) })
}

/**
 * A person's own colour, a code such as #e0563a, for the selected words, the
 * words a Select box holds, or else the selected text blocks. The AI's style
 * and mark take named colours only, so these operations are made here, with
 * core's markRange.
 */
export function customColourOps(doc: Doc, selection: Selection, color: AnyColor): Op[] {
  const pieces = boxPieces(doc, selection)
  if (pieces.length > 0) return overPieces(doc, pieces, (now, piece) => customColourOps(now, piece, color))
  const range = selection.range
  if (range && range.start < range.end) {
    const block = doc.block[range.block]
    if (block?.type !== 'text') return []
    const md = markRange(block.md, range.start, range.end, { color })
    return md === block.md ? [] : [spliceFor(block.id, 'md', block.md, md)]
  }
  return selection.blocks.flatMap((id): Op[] => {
    const block = doc.block[id]
    if (block?.type !== 'text' || block.style?.color === color) return []
    return [{ op: 'update', id, set: { style: { ...block.style, color } } }]
  })
}

/** A library font, such as lora, for the selected text blocks. The AI's style takes the four font styles only, so these operations are made here. */
export function customFontOps(doc: Doc, selection: Selection, font: string): Op[] {
  return selection.blocks.flatMap((id): Op[] => {
    const block = doc.block[id]
    if (block?.type !== 'text' || block.style?.font === font) return []
    return [{ op: 'update', id, set: { style: { ...block.style, font } } }]
  })
}

export interface WordMarks {
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  highlight: boolean
  underline: boolean
  sub: boolean
  sup: boolean
}

const NONE: WordMarks = { bold: false, italic: false, strike: false, code: false, highlight: false, underline: false, sub: false, sup: false }

/** Which marks every selected word has, under a Select box too, for the toolbar's pressed buttons. Nothing when no words are selected. */
export function marksIn(doc: Doc, selection: Selection): WordMarks {
  return marksOver(doc, selection.range ? [selection.range] : boxPieces(doc, selection))
}

/** Which marks every word of these pieces has. Nothing when they hold no words. */
export function marksOver(doc: Doc, chosen: readonly WordRange[]): WordMarks {
  const pieces = chosen.filter((piece) => piece.start < piece.end && doc.block[piece.block]?.type === 'text')
  if (pieces.length === 0) return NONE
  const all: WordMarks = { bold: true, italic: true, strike: true, code: true, highlight: true, underline: true, sub: true, sup: true }
  for (const range of pieces) {
    let at = 0
    for (const run of toRuns((doc.block[range.block] as TextBlock).md)) {
      // Positions as core counts them: text by its characters, a formula as $tex$.
      const length = 'text' in run ? run.text.length : run.math.length + 2
      if (at < range.end && at + length > range.start) {
        all.bold &&= run.marks.b === true
        all.italic &&= run.marks.i === true
        all.strike &&= run.marks.s === true
        all.code &&= run.marks.code === true
        all.highlight &&= run.marks.hl === true
        all.underline &&= run.marks.u === true
        all.sub &&= run.marks.sub === true
        all.sup &&= run.marks.sup === true
      }
      at += length
    }
  }
  return all
}

/** The colour, size or font all these words show, their own or their line's; undefined when they differ. */
export function styleOver(doc: Doc, pieces: readonly WordRange[], key: 'color' | 'size' | 'font'): string | undefined {
  let found: string | undefined
  for (const piece of pieces) {
    const block = doc.block[piece.block]
    if (block?.type !== 'text') continue
    const line = block.style?.[key] ?? (key === 'color' ? 'ink' : key === 'size' ? 'm' : 'sans')
    let at = 0
    for (const run of toRuns(block.md)) {
      const length = 'text' in run ? run.text.length : run.math.length + 2
      if (at < piece.end && at + length > piece.start) {
        const value = run.marks[key] ?? line
        if (found !== undefined && found !== value) return undefined
        found = value
      }
      at += length
    }
  }
  return found
}

/** The first selected text block, whose role and style the toolbar shows. */
export function firstText(doc: Doc, selection: Selection): TextBlock | undefined {
  for (const id of selection.blocks) {
    const block = doc.block[id]
    if (block?.type === 'text') return block
  }
  return undefined
}
