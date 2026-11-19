// A board is read along its links: its flowcharts as they run, ink right after the node it was written on, and what
// lies loose on it top to bottom. The outline, the exports, search and the AI all read it so.
import { describe, expect, it } from 'vitest'
import { apply, chartOps, chartsIn, createDoc, linearise, outline, readFlowchart, toMarkdown, toText, validateDoc, type Block, type Doc, type Op } from '../../src/index.js'
import { BOARD, PHYSICS } from '../fixtures/index.js'

/** A board with a chart on it, its nodes named n1, n2… in the order the chart names them. */
function boardOf(src: string): Doc {
  const doc = createDoc({ board: true })
  let count = 0
  return validateDoc(apply(doc, chartOps(doc, doc.pages[0]!, readFlowchart(src), () => `n${++count}`).ops).doc)
}
const order = (doc: Doc): string[] => linearise(doc).map((item) => item.block.id)
/** A node placed by hand, on the board's page. */
const node = (doc: Doc, id: string, x: number, y: number, to: string[] = []): Op => ({
  op: 'add',
  block: { id, r: 0, type: 'node', page: doc.pages[0]!, x, y, w: 4000, h: 1600, shape: 'box', md: id, ...(to.length > 0 ? { to: to.map((each) => ({ node: each })) } : {}) } as Block,
})

describe('a board’s reading order', () => {
  it('follows the flowchart along its links, ink right after its node, then what lies beside it', () => {
    expect(order(BOARD)).toEqual(['n1', 'n2', 'n3', 'k1', 'n4', 'f1', 't1'])
  })

  it('follows a decision’s first way to where the ways join, then its second, then the join', () => {
    const doc = boardOf('flowchart TD\n  Q{Ready?} -->|yes| Y1[Pack] --> Y2[Label] --> E[Send]\n  Q -->|no| N1[Wait] --> E')
    // Named in the chart: Q n1, Y1 n2, Y2 n3, E n4, N1 n5.
    expect(order(doc)).toEqual(['n1', 'n2', 'n3', 'n5', 'n4'])
  })

  it('is the links’, not the places’: a node dragged elsewhere is read where its links say', () => {
    const doc = boardOf('flowchart TD\n  A[One] --> B[Two] --> C[Three]')
    const moved = apply(doc, [{ op: 'move', id: 'n3', to: { page: doc.pages[0]!, x: -20_000, y: -9000 } }]).doc
    expect(order(moved)).toEqual(['n1', 'n2', 'n3'])
  })

  it('reads a loop with no start from its highest node, and never stops on a way back', () => {
    let doc = createDoc({ board: true })
    doc = apply(doc, [node(doc, 'a', 0, 6000, ['b']), node(doc, 'b', 0, 0, ['c']), node(doc, 'c', 0, 3000, ['a'])]).doc
    expect(order(doc)).toEqual(['b', 'c', 'a'])
    // A way back in the middle of a chart: each node is read once, in the order the chart runs.
    expect(order(boardOf('flowchart TD\n  A --> B --> C --> D\n  C --> B\n  D --> A'))).toEqual(['n1', 'n2', 'n3', 'n4'])
  })

  it('places each flowchart and each loose thing by where it is: a title above comes first, a chart on the left before one on the right', () => {
    let doc = createDoc({ board: true })
    const page = doc.pages[0]!
    doc = apply(doc, [
      node(doc, 'r1', 9000, 0, ['r2']),
      node(doc, 'r2', 9000, 3000),
      node(doc, 'l1', 0, 0, ['l2']),
      node(doc, 'l2', 0, 3000),
      { op: 'add', block: { id: 'top', r: 0, type: 'frame', page, x: 0, y: -3000, w: 9000, h: 900, kids: [] } },
      { op: 'add', block: { id: 'ink', r: 0, type: 'ink', page, x: 0, y: 8000, w: 600, h: 600, strokes: [{ pts: [0, 0, 128, 600, 600, 128], color: 'ink', width: 'm' }] } },
    ]).doc
    expect(order(doc)).toEqual(['top', 'l1', 'l2', 'r1', 'r2', 'ink'])
    expect(chartsIn(doc).map((chart) => chart.map((each) => each.id))).toEqual([['l1', 'l2'], ['r1', 'r2']])
  })

  it('reads a chain of fifty thousand nodes, as many as a note holds, without fault', () => {
    const doc = structuredClone(createDoc({ board: true })) as Doc
    const page = doc.pages[0]!
    const count = 49_999
    // Placed bottom to top, so the places say the opposite of the links.
    for (let i = 0; i < count; i++) {
      const id = `n${i.toString(36)}`
      doc.block[id] = { id, r: 0, type: 'node', page, x: 0, y: (count - i) * 2000, w: 4000, h: 1600, shape: 'box', md: id, ...(i + 1 < count ? { to: [{ node: `n${(i + 1).toString(36)}` }] } : {}) } as Block
      doc.page[page]!.free.push(id)
    }
    const read = order(doc)
    expect(read).toHaveLength(count)
    expect([read[0], read[1], read.at(-1)]).toEqual(['n0', 'n1', `n${(count - 1).toString(36)}`])
  })

  it('leaves a note that is no board as it was: top to bottom, and no flowchart in it', () => {
    expect(order(PHYSICS)).toEqual(['f1', 't1', 't2', 'm1', 'g1', 'k1'])
    expect(chartsIn(PHYSICS)).toEqual([])
  })
})

describe('a board in the outline and the exports', () => {
  it('is named as a board in the outline, never as page 1 of 1', () => {
    expect(outline(BOARD).split('\n').slice(0, 3)).toEqual(['How a post is published', 'board p1', 'n1 pill Start → n2'])
  })

  it('leaves as Mermaid in Markdown, which reads back as the same chart', () => {
    const { markdown } = toMarkdown(BOARD)
    const block = /```mermaid\n([\s\S]*?)\n```/u.exec(markdown)![1]!
    const chart = readFlowchart(block)
    expect(chart.nodes.map((each) => [each.shape, each.md])).toEqual([['pill', 'Start'], ['box', 'Write the draft'], ['diamond', 'Passed?'], ['pill', 'Publish']])
    expect(chart.links.map((link) => `${link.from}>${link.to}${link.label === undefined ? '' : ` ${link.label}`}`)).toEqual(['s1>s2', 's2>s3', 's3>s4 yes', 's3>s2 no'])
    expect(chart.left).toEqual([])
    // One block for the whole chart, written once.
    expect(markdown.match(/```mermaid/gu)).toHaveLength(1)
  })

  it('leaves as its steps in plain text, each with where it leads when that is not the next line', () => {
    const doc = boardOf('flowchart TD\n  A[Order] --> B{In stock?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Wait]\n  D --> B\n  E[ ]')
    expect(toText(doc, { title: false })).toBe(['Order', 'In stock? → Ship (yes), Wait (no)', 'Ship', 'Wait → In stock?', '', 'E'].join('\n') + '\n')
  })
})
