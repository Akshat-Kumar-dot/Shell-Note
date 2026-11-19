// Where a board's nodes go. Code does every place: a model, a command, an assistant names nodes by their ids and
// never gives a position.
//
//   a node's size      from its words: so many letters a line, so many lines, with room for its shape
//   a whole chart      in layers: the starts first, each node a layer after the furthest node pointing to it, each
//                      layer in the order that crosses fewest links, each node in line with those it joins
//                      (the method Sugiyama, Tagawa and Toda published in 1981; written here, with no package)
//   one new step       beside the node it follows along the way the chart runs; between it and its one next step,
//                      which moves along with all after it; or as one more branch of a node with several ways out
//
// The same chart always gets the same places. Units are 0.01 mm, whole numbers.
import type { Box } from '../ink/geometry.js'
import { parseInline, plainText } from '../markdown/inline.js'
import { MAX_LINKS, type Block, type Doc, type Id, type Link, type NodeBlock, type NodeShape } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { ValidationError } from '../validate/errors.js'
import type { Chart, Flow } from './mermaid.js'

/** A letter's width and a line's height at the usual size, and the room kept round a node's words. */
const LETTER = 200
const LINE = 600
const PAD_X = 500
const PAD_Y = 450
/** A node's words are at least this wide and at most this wide: 24 mm, and 52 mm (26 letters a line). */
const NARROWEST = 2400
const WIDEST = 5200
/** Room between two layers (for a link and its words), between two nodes of a layer, and round a new chart. */
export const GAP_ALONG = 1600
export const GAP_ACROSS = 1000
const CHART_GAP = 3000
/** Two places this close count as the same: 0.5 mm. */
const NEAR = 50

type Size = { w: number; h: number }

/** A letter that takes two letters' width: Chinese, Japanese and Korean writing, and most emoji. */
const wide = (char: string): boolean => (char.codePointAt(0) ?? 0) >= 0x1100

/** The size a node of a shape needs for its words. */
export function nodeSize(shape: NodeShape, md: string): Size {
  const words = plainText(parseInline(md)).replace(/\s+/gu, ' ').trim()
  const most = Math.floor(WIDEST / LETTER)
  const width = (text: string): number => [...text].reduce((sum, char) => sum + (wide(char) ? 2 : 1), 0)
  // Words put on lines, a word too long for a line cut where the line ends.
  const lines: number[] = []
  let line = 0
  for (const word of words === '' ? [] : words.split(' ')) {
    let left = width(word)
    if (line > 0 && line + 1 + left <= most) {
      line += 1 + left
      continue
    }
    if (line > 0) lines.push(line)
    while (left > most) {
      lines.push(most)
      left -= most
    }
    line = left
  }
  if (line > 0 || lines.length === 0) lines.push(line)
  const textW = Math.max(NARROWEST, Math.min(WIDEST, Math.max(...lines) * LETTER))
  const textH = lines.length * LINE
  let w = textW + 2 * PAD_X
  let h = textH + 2 * PAD_Y
  switch (shape) {
    case 'diamond':
      // Its words lie in the middle half of its box.
      w = w * 1.5
      h = h * 1.7
      break
    case 'circle':
    case 'double-circle':
      w = h = Math.max(2000, Math.hypot(textW, textH) + PAD_Y)
      break
    case 'hexagon':
      w += h
      break
    case 'slant':
    case 'slant-back':
    case 'trapezoid':
    case 'trapezoid-down':
      w += h * 0.8
      break
    case 'cylinder':
      h += 600
      break
    case 'pill':
    case 'flag':
      w += h / 2
      break
    case 'subroutine':
      w += 600
      break
    default:
  }
  // To whole millimetres.
  return { w: Math.ceil(w / 100) * 100, h: Math.ceil(h / 100) * 100 }
}

// ----- which way a chart runs ---------------------------------------------------

