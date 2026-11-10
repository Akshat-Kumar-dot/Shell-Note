// What differs between two versions of a note, as operations for apply():
// the way a version that arrived from another device goes into the note a
// person has open, as ordinary edits. `rev` and each block's `r` are counted
// on each device by its own apply(), so two notes are the same when everything
// else in them is.
import { apply, type Applied } from '../apply.js'
import type { Block, Doc, Id } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { has } from '../util.js'
import { ValidationError } from '../validate/errors.js'

/** True when two values hold the same data, whatever the order of their keys. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false
    return true
  }
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (!has(b, key) || !same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  return true
}

/** True when two blocks are the same but for `r`, the count of when each was last changed. */
export function sameBlock(a: Block | undefined, b: Block | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (key !== 'r' && (!has(b, key) || !same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))) return false
  return true
}

/** The fields of a document besides its pages, blocks and pictures: `update` sets them on the document's own id. */
const DOC_FIELDS = ['title', 'rules', 'pen', 'media', 'clips', 'programs'] as const

/** True when two notes are the same but for `rev` and each block's `r`. */
export function sameContent(a: Doc, b: Doc): boolean {
  if (a === b) return true
  if (a.v !== b.v || a.id !== b.id || !same(a.pages, b.pages) || !same(a.page, b.page) || !same(a.asset, b.asset)) return false
  for (const field of DOC_FIELDS) if (!same(a[field], b[field])) return false
  const ids = Object.keys(a.block)
  if (ids.length !== Object.keys(b.block).length) return false
  for (const id of ids) if (!has(b.block, id) || !sameBlock(a.block[id], b.block[id])) return false
  return true
}

/** What `update` may set on each kind of block, a frame's `next` apart (it is linked last). */
const FIELDS: Record<Block['type'], readonly string[]> = {
  frame: [],
  text: ['role', 'indent', 'md', 'style', 'done'],
  math: ['tex', 'value'],
  image: ['asset', 'alt', 'caption'],
  diagram: ['src'],
  ink: ['text'],
  table: ['rows', 'head', 'alt', 'caption', 'cols', 'width', 'look'],
}

/** `set` for an `update`: each field that differs, null for one that is gone. */
function fieldsToSet(from: object, to: object, fields: readonly string[]): Record<string, unknown> {
  const a = from as Record<string, unknown>
  const b = to as Record<string, unknown>
  const set: Record<string, unknown> = {}
  for (const field of fields) if (!same(a[field], b[field])) set[field] = b[field] === undefined ? null : b[field]
  return set
}

/**
 * The elements of `current` that may stay where they are while the others
 * move, so that the list ends in the order of `target`: the longest run of
 * them already in that order.
 */
function staying(current: readonly Id[], target: readonly Id[]): Set<Id> {
  const wanted = new Map(target.map((id, index) => [id, index]))
  const order = current.map((id) => wanted.get(id)!)
  // The longest rising run of `order`, by patience sorting: tails[k] ends the best run of length k + 1.
  const tails: number[] = []
  const before: number[] = new Array<number>(order.length).fill(-1)
  for (let i = 0; i < order.length; i++) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (order[tails[mid]!]! < order[i]!) low = mid + 1
      else high = mid
    }
    before[i] = low > 0 ? tails[low - 1]! : -1
    tails[low] = i
  }
  const keep = new Set<Id>()
  for (let i = tails.length > 0 ? tails[tails.length - 1]! : -1; i >= 0; i = before[i]!) keep.add(current[i]!)
  return keep
}

/** The moves that put `current` in the order of `target` (the same elements): each names an element and its new index in the list without it. */
function reorder(current: Id[], target: readonly Id[], move: (id: Id, at: number) => void): void {
  if (same(current, target)) return
  const keep = staying(current, target)
  target.forEach((id, index) => {
    if (keep.has(id)) return
    current.splice(current.indexOf(id), 1)
    // After the element before it in the target, which is in its place already.
    const at = index === 0 ? 0 : current.indexOf(target[index - 1]!) + 1
    current.splice(at, 0, id)
    move(id, at)
  })
}

