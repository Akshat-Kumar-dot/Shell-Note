// A board's links as they are drawn: each one's path, from the two steps it joins and the way its chart runs, and the
// patch its words go on, placed knowing every link. Worked out once for the whole board, so the screen, the print and
// the library's picture draw the same lines and words, and panning the screen never moves a word.
import type { Box } from '../ink/geometry.js'
import type { Doc, Id, Link, NodeBlock } from '../schema/doc.js'
import { flowOf } from './layout.js'
import { placeLabels } from './labels.js'
import type { Flow } from './mermaid.js'
import { chartsIn } from './order.js'
import { routeLink, type Route } from './route.js'

export interface DrawnLink {
  /** The step it leaves, and its place in that step's list of links. */
  from: Id
  index: number
  /** The step it leads to. */
  to: Id
  link: Link
  route: Route
  /** The way its chart runs, which its path follows. */
  flow: Flow
  /** The patch its words are drawn on; none when it has no words. */
  label?: Box
}

/** A link's key: the step it leaves and the step it leads to (one link a pair). */
export const linkKey = (from: Id, to: Id): string => `${from}>${to}`

/** The lane a way back runs along beside its chart, as a thin box the ways back after it keep clear of. */
function laneOf(route: Route): Box | undefined {
  const [a, b] = [route.points[1], route.points[2]]
  if (!a || !b) return undefined
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x: x - 1, y: y - 1, w: Math.abs(a.x - b.x) + 2, h: Math.abs(a.y - b.y) + 2 }
}

/**
 * Every link of a board's page, in the order its charts read, with its path and its words' place. The words keep clear
 * of every step and every other block on the board.
 */
export function boardLinks(doc: Doc, pageId: Id): DrawnLink[] {
  const page = doc.page[pageId]
  if (!page) return []
  const byId = new Map<Id, NodeBlock>()
  for (const id of page.free) {
    const block = doc.block[id]
    if (block?.type === 'node') byId.set(id, block)
  }
  const links: DrawnLink[] = []
  // Each chart runs its own way, and its ways back keep clear of its own steps, and of the ways back run before them:
  // two that a step pushed out the same way never share a lane.
  for (const chart of chartsIn(doc)) {
    if (chart[0]?.page !== pageId) continue
    const flow: Flow = flowOf(chart)
    const boxes = chart.map((node) => ({ id: node.id, box: { x: node.x, y: node.y, w: node.w, h: node.h } }))
    const lanes: Box[] = []
    for (const node of chart) {
      ;(node.to ?? []).forEach((link, index) => {
        const target = byId.get(link.node)
        if (!target) return
        const others = [...boxes.filter((one) => one.id !== node.id && one.id !== target.id).map((one) => one.box), ...lanes]
        const route = routeLink({ shape: node.shape, box: node }, { shape: target.shape, box: target }, flow, link.path, others)
        const lane = route.kind === 'angled' && route.from === route.to ? laneOf(route) : undefined
        if (lane) lanes.push(lane)
        links.push({ from: node.id, index, to: target.id, link, route, flow })
      })
    }
  }
  const keepClear: Box[] = page.free.flatMap((id) => {
    const block = doc.block[id]
    return block && 'page' in block && !(block.type === 'ink' && block.on !== undefined) ? [{ x: block.x, y: block.y, w: block.w, h: Math.max(block.h, 600) }] : []
  })
  const labels = placeLabels(
    links.map((one) => ({ key: linkKey(one.from, one.to), route: one.route, text: one.link.label ?? '' })),
    keepClear,
  )
  return links.map((one) => {
    const label = labels.get(linkKey(one.from, one.to))
    return label ? { ...one, label } : one
  })
}
