// What a note's file says of its own past, for devices that keep one library
// in step (sync.json in the file, docs/file-format.md): which device wrote
// this version, and the latest change of each device it includes. From two of
// them a device tells "the other has seen all I wrote, and wrote more" (take
// its version) from "we both wrote apart" (merge), with no server to ask.
import { strToU8 } from 'fflate'
import { z } from 'zod'
import { hashBytes } from '../io/hash.js'
import { Id, type Doc } from '../schema/doc.js'
import { stable } from './diff.js'
import type { MergeOptions } from './merge.js'

/** The latest change of each device a version includes: the device's own `rev` of the note when it wrote that change. */
export const Seen = z.record(Id, z.int().nonnegative())
export type Seen = z.infer<typeof Seen>

export const Lineage = z.strictObject({
  v: z.literal(1),
  /** The device that wrote this version: a random id it made for this library, nothing more. */
  by: Id,
  /** When that device last changed the note, in milliseconds since 1970. */
  at: z.int().nonnegative(),
  /** A fingerprint of the note's content, so two versions that hold the same are known as one. */
  id: z.string().regex(/^[0-9a-f]{16,64}$/u),
  seen: Seen,
  /**
   * The last version this device took from another or merged: what that one had seen, and this device's `rev` of
   * the note just after. Blocks whose `r` is above it are this device's own changes since.
   */
  base: z.strictObject({ seen: Seen, rev: z.int().nonnegative() }).optional(),
  /** When the note was last put where it is: moved, deleted or brought back. Of two files of one note, the one put later says where it belongs. */
  put: z.int().nonnegative().optional(),
})
export type Lineage = z.infer<typeof Lineage>

/** sync.json as read from a file: undefined when it is missing or not as expected, as in a file from elsewhere. */
export function readLineage(text: string | undefined): Lineage | undefined {
  if (text === undefined) return undefined
  try {
    const parsed = Lineage.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** sync.json's text, the same for the same lineage. */
export function lineageText(lineage: Lineage): string {
  const sorted = (map: Seen): Seen => Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  const { v, by, at, id, base, put } = lineage
  return `${JSON.stringify({ v, by, at, id, seen: sorted(lineage.seen), ...(base ? { base: { seen: sorted(base.seen), rev: base.rev } } : {}), ...(put !== undefined ? { put } : {}) })}\n`
}

/** True when `a` includes everything `b` does. */
export function includes(a: Seen, b: Seen): boolean {
  return Object.entries(b).every(([device, rev]) => (a[device] ?? -1) >= rev)
}

/** Everything either has seen. */
export function seenByBoth(a: Seen, b: Seen): Seen {
  const out: Seen = { ...a }
  for (const [device, rev] of Object.entries(b)) out[device] = Math.max(out[device] ?? 0, rev)
  return out
}

/**
 * How two versions stand: the same; `a` ahead (it has all of `b` and more);
 * behind; or apart, each holding changes the other has not seen.
 */
export function compare(a: Seen, b: Seen): 'same' | 'ahead' | 'behind' | 'apart' {
  const ahead = includes(a, b)
  const behind = includes(b, a)
  return ahead && behind ? 'same' : ahead ? 'ahead' : behind ? 'behind' : 'apart'
}

/**
 * The `rev`, in a side's own counting, of the latest point the other side is
 * known to have seen: its blocks with `r` above it are what it changed since.
 * Undefined when the other side has seen nothing of it that is known.
 */
function since(side: Lineage, other: Lineage): number | undefined {
  const marks: number[] = []
  const own = other.seen[side.by]
  if (own !== undefined) marks.push(own)
  if (side.base && includes(other.seen, side.base.seen)) marks.push(side.base.rev)
  return marks.length > 0 ? Math.max(...marks) : undefined
}

/**
 * How to merge two versions that stand apart, from their lineages: what each
 * has changed since the other last saw it, and which stands when both changed
 * the same small thing: the one changed later (by its device's name, should
 * the times be the same), so every device says the same.
 */
export function mergeOptions(mine: Lineage, theirs: Lineage): Pick<MergeOptions, 'mineSince' | 'theirsSince' | 'first'> {
  const mineSince = since(mine, theirs)
  const theirsSince = since(theirs, mine)
  const mineFirst = mine.at !== theirs.at ? mine.at > theirs.at : mine.by !== theirs.by ? mine.by > theirs.by : mine.id >= theirs.id
  return { ...(mineSince !== undefined ? { mineSince } : {}), ...(theirsSince !== undefined ? { theirsSince } : {}), first: mineFirst ? 'mine' : 'theirs' }
}

/** The fingerprint of a note's content: the same for two notes that differ only in `rev` and each block's `r`. */
export async function contentId(doc: Doc): Promise<string> {
  const content = { ...doc, rev: 0, block: Object.fromEntries(Object.entries(doc.block).map(([id, block]) => [id, { ...block, r: 0 }])) }
  return (await hashBytes(strToU8(stable(content)))).slice(0, 32)
}
