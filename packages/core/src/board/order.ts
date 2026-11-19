// A board's reading order: what the outline, the exports, search and the AI read, in the order a person reads it.
//
// A flowchart is read along its links, not by where its nodes happen to lie: from its starts (the nodes nothing points
// to), a node once every node leading to it is read, the first way out of a decision followed to its end before the
// second. A way back, which closes a loop, is not counted, so a loop never stops the reading. Ink written on a node is
// read right after the node. The flowcharts and the loose things on the board (boxes of text, pictures, ink on no
// node) come top to bottom, then left to right, each flowchart where its highest node is.
import { isEndless, type Block, type Doc, type FreeBlock, type Id, type NodeBlock, type Page } from '../schema/doc.js'

/** One thing read as a whole: a flowchart, its nodes in order; or one loose block. */
type Unit = { chart: NodeBlock[] } | { loose: FreeBlock }

/** Top to bottom, then left to right, then back to front: the order of a page that has no links. */
const byPlace = (stack: ReadonlyMap<Id, number>) => (a: FreeBlock, b: FreeBlock): number => a.y - b.y || a.x - b.x || (stack.get(a.id) ?? 0) - (stack.get(b.id) ?? 0)

/** The flowcharts of a page: its nodes joined by links, either way, directly or not; each in the order of `byPlace`. */
function chartsOf(nodes: readonly NodeBlock[], order: (a: FreeBlock, b: FreeBlock) => number): NodeBlock[][] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const root = new Map(nodes.map((node) => [node.id, node.id]))
  const find = (id: Id): Id => {
    let at = id
    while (root.get(at) !== at) at = root.get(at)!
    // Every node on the way then points straight at the root, so a long chain is walked once.
    for (let step = id; step !== at; ) {
      const up = root.get(step)!
      root.set(step, at)
      step = up
    }
    return at
  }
  for (const node of nodes) for (const link of node.to ?? []) if (byId.has(link.node)) root.set(find(link.node), find(node.id))
  const charts = new Map<Id, NodeBlock[]>()
  for (const node of [...nodes].sort(order)) {
    const key = find(node.id)
    const chart = charts.get(key)
    if (chart) chart.push(node)
    else charts.set(key, [node])
  }
  return [...charts.values()]
}

/** One flowchart's nodes in the order it runs. `nodes` are in the order of `byPlace`, which decides between equals. */
function alongLinks(nodes: readonly NodeBlock[]): NodeBlock[] {
  const at = new Map(nodes.map((node, i) => [node.id, i]))
  const next = nodes.map((node) => (node.to ?? []).flatMap((link) => (at.has(link.node) ? [at.get(link.node)!] : [])))
  const incoming = new Array<number>(nodes.length).fill(0)
  for (const ways of next) for (const to of ways) incoming[to]!++

  // The ways back: a link to a node the walk is still inside. Walked from the starts first, then from what is left
  // (a loop with no start), without calling itself, so a chain of fifty thousand is no deeper than one.
  const state = new Uint8Array(nodes.length)
  const back = new Set<string>()
  const walk = (first: number): void => {
    const stack: { node: number; next: number }[] = [{ node: first, next: 0 }]
    state[first] = 1
    while (stack.length > 0) {
      const top = stack.at(-1)!
      const to = next[top.node]![top.next++]
      if (to === undefined) {
        state[top.node] = 2
        stack.pop()
      } else if (state[to] === 1) back.add(`${top.node}>${to}`)
      else if (state[to] === 0) {
        state[to] = 1
        stack.push({ node: to, next: 0 })
      }
    }
  }
  for (let i = 0; i < nodes.length; i++) if (incoming[i] === 0 && state[i] === 0) walk(i)
  for (let i = 0; i < nodes.length; i++) if (state[i] === 0) walk(i)

  // Then each node once every node leading to it is read, the ways back left out: the first way out followed first.
  const forward = next.map((ways, from) => ways.filter((to) => !back.has(`${from}>${to}`)))
  const waiting = new Array<number>(nodes.length).fill(0)
  for (const ways of forward) for (const to of ways) waiting[to]!++
  const ready: number[] = []
  for (let i = nodes.length - 1; i >= 0; i--) if (waiting[i] === 0) ready.push(i)
  const out: NodeBlock[] = []
  while (ready.length > 0) {
    const node = ready.pop()!
    out.push(nodes[node]!)
    const freed = forward[node]!.filter((to) => --waiting[to]! === 0)
    for (let i = freed.length - 1; i >= 0; i--) ready.push(freed[i]!)
  }
  return out
}

/** The units of a board's page, in reading order. */
function unitsOf(doc: Doc, page: Page): Unit[] {
  const stack = new Map(page.free.map((id, i) => [id, i]))
  const order = byPlace(stack)
  const blocks = page.free.map((id) => doc.block[id]).filter((block): block is FreeBlock => block !== undefined && 'page' in block)
  const nodes = blocks.filter((block): block is NodeBlock => block.type === 'node')
  const isNode = new Set(nodes.map((node) => node.id))
  const charts = chartsOf(nodes, order).map(alongLinks)
  const units: { unit: Unit; first: FreeBlock }[] = [
    // A flowchart stands where its highest node is: its first in the order of a page, before its nodes were ordered.
    ...charts.map((chart) => ({ unit: { chart }, first: [...chart].sort(order)[0]! })),
    ...blocks.filter((block) => block.type !== 'node' && !(block.type === 'ink' && block.on !== undefined && isNode.has(block.on))).map((loose) => ({ unit: { loose }, first: loose })),
  ]
  return units.sort((a, b) => order(a.first, b.first)).map(({ unit }) => unit)
}

/** The blocks lying on a board's page, in reading order: each flowchart along its links, ink after its node. */
export function boardOrder(doc: Doc, page: Page): FreeBlock[] {
  const inkOn = new Map<Id, FreeBlock[]>()
  for (const id of page.free) {
    const block: Block | undefined = doc.block[id]
    if (block?.type !== 'ink' || block.on === undefined) continue
    const held = inkOn.get(block.on)
    if (held) held.push(block)
    else inkOn.set(block.on, [block])
  }
  return unitsOf(doc, page).flatMap((unit) => ('loose' in unit ? [unit.loose] : unit.chart.flatMap((node) => [node, ...(inkOn.get(node.id) ?? [])])))
}

/** The flowcharts of a note, in reading order, each its nodes in the order it runs. None in a note that is no board. */
export function chartsIn(doc: Doc): NodeBlock[][] {
  return doc.pages.flatMap((id) => {
    const page = doc.page[id]
    return page && isEndless(page) ? unitsOf(doc, page).flatMap((unit) => ('chart' in unit ? [unit.chart] : [])) : []
  })
}
