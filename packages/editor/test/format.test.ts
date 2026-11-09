// The toolbar's logic, without a browser: selections in core's terms, which
// marks show as pressed, and what the buttons do.
import { apply, type ChildBlock, type Doc, type TextBlock } from '@shellnote/core'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../core/test/fixtures/index.js'
import { coreOffset, frameJSON, selectionOf } from '../src/frame/convert.js'
import { frameExtensions } from '../src/frame/schema.js'
import { colourOps, fontOps, sizeOps, styleOver, trimRange, wordOps } from '../src/format.js'
import { boxColourOps, boxPieces, chosenPieces, colourOf, customColourOps, customFontOps, EditorStore, marksIn, markOps, styleOps } from '../src/index.js'

const schema = getSchema(frameExtensions({ takenElsewhere: () => false, newId: () => 'unused', assetUrl: () => undefined, asset: () => undefined }))

/** PHYSICS with t2's words replaced. */
function withText(md: string): Doc {
  return { ...PHYSICS, block: { ...PHYSICS.block, t2: { ...(PHYSICS.block.t2 as ChildBlock), md } as ChildBlock } }
}

describe('selections in core terms', () => {
  it('count a formula as $tex$, as core does', () => {
    const doc = withText('a $x^2$ b')
    const t2 = schema.nodeFromJSON(frameJSON(doc, 'f1')).child(1)
    // The editor counts the formula as one position; core counts "$x^2$", five.
    expect([0, 2, 3, 4, 5].map((at) => coreOffset(t2, at))).toEqual([0, 2, 7, 8, 9])
  })

  it('give the words selected in one block, and the blocks touched', () => {
    const doc = withText('An object at rest')
    const editor = schema.nodeFromJSON(frameJSON(doc, 'f1'))
    // t1 is 13 letters long, so t2's text starts at 1 + 13 + 1 + 1 = 16.
    const state = EditorState.create({ doc: editor, selection: TextSelection.create(editor, 16 + 3, 16 + 9) })
    expect(selectionOf(state, doc)).toEqual({ blocks: ['t2'], range: { block: 't2', start: 3, end: 9 } })
    const across = EditorState.create({ doc: editor, selection: TextSelection.create(editor, 3, 16 + 2) })
    expect(selectionOf(across, doc)).toEqual({ blocks: ['t1', 't2'] })
  })
})

describe('the toolbar', () => {
  const doc = withText('make this ***bold*** now')
  const range = (start: number, end: number) => ({ blocks: ['t2'], range: { block: 't2', start, end } })

  it('shows a mark as pressed only when every selected word has it', () => {
    expect(marksIn(doc, range(10, 14))).toMatchObject({ bold: true, italic: true, strike: false })
    expect(marksIn(doc, range(5, 14))).toMatchObject({ bold: false, italic: false })
    expect(marksIn(doc, { blocks: ['t2'] })).toMatchObject({ bold: false })
  })

  it('sends colour to the selected words, or to the block, as an AI style would', () => {
    const words = apply(doc, styleOps(doc, range(0, 4), { color: 'red' })).doc.block.t2 as TextBlock
    expect(words.md).toBe('[make]{color=red} this ***bold*** now')
    const block = apply(doc, styleOps(doc, { blocks: ['t2'] }, { color: 'red' })).doc.block.t2 as TextBlock
    expect(block).toMatchObject({ md: 'make this ***bold*** now', style: { color: 'red' } })
  })

  it('sends a size, alignment or role to the whole block, even with words selected in it', () => {
    // To core, selected words are words, not a block (protocol v1.1); the toolbar's block buttons still act on the block.
    expect(styleOps(doc, range(0, 4), { align: 'center' })).toEqual([{ op: 'update', id: 't2', set: { style: { align: 'center' } } }])
    expect(styleOps(doc, range(0, 4), { role: 'h2' })).toEqual([{ op: 'update', id: 't2', set: { role: 'h2' } }])
  })

  it('leaves out blocks a change cannot apply to, and words when none are selected', () => {
    // m1 is a formula: a size does not apply to it, so only t2 changes.
    expect(styleOps(doc, { blocks: ['t2', 'm1'] }, { size: 'l' })).toEqual([{ op: 'update', id: 't2', set: { style: { size: 'l' } } }])
    expect(markOps(doc, { blocks: ['t2'] }, { bold: true })).toEqual([])
  })
})