/** Places along the way a chart runs and across it, whichever way that is. */
function axes(flow: Flow) {
  const upright = flow === 'down' || flow === 'up'
  const sign = flow === 'down' || flow === 'right' ? 1 : -1
  return {
    /** Where a box starts and ends along the flow. */
    start: (box: Box): number => (sign === 1 ? (upright ? box.y : box.x) : -(upright ? box.y + box.h : box.x + box.w)),
    end: (box: Box): number => (sign === 1 ? (upright ? box.y + box.h : box.x + box.w) : -(upright ? box.y : box.x)),
    /** Its middle across the flow, and how much room it takes each way. */
    centre: (box: Box): number => (upright ? box.x + box.w / 2 : box.y + box.h / 2),
    deep: (size: Size): number => (upright ? size.h : size.w),
    broad: (size: Size): number => (upright ? size.w : size.h),
    /** A box from where it starts along the flow and its middle across it. */
    box: (start: number, centre: number, size: Size): Box =>
      upright
        ? { x: Math.round(centre - size.w / 2), y: Math.round(sign === 1 ? start : -(start + size.h)), ...size }
        : { x: Math.round(sign === 1 ? start : -(start + size.w)), y: Math.round(centre - size.h / 2), ...size },
    /** A step of `by` along the flow, as a change of x and y. */
    step: (by: number): { dx: number; dy: number } => (upright ? { dx: 0, dy: sign * by } : { dx: sign * by, dy: 0 }),
    /** A step of `by` across the flow. */
    aside: (by: number): { dx: number; dy: number } => (upright ? { dx: by, dy: 0 } : { dx: 0, dy: by }),
  }
}

const boxOf = (block: { x: number; y: number; w: number; h: number }): Box => ({ x: block.x, y: block.y, w: block.w, h: block.h })
const middle = (box: Box): { x: number; y: number } => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })

/** The way one link runs: the way its second node lies from its first, by the greater of across and down. */
function wayOf(from: Box, to: Box): Flow {
  const [a, b] = [middle(from), middle(to)]
  return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 'right' : 'left') : b.y >= a.y ? 'down' : 'up'
}

/** The way most of some links run; down when there are none, or as many each way. */
function mostOf(ways: readonly Flow[]): Flow | undefined {
  const count = new Map<Flow, number>()
  for (const way of ways) count.set(way, (count.get(way) ?? 0) + 1)
  // Down first, so that it stands when as many run another way.
  return (['down', 'right', 'up', 'left'] as const).reduce<Flow | undefined>((best, way) => ((count.get(way) ?? 0) > (best === undefined ? 0 : count.get(best)!) ? way : best), undefined)
}

/** The nodes of a page, in the order the page lists them. */
export function nodesOn(doc: Doc, pageId: Id): NodeBlock[] {
  return (doc.page[pageId]?.free ?? []).map((id) => doc.block[id]).filter((block): block is NodeBlock => block?.type === 'node')
}

/** The way a board's flowchart runs, from where its links lead: down when it has none. */
export function flowOf(nodes: readonly NodeBlock[]): Flow {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ways = nodes.flatMap((node) => (node.to ?? []).flatMap((link) => (byId.has(link.node) ? [wayOf(boxOf(node), boxOf(byId.get(link.node)!))] : [])))
  return mostOf(ways) ?? 'down'
}

// ----- a whole chart, in layers -------------------------------------------------

/**
 * Places for a chart's nodes, the first corner of the whole at 0, 0: each node's box by its key. `nodes` are in the
 * order the chart names them, which decides between equals; a link naming a node that is not among them is left out.
 */
