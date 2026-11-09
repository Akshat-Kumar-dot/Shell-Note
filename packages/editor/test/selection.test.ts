// What Delete removes when blocks are chosen as objects, or held by a Select box.
import { apply, type Doc, type Frame, type TextBlock } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { MIXED } from '../../core/test/fixtures/index.js'
import { EditorStore, removalOps, removeChosen, toggleChosen } from '../src/index.js'

describe('removing chosen blocks', () => {
  it('removes blocks placed on the page, and blocks inside frames', () => {
    expect(removalOps(MIXED, ['mf', 'kk', 'p1'])).toEqual([
      { op: 'remove', id: 'mf' },
      { op: 'remove', id: 'kk' },
      { op: 'remove', id: 'p1' },
    ])
  })

  it('removes a frame left with nothing in it, which takes its blocks along', () => {
    expect(removalOps(MIXED, ['b1', 'b2', 'c1', 'mf'])).toEqual([
      { op: 'remove', id: 'fb' },
      { op: 'remove', id: 'fc' },
      { op: 'remove', id: 'mf' },
    ])
    const after = apply(MIXED, removalOps(MIXED, ['b1', 'b2'])).doc
    expect(after.block.fb).toBeUndefined()
    expect(after.block.b1).toBeUndefined()
    expect((after.block.fa as Frame).kids).toHaveLength(14)
  })

  it('leaves out ids the note does not have', () => {
    expect(removalOps(MIXED, ['nope', 'mf'])).toEqual([{ op: 'remove', id: 'mf' }])
  })
})

describe('cutting the words a Select box holds', () => {
  // b1 reads "Right column: **summary**", in plain text "Right column: summary".
  const md = (doc: Doc, id: string): string => (doc.block[id] as TextBlock).md

  it('cuts a piece out of a line with the space after it, keeping the formatting around it', () => {
    const after = apply(MIXED, removalOps(MIXED, [], [{ block: 'b1', start: 6, end: 13 }])).doc
    expect(md(after, 'b1')).toBe('Right **summary**')
  })

  it('cuts several pieces of one block, last first, as one change, taking the space before a piece that ends the line', () => {
    const ops = removalOps(MIXED, [], [
      { block: 'b1', start: 0, end: 5 },
      { block: 'b1', start: 14, end: 21 },
    ])
    expect(ops).toHaveLength(1)
    expect(md(apply(MIXED, ops).doc, 'b1')).toBe('column:')
  })

  it('cuts letters from inside a word exactly, taking no space, so the rest of the word and the spaces stay', () => {
    // "lum" out of "column:", then "umn:", which ends at a space but starts inside the word.
    expect(md(apply(MIXED, removalOps(MIXED, [], [{ block: 'b1', start: 8, end: 11 }])).doc, 'b1')).toBe('Right con: **summary**')
    expect(md(apply(MIXED, removalOps(MIXED, [], [{ block: 'b1', start: 9, end: 13 }])).doc, 'b1')).toBe('Right col **summary**')
  })

  it('removes a block left with no words, and leaves pieces of a block removed whole to that removal', () => {
    const emptied = apply(MIXED, removalOps(MIXED, [], [{ block: 'b1', start: 0, end: 21 }])).doc
    expect(emptied.block.b1).toBeUndefined()
    expect(emptied.block.fb).toBeDefined()
    expect(removalOps(MIXED, ['b1'], [{ block: 'b1', start: 0, end: 5 }])).toEqual([{ op: 'remove', id: 'b1' }])
  })

  it('leaves out pieces past the end of the text, and pieces of blocks that are not text', () => {
    expect(removalOps(MIXED, [], [{ block: 'b1', start: 5, end: 99 }, { block: 'mf', start: 0, end: 1 }])).toEqual([])
  })

  it('removes the box\'s words and blocks together as one undo step, and lets the box go', () => {
    const store = new EditorStore(MIXED)
    store.select({ blocks: ['mf'], words: [{ block: 'b1', start: 6, end: 13 }], here: { page: 'w1', x: 0, y: 0, w: 100, h: 100 } }, 'objects')
    removeChosen(store)
    expect(md(store.doc, 'b1')).toBe('Right **summary**')
    expect(store.doc.block.mf).toBeUndefined()
    expect(store.selection).toEqual({ blocks: [] })
    store.undo()
    expect(md(store.doc, 'b1')).toBe(md(MIXED, 'b1'))
    expect(store.doc.block.mf).toBeDefined()
  })
})

describe('choosing', () => {
  it('adds a block with Shift+click and takes it away again, starting afresh from a caret in text', () => {
    const store = new EditorStore(MIXED)
    store.select({ blocks: ['p1'] })
    toggleChosen(store, 'mf')
    expect([store.selection.blocks, store.selectionKind]).toEqual([['mf'], 'objects'])
    toggleChosen(store, 'kk')
    toggleChosen(store, 'mf')
    expect(store.selection.blocks).toEqual(['kk'])
  })

  it('removes nothing while the selection is a caret in text, so Delete in a line never takes the line', () => {
    const store = new EditorStore(MIXED)
    store.select({ blocks: ['p1'] })
    removeChosen(store)
    expect(store.doc).toBe(MIXED)
    store.select({ blocks: ['p1', 'mf'] }, 'objects')
    removeChosen(store)
    expect(store.doc.block.p1).toBeUndefined()
    expect(store.doc.block.mf).toBeUndefined()
    // One undo step brings both back.
    store.undo()
    expect(store.doc.block.p1).toBeDefined()
    expect(store.doc.block.mf).toBeDefined()
  })
})
