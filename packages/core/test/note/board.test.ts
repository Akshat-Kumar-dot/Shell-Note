// A board's commands made into the note's own operations (the Board, step 2): a step added after, before or alone, a
// link made, changed and taken away, a step's look, a whole flowchart from its Mermaid, the chart laid out again; a
// step named in words; and the note's other commands as they work on a board. Code does every place.
import { describe, expect, it } from 'vitest'
import { apply } from '../../src/apply.js'
import { route } from '../../src/command/router.js'
import { typed } from '../../src/command/terminal.js'
import { COMMANDS } from '../../src/command/all.js'
import { idTaken } from '../../src/ids.js'
import { compileNote, type NoteInput } from '../../src/note/compile.js'
import { referTo } from '../../src/note/refer.js'
import type { Doc, NodeBlock } from '../../src/schema/doc.js'
import { validateDoc } from '../../src/validate/doc.js'
import { BOARD, MIXED } from '../fixtures/index.js'

const context = (doc: Doc) => ({ page: 1, taken: (id: string) => idTaken(doc, id) })
const run = (command: string, input: NoteInput, doc: Doc = BOARD, near?: { x: number; y: number }) => {
  const compiled = compileNote(doc, command, input, { ...context(doc), ...(near ? { near } : {}) })
  const after = apply(doc, compiled.ops).doc
  validateDoc(after)
  return { ...compiled, doc: after }
}
const node = (doc: Doc, id: string): NodeBlock => doc.block[id] as NodeBlock
const refusal = (command: string, input: NoteInput, doc: Doc = BOARD): string => {
  try {
    compileNote(doc, command, input, context(doc))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('It was not refused.')
}
const apart = (a: NodeBlock, b: NodeBlock): boolean => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y

describe('board.add', () => {
  it('puts a step between a step and its one next, the rest moving along, the link’s words kept', () => {
    const { doc, made, said } = run('board.add', { after: 'n2', words: 'Spell check' })
    const id = made[0]!
    expect(node(doc, 'n2').to).toEqual([{ node: id }])
    expect(node(doc, id)).toMatchObject({ shape: 'box', md: 'Spell check', to: [{ node: 'n3' }] })
    expect(node(doc, 'n3').y).toBeGreaterThan(node(BOARD, 'n3').y)
    expect(apart(node(doc, id), node(doc, 'n3'))).toBe(true)
    expect(said).toBe(`added the step “Spell check” (${id}) after n2`)
  })

  it('after a decision, adds one more branch; before a step, takes its place', () => {
    const branch = run('board.add', { after: 'the diamond', words: 'Ask again', shape: 'round' })
    expect(node(branch.doc, 'n3').to!.map((link) => link.node)).toEqual(['n4', 'n2', branch.made[0]])
    const before = run('board.add', { before: 'n1', words: 'Idea' })
    expect(node(before.doc, before.made[0]!).to).toEqual([{ node: 'n1' }])
  })

  it('alone, goes where the board has room near the middle of the view, with no words yet when none are given', () => {
    const { doc, made, said } = run('board.add', { colour: 'green' }, BOARD, { x: 30000, y: 30000 })
    const step = node(doc, made[0]!)
    expect(step).toMatchObject({ md: '', color: 'green', shape: 'box' })
    expect(Math.abs(step.x + step.w / 2 - 30000)).toBeLessThan(100)
    expect(said).toBe(`added the step with no words yet (${made[0]!}) on its own, where the board has room`)
  })

  it('is refused on a note of pages, with what to do there', () => {
    expect(refusal('board.add', { words: 'One' }, MIXED)).toMatch(/not a board.*note\.new type=board.*diagram: add/su)
  })
})

describe('board.link and board.unlink', () => {
  it('join two steps named in words, with words on the link', () => {
    const { doc, said } = run('board.link', { from: 'the step Publish', to: 'the first step', label: 'next post' })
    expect(node(doc, 'n4').to).toEqual([{ node: 'n1', label: 'next post' }])
    expect(said).toBe('linked n4 → n1 (“next post”)')
  })

  it('change only what is given of a link there already, and say when nothing changed', () => {
    const curved = run('board.link', { from: 'n3', to: 'n4', route: 'curved', arrow: false })
    expect(node(curved.doc, 'n3').to![0]).toEqual({ node: 'n4', label: 'yes', path: 'curved', head: 'none' })
    const back = run('board.link', { from: 'n3', to: 'n4', route: 'angled', arrow: true, label: '' }, curved.doc)
    expect(node(back.doc, 'n3').to![0]).toEqual({ node: 'n4' })
    expect(run('board.link', { from: 'n1', to: 'n2' }).said).toBe('n1 → n2 is so already: nothing changed')
  })

  it('refuse a link to itself, and to what is not a step', () => {
    expect(refusal('board.link', { from: 'n1', to: 'n1' })).toMatch(/does not lead to itself/u)
    expect(refusal('board.link', { from: 'n1', to: 'f1' })).toMatch(/f1 is not a step.*a link joins two steps/su)
  })

  it('take a link away, and say the other way round when only that one is there', () => {
    const { doc } = run('board.unlink', { from: 'n3', to: 'n2' })
    expect(node(doc, 'n3').to).toEqual([{ node: 'n4', label: 'yes' }])
    expect(run('board.unlink', { from: 'n2', to: 'n4' }).said).toBe('n2 does not lead to n4: nothing changed')
    expect(run('board.unlink', { from: 'n2', to: 'n3' }, doc).ops).toHaveLength(1)
    expect(run('board.unlink', { from: 'n3', to: 'n2' }, doc).said).toBe('n3 does not lead to n2; n2 leads to n3: board: unlink from=n2 to=n3: nothing changed')
  })
})

describe('board.look', () => {
  it('changes a step’s shape and colour, its size fitting its words in the new shape', () => {
    const { doc, said } = run('board.look', { block: 'Write the draft', shape: 'diamond', colour: 'red' })
    expect(node(doc, 'n2')).toMatchObject({ shape: 'diamond', color: 'red' })
    expect(node(doc, 'n2').w).toBeGreaterThan(node(BOARD, 'n2').w)
    expect(said).toBe('n2: shape diamond, colour red')
  })

  it('takes a colour away with the usual ink, and asks for a look when none is said', () => {
    expect(node(run('board.look', { block: 'n3', colour: 'ink' }).doc, 'n3').color).toBeUndefined()
    expect(refusal('board.look', { block: 'n3' })).toMatch(/Say the look/u)
  })
})

describe('board.draw and board.tidy', () => {
  it('draws a whole flowchart from its Mermaid, its slips mended, and says what a board does not keep', () => {
    const { doc, made, said } = run('board.draw', { words: 'flowchart LR\n  A[Plan] --> B[Do]\n  B --> C{Done?}\n  C -->|no| A\n  classDef red fill:#f00' }, BOARD, { x: 40000, y: 0 })
    expect(made).toHaveLength(3)
    expect(node(doc, made[0]!).to).toEqual([{ node: made[1] }])
    expect(node(doc, made[2]!).to).toEqual([{ node: made[0], label: 'no' }])
    for (const id of made) for (const old of ['n1', 'n2', 'n3', 'n4']) expect(apart(node(doc, id), node(doc, old))).toBe(true)
    expect(said).toMatch(/^drew a flowchart of 3 steps \(.*\); not kept: /u)
  })

  it('refuses words that are no flowchart, and draws one asked for as a diagram on a board', () => {
    expect(refusal('board.draw', { words: 'not a flowchart at all' })).toBeTruthy()
    const diagram = run('diagram.add', { words: 'flowchart TD\n  A --> B' })
    expect(diagram.made.every((id) => diagram.doc.block[id]?.type === 'node')).toBe(true)
  })

  it('lays the chart out again, a way given or the way it runs', () => {
    const across = run('board.tidy', { flow: 'right' })
    expect(node(across.doc, 'n2').x).toBeGreaterThan(node(across.doc, 'n1').x)
    expect(across.said).toBe('laid the flowchart out again, running right')
    const again = run('board.tidy', { flow: 'right' }, across.doc)
    expect(again.said).toBe('the flowchart is laid out so already: nothing changed')
  })
})

describe('a step named in words', () => {
  const id = (written: string): string => {
    const found = referTo(BOARD, written, { page: 1 })
    return found.ok ? found.id : `refused: ${found.why}`
  }

  it('by its place in the chart, its shape, or its words with or without a kind', () => {
    expect(id('the first step')).toBe('n1')
    expect(id('step 2')).toBe('n2')
    expect(id('the last step')).toBe('n4')
    expect(id('the diamond')).toBe('n3')
    expect(id('the decision')).toBe('n3')
    expect(id('the step Publish')).toBe('n4')
    expect(id('the Passed step')).toBe('n3')
    expect(id('Write the draft')).toBe('n2')
    expect(id('Remember the deadline')).toBe('t1')
  })

  it('offers each that fits when several do, and lists the steps when none does', () => {
    expect(id('the pill')).toMatch(/^refused: 2 steps fit "the pill": n1 \(pill “Start”\), n4 \(pill “Publish”\)/u)
    expect(id('the step Banana')).toMatch(/^refused: No step of the board is "the step Banana"\. Its steps: n1 \(pill “Start”\)/u)
  })
})

describe('the note’s other commands, on a board', () => {
  it('rewrite a step’s words, one line, its size fitting them', () => {
    const { doc, said } = run('text.rewrite', { block: 'n4', words: 'Publish it on the website\nfor everyone' })
    expect(node(doc, 'n4').md).toBe('Publish it on the website for everyone')
    expect(node(doc, 'n4').w).toBeGreaterThan(node(BOARD, 'n4').w)
    expect(said).toBe('rewrote the step n4: “Publish it on the website for everyone”')
  })

  it('refuse to move a step by words, saying what moves it', () => {
    expect(refusal('block.move', { block: 'n2', beside: 'n3' })).toMatch(/n2 is a step: its place follows its links/u)
  })

  it('remove a step with its links and the ink on it', () => {
    const { doc } = run('block.remove', { block: 'the diamond' })
    expect(doc.block.n3).toBeUndefined()
    expect(doc.block.k1).toBeUndefined()
    expect(node(doc, 'n2').to).toBeUndefined()
  })
})

describe('the board’s commands, said in words', () => {
  const found = async (operation: string, given: Record<string, unknown> = {}): Promise<string> => {
    const routed = await route('board', operation, given)
    return routed.kind === 'found' ? routed.command : routed.kind
  }

  it('are found in their area by the words people use', async () => {
    expect(await found('add', { after: 'n2' })).toBe('board.add')
    expect(await found('connect', { from: 'n1', to: 'n3' })).toBe('board.link')
    expect(await found('disconnect', { from: 'n1', to: 'n3' })).toBe('board.unlink')
    expect(await found('make it a diamond', { block: 'n2' })).toBe('board.look')
    expect(await found('tidy up')).toBe('board.tidy')
    expect(await found('remove', { block: 'n3' })).toBe('block.remove')
  })

  it('take a step’s shape in a flowchart’s own words', () => {
    const look = COMMANDS.find((spec) => spec.name === 'board.look')!
    expect(typed(look, { block: 'n2', shape: 'decision' })).toEqual({ block: 'n2', shape: 'diamond' })
    expect(typed(look, { block: 'n2', shape: 'Rectangle' })).toEqual({ block: 'n2', shape: 'box' })
  })
})