/**
 * The operations that turn `from` into `to`: apply(from, difference(from, to))
 * gives a note with the content of `to`. Both must be valid notes with the
 * same id. Nothing is returned when they are the same already.
 */
export function difference(from: Doc, to: Doc): Op[] {
  if (from.id !== to.id) throw new ValidationError('bad_doc', `These are two different notes (${from.id} and ${to.id}), not two versions of one.`)
  if (sameContent(from, to)) return []
  const ops: Op[] = []
  // Where everything is as the operations so far leave it: each list an index is counted in.
  const pages = [...from.pages]
  const free = new Map<Id, Id[]>(pages.map((id) => [id, [...from.page[id]!.free]]))
  const kids = new Map<Id, Id[]>()
  const here = new Map<Id, Block>()
  for (const block of Object.values(from.block)) {
    here.set(block.id, block)
    if (block.type === 'frame') kids.set(block.id, [...block.kids])
  }
  const listOf = (block: Block): Id[] => ('parent' in block ? kids.get(block.parent)! : free.get(block.page)!)
  const take = (block: Block): void => {
    const list = listOf(block)
    list.splice(list.indexOf(block.id), 1)
  }
  const drop = (id: Id): void => {
    const block = here.get(id)
    if (!block) return
    take(block)
    for (const kid of kids.get(id) ?? []) here.delete(kid)
    kids.delete(id)
    here.delete(id)
    ops.push({ op: 'remove', id })
  }

  // Pictures first: a block may show one as soon as it is added.
  for (const [hash, meta] of Object.entries(to.asset)) if (!same(from.asset[hash], meta)) ops.push({ op: 'asset', hash, meta })
  for (const id of to.pages) {
    if (has(from.page, id)) continue
    ops.push({ op: 'page', add: { ...to.page[id]!, free: [] } })
    pages.push(id)
    free.set(id, [])
  }
  // A frame's continuation that changes is unlinked now and linked last, so no two frames ever continue in one.
  for (const block of Object.values(from.block)) {
    if (block.type !== 'frame' || block.next === undefined) continue
    const after = to.block[block.id]
    if (!after || after.type !== 'frame' || after.next !== block.next) ops.push({ op: 'update', id: block.id, set: { next: null } })
  }
  // A block never changes its type: one that did is another block with the same id, taken out and added again.
  for (const block of Object.values(from.block)) {
    const after = to.block[block.id]
    if (after && after.type !== block.type) drop(block.id)
  }

  // New blocks: frames, then what lies on a page, then what sits in a frame. Each goes to the end; the order comes later.
  const added = new Set<Id>()
  const add = (block: Block): void => {
    if (block.type === 'frame') {
      const frame: Record<string, unknown> = { ...block, kids: [] }
      delete frame.next
      ops.push({ op: 'add', block: frame as Block })
      kids.set(block.id, [])
    } else ops.push({ op: 'add', block })
    here.set(block.id, block)
    listOf(block).push(block.id)
    added.add(block.id)
  }
  const fresh = Object.values(to.block).filter((block) => !here.has(block.id))
  for (const block of fresh) if (block.type === 'frame') add(block)
  for (const block of fresh) if (block.type !== 'frame' && 'page' in block) add(block)
  for (const block of fresh) if ('parent' in block) add(block)

  // Blocks that are elsewhere now: in another frame, on another page, or at another spot.
  const sized = new Set<Id>()
  for (const after of Object.values(to.block)) {
    const before = here.get(after.id)!
    if (added.has(after.id)) continue
    if ('parent' in after) {
      if ('parent' in before && before.parent === after.parent) continue
      take(before)
      const list = kids.get(after.parent)!
      ops.push({ op: 'move', id: after.id, to: { parent: after.parent, at: list.length } })
      list.push(after.id)
    } else {
      const stays = 'page' in before && before.page === after.page
      if (stays && before.x === after.x && before.y === after.y) continue
      ops.push({ op: 'move', id: after.id, to: { page: after.page, x: after.x, y: after.y, w: after.w, h: after.h } })
      sized.add(after.id)
      if (stays) continue
      take(before)
      free.get(after.page)!.push(after.id)
    }
    here.set(after.id, after)
  }

  // Blocks that are gone: a frame takes what is still in it.
  for (const block of [...here.values()]) if (block.type === 'frame' && !has(to.block, block.id)) drop(block.id)
  for (const block of [...here.values()]) if (!has(to.block, block.id)) drop(block.id)
  for (const id of [...pages]) {
    if (has(to.page, id)) continue
    ops.push({ op: 'page', remove: id })
    pages.splice(pages.indexOf(id), 1)
  }

  // The order of the pages, of what lies on each, and of what sits in each frame.
  reorder(pages, to.pages, (id, at) => ops.push({ op: 'page', move: id, to: at }))
  for (const id of to.pages) {
    reorder(free.get(id)!, to.page[id]!.free, (blockId, at) => {
      const block = to.block[blockId] as Extract<Block, { page: Id }>
      ops.push({ op: 'move', id: blockId, to: { page: block.page, x: block.x, y: block.y, at } })
    })
  }
  for (const block of Object.values(to.block)) {
    if (block.type === 'frame') reorder(kids.get(block.id)!, block.kids, (kid, at) => ops.push({ op: 'move', id: kid, to: { parent: block.id, at } }))
  }

  // What each block holds.
  for (const after of Object.values(to.block)) {
    const before = from.block[after.id]
    if (!before || added.has(after.id) || before === after) continue
    const set = fieldsToSet(before, after, [...FIELDS[after.type], ...('page' in after && !sized.has(after.id) ? ['w', 'h'] : [])])
    // apply() clears a math block's cached value when its tex changes, unless the value comes too.
    if (after.type === 'math' && has(set, 'tex') && after.value !== undefined) set.value = after.value
    if (Object.keys(set).length > 0) ops.push({ op: 'update', id: after.id, set })
    if (after.type === 'ink' && before.type === 'ink' && before.strokes !== after.strokes) {
      const a = before.strokes
      const b = after.strokes
      let start = 0
      while (start < a.length && start < b.length && same(a[start], b[start])) start++
      let enda = a.length
      let endb = b.length
      while (enda > start && endb > start && same(a[enda - 1], b[endb - 1])) {
        enda--
        endb--
      }
      for (let i = start; i < enda; i++) ops.push({ op: 'stroke', id: after.id, at: start, remove: true })
      for (let i = start; i < endb; i++) ops.push({ op: 'stroke', id: after.id, at: i, add: b[i]! })
    }
  }
  for (const after of Object.values(to.block)) {
    if (after.type !== 'frame' || after.next === undefined) continue
    const before = from.block[after.id]
    if (added.has(after.id) || before?.type !== 'frame' || before.next !== after.next) ops.push({ op: 'update', id: after.id, set: { next: after.next } })
  }
  for (const id of to.pages) {
    const before = from.page[id]
    if (!before) continue
    const set = fieldsToSet(before, to.page[id]!, ['w', 'h', 'bg'])
    if (Object.keys(set).length > 0) ops.push({ op: 'update', id, set })
  }
  const set = fieldsToSet(from, to, DOC_FIELDS)
  if (Object.keys(set).length > 0) ops.push({ op: 'update', id: from.id, set })
  // Last, the pictures nothing shows any more.
  for (const hash of Object.keys(from.asset)) if (!has(to.asset, hash)) ops.push({ op: 'asset', hash, meta: null })
  return ops
}

/**
 * Make `doc` hold what `target` holds, through apply(): one transaction, so
 * `rev` goes up by one and each changed block's `r` with it. Throws a
 * ValidationError, changing nothing, when the two cannot be brought together.
 */
export function become(doc: Doc, target: Doc): Applied {
  const result = apply(doc, difference(doc, target))
  if (!sameContent(result.doc, target)) throw new ValidationError('bad_doc', 'These two versions of the note could not be brought together.')
  return result
}
