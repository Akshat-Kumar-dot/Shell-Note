// The difference between two versions of a note, as operations: applied to
// the one, they give the other, whatever happened in between.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { apply, createDoc, validateDoc, type Doc, type Op } from '../../src/index.js'
import { become, difference, same, sameBlock, sameContent } from '../../src/sync/diff.js'
import { Namer, planTransaction, transactions } from '../arbitraries.js'
import { FIXTURES } from '../fixtures/index.js'
import { content } from '../helpers.js'

const fixture = fc.constantFrom(...Object.values(FIXTURES))

/** A note after a run of random transactions. */
function after(namer: Namer, start: Doc, plan: Parameters<typeof planTransaction>[2][]): Doc {
  let doc = start
  for (const seeds of plan) {
    const { ops } = planTransaction(namer, doc, seeds)
    if (ops.length > 0) doc = apply(doc, ops).doc
  }
  return doc
}

describe('same', () => {
  it('compares data, whatever the order of the keys', () => {
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(same([1, 2], [2, 1])).toBe(false)
    expect(same(null, {})).toBe(false)
  })

  it('takes two blocks as the same when only r differs', () => {
    const doc = FIXTURES.mixed
    const block = Object.values(doc.block)[0]!
    expect(sameBlock(block, { ...block, r: block.r + 5 })).toBe(true)
    expect(sameBlock(block, undefined)).toBe(false)
  })
})

describe('difference', () => {
  it('is nothing between a note and itself, or the same note counted otherwise', () => {
    const doc = FIXTURES.mixed
    expect(difference(doc, doc)).toEqual([])
    expect(difference(doc, { ...doc, rev: doc.rev + 9 })).toEqual([])
  })

  it('refuses two different notes', () => {
    expect(() => difference(createDoc(), createDoc())).toThrow(/two different notes/u)
  })

  it('moves one block when one block moved, not the rest of the list', () => {
    const start = createDoc()
    const frame = Object.keys(start.block)[0]!
    const add: Op[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ op: 'add', block: { id, r: 0, type: 'text', parent: frame, role: 'p', indent: 0, md: id } }))
    const from = apply(start, add).doc
    const to = apply(from, [{ op: 'move', id: 'a', to: { parent: frame, at: 4 } }]).doc
    expect(difference(from, to)).toEqual([{ op: 'move', id: 'a', to: { parent: frame, at: 4 } }])
    expect(difference(to, from)).toEqual([{ op: 'move', id: 'a', to: { parent: frame, at: 0 } }])
  })

  it('changes only the strokes that differ in a block of ink', () => {
    const start = createDoc()
    const page = start.pages[0]!
    const stroke = (x: number) => ({ pts: [x, 0, 128, x + 10, 10, 128], color: 'ink' as const, width: 'm' as const })
    const from = apply(start, [{ op: 'add', block: { id: 'ink', r: 0, type: 'ink', page, x: 0, y: 0, w: 100, h: 100, strokes: [stroke(1), stroke(2), stroke(3)] } }]).doc
    const to = apply(from, [
      { op: 'stroke', id: 'ink', at: 1, remove: true },
      { op: 'stroke', id: 'ink', at: 1, add: stroke(7) },
    ]).doc
    expect(difference(from, to)).toEqual([
      { op: 'stroke', id: 'ink', at: 1, remove: true },
      { op: 'stroke', id: 'ink', at: 1, add: stroke(7) },
    ])
  })

  it('turns any version of a note into any later one, and back', () => {
    fc.assert(
      fc.property(fixture, transactions, transactions, (start, first, second) => {
        const namer = new Namer()
        const from = after(namer, start, first)
        const to = after(namer, from, second)
        for (const [a, b] of [
          [from, to],
          [to, from],
          [start, to],
          [to, start],
        ] as const) {
          const result = become(a, b)
          validateDoc(result.doc)
          expect(content(result.doc)).toStrictEqual(content(b))
          expect(sameContent(result.doc, b)).toBe(true)
          if (!sameContent(a, b)) expect(result.doc.rev).toBe(a.rev + 1)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('turns one version into another made apart from it, from the same start', () => {
    fc.assert(
      fc.property(fixture, transactions, transactions, (start, first, second) => {
        // Two namers that never give the same id, as two devices never do.
        const here = after(new Namer(), start, first)
        const there = after(new Namer('y'), start, second)
        const result = become(here, there)
        validateDoc(result.doc)
        expect(content(result.doc)).toStrictEqual(content(there))
      }),
      { numRuns: 300 },
    )
  })
})
