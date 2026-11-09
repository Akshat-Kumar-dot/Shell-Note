// A thumbnail's words keep their marks (Stage 3a's exit check: the thumbnails
// show the new marks): underline, subscript, superscript, and a size or font
// of the words' own, laid out as thumbnail.ts draws them.
import { toRuns } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { layoutRuns, tableColumns, type Look } from '../src/library/textLayout.js'

const line: Look = { size: 10, font: 'sans', bold: false, italic: false, color: undefined }
/** Every character is half as wide as the letters are high. */
const measure = (text: string, look: Look): number => text.length * look.size * 0.5

const pieces = (md: string, width = 1000) => layoutRuns(toRuns(md), line, 10, width, measure).flatMap((l) => l.pieces)
const find = (md: string, text: string) => pieces(md).find((piece) => piece.text === text)!

describe('the thumbnail lays out words with their marks', () => {
  it('underline, strike and highlight', () => {
    expect(find('one [two]{.underline} three', 'two')).toMatchObject({ underline: true, strike: false })
    expect(find('one ~~two~~', 'two')).toMatchObject({ strike: true })
    expect(find('==two==', 'two')).toMatchObject({ highlight: true })
    expect(find('one [two]{.underline}', 'one')).toMatchObject({ underline: false })
  })

  it('subscript and superscript: smaller, below or above the line', () => {
    const sub = find('H[2]{.sub}O', '2')
    const sup = find('x[2]{.sup}', '2')
    expect(sub.size).toBeLessThan(10)
    expect(sub.shift).toBeGreaterThan(0)
    expect(sup.size).toBeLessThan(10)
    expect(sup.shift).toBeLessThan(0)
    expect(find('H[2]{.sub}O', 'H').shift).toBe(0)
  })

  it('a size and a font of the words own, a library font in the style it resembles', () => {
    expect(find('one [two]{size=xl}', 'two').size).toBe(16)
    expect(find('one [two]{size=xl}', 'one').size).toBe(10)
    expect(find('[two]{font=lora}', 'two').font).toBe('serif')
    expect(find('[two]{font=mono}', 'two').font).toBe('mono')
    expect(find('**bold** [red]{color=red}', 'bold').bold).toBe(true)
    expect(find('**bold** [red]{color=red}', 'red').color).toBe('red')
  })

  it('breaks lines between words, a line never starting with a space, and the tallest words set its height', () => {
    // "aaaa bbbb cccc" at 5 px a character: 20 + 5 + 20 = 45 px fit in 50, the third word does not.
    const lines = layoutRuns(toRuns('aaaa bbbb cccc'), line, 10, 50, measure)
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(''))).toEqual(['aaaa bbbb', 'cccc'])
    const tall = layoutRuns(toRuns('a [b]{size=xl}'), line, 10, 1000, measure)
    expect(tall[0]!.height).toBeGreaterThan(layoutRuns(toRuns('a b'), line, 10, 1000, measure)[0]!.height)
  })
})

describe('the thumbnail draws a table at its own widths', () => {
  it('as wide as it was made, each column at its share', () => {
    expect(tableColumns({ rows: [['a', 'b']], cols: [700, 300], width: 500 }, 200)).toEqual({ width: 100, edges: [0, 70, 100] })
    // Without widths: the frame's whole width, in equal columns.
    expect(tableColumns({ rows: [['a', 'b', 'c', 'd']] }, 100)).toEqual({ width: 100, edges: [0, 25, 50, 75, 100] })
  })
})
