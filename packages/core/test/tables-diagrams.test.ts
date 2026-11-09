// Protocol v1.1: tables written as pipe tables, and diagrams of three kinds.
import { describe, expect, it } from 'vitest'
import {
  apply,
  cleanContent,
  diagramHint,
  diagramKind,
  GRAPHS_LATER,
  mendFlowchart,
  plotsEquation,
  runEdit,
  type Caps,
  type CompleteRequest,
  type Doc,
  type Frame,
  type Model,
  type TableBlock,
} from '../src/index.js'
import { MIXED, PHYSICS } from './fixtures/index.js'

function scripted(replies: string[], caps: Partial<Caps> = {}): Model & { asked: CompleteRequest[] } {
  const asked: CompleteRequest[] = []
  return {
    name: 'scripted',
    caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'full', ...caps },
    asked,
    async complete(request) {
      asked.push(request)
      return { text: replies.shift() ?? '', tokensIn: 10, tokensOut: 5, ms: 1 }
    },
  }
}

const MOONS = '| Planet | Moons |\n| --- | --- |\n| Earth | 1 |\n| Mars | 2 |'
/** PHYSICS with a table after the formula, its columns at 60% and 40%. */
const WITH_TABLE: Doc = apply(PHYSICS, [
  { op: 'add', block: { id: 'tb', r: 0, type: 'table', parent: 'f1', rows: [['Planet', 'Moons'], ['Earth', '1']], head: true, cols: [600, 400] }, at: 3 },
]).doc

describe('tables', () => {
  it('are inserted from a pipe table the content step writes', async () => {
    const model = scripted(['{"ops":[{"op":"insert","at":"after","ref":"a","kind":"table"}]}', `Here is the table:\n\`\`\`\n${MOONS}\n\`\`\``])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'add a table of the moons of Earth and Mars after this', model })
    expect(model.asked[1]!.messages[0]!.content).toContain('Write one table as a Markdown pipe table')
    const frame = out.doc.block.f1 as Frame
    const added = out.doc.block[frame.kids[2]!] as TableBlock
    expect(added).toMatchObject({ type: 'table', parent: 'f1', head: true, rows: [['Planet', 'Moons'], ['Earth', '1'], ['Mars', '2']] })
  })

  it('go in a new frame on empty paper, as text does', async () => {
    const here = { page: 'p1', x: 2000, y: 23000, w: 8000, h: 3000 }
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: [], here }, instruction: 'a table of the planets here', model: scripted(['{"ops":[{"op":"insert","at":"here","kind":"table"}]}', MOONS]) })
    const frame = Object.values(out.doc.block).find((b): b is Frame => b.type === 'frame' && b.id !== 'f1')!
    expect(frame).toMatchObject({ page: 'p1', x: 2000, y: 23000, w: 8000 })
    expect(out.doc.block[frame.kids[0]!]).toMatchObject({ type: 'table', rows: [['Planet', 'Moons'], ['Earth', '1'], ['Mars', '2']] })
  })

  it('are rewritten as a whole pipe table; new columns get equal widths', async () => {
    const same = await runEdit({ doc: WITH_TABLE, selection: { blocks: ['tb'] }, instruction: 'add Mars', model: scripted(['{"ops":[{"op":"rewrite","id":"a"}]}', MOONS]) })
    expect(same.doc.block.tb).toMatchObject({ rows: [['Planet', 'Moons'], ['Earth', '1'], ['Mars', '2']], head: true, cols: [600, 400] })
    const wider = await runEdit({
      doc: WITH_TABLE,
      selection: { blocks: ['tb'] },
      instruction: 'add a column for rings',
      model: scripted(['{"ops":[{"op":"rewrite","id":"a"}]}', '| Planet | Moons | Rings |\n| --- | --- | --- |\n| Earth | 1 | no |']),
    })
    expect(wider.doc.block.tb).toMatchObject({ rows: [['Planet', 'Moons', 'Rings'], ['Earth', '1', 'no']] })
    expect(wider.doc.block.tb).not.toHaveProperty('cols')
  })

  it('are made from paragraphs by convert, for the full set', async () => {
    const out = await runEdit({
      doc: MIXED,
      selection: { blocks: ['p2'] },
      instruction: 'turn this into a table',
      model: scripted(['{"ops":[{"op":"convert","ids":["a"],"into":"table"}]}', '| Item | Price |\n| --- | --- |\n| Tea | $5 |']),
    })
    expect(out.doc.block.p2).toBeUndefined()
    const made = Object.values(out.doc.block).find((b) => b.type === 'table')
    expect(made).toMatchObject({ parent: 'fa', rows: [['Item', 'Price'], ['Tea', '$5']] })
  })

  it('that are not pipe tables get one rewrite, told why, then stop the edit', async () => {
    const model = scripted(['{"ops":[{"op":"insert","at":"after","ref":"a","kind":"table"}]}', 'Earth has 1 moon and Mars has 2.', MOONS])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'add a table of moons after this', model })
    expect(model.asked[2]!.messages[1]!.content).toContain('Your last answer was refused: Write the table as a Markdown pipe table')
    expect(Object.values(out.doc.block).some((b) => b.type === 'table')).toBe(true)
    const stubborn = await runEdit({
      doc: PHYSICS,
      selection: { blocks: ['t2'] },
      instruction: 'add a table of moons after this',
      model: scripted(['{"ops":[{"op":"insert","at":"after","ref":"a","kind":"table"}]}', 'no table', 'still none']),
    })
    expect(stubborn.error).toMatch(/^content: Write the table as a Markdown pipe table/)
    expect(stubborn.doc).toBe(PHYSICS)
  })
})