export function layoutChart(nodes: readonly ({ key: string } & Size)[], links: readonly { from: string; to: string }[], flow: Flow = 'down'): Map<string, Box> {
  const n = nodes.length
  const at = new Map(nodes.map((node, i) => [node.key, i]))
  const out: number[][] = nodes.map(() => [])
  const incoming = new Array<number>(n).fill(0)
  for (const link of links) {
    const [a, b] = [at.get(link.from), at.get(link.to)]
    if (a === undefined || b === undefined || a === b || out[a]!.includes(b)) continue
    out[a]!.push(b)
    incoming[b]!++
  }

  // 1. A way back (a link to a node the walk is still inside) is turned round for the layering, so no loop is left.
  const down: number[][] = nodes.map(() => [])
  const up: number[][] = nodes.map(() => [])
  const state = new Uint8Array(n)
  const done: number[] = []
  const walk = (first: number): void => {
    // Without calling itself: a chain of five hundred nodes is five hundred deep.
    const stack: { node: number; next: number }[] = [{ node: first, next: 0 }]
    state[first] = 1
    while (stack.length > 0) {
      const top = stack.at(-1)!
      const to = out[top.node]![top.next++]
      if (to === undefined) {
        state[top.node] = 2
        done.push(top.node)
        stack.pop()
        continue
      }
      const [a, b] = state[to] === 1 ? [to, top.node] : [top.node, to]
      down[a]!.push(b)
      up[b]!.push(a)
      if (state[to] === 0) {
        state[to] = 1
        stack.push({ node: to, next: 0 })
      }
    }
  }
  // The starts first (nothing points to them), then what is left: nodes of a loop with no start.
  for (let i = 0; i < n; i++) if (incoming[i] === 0 && state[i] === 0) walk(i)
  for (let i = 0; i < n; i++) if (state[i] === 0) walk(i)

  // 2. Layers: a node lies one layer after the furthest node pointing to it.
  const layer = new Array<number>(n).fill(0)
  for (const node of [...done].reverse()) for (const to of down[node]!) layer[to] = Math.max(layer[to]!, layer[node]! + 1)
  const layers: number[][] = []
  for (let i = 0; i < n; i++) (layers[layer[i]!] ??= []).push(i)

  // 3. The order in each layer: each node by the middle of those it joins in the layers before, then after, in turn.
  const place = new Array<number>(n).fill(0)
  const settle = (row: number[]): void => row.forEach((node, i) => (place[node] = (i + 0.5) / row.length))
  layers.forEach(settle)
  const mean = (list: readonly number[], of: (node: number) => number, otherwise: number): number => (list.length === 0 ? otherwise : list.reduce((sum, node) => sum + of(node), 0) / list.length)
  for (let pass = 0; pass < 4; pass++) {
    const forward = pass % 2 === 0
    for (const row of forward ? layers.slice(1) : layers.slice(0, -1).reverse()) {
      const weight = new Map(row.map((node) => [node, mean(forward ? up[node]! : down[node]!, (other) => place[other]!, place[node]!)]))
      row.sort((a, b) => weight.get(a)! - weight.get(b)! || a - b)
      settle(row)
    }
  }

  // 4. Places. Along the flow, a layer is as deep as its deepest node. Across it, each node is drawn toward the middle
  // of those it joins, never nearer its neighbour than the gap: from the starts on, back from the ends, and on again.
  const { deep, broad, box } = axes(flow)
  const size = (node: number): Size => ({ w: nodes[node]!.w, h: nodes[node]!.h })
  const centre = new Array<number>(n).fill(0)
  const spread = (row: readonly number[], wanted: (node: number) => number): void => {
    // As far one way as the order allows, and as far the other: halfway between the two keeps the order and the gaps.
    const low: number[] = []
    row.forEach((node, i) => (low[i] = i === 0 ? wanted(node) : Math.max(wanted(node), low[i - 1]! + (broad(size(row[i - 1]!)) + broad(size(node))) / 2 + GAP_ACROSS)))
    const high: number[] = []
    for (let i = row.length - 1; i >= 0; i--) {
      const node = row[i]!
      high[i] = i === row.length - 1 ? wanted(node) : Math.min(wanted(node), high[i + 1]! - (broad(size(row[i + 1]!)) + broad(size(node))) / 2 - GAP_ACROSS)
    }
    row.forEach((node, i) => (centre[node] = (low[i]! + high[i]!) / 2))
  }
  for (const row of layers) {
    // To begin with, each layer packed and centred on one line.
    let across = 0
    const packed = row.map((node, i) => {
      if (i > 0) across += (broad(size(row[i - 1]!)) + broad(size(node))) / 2 + GAP_ACROSS
      return across
    })
    row.forEach((node, i) => (centre[node] = packed[i]! - across / 2))
  }
  for (const forward of [true, false, true]) {
    for (const row of forward ? layers.slice(1) : layers.slice(0, -1).reverse()) spread(row, (node) => mean(forward ? up[node]! : down[node]!, (other) => centre[other]!, centre[node]!))
  }
  const boxes: Box[] = new Array<Box>(n)
  let start = 0
  for (const row of layers) {
    const depth = Math.max(...row.map((node) => deep(size(node))))
    for (const node of row) boxes[node] = box(start + (depth - deep(size(node))) / 2, centre[node]!, size(node))
    start += depth + GAP_ALONG
  }
  // The whole from 0, 0.
  const left = Math.min(...boxes.map((each) => each.x))
  const top = Math.min(...boxes.map((each) => each.y))
  return new Map(nodes.map((node, i) => [node.key, { ...boxes[i]!, x: boxes[i]!.x - left, y: boxes[i]!.y - top }]))
}