describe('the word buttons under a Select box', () => {
  // t1 reads "Newton's laws"; t2 one line of text, of which a box holds two pieces.
  const doc = withText('one two three four five')
  const here = { page: 'p1', x: 0, y: 0, w: 100, h: 100 }
  const box = { blocks: ['t1'], words: [{ block: 't2', start: 4, end: 7 }, { block: 't2', start: 14, end: 18 }], here }

  it('act on each piece, and on the whole text of each text block the box holds', () => {
    expect(boxPieces(doc, box)).toEqual([{ block: 't1', start: 0, end: 13 }, ...box.words])
    const ops = markOps(doc, box, { bold: true })
    // One change for each block.
    expect(ops).toHaveLength(2)
    const after = apply(doc, ops).doc
    expect((after.block.t2 as TextBlock).md).toBe('one **two** three **four** five')
    expect((after.block.t1 as TextBlock).md).toBe("**Newton's laws**")
    expect(marksIn(after, box)).toMatchObject({ bold: true, italic: false })
    expect(marksIn(doc, box)).toMatchObject({ bold: false })
  })

  it('colour each piece, with a named colour or a code', () => {
    const words = { blocks: [], words: box.words, here }
    expect((apply(doc, boxColourOps(doc, words, 'red')).doc.block.t2 as TextBlock).md).toBe('one [two]{color=red} three [four]{color=red} five')
    expect((apply(doc, customColourOps(doc, words, '#2a9d8f')).doc.block.t2 as TextBlock).md).toBe('one [two]{color=#2a9d8f} three [four]{color=#2a9d8f} five')
  })

  it('hold no pieces for a selection made any other way', () => {
    expect(boxPieces(doc, { blocks: ['t1', 't2'] })).toEqual([])
    expect(boxColourOps(doc, { blocks: ['t2'] }, 'red')).toEqual([])
  })
})

describe('the tools', () => {
  it('start with Type, and tell listeners when another is chosen', () => {
    const store = new EditorStore(PHYSICS)
    expect(store.tool).toBe('type')
    let heard = 0
    const stop = store.subscribeTool(() => heard++)
    store.setTool('select')
    store.setTool('select')
    expect([store.tool, store.toolSnapshot(), heard]).toEqual(['select', 'select', 1])
    stop()
    store.setTool('free')
    expect([store.tool, heard]).toEqual(['free', 1])
  })
})

describe('a person\'s own colours', () => {
  const doc = withText('one two three')

  it('colour the selected words with a code, or else the selected blocks', () => {
    const words = customColourOps(doc, { blocks: ['t2'], range: { block: 't2', start: 4, end: 7 } }, '#2a9d8f')
    expect(apply(doc, words).doc.block.t2).toMatchObject({ md: 'one [two]{color=#2a9d8f} three' })
    const blocks = customColourOps(doc, { blocks: ['t1', 't2', 'm1'] }, '#2a9d8f')
    expect(blocks).toEqual([
      { op: 'update', id: 't1', set: { style: { color: '#2a9d8f' } } },
      { op: 'update', id: 't2', set: { style: { color: '#2a9d8f' } } },
    ])
  })

  it('stay when the AI, or a named-colour button, changes something else', () => {
    const coloured = apply(doc, customColourOps(doc, { blocks: ['t2'] }, '#2a9d8f')).doc
    const bigger = apply(coloured, styleOps(coloured, { blocks: ['t2'] }, { size: 'l' })).doc
    expect((bigger.block.t2 as TextBlock).style).toEqual({ color: '#2a9d8f', size: 'l' })
  })

  it('are read from pasted HTML only when they are named colours or codes', () => {
    expect(colourOf('#2A9D8F')).toBe('#2a9d8f')
    expect(colourOf('2a9d8f')).toBe('#2a9d8f')
    expect(colourOf('Red')).toBe('red')
    expect(colourOf('url(x)')).toBeNull()
    expect(colourOf('#2a9d8')).toBeNull()
  })
})