describe('a flowchart with a slip', () => {
  // Each slip was refused by Mermaid 11.17.2, and each mended line parsed (checked 11 October 2026).
  it('is mended so that it draws: weights, arrows, bare dashes and a label in the wrong place', () => {
    expect(mendFlowchart('flowchart LR\n  1 --|3| 2\n  2 --|3| 4')).toBe('flowchart LR\n  1 ---|3| 2\n  2 ---|3| 4')
    expect(mendFlowchart('flowchart LR\n  A --|7|> B')).toBe('flowchart LR\n  A -->|7| B')
    expect(mendFlowchart('flowchart LR\n  A -> B')).toBe('flowchart LR\n  A --> B')
    expect(mendFlowchart('flowchart LR\n  A -- B')).toBe('flowchart LR\n  A --- B')
    expect(mendFlowchart('flowchart LR\n  A --> B |3|')).toBe('flowchart LR\n  A -->|3| B')
  })

  it("puts a box's words in quotes when they have brackets, which Mermaid would read as a shape", () => {
    // As gemma-4-e2b wrote them in the benchmark.
    expect(mendFlowchart('flowchart LR\n  B -- Yes --> C[Net Force (F) acts on mass (m)]\n  C --> D[Acceleration (a) = F/m]')).toBe(
      'flowchart LR\n  B -- Yes --> C["Net Force (F) acts on mass (m)"]\n  C --> D["Acceleration (a) = F/m"]',
    )
    expect(mendFlowchart('flowchart LR\n  B --> C[todo [ ] Finish problem set 3]\n  C --> D[ASK]')).toBe('flowchart LR\n  B --> C["todo [ ] Finish problem set 3"]\n  C --> D[ASK]')
    expect(mendFlowchart('flowchart TD\n  A[Push (F)]-->B{Moves (yes or no)?}&C(Rest (v = 0)):::calm')).toBe(
      'flowchart TD\n  A["Push (F)"]-->B{"Moves (yes or no)?"}&C("Rest (v = 0)"):::calm',
    )
  })

  it('keeps every line Mermaid reads already, and every other kind of diagram, as written', () => {
    const fine = 'flowchart LR\n  A -- text --- B\n  A -.-> C\n  A ---|5| D\n  A -->|6| E\n  A <--> F'
    expect(mendFlowchart(fine)).toBe(fine)
    const shapes = 'flowchart LR\n  A[Source] --> B{Ok?}\n  B --> C["Force (F)"]\n  C --> D[(Store)]\n  D --> E([Stop])\n  E --> F((Hub))\n  F --> G{{Choose}}\n  G --> H[/Slope (m)/]'
    expect(mendFlowchart(shapes)).toBe(shapes)
    expect(mendFlowchart('pie title X\n  "a --|b|" : 1')).toBe('pie title X\n  "a --|b|" : 1')
    // The writing step mends what it cleans.
    expect(cleanContent('diagram', '```mermaid\nflowchart LR\n  1 --|3| 2\n```')).toBe('flowchart LR\n  1 ---|3| 2')
  })
})

