// A short mark of what a block holds: the same on every device, whatever
// order its fields are in, and whatever its `r` (the count of when it last
// changed, which each device keeps for itself). It lets one device say "these
// blocks, as I left them" in a few letters, and another tell whether its own
// are still so: what an edit made elsewhere needs before it is undone here.
import type { Block } from '../schema/doc.js'
import { idFrom } from './merge.js'

/** A value as text, its fields in one order always. */
function steady(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(steady).join(',')}]`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'null'
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([, held]) => held !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${fields.map(([key, held]) => `${JSON.stringify(key)}:${steady(held)}`).join(',')}}`
}

/** The mark of a block. Two blocks that are the same but for `r` (sameBlock) have one mark. */
export function blockPrint(block: Block): string {
  return idFrom(steady({ ...block, r: 0 }))
}