describe('a colour, size or font on words', () => {
  const doc = withText('one two three')
  const t2 = (ops: ReturnType<typeof sizeOps>, from: Doc = doc) => apply(from, ops).doc.block.t2 as TextBlock
  const two = [{ block: 't2', start: 4, end: 7 }]
  const all = [{ block: 't2', start: 0, end: 13 }]

  it('go to some words as a span of their own', () => {
    expect(t2(sizeOps(doc, two, 'l')).md).toBe('one [two]{size=l} three')
    expect(t2(fontOps(doc, two, 'lora')).md).toBe('one [two]{font=lora} three')
    expect(t2(colourOps(doc, two, '#2a9d8f')).md).toBe('one [two]{color=#2a9d8f} three')
  })

  it('go to a whole line as its style, the same change on its words giving way', () => {
    const big = apply(doc, sizeOps(doc, two, 'l')).doc
    expect(t2(sizeOps(big, all, 'xl'), big)).toMatchObject({ md: 'one two three', style: { size: 'xl' } })
    // Only the same kind gives way: a font on a word stays.
    const serif = apply(doc, fontOps(doc, two, 'serif')).doc
    expect(t2(sizeOps(serif, all, 's'), serif)).toMatchObject({ md: 'one [two]{font=serif} three', style: { size: 's' } })
    // A library font and a colour code on a whole line, as the font menu and the picker set them.
    expect(t2(fontOps(doc, all, 'lora')).style).toEqual({ font: 'lora' })
    expect(t2(colourOps(doc, all, '#2a9d8f')).style).toEqual({ color: '#2a9d8f' })
  })

  it('leave out a span that only repeats the line\'s style, but keep ink inside a coloured line', () => {
    const large = apply(doc, sizeOps(doc, all, 'l')).doc
    expect(sizeOps(large, two, 'l')).toEqual([])
    expect(t2(sizeOps(large, two, 'm'), large).md).toBe('one [two]{size=m} three')
    const red = apply(doc, colourOps(doc, all, 'red')).doc
    expect(t2(colourOps(red, two, 'ink'), red).md).toBe('one [two]{color=ink} three')
    expect(t2(colourOps(doc, two, 'ink')).md).toBe('one two three')
  })

  it('show in the bar as the size or font all the words have, their own or their line\'s', () => {
    const big = apply(doc, sizeOps(doc, two, 'l')).doc
    expect(styleOver(big, two, 'size')).toBe('l')
    expect(styleOver(big, all, 'size')).toBeUndefined()
    expect(styleOver(big, [{ block: 't2', start: 0, end: 3 }], 'size')).toBe('m')
    expect(styleOver(big, two, 'font')).toBe('sans')
  })
})

describe('a change of format goes to the words, not the spaces at the ends of a selection', () => {
  // As a double-click on Windows selects a word: with the space after it.
  const doc = withText('one two three ')
  const t2 = (ops: ReturnType<typeof sizeOps>) => apply(doc, ops).doc.block.t2 as TextBlock

  it('trims a range; a range of spaces only stays as it is', () => {
    expect(trimRange(doc, { block: 't2', start: 4, end: 8 })).toEqual({ block: 't2', start: 4, end: 7 })
    expect(trimRange(doc, { block: 't2', start: 3, end: 8 })).toEqual({ block: 't2', start: 4, end: 7 })
    expect(trimRange(doc, { block: 't2', start: 3, end: 4 })).toEqual({ block: 't2', start: 3, end: 4 })
    const here = { page: 'p1', x: 0, y: 0, w: 100, h: 100 }
    expect(chosenPieces(doc, { blocks: [], words: [{ block: 't2', start: 4, end: 8 }], here })).toEqual([{ block: 't2', start: 4, end: 7 }])
  })

  it("takes a line's words, whatever spaces end it, as the whole line", () => {
    expect(t2(sizeOps(doc, [{ block: 't2', start: 0, end: 13 }], 'l'))).toMatchObject({ md: 'one two three ', style: { size: 'l' } })
    expect(t2(colourOps(doc, [{ block: 't2', start: 4, end: 7 }], 'red')).md).toBe('one [two]{color=red} three ')
  })
})

describe('underline, subscript and superscript', () => {
  const doc = withText('H2O and x2')

  it('go on the selected words; subscript and superscript exclude each other, as in Word', () => {
    const sub = apply(doc, wordOps(doc, [{ block: 't2', start: 1, end: 2 }], { sub: true })).doc
    expect((sub.block.t2 as TextBlock).md).toBe('H[2]{.sub}O and x2')
    const sup = apply(sub, wordOps(sub, [{ block: 't2', start: 1, end: 2 }], { sup: true })).doc
    expect((sup.block.t2 as TextBlock).md).toBe('H[2]{.sup}O and x2')
    const under = apply(doc, wordOps(doc, [{ block: 't2', start: 0, end: 3 }], { underline: true })).doc
    expect((under.block.t2 as TextBlock).md).toBe('[H2O]{.underline} and x2')
    expect(marksIn(under, { blocks: ['t2'], range: { block: 't2', start: 0, end: 3 } })).toMatchObject({ underline: true, sub: false })
  })
})

describe('library fonts', () => {
  const doc = withText('one two three')

  it('go to the selected text blocks, and stay when the AI changes something else', () => {
    const ops = customFontOps(doc, { blocks: ['t1', 't2', 'm1'] }, 'lora')
    expect(ops).toEqual([
      { op: 'update', id: 't1', set: { style: { font: 'lora' } } },
      { op: 'update', id: 't2', set: { style: { font: 'lora' } } },
    ])
    const lora = apply(doc, ops).doc
    const red = apply(lora, styleOps(lora, { blocks: ['t2'] }, { color: 'red' })).doc
    expect((red.block.t2 as TextBlock).style).toEqual({ font: 'lora', color: 'red' })
  })
})
