// A flowchart written in Mermaid becomes a board's nodes and links, and a board's nodes Mermaid again. The reader is
// the app's own: every shape, every kind of link, what small models get wrong, and what is refused or left out.
import { describe, expect, it } from 'vitest'
import { BRACKETS, MAX_CHART_NODES, MAX_LINKS, NodeShape, readFlowchart, ValidationError, writeFlowchart, type Chart, type NodeBlock } from '../../src/index.js'
import { BOARD } from '../fixtures/index.js'

const refusal = (src: string): ValidationError => {
  try {
    readFlowchart(src)
  } catch (error) {
    if (error instanceof ValidationError) return error
    throw error
  }
  throw new Error('It was read, and should have been refused.')
}
const pairs = (chart: Chart): string[] => chart.links.map((link) => `${link.from}>${link.to}${link.label === undefined ? '' : `:${link.label}`}`)

describe('a flowchart read from Mermaid', () => {
  it('becomes nodes with their shapes and words, and links with theirs', () => {
    const chart = readFlowchart('flowchart TD\n  A([Start]) --> B[Write the draft]\n  B --> C{Passed?}\n  C -->|yes| D([Publish])\n  C -->|no| B')
    expect(chart.flow).toBe('down')
    expect(chart.nodes).toEqual([
      { key: 'A', shape: 'pill', md: 'Start' },
      { key: 'B', shape: 'box', md: 'Write the draft' },
      { key: 'C', shape: 'diamond', md: 'Passed?' },
      { key: 'D', shape: 'pill', md: 'Publish' },
    ])
    expect(pairs(chart)).toEqual(['A>B', 'B>C', 'C>D:yes', 'C>B:no'])
    expect(chart.left).toEqual([])
  })

  it('reads each of the fourteen shapes by its brackets, the words in quotes or not', () => {
    for (const shape of NodeShape.options) {
      const [open, close] = BRACKETS[shape]
      expect(readFlowchart(`flowchart LR\n  A${open}Some words${close}`).nodes, shape).toEqual([{ key: 'A', shape, md: 'Some words' }])
      expect(readFlowchart(`flowchart LR\n  A${open}"Force (F) [N]"${close} --> B`).nodes[0], shape).toEqual({ key: 'A', shape, md: 'Force (F) [N]' })
    }
  })

  it('reads which way it runs, and a first line that says graph', () => {
    expect(readFlowchart('flowchart LR\nA --> B').flow).toBe('right')
    expect(readFlowchart('graph TB\nA --> B').flow).toBe('down')
    expect(readFlowchart('flowchart BT\nA --> B').flow).toBe('up')
    expect(readFlowchart('flowchart RL\nA --> B').flow).toBe('left')
    expect(pairs(readFlowchart('graph TD; A-->B; B-->C'))).toEqual(['A>B', 'B>C'])
  })

  it('reads a chain, several nodes at once, and a node named before its words', () => {
    expect(pairs(readFlowchart('flowchart TD\n  A --> B --> C'))).toEqual(['A>B', 'B>C'])
    expect(pairs(readFlowchart('flowchart TD\n  A --> B & C\n  B & C --> D'))).toEqual(['A>B', 'A>C', 'B>D', 'C>D'])
    const later = readFlowchart('flowchart TD\n  A --> B\n  A[First]\n  B{Second?}')
    expect(later.nodes).toEqual([{ key: 'A', shape: 'box', md: 'First' }, { key: 'B', shape: 'diamond', md: 'Second?' }])
  })

  it('reads every kind of link: plain, dotted, thick, with or without an arrow, longer, its words either way', () => {
    const chart = readFlowchart(
      ['flowchart TD', 'A --> B', 'A --- C', 'A -.-> D', 'A -.- E', 'A ==> F', 'A === G', 'A ----> H', 'A -- maybe --> I', 'A -. perhaps .-> J', 'A == surely ==> K', 'A ---|"both, here"| L'].join('\n'),
    )
    expect(chart.links).toEqual([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C', head: 'none' },
      { from: 'A', to: 'D', line: 'dotted' },
      { from: 'A', to: 'E', line: 'dotted', head: 'none' },
      { from: 'A', to: 'F', line: 'thick' },
      { from: 'A', to: 'G', line: 'thick', head: 'none' },
      { from: 'A', to: 'H' },
      { from: 'A', to: 'I', label: 'maybe' },
      { from: 'A', to: 'J', label: 'perhaps', line: 'dotted' },
      { from: 'A', to: 'K', label: 'surely', line: 'thick' },
      { from: 'A', to: 'L', label: 'both, here', head: 'none' },
    ])
  })

  it('reads a link both ways as two, and one written backwards as it points', () => {
    expect(pairs(readFlowchart('flowchart LR\nA <--> B'))).toEqual(['A>B', 'B>A'])
    expect(readFlowchart('flowchart LR\nA <-- B').links).toEqual([{ from: 'B', to: 'A' }])
  })

  it('mends what small models get wrong, as for a diagram', () => {
    // One dash, a label after its node, two dashes with a label, brackets in a box's words, a bare pair of dashes.
    expect(pairs(readFlowchart('flowchart TD\nA -> B'))).toEqual(['A>B'])
    expect(pairs(readFlowchart('flowchart TD\nA --> B |7|'))).toEqual(['A>B:7'])
    expect(readFlowchart('flowchart TD\nA --|7| B').links).toEqual([{ from: 'A', to: 'B', label: '7', head: 'none' }])
    expect(readFlowchart('flowchart TD\nA[Force (F)] --> B').nodes[0]).toEqual({ key: 'A', shape: 'box', md: 'Force (F)' })
    expect(readFlowchart('flowchart TD\nA -- B').links).toEqual([{ from: 'A', to: 'B', head: 'none' }])
  })

  it('reads one with no first line, in a code fence, with comments and front matter', () => {
    expect(pairs(readFlowchart('A[Start] --> B[End]'))).toEqual(['A>B'])
    expect(pairs(readFlowchart('```mermaid\nflowchart TD\n  %% the happy path\n  A --> B\n```'))).toEqual(['A>B'])
    expect(pairs(readFlowchart('---\ntitle: Plan\n---\nflowchart TD\nA --> B'))).toEqual(['A>B'])
  })

  it('makes the words plain: a line break a space, no HTML, entities as their characters, one line', () => {
    const chart = readFlowchart('flowchart TD\n  A["Line one<br/>line two"] --> B["<b>Bold</b> #quot;said#quot; &amp; #9829;"]\n  C["`**strong** words`"]')
    expect(chart.nodes.map((node) => node.md)).toEqual(['Line one line two', 'Bold "said" & ♥', '**strong** words'])
  })

  it('reads names with a hyphen or in any script, a ; inside a node’s words, and no spaces at all', () => {
    expect(pairs(readFlowchart('flowchart TD\n  step-1[Do the work] --> step-2[Check it]\n  step-2 -->|ok| done'))).toEqual(['step-1>step-2', 'step-2>done:ok'])
    expect(readFlowchart('flowchart TD\n  開始[開始 ✅] --> ende[Größe prüfen]').nodes).toEqual([
      { key: '開始', shape: 'box', md: '開始 ✅' },
      { key: 'ende', shape: 'box', md: 'Größe prüfen' },
    ])
    expect(readFlowchart('flowchart TD\n A[Do this; then that] --> B(Stop; rest); B --> C').nodes.map((node) => node.md)).toEqual(['Do this; then that', 'Stop; rest', 'C'])
    expect(pairs(readFlowchart('flowchart LR\nA[Start]-->B{Ok?}\nB-->|yes|C((Join))\nB-- no -->A'))).toEqual(['A>B', 'B>C:yes', 'B>A:no'])
    // An icon font's name before the words is not kept.
    expect(readFlowchart('graph LR\n  F[fa:fa-car Car]').nodes[0]!.md).toBe('Car')
  })

  it('reads Mermaid’s longer form of a shape', () => {
    const chart = readFlowchart('flowchart TD\n  A@{ shape: diamond, label: "Passed?" } --> B@{ shape: cyl, label: "Store" }\n  C@{ shape: something-new }')
    expect(chart.nodes).toEqual([
      { key: 'A', shape: 'diamond', md: 'Passed?' },
      { key: 'B', shape: 'cylinder', md: 'Store' },
      { key: 'C', shape: 'box', md: 'C' },
    ])
  })

  it('keeps no group, style or click, keeps the steps, and says what it left', () => {
    const chart = readFlowchart(
      ['flowchart TD', 'subgraph Review [The review]', '  direction LR', '  A --> B', 'end', 'classDef warm fill:#f96', 'class A warm', 'B:::warm --> C', 'style C fill:#bbf', 'click A href "https://example.com" _blank', 'click B call run()', 'A --o D', 'A --> B', 'D --> D', 'A ~~~ C'].join('\n'),
    )
    expect(chart.nodes.map((node) => node.key)).toEqual(['A', 'B', 'C', 'D'])
    expect(pairs(chart)).toEqual(['A>B', 'B>C', 'A>D'])
    expect(chart.left).toEqual([
      'the grouping of a subgraph (the steps in it are kept)',
      'colours and styles (classDef, class, style)',
      'click lines (a step never opens or runs anything)',
      'round and crossed ends of links (they are arrows)',
      'a second link between the same two steps',
      'a link from a step to itself',
      'hidden links (~~~)',
    ])
    // Nothing of a click is anywhere in what was read.
    expect(JSON.stringify(chart)).not.toMatch(/example\.com|run\(\)|href/u)
  })

  it('refuses a line that does not read, with its number and how one is written', () => {
    const open = refusal('flowchart TD\n  A[Start] --> B\n  B --> C[Unclosed')
    expect(open.code).toBe('content')
    expect(open.hint).toMatch(/^Line 3 of the flowchart does not read: C\[… is not closed with \]\. Write a step as A\[words\] and a link as A --> B/u)
    expect(refusal('flowchart TD\n  A -->').hint).toMatch(/^Line 2 .*a link leads nowhere/u)
    expect(refusal('flowchart TD\n  A B').hint).toMatch(/^Line 2 .*a link was expected at "B"/u)
    expect(refusal('flowchart TD\n  --> B').hint).toMatch(/^Line 2 .*a step's name was expected/u)
    expect(refusal('flowchart TD\n  A["Unclosed] --> B').hint).toMatch(/^Line 2 .*quote/u)
  })

  it('refuses another kind of diagram, an empty one, and one too large', () => {
    expect(refusal('pie title Votes\n  "Yes" : 3').hint).toMatch(/A board draws a flowchart, not a pie/u)
    expect(refusal('sequenceDiagram\n  A->>B: hi').hint).toMatch(/not a sequenceDiagram/u)
    expect(refusal('  \n').hint).toMatch(/is empty/u)
    expect(refusal('flowchart TD').hint).toMatch(/has no steps/u)
    const many = Array.from({ length: MAX_CHART_NODES + 1 }, (_, i) => `n${i}`)
    expect(refusal(`flowchart TD\n${many.join('\n')}`).hint).toMatch(/at most 500 steps/u)
    expect(refusal(`flowchart TD\n${many.slice(1, MAX_LINKS + 2).map((key) => `hub --> ${key}`).join('\n')}`).hint).toMatch(/points to more than 64 others/u)
    // As many as it takes are read.
    expect(readFlowchart(`flowchart TD\n${many.slice(0, MAX_CHART_NODES).join('\n')}`).nodes).toHaveLength(MAX_CHART_NODES)
  })

  it('never faults on what it is given: it reads it, or refuses it with a hint', () => {
    for (const src of ['flowchart TD\nA((', 'flowchart TD\nA@{', 'flowchart TD\n&', 'flowchart TD\nA --> |x', 'flowchart TD\n;;;', 'graph\n"', 'flowchart TD\nA[[[[', 'flowchart TD\nA -->|a|b|c| B', 'flowchart TD\nconstructor --> __proto__', 'flowchart TD\nA:::']) {
      try {
        readFlowchart(src)
      } catch (error) {
        expect(error, src).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).hint.length, src).toBeGreaterThan(20)
      }
    }
  })
})