// ----- on a board ----------------------------------------------------------------

/** The boxes of everything placed on a page: a frame at least a line tall, since its height is written as it is drawn. */
function boxesOn(doc: Doc, pageId: Id, except: ReadonlySet<Id> = new Set()): Box[] {
  return (doc.page[pageId]?.free ?? []).flatMap((id) => {
    const block = doc.block[id]
    if (!block || except.has(id) || !('page' in block)) return []
    return [{ x: block.x, y: block.y, w: block.w, h: block.type === 'frame' ? Math.max(block.h, 600) : block.h }]
  })
}

const clear = (box: Box, others: readonly Box[], gap = 300): boolean => others.every((o) => box.x + box.w + gap <= o.x || o.x + o.w + gap <= box.x || box.y + box.h + gap <= o.y || o.y + o.h + gap <= box.y)

/**
 * Where something of `size` goes on a board without lying on anything: round `near` (where the person is looking)
 * when that is free, else to the right of everything there, level with it. An empty board takes it at `near`, or at
 * 0, 0.
 */
export function emptySpot(doc: Doc, pageId: Id, size: Size, near?: { x: number; y: number }): { x: number; y: number } {
  const others = boxesOn(doc, pageId)
  const wanted = near ? { x: Math.round(near.x - size.w / 2), y: Math.round(near.y - size.h / 2) } : undefined
  if (others.length === 0) return wanted ?? { x: 0, y: 0 }
  if (wanted && clear({ ...wanted, ...size }, others, CHART_GAP / 2)) return wanted
  const right = Math.max(...others.map((o) => o.x + o.w))
  const top = Math.min(...others.map((o) => o.y))
  return { x: right + CHART_GAP, y: wanted?.y ?? top }
}

/** A link as a node keeps it, from one a chart read. */
const linkOf = (to: Id, link: { label?: string | undefined; line?: 'dotted' | 'thick' | undefined; head?: 'none' | undefined }): Link => ({
  node: to,
  ...(link.label === undefined ? {} : { label: link.label }),
  ...(link.line === undefined ? {} : { line: link.line }),
  ...(link.head === undefined ? {} : { head: link.head }),
})

/**
 * The operations that put a chart on a board: a node for each of its nodes, sized for its words, laid out, each with
 * its links. One change. `made` gives each node's id by its name in the chart.
 */
export function chartOps(doc: Doc, pageId: Id, chart: Pick<Chart, 'flow' | 'nodes' | 'links'>, newId: () => Id, near?: { x: number; y: number }): { ops: Op[]; made: Map<string, Id>; box: Box } {
  const sizes = chart.nodes.map((node) => ({ key: node.key, ...nodeSize(node.shape, node.md) }))
  const boxes = layoutChart(sizes, chart.links, chart.flow)
  const whole = { w: Math.max(...[...boxes.values()].map((b) => b.x + b.w)), h: Math.max(...[...boxes.values()].map((b) => b.y + b.h)) }
  const origin = emptySpot(doc, pageId, whole, near)
  const made = new Map(chart.nodes.map((node) => [node.key, newId()]))
  const ops = chart.nodes.map((node): Op => {
    const box = boxes.get(node.key)!
    const to = chart.links.filter((link) => link.from === node.key && made.has(link.to)).map((link) => linkOf(made.get(link.to)!, link))
    const block = { id: made.get(node.key)!, r: 0, type: 'node', page: pageId, x: origin.x + box.x, y: origin.y + box.y, w: box.w, h: box.h, shape: node.shape, md: node.md, ...(to.length > 0 ? { to } : {}) }
    return { op: 'add', block: block as Block }
  })
  return { ops, made, box: { ...origin, ...whole } }
}

