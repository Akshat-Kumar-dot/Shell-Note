// The words of a thumbnail laid out without a canvas, so they can be tested:
// each piece of text with the look it has on the page (file format version 2:
// underline, subscript, superscript, and a size or font of the words' own, as
// well as bold, italic, strike, highlight and colour). thumbnail.ts draws the
// pieces; the measuring is passed in.
import { equalShares, libraryFont, SHARE_TOTAL, type Run, type Size, type TableBlock } from '@shellnote/core'

/** How a piece of text looks: what the canvas needs to draw it. */
export interface Look {
  /** Height of the letters, in pixels. */
  size: number
  /** A font style: sans, serif, mono or hand. */
  font: string
  bold: boolean
  italic: boolean
  /** A named colour or a code; undefined for the ink colour. */
  color: string | undefined
}

export interface Piece extends Look {
  text: string
  /** From the start of the line, in pixels. */
  x: number
  width: number
  /** Down from the line's top: below it for subscript, above it (negative) for superscript. */
  shift: number
  underline: boolean
  strike: boolean
  highlight: boolean
}

export interface Line {
  pieces: Piece[]
  width: number
  /** The line's height, set by its largest letters. */
  height: number
}

/** Sizes as theme.css draws them, from 11 pt: the factor for each size token. */
export const SIZE_FACTOR: Record<Size, number> = { s: 0.85, m: 1, l: 1.25, xl: 1.6 }
/** Line spacing, as a multiple of the letters' size. */
export const LINE = 1.45

/** The font style a font draws in: a library font in the style it resembles. */
export function fontStyle(font: string | undefined): string {
  if (font === 'serif' || font === 'mono' || font === 'hand' || font === 'sans') return font
  return (font !== undefined && libraryFont(font)?.like) || 'sans'
}

/** The look of one run: its line's, changed by the run's own marks. `normal` is the size of 11 pt text, in pixels. */
export function lookOf(run: Run, line: Look, normal: number): Look & Pick<Piece, 'shift' | 'underline' | 'strike' | 'highlight'> {
  const marks = run.marks
  const own = marks.size ? normal * SIZE_FACTOR[marks.size] : line.size
  // Subscript and superscript are smaller, and sit below or above the line, as on the page.
  const small = marks.sub || marks.sup ? own * 0.75 : own
  return {
    size: small,
    font: 'math' in run ? 'serif' : marks.code ? 'mono' : marks.font ? fontStyle(marks.font) : line.font,
    bold: line.bold || marks.b === true,
    italic: line.italic || marks.i === true || 'math' in run,
    color: marks.color ?? line.color,
    shift: marks.sup ? -own * 0.3 : marks.sub ? own * 0.35 : 0,
    underline: marks.u === true,
    strike: marks.s === true,
    highlight: marks.hl === true,
  }
}

/**
 * Lay runs out in lines no wider than `width`, breaking between words. A word
 * too long for a line has a line of its own. `measure` gives a text's width in
 * a look.
 */
export function layoutRuns(runs: readonly Run[], line: Look, normal: number, width: number, measure: (text: string, look: Look) => number): Line[] {
  const lines: Line[] = []
  let current: Piece[] = []
  let x = 0
  const finish = (): void => {
    // Spaces at the end of a line take no room.
    while (current.length > 0 && current.at(-1)!.text.trim() === '') current.pop()
    const height = Math.max(line.size, ...current.map((piece) => piece.size - Math.min(0, piece.shift))) * LINE
    lines.push({ pieces: current, width: current.reduce((end, piece) => Math.max(end, piece.x + piece.width), 0), height })
    current = []
    x = 0
  }
  for (const run of runs) {
    const look = lookOf(run, line, normal)
    const text = 'math' in run ? run.math : run.text
    for (const token of text.match(/\s+|\S+/gu) ?? []) {
      const space = token.trim() === ''
      // A line starts with a word, never with the spaces after the last one.
      if (space && current.length === 0) continue
      const tokenWidth = measure(token, look)
      if (!space && current.length > 0 && x + tokenWidth > width) finish()
      current.push({ ...look, text: token, x, width: tokenWidth })
      x += tokenWidth
    }
  }
  if (current.length > 0 || lines.length === 0) finish()
  return lines
}

/**
 * Where a table's columns are, for a frame `width` pixels wide: the table's
 * own width (its share of the frame's) and each column's left edge, then the
 * right edge of the last.
 */
export function tableColumns(table: Pick<TableBlock, 'rows' | 'cols' | 'width'>, width: number): { width: number; edges: number[] } {
  const across = (width * (table.width ?? SHARE_TOTAL)) / SHARE_TOTAL
  const shares = table.cols ?? equalShares(table.rows[0]?.length ?? 1)
  let at = 0
  return { width: across, edges: [0, ...shares.map((share) => (at += (share * across) / SHARE_TOTAL))] }
}