describe('a board’s nodes written as Mermaid', () => {
  const nodes = Object.values(BOARD.block).filter((block): block is NodeBlock => block.type === 'node')

  it('are a line each with their shape’s brackets and plain words, then each link', () => {
    expect(writeFlowchart(nodes)).toBe(
      ['flowchart TD', '  s1(["Start"])', '  s2["Write the draft"]', '  s3{"Passed?"}', '  s4(["Publish"])', '  s1 --> s2', '  s2 --> s3', '  s3 -->|"yes"| s4', '  s3 -->|"no"| s2'].join('\n'),
    )
  })

  it('read back as they were: every shape, every kind of link, words with quotes and bars in them', () => {
    const all: Pick<NodeBlock, 'id' | 'shape' | 'md' | 'to'>[] = NodeShape.options.map((shape, i) => ({
      id: `id${i}`,
      shape,
      md: i === 3 ? 'She said "go" | stop' : `Step ${i}`,
      ...(i + 1 < NodeShape.options.length
        ? { to: [{ node: `id${i + 1}`, ...(i % 2 === 0 ? { label: i === 4 ? 'a "b" | c' : `way ${i}` } : {}), ...(i % 3 === 1 ? { line: 'dotted' as const } : i % 3 === 2 ? { line: 'thick' as const } : {}), ...(i % 4 === 3 ? { head: 'none' as const } : {}) }] }
        : {}),
    }))
    const back = readFlowchart(writeFlowchart(all, 'right'))
    expect(back.flow).toBe('right')
    expect(back.left).toEqual([])
    expect(back.nodes).toEqual(all.map((node, i) => ({ key: `s${i + 1}`, shape: node.shape, md: node.md })))
    expect(back.links).toEqual(
      all.flatMap((node, i) =>
        (node.to ?? []).map((link) => ({ from: `s${i + 1}`, to: `s${i + 2}`, ...(link.label === undefined ? {} : { label: link.label.replace(/\|/gu, '/') }), ...(link.line === undefined ? {} : { line: link.line }), ...(link.head === undefined ? {} : { head: link.head }) })),
      ),
    )
    // Written again from what was read, it is the same text.
    const again = writeFlowchart(back.nodes.map((node) => ({ id: node.key, shape: node.shape, md: node.md, to: back.links.filter((link) => link.from === node.key).map((link) => ({ node: link.to, ...(link.label === undefined ? {} : { label: link.label }), ...(link.line === undefined ? {} : { line: link.line }), ...(link.head === undefined ? {} : { head: link.head }) })) })), 'right')
    expect(readFlowchart(again)).toEqual(back)
  })

  it('leave out a link to a node that is not among them', () => {
    expect(writeFlowchart(nodes.slice(0, 2))).toBe(['flowchart TD', '  s1(["Start"])', '  s2["Write the draft"]', '  s1 --> s2'].join('\n'))
  })
})