/** The moves that take some nodes, and the ink written on them, `dx` and `dy` from where they are. */
export function moveOps(doc: Doc, ids: Iterable<Id>, dx: number, dy: number): Op[] {
  const nodes = new Set(ids)
  if (dx === 0 && dy === 0) return []
  const ops: Op[] = []
  for (const block of Object.values(doc.block)) {
    const moves = (block.type === 'node' && nodes.has(block.id)) || (block.type === 'ink' && block.on !== undefined && nodes.has(block.on))
    if (moves && 'page' in block) ops.push({ op: 'move', id: block.id, to: { page: block.page, x: block.x + dx, y: block.y + dy } })
  }
  return ops
}

/** The nodes a node leads to, itself among them, that lie at or after it along the flow: what moves along with it. */
function onward(byId: ReadonlyMap<Id, NodeBlock>, first: NodeBlock, flow: Flow, never: Id): Set<Id> {
  const { start } = axes(flow)
  const from = start(boxOf(first)) - NEAR
  const found = new Set<Id>([first.id])
  const todo = [first]
  while (todo.length > 0) {
    for (const link of todo.pop()!.to ?? []) {
      const next = byId.get(link.node)
      if (!next || found.has(next.id) || next.id === never || start(boxOf(next)) < from) continue
      found.add(next.id)
      todo.push(next)
    }
  }
  return found
}

export interface NewStep {
  md: string
  /** A box when left out. */
  shape?: NodeShape
  color?: NodeBlock['color']
}

/**
 * The operations that add one step to a flowchart, after a node or before it. After a node with one next step, the
 * new one goes between the two, and that next step moves along with all after it; after a node with none, it is its
 * next step; after a node with several (a decision), it is one more branch beside the others. Before a node, it
 * takes the node's place and the links that led to it, and the node moves along. A spot something else holds is
 * never taken: the new step goes aside until it is clear. One change; `id` is the new node's.
 */
