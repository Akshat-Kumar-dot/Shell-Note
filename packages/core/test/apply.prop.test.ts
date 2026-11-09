// Phase 0 exit check: for random valid operation sequences, applying them and
// then applying the inverses gives back the same document.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { apply, validateDoc, ValidationError, type Op } from '../src/index.js'
import { Namer, planOp, planTransaction, seed, transactions } from './arbitraries.js'
import { FIXTURES } from './fixtures/index.js'
import { content, deepFreeze } from './helpers.js'

const fixture = fc.constantFrom(...Object.values(FIXTURES))

describe('apply, on random operations', () => {
  it('then the inverses in reverse order, gives back the starting document', () => {
    fc.assert(
      fc.property(fixture, transactions, (start, plan) => {
        const namer = new Namer()
        const undo: Op[][] = []
        let doc = start
        for (const seeds of plan) {
          const { ops, after } = planTransaction(namer, doc, seeds)
          if (ops.length === 0) continue
          const result = apply(doc, ops)
          // One transaction does exactly what its operations do one by one...
          expect(content(result.doc)).toStrictEqual(content(after))
          // ...leaves a valid document, and raises rev by one.
          validateDoc(result.doc)
          expect(result.doc.rev).toBe(doc.rev + 1)
          undo.push(result.inverse)
          // Frozen: if a later apply() modified this document, it would throw.
          doc = deepFreeze(result.doc)
        }
        for (const inverse of undo.reverse()) doc = deepFreeze(apply(doc, inverse).doc)
        expect(content(doc)).toStrictEqual(content(start))
      }),
      { numRuns: 300 },
    )
  })

  it('either gives a valid document or throws a ValidationError, even for broken operations', () => {
    fc.assert(
      fc.property(fixture, seed, fc.jsonValue(), fc.nat(), (start, s, junk, where) => {
        const op = planOp(new Namer(), start, s)
        if (!op) return
        const broken = breakOne(op, where, junk)
        try {
          validateDoc(apply(start, [broken as Op]).doc)
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error
        }
      }),
      { numRuns: 1000 },
    )
  })
})

/** A copy of `op` with one field, at any depth, replaced by `junk`. */
function breakOne(op: Op, where: number, junk: unknown): unknown {
  const copy = structuredClone(op) as Record<string, unknown>
  const paths: (string | number)[][] = []
  const walk = (value: unknown, path: (string | number)[]): void => {
    if (typeof value !== 'object' || value === null) return
    for (const [key, inner] of Object.entries(value)) {
      paths.push([...path, key])
      walk(inner, [...path, key])
    }
  }
  walk(copy, [])
  const path = paths[where % paths.length]!
  let at = copy as Record<string | number, unknown>
  for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>
  at[path.at(-1)!] = junk
  return copy
}
