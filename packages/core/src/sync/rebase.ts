// Undo and redo, kept across a change that came in from another device. Each
// step was made for the note as it was; the note now holds the other device's
// changes too. So each step is worked out again: the note before the step and
// the changes that came in are merged, and the step becomes the operations
// that lead there from the note as it is now. Undo then takes back what the
// person did, and leaves what came in.
import { apply } from '../apply.js'
import type { History, Step } from '../history.js'
import type { Doc } from '../schema/doc.js'
import { difference, sameContent } from './diff.js'
import { merge } from './merge.js'

/** One stack of steps, newest last, fitted to the note as it is now. `back` gives a step's operations that lead away from the note: its undo, or its redo. */
function fitted(steps: readonly Step[], before: Doc, after: Doc, back: 'undo' | 'redo'): Step[] {
  const out: Step[] = []
  let was = before
  let now = after
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!
    try {
      // The note this step leads back to, had nothing come in; then the same with what came in.
      const target = apply(was, step[back]).doc
      const merged = merge(target, now, { base: was, first: 'theirs' })
      // Words both changed cannot be taken back cleanly: this step and the older ones are let go, never applied wrongly.
      if (merged.twice.length > 0) break
      const ops = difference(now, merged.doc)
      const result = apply(now, ops)
      if (!sameContent(result.doc, merged.doc)) break
      // A step whose whole change was overwritten by what came in has nothing left to take back.
      if (ops.length > 0) out.unshift(back === 'undo' ? { ...step, undo: ops, redo: result.inverse } : { ...step, redo: ops, undo: result.inverse })
      was = target
      now = result.doc
    } catch {
      break
    }
  }
  return out
}

/**
 * The history of a note that took in changes from elsewhere: `before` is the
 * note the history was made on, `after` the note now. A step the incoming
 * change left nothing of is dropped; one it clashes with is dropped with the
 * steps before it.
 */
export function rebase(history: History, before: Doc, after: Doc): History {
  if (history.done.length === 0 && history.undone.length === 0) return history
  return { done: fitted(history.done, before, after, 'undo'), undone: fitted(history.undone, before, after, 'redo') }
}
