// Tier 0: simple commands with no model. Whatever it returns is also compiled
// and applied, to check it is a real, undoable edit.
import { describe, expect, it } from 'vitest'
import { compile, makeAliases, parseInline, plainText, selectByKind, tier0, type AiOp, type Doc, type Selection, type TextBlock } from '../src/index.js'
import { MIXED, PHYSICS } from './fixtures/index.js'
import { step } from './helpers.js'

let counter = 0

/** Run tier 0; when it answers, apply its operations too. */
function t0(doc: Doc, selection: Selection, instruction: string): AiOp[] | undefined {
  const aliases = makeAliases(doc, selection)
  const ops = tier0(instruction, { doc, selection, aliases })
  if (ops) {
    const internal = ops.flatMap((op) => compile(op, { doc, aliases, selection, newId: () => `q${counter++}` }))
    if (internal.length > 0) step(doc, internal)
  }
  return ops
}

const words = (doc: Doc, block: string, text: string): NonNullable<Selection['range']> => {
  const start = plainText(parseInline((doc.block[block] as TextBlock).md)).indexOf(text)
  return { block, start, end: start + text.length }
}

describe('tier 0 handles simple commands with no model', () => {
  it('colours, sizes and combinations', () => {
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'make it red')).toEqual([{ op: 'style', ids: ['a'], color: 'red' }])
    expect(t0(PHYSICS, { blocks: ['t1'] }, 'make the heading blue and bigger')).toEqual([{ op: 'style', ids: ['a'], color: 'blue', size: 'l' }])
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'center it, serif font')).toEqual([{ op: 'style', ids: ['a'], align: 'center', font: 'serif' }])
  })

  it('formats the selected words, or the whole block', () => {
    const range = words(PHYSICS, 't2', 'object')
    expect(t0(PHYSICS, { blocks: ['t2'], range }, 'bold')).toEqual([{ op: 'mark', id: 'a', bold: true }])
    expect(t0(PHYSICS, { blocks: ['t2'], range }, 'red')).toEqual([{ op: 'mark', id: 'a', color: 'red' }])
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'bold and red')).toEqual([
      { op: 'style', ids: ['a'], color: 'red' },
      { op: 'mark', id: 'a', bold: true },
    ])
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'cross it out')).toEqual([{ op: 'mark', id: 'a', strike: true }])
  })

  it('changes roles, ticks and nesting', () => {
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'make it a bullet point')).toEqual([{ op: 'style', ids: ['a'], role: 'li' }])
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'heading 1')).toEqual([{ op: 'style', ids: ['a'], role: 'h1' }])
    expect(t0(MIXED, { blocks: ['td'] }, 'mark as done')).toEqual([{ op: 'style', ids: ['a'], done: true }])
    expect(t0(MIXED, { blocks: ['l1'] }, 'indent')).toEqual([{ op: 'style', ids: ['a'], indent: 'in' }])
  })

  it('deletes and moves', () => {
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'delete this')).toEqual([{ op: 'delete', ids: ['a'] }])
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'move it up')).toEqual([{ op: 'move', id: 'a', at: 'before', ref: 'b' }])
  })

  it('forgives typos', () => {
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'mkae it bleu')).toEqual([{ op: 'style', ids: ['a'], color: 'blue' }])
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'make it italc')).toEqual([{ op: 'mark', id: 'a', italic: true }])
  })
})

describe('tier 0 hands over what it cannot be sure of', () => {
  it('any word it does not know', () => {
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'make it look professional')).toBeUndefined()
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'read it')).toBeUndefined()
  })

  it('"the heading" when the selection is not a heading', () => {
    expect(t0(PHYSICS, { blocks: ['t2'] }, 'make the heading blue')).toBeUndefined()
  })

  it('styles that do not fit the block', () => {
    expect(t0(PHYSICS, { blocks: ['m1'] }, 'make it bigger')).toBeUndefined()
    expect(t0(PHYSICS, { blocks: ['k1'] }, 'make it red')).toEqual([{ op: 'style', ids: ['a'], color: 'red' }])
  })
})

describe('select by kind', () => {
  it('selects every block of a kind on the page, then tier 0 does the rest', () => {
    const byKind = selectByKind(MIXED, { blocks: ['p1'] }, 'make all headings blue')!
    expect(byKind).toEqual({ selection: { blocks: ['h1'] }, rest: 'make blue' })
    expect(t0(MIXED, byKind.selection, byKind.rest)).toEqual([{ op: 'style', ids: ['a'], color: 'blue' }])
  })

  it('reaches the whole note when asked', () => {
    expect(selectByKind(MIXED, { blocks: ['p1'] }, 'all paragraphs in this note in serif')?.selection.blocks).toEqual(['p1', 'p2', 'b1', 'c1'])
    expect(selectByKind(MIXED, { blocks: ['p1'] }, 'every formula on this page bigger')?.selection.blocks).toEqual(['mc', 'mf'])
  })

  it('leaves other requests alone', () => {
    expect(selectByKind(MIXED, { blocks: ['p1'] }, 'make it blue')).toBeUndefined()
    expect(selectByKind(MIXED, { blocks: ['p1'] }, 'all of it in serif')).toBeUndefined()
  })
})
