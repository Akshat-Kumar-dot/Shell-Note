// What a person's hand makes on a board: a step drawn where the pointer drags or clicks, a link drawn from one step to
// another or to the bare board, a link's end taken to another step, and the route a link takes once it is made, so the
// screen can mark the point it will join before it is let go. Nothing of the hand's path is kept: a link says which
// two steps and which way, and code runs it as it runs every link (route.ts), from the middle of a side code chooses.
// Units are 0.01 mm.
import type { Box } from '../ink/geometry.js'
import { MAX_LINKS, type Block, type Doc, type Id, type NodeBlock, type NodeShape } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { flowOf, nodesOn, nodeSize } from './layout.js'
import { routeLink, type Point, type Route } from './route.js'

/** The paper's dots, 5 mm apart: a step's middle goes to the nearest as it is drawn or moved by hand. */
export const DOT = 500
export const toDot = (value: number): number => Math.round(value / DOT) * DOT

/** A box of a size about a point, its middle on the nearest dot unless `free`. */
function about(point: Point, size: { w: number; h: number }, free: boolean): Box {
  const x = free ? point.x : toDot(point.x)
  const y = free ? point.y : toDot(point.y)
  return { x: Math.round(x - size.w / 2), y: Math.round(y - size.h / 2), w: size.w, h: size.h }
}

/**
 * The box of a step drawn by hand. A drag from `from` to `to`: over the box dragged, in whole millimetres and at least
 * the size its shape needs with no words. A click (`to` left out): of that usual size about the point. Its middle on
 * the nearest dot of the paper unless `free` (Alt held).
 */
export function drawnBox(shape: NodeShape, from: Point, to?: Point, free = false): Box {
  const least = nodeSize(shape, '')
  if (!to) return about(from, least, free)
  const size = {
    w: Math.max(least.w, Math.round(Math.abs(to.x - from.x) / 100) * 100),
    h: Math.max(least.h, Math.round(Math.abs(to.y - from.y) / 100) * 100),
  }
  return about({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, size, free)
}

/** A step made by hand, with no words yet: the caret goes into it to type them. */
export function newStepOp(page: Id, box: Box, shape: NodeShape, id: Id): Op {
  return { op: 'add', block: { id, r: 0, type: 'node', page, x: box.x, y: box.y, w: box.w, h: box.h, shape, md: '' } as Block }
}

/**
 * The change that joins two steps, from the first to the second; none when they are one step, lie on two pages, are
 * joined that way already, or the first leads to as many steps as a step can.
 */
export function joinOps(doc: Doc, from: Id, to: Id): Op[] {
  const a = doc.block[from]
  const b = doc.block[to]
  if (a?.type !== 'node' || b?.type !== 'node' || from === to || a.page !== b.page) return []
  const list = a.to ?? []
  if (list.some((link) => link.node === to) || list.length >= MAX_LINKS) return []
  return [{ op: 'update', id: from, set: { to: [...list, { node: to }] } }]
}

/**
 * A link drawn from a step and let go on the bare board: a step of the same shape as the one it left, of the usual
 * size about `at` (its middle on the nearest dot unless `free`), joined from the first. Never a choice of shapes there.
 * One change; undefined when the first step leads to as many as a step can.
 */
export function joinNewOps(doc: Doc, from: Id, at: Point, free: boolean, id: Id): Op[] | undefined {
  const a = doc.block[from]
  if (a?.type !== 'node' || (a.to?.length ?? 0) >= MAX_LINKS) return undefined
  const box = about(at, nodeSize(a.shape, ''), free)
  return [newStepOp(a.page, box, a.shape, id), { op: 'update', id: from, set: { to: [...(a.to ?? []), { node: id }] } }]
}

/**
 * A chosen link's end taken to another step: the link from `from` to `to` leaves `onto` instead (end 'from'), or
 * leads to it (end 'to'), its words and its look kept, in one change. None when nothing would change, when it would
 * join a step to itself or a pair joined that way already, or when `onto` leads to as many steps as a step can.
 */
export function moveEndOps(doc: Doc, from: Id, to: Id, end: 'from' | 'to', onto: Id): Op[] {
  const a = doc.block[from]
  const target = doc.block[onto]
  if (a?.type !== 'node' || target?.type !== 'node' || target.page !== a.page || onto === from || onto === to) return []
  const list = a.to ?? []
  const link = list.find((one) => one.node === to)
  if (!link) return []
  if (end === 'to') {
    if (list.some((one) => one.node === onto)) return []
    return [{ op: 'update', id: from, set: { to: list.map((one) => (one.node === to ? { ...one, node: onto } : one)) } }]
  }
  const theirs = target.to ?? []
  if (theirs.some((one) => one.node === to) || theirs.length >= MAX_LINKS) return []
  const kept = list.filter((one) => one.node !== to)
  return [
    { op: 'update', id: from, set: { to: kept.length > 0 ? kept : null } },
    { op: 'update', id: onto, set: { to: [...theirs, link] } },
  ]
}

/** The steps of a chart: every step joined to `first`, either way, directly or not. */
function chartOf(nodes: readonly NodeBlock[], first: Id): NodeBlock[] {
  const near = new Map<Id, Id[]>()
  const ids = new Set(nodes.map((node) => node.id))
  const join = (a: Id, b: Id): void => {
    const list = near.get(a)
    if (list) list.push(b)
    else near.set(a, [b])
  }
  for (const node of nodes)
    for (const link of node.to ?? []) {
      if (!ids.has(link.node)) continue
      join(node.id, link.node)
      join(link.node, node.id)
    }
  const found = new Set([first])
  const todo = [first]
  while (todo.length > 0) {
    for (const next of near.get(todo.pop()!) ?? []) {
      if (found.has(next)) continue
      found.add(next)
      todo.push(next)
    }
  }
  return nodes.filter((node) => found.has(node.id))
}

/**
 * The route of the link from one step to another as the board draws it: the link there is, or, when there is none,
 * the one joining them would make. Its chart runs the way most of its links run once it is joined (as the board
 * draws it), so the sides it leaves and enters by are those it takes once let go: code chooses them.
 */
export function linkRoute(doc: Doc, from: Id, to: Id): Route | undefined {
  const a = doc.block[from]
  const b = doc.block[to]
  if (a?.type !== 'node' || b?.type !== 'node' || from === to || a.page !== b.page) return undefined
  const had = a.to?.find((link) => link.node === to)
  const joined: NodeBlock = had ? a : { ...a, to: [...(a.to ?? []), { node: to }] }
  const nodes = nodesOn(doc, a.page).map((node) => (node.id === from ? joined : node))
  return routeLink({ shape: a.shape, box: a }, { shape: b.shape, box: b }, flowOf(chartOf(nodes, from)), had?.path)
}
