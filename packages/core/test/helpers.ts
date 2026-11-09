import { expect } from 'vitest'
import { apply, validateDoc, ValidationError, type Applied, type Doc, type ErrorCode, type Op } from '../src/index.js'

/** Freeze a value and everything inside it, so any attempt to modify it throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

/**
 * A document without its revision counters (`rev`, and `r` on blocks). Undo is
 * itself a change, so it raises the counters; everything else must match.
 */
export function content(doc: Doc): unknown {
  return {
    ...doc,
    rev: 0,
    block: Object.fromEntries(Object.entries(doc.block).map(([id, block]) => [id, { ...block, r: 0 }])),
  }
}

/**
 * Apply `ops` and check the result: it is valid, rev went up by one, and the
 * returned inverse gives back the starting document.
 */
export function step(doc: Doc, ops: Op[]): Applied {
  const result = apply(doc, ops)
  validateDoc(result.doc)
  expect(result.doc.rev).toBe(doc.rev + 1)
  const back = apply(result.doc, result.inverse)
  validateDoc(back.doc)
  expect(content(back.doc)).toStrictEqual(content(doc))
  return result
}

/** Marks a field for deletion in `edited`. */
export const DELETE = Symbol('delete')

/** A deep copy of `value` with one field changed (or deleted), for building bad inputs. */
export function edited(value: unknown, path: (string | number)[], next: unknown): unknown {
  const copy = structuredClone(value)
  let at = copy as Record<string | number, unknown>
  for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>
  const last = path.at(-1)!
  if (next === DELETE) delete at[last]
  else at[last] = next
  return copy
}

/** Run `fn`, expect a ValidationError with this code (and a hint matching `hint`), and return it. */
export function expectError(fn: () => unknown, code: ErrorCode, hint?: RegExp): ValidationError {
  let error: unknown
  try {
    fn()
  } catch (caught) {
    error = caught
  }
  expect(error, 'expected a ValidationError').toBeInstanceOf(ValidationError)
  const failure = error as ValidationError
  expect(failure.code, failure.hint).toBe(code)
  if (hint) expect(failure.hint).toMatch(hint)
  return failure
}
