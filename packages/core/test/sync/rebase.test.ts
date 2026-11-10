// Undo and redo across a change that came in from another device: on random
// edits here and elsewhere, every step still applies and gives a valid note.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { apply, become, emptyHistory, merge, rebase, record, redo, sameContent, undo, validateDoc, type Doc, type History } from '../../src/index.js'
import { Namer, planTransaction, transactions } from '../arbitraries.js'
import { FIXTURES } from '../fixtures/index.js'

describe('rebase', () => {
  it('leaves an empty history as it is', () => {
    const history = emptyHistory()
    expect(rebase(history, FIXTURES.mixed, FIXTURES.mixed)).toBe(history)
  })

  it('keeps every step it keeps exact: undo then redo gives the note back, and the other way round', () => {
    const fixture = fc.constantFrom(...Object.values(FIXTURES))
    fc.assert(
      fc.property(fixture, transactions, transactions, fc.nat(4), (start, mine, others, undone) => {
        let doc: Doc = start
        let history: History = emptyHistory()
        const namer = new Namer()
        for (const seeds of mine) {
          const { ops } = planTransaction(namer, doc, seeds)
          if (ops.length === 0) continue
          const result = apply(doc, ops)
          history = record(history, ops, result.inverse)
          doc = result.doc
        }
        for (let i = 0; i < undone; i++) {
          const moved = undo(history, doc)
          if (moved) ({ doc, history } = moved)
        }
        let theirs = start
        const other = new Namer('y')
        for (const seeds of others) {
          const { ops } = planTransaction(other, theirs, seeds)
          if (ops.length > 0) theirs = apply(theirs, ops).doc
        }
        const taken = become(doc, merge(doc, theirs, { base: start, first: 'mine' }).doc).doc
        history = rebase(history, doc, taken)
        doc = validateDoc(taken)

        let redone = 0
        for (let moved = redo(history, doc); moved; moved = redo(history, doc)) {
          ;({ doc, history } = moved)
          validateDoc(doc)
          redone++
        }
        for (let i = 0; i < redone; i++) ({ doc, history } = undo(history, doc)!)
        expect(sameContent(doc, taken)).toBe(true)
        let steps = 0
        for (let moved = undo(history, doc); moved; moved = undo(history, doc)) {
          ;({ doc, history } = moved)
          validateDoc(doc)
          steps++
        }
        for (let i = 0; i < steps; i++) ({ doc, history } = redo(history, doc)!)
        expect(sameContent(doc, taken)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })
})