describe('diagrams', () => {
  it('declare their kind on the first line', () => {
    expect(['flowchart LR\n  A --> B', 'graph TD\n  A --> B', 'pie title Votes\n  "Yes" : 3', 'xychart-beta\n  bar [1, 2]', '---\ntitle: Steps\n---\n%% a comment\nflowchart LR\n  A --> B'].map(diagramKind)).toEqual([
      'flowchart',
      'flowchart',
      'pie',
      'xychart',
      'flowchart',
    ])
    expect(diagramKind('sequenceDiagram\n  A->>B: hi')).toBe('sequenceDiagram')
    expect(diagramKind('')).toBeUndefined()
  })

  it('may be written in three kinds, or keep the kind they have when changed', () => {
    expect(diagramHint('flowchart LR\n  A --> B')).toBeNull()
    expect(diagramHint('sequenceDiagram\n  A->>B: hi')).toBe('Write a flowchart, a pie or an xychart, not a sequenceDiagram.')
    expect(diagramHint('sequenceDiagram\n  A->>B: hi', 'sequenceDiagram')).toBeNull()
    expect(diagramHint('mindmap\n  root', 'sequenceDiagram')).toBe('Write a flowchart, a pie or an xychart, or keep it a sequenceDiagram, not a mindmap.')
    expect(diagramHint('A --> B')).toBe('Start with the diagram\'s kind on the first line: flowchart, pie or xychart.')
  })

  it('of equations are not drawn yet: code says so, with no model call', async () => {
    expect(['plot y = x^2 here', 'draw a graph of y = 2x + 1', 'sketch the graph of sin(x)', 'graph f(x) = x²', 'draw a parabola'].map(plotsEquation)).toEqual([true, true, true, true, true])
    expect(['draw a flowchart of the steps', 'make a bar chart of the rainfall', 'plot the results in a pie chart', 'what is y = mx + c?'].map(plotsEquation)).toEqual([false, false, false, false])
    const model = scripted([])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: [], here: { page: 'p1', x: 2000, y: 23000, w: 8000, h: 3000 } }, instruction: 'plot y = x^2 here', model })
    expect(out).toMatchObject({ tier: 0, calls: 0, declined: GRAPHS_LATER, doc: PHYSICS })
    expect(out.log).toMatchObject({ result: 'declined', model: 'tier0' })
  })

  it('are tidied: a code fence or a line naming the language goes', () => {
    expect(cleanContent('diagram', 'mermaid\nflowchart LR\n  A --> B')).toBe('flowchart LR\n  A --> B')
    expect(cleanContent('table', '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```')).toBe('| a | b |\n|---|---|\n| 1 | 2 |')
  })

  it('of another kind get one rewrite, told the three kinds', async () => {
    const model = scripted(['{"ops":[{"op":"insert","at":"after","ref":"a","kind":"diagram"}]}', 'sequenceDiagram\n  Force->>Motion: changes', 'flowchart LR\n  Force --> Motion'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'add a diagram of how a force changes motion after this', model })
    expect(model.asked[2]!.messages[1]!.content).toContain('Your last answer was refused: Write a flowchart, a pie or an xychart, not a sequenceDiagram. Write it again.')
    expect(Object.values(out.doc.block).find((b) => b.type === 'diagram' && b.id !== 'dc')).toMatchObject({ src: 'flowchart LR\n  Force --> Motion' })
    expect(out.retries).toBe(1)
  })

  it('keep their own kind when changed, and pass the parse check the caller gives', async () => {
    const kept = await runEdit({ doc: MIXED, selection: { blocks: ['df'] }, instruction: 'add a reply from the teacher', model: scripted(['{"ops":[{"op":"rewrite","id":"a"}]}', 'sequenceDiagram\n  Student->>Teacher: Why?\n  Teacher->>Student: Because.']) })
    expect(kept.doc.block.df).toMatchObject({ src: 'sequenceDiagram\n  Student->>Teacher: Why?\n  Teacher->>Student: Because.' })

    const checked: string[] = []
    const mermaid = async (src: string): Promise<string | null> => {
      checked.push(src)
      return src.includes('-->>') ? 'Line 2: "-->>" is not an arrow in a flowchart.' : null
    }
    const model = scripted(['{"ops":[{"op":"insert","at":"after","ref":"a","kind":"diagram"}]}', 'flowchart LR\n  A -->> B', 'flowchart LR\n  A --> B'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'add a diagram after this', model, checks: { mermaid } })
    expect(checked).toEqual(['flowchart LR\n  A -->> B', 'flowchart LR\n  A --> B'])
    expect(model.asked[2]!.messages[1]!.content).toContain('Line 2: "-->>" is not an arrow in a flowchart.')
    expect(Object.values(out.doc.block).some((b) => b.type === 'diagram' && b.id !== 'dc' && b.src === 'flowchart LR\n  A --> B')).toBe(true)
  })
})
