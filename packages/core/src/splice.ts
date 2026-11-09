// The smallest change from one text to another, as one splice: what typing,
// an AI rewrite and a cut of words send to apply(), so a step of the history
// costs the size of the change, not the size of the block.
import type { Id } from './schema/doc.js'
import type { Op } from './schema/ops.js'
import { splitsCharacter } from './util.js'

/** The smallest splice that turns `before` into `after`, never cutting a character in two. */
export function spliceFor(id: Id, field: 'md' | 'tex' | 'src' | 'caption', before: string, after: string): Op {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--
    endAfter--
  }
  if (splitsCharacter(before, start) || splitsCharacter(after, start)) start--
  if (splitsCharacter(before, endBefore) || splitsCharacter(after, endAfter)) {
    endBefore++
    endAfter++
  }
  return { op: 'splice', id, field, at: start, del: endBefore - start, ins: after.slice(start, endAfter) }
}