export function stepOps(doc: Doc, ref: Id, side: 'after' | 'before', step: NewStep, newId: () => Id): { ops: Op[]; id: Id } {
  const node = doc.block[ref]
  if (node?.type !== 'node') throw new ValidationError('wrong_type', `${ref} is not a step of a flowchart: a new step goes after or before a node of the board.`, { got: ref })
  const nodes = nodesOn(doc, node.page)
  const byId = new Map(nodes.map((each) => [each.id, each]))
  const shape = step.shape ?? 'box'
  const size = nodeSize(shape, step.md)
  const id = newId()
  const here = boxOf(node)

  // The way the chart runs here: by this node's own links, in and out, else as most of the board's do.
  const into = nodes.filter((each) => each.to?.some((link) => link.node === ref))
  const targets = (node.to ?? []).flatMap((link) => (byId.has(link.node) ? [byId.get(link.node)!] : []))
  const flow = mostOf([...targets.map((to) => wayOf(here, boxOf(to))), ...into.map((from) => wayOf(boxOf(from), here))]) ?? flowOf(nodes)
  const { start, end, centre, deep, broad, box, step: along, aside } = axes(flow)

  const ops: Op[] = []
  const moved = new Map<Id, { dx: number; dy: number }>()
  const push = (ids: Iterable<Id>, by: number): void => {
    const { dx, dy } = along(by)
    const list = [...ids]
    ops.push(...moveOps(doc, list, dx, dy))
    for (const each of list) moved.set(each, { dx, dy })
  }
  const relink = (from: NodeBlock, to: Link[]): void => void ops.push({ op: 'update', id: from.id, set: { to } })
  let spot: Box
  let to: Link[] = []

  if (side === 'before') {
    to = [{ node: ref }]
    if (into.length === 0) spot = box(start(here) - GAP_ALONG - deep(size), centre(here), size)
    else {
      // It takes the node's place; the node, and all after it, move along. What led to the node leads to it.
      spot = box(start(here), centre(here), size)
      push(onward(byId, node, flow, id), deep(size) + GAP_ALONG)
      for (const from of into) relink(from, from.to!.map((link) => (link.node === ref ? { ...link, node: id } : link)))
    }
  } else if (targets.length === 1 && node.to!.length === 1) {
    // Between the node and its one next step, which keeps the words the link had.
    const next = targets[0]!
    spot = box(end(here) + GAP_ALONG, centre(here), size)
    const ahead = start(boxOf(next)) >= end(here) - NEAR
    if (ahead) push(onward(byId, next, flow, ref), Math.max(0, end(spot) + GAP_ALONG - start(boxOf(next))))
    relink(node, [{ ...node.to![0]!, node: id }])
    to = [{ node: next.id }]
  } else if (targets.length === 0) {
    spot = box(end(here) + GAP_ALONG, centre(here), size)
    relink(node, [...(node.to ?? []), { node: id }])
  } else {
    // One more branch: level with the branches there are, beside the outermost.
    if (node.to!.length >= MAX_LINKS) throw new ValidationError('bad_value', `${ref} points to ${MAX_LINKS} steps already, the most a step has. Add the new step after one of them.`)
    const ahead = targets.filter((each) => start(boxOf(each)) >= end(here) - NEAR)
    const level = ahead.length > 0 ? Math.min(...ahead.map((each) => start(boxOf(each)))) : end(here) + GAP_ALONG
    const beside = ahead.length > 0 ? Math.max(...ahead.map((each) => centre(boxOf(each)) + broad(each) / 2)) + GAP_ACROSS + broad(size) / 2 : centre(here)
    spot = box(level, beside, size)
    relink(node, [...node.to!, { node: id }])
  }

  // Never on something else: aside, a step at a time, until it is clear of everything as the moves leave it.
  const others = (doc.page[node.page]?.free ?? []).flatMap((each) => {
    const block = doc.block[each]
    if (!block || !('page' in block)) return []
    const by = moved.get(block.type === 'ink' && block.on !== undefined ? block.on : each) ?? { dx: 0, dy: 0 }
    return [{ x: block.x + by.dx, y: block.y + by.dy, w: block.w, h: block.type === 'frame' ? Math.max(block.h, 600) : block.h }]
  })
  for (let tries = 0; tries < 200 && !clear(spot, others); tries++) {
    const { dx, dy } = aside(GAP_ACROSS)
    spot = { ...spot, x: spot.x + dx, y: spot.y + dy }
  }
  const block = { id, r: 0, type: 'node', page: node.page, ...spot, shape, md: step.md, ...(step.color === undefined ? {} : { color: step.color }), ...(to.length > 0 ? { to } : {}) }
  return { ops: [{ op: 'add', block: block as Block }, ...ops], id }
}

/**
 * The moves that lay a board's flowchart out again, each node keeping its size, the whole keeping its first corner:
 * none when every node is where the layout puts it.
 */
export function tidyChartOps(doc: Doc, pageId: Id): Op[] {
  const nodes = nodesOn(doc, pageId)
  if (nodes.length === 0) return []
  const boxes = layoutChart(
    nodes.map((node) => ({ key: node.id, w: node.w, h: node.h })),
    nodes.flatMap((node) => (node.to ?? []).map((link) => ({ from: node.id, to: link.node }))),
    flowOf(nodes),
  )
  const left = Math.min(...nodes.map((node) => node.x))
  const top = Math.min(...nodes.map((node) => node.y))
  return nodes.flatMap((node) => {
    const box = boxes.get(node.id)!
    return moveOps(doc, [node.id], left + box.x - node.x, top + box.y - node.y)
  })
}
