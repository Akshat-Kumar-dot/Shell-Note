// A Select box (protocol v1.1): new things go only into it, and the scope
// check refuses an edit that changes or adds anything outside the selection.
import { describe, expect, it } from 'vitest'
import {
  apply,
  makeAliases,
  outsideScope,
  parseInline,
  plainText,
  removalOps,
  runEdit,
  sameOutside,
  userPrompt,
  type Caps,
  type CompleteRequest,
  type Doc,
  type Frame,
  type Model,
  type Selection,
  type TextBlock,
  type WordRange,
} from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'

function piece(text: string, doc: Doc = PHYSICS, block = 't2'): WordRange {
  const start = plainText(parseInline((doc.block[block] as TextBlock).md)).indexOf(text)
  return { block, start, end: start + text.length }
}
const md = (doc: Doc, id: string): string => (doc.block[id] as TextBlock).md
const plain = (doc: Doc, id: string): string => plainText(parseInline(md(doc, id)))
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

const box = { page: 'p1', x: 2000, y: 2000, w: 17000, h: 3000 }
const emptyPaper = { page: 'p1', x: 2000, y: 23000, w: 8000, h: 3000 }

describe('a Select box', () => {
  const prompt = (selection: Selection): string => userPrompt({ doc: PHYSICS, selection, aliases: makeAliases(PHYSICS, selection), instruction: 'x' })

  it('tells the model where new things go: after the chosen words or blocks, or on the empty paper', () => {
    expect(prompt({ blocks: [], words: [piece('force')], here: box })).toContain('HERE: after the chosen words')
    expect(prompt({ blocks: ['t1'], here: box })).toContain('HERE: after the chosen blocks')
    expect(prompt({ blocks: [], here: emptyPaper })).toContain('HERE: an empty area of the page')
    // The box ends with what it holds last: words of t2, then the whole formula m1.
    expect(prompt({ blocks: ['m1'], words: [piece('force')], here: box })).toContain('HERE: after the chosen blocks')
  })

  it('puts new words right after the chosen words, and shows the writer the words they follow', async () => {
    const model = scripted(['{"ops":[{"op":"insert","at":"here","kind":"text"}]}', 'or a pull'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: [], words: [piece('force')], here: box }, instruction: 'add "or a pull" after it', model, tier0: false })
    expect(plain(out.doc, 't2')).toBe('An object at rest stays at rest unless a force or a pull acts on it.')
    expect((out.doc.block.f1 as Frame).kids).toEqual(['t1', 't2', 'm1'])
    expect(model.asked[1]!.messages[1]!.content).toContain('CHOSEN WORDS\nforce\n')
  })

  it('puts a table, a diagram or a formula right after the paragraph the words are in', async () => {
    const out = await runEdit({
      doc: PHYSICS,
      selection: { blocks: [], words: [piece('object'), piece('force')], here: box },
      instruction: 'add a table of forces here',
      model: scripted(['{"ops":[{"op":"insert","at":"here","kind":"table"}]}', '| Force | Unit |\n| --- | --- |\n| Weight | N |']),
      tier0: false,
    })
    const kids = (out.doc.block.f1 as Frame).kids
    expect(kids.slice(0, 2)).toEqual(['t1', 't2'])
    expect(out.doc.block[kids[2]!]).toMatchObject({ type: 'table', rows: [['Force', 'Unit'], ['Weight', 'N']] })
    expect(kids[3]).toBe('m1')
  })

  it('on empty paper, fills the box', async () => {
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: [], here: emptyPaper }, instruction: 'draw the steps here', model: scripted(['{"ops":[{"op":"insert","at":"here","kind":"diagram"}]}', 'flowchart LR\n  A --> B']) })
    const diagram = Object.values(out.doc.block).find((b) => b.type === 'diagram')
    expect(diagram).toMatchObject({ page: 'p1', x: 2000, y: 23000, w: 8000, h: 3000, src: 'flowchart LR\n  A --> B' })
  })

  it('offers no neighbour as a place: new things go "here"', async () => {
    const model = scripted(['{"ops":[{"op":"insert","at":"after","ref":"b","kind":"text"}]}', '{"ops":[{"op":"none","why":"x"}]}'])
    await runEdit({ doc: PHYSICS, selection: { blocks: [], words: [piece('force')], here: box }, instruction: 'add a line after the formula', model, tier0: false })
    expect(model.asked[1]!.messages.at(-1)!.content).toContain('{"error":"unknown_id","got":"b","hint":"Inside the box, new things go only \\"here\\": give \\"at\\":\\"here\\" and no \\"ref\\"."}')
  })
})

describe('the scope check', () => {
  const words: Selection = { blocks: [], words: [piece('object'), piece('force')], here: box }
  const aliases = makeAliases(PHYSICS, words)
  const after = (ops: Parameters<typeof apply>[1]): Doc => apply(PHYSICS, ops).doc

  it('lets the chosen words change, grow and go, and new words follow them', () => {
    expect(outsideScope(PHYSICS, after([{ op: 'splice', id: 't2', field: 'md', at: 3, del: 6, ins: 'heavy object' }]), words, aliases)).toBeNull()
    expect(outsideScope(PHYSICS, after(removalOps(PHYSICS, [], words.words!)), words, aliases)).toBeNull()
  })

  it('refuses a change to the text around the chosen words, or to their block', () => {
    expect(outsideScope(PHYSICS, after([{ op: 'splice', id: 't2', field: 'md', at: 0, del: 2, ins: 'One' }]), words, aliases)).toBe(
      'Only the chosen words of a may change: the rest of its text, and the block itself, stay as they are.',
    )
    expect(outsideScope(PHYSICS, after([{ op: 'update', id: 't2', set: { role: 'h2' } }]), words, aliases)).toMatch(/^Only the chosen words of a may change/)
  })

  it('refuses a change to a block that was not selected, or its removal', () => {
    expect(outsideScope(PHYSICS, after([{ op: 'update', id: 't1', set: { style: { color: 'red' } } }]), words, aliases)).toBe('Only what is selected may change: leave the other blocks as they are.')
    expect(outsideScope(PHYSICS, after([{ op: 'remove', id: 'm1' }]), words, aliases)).toBe('Only what is selected may be removed.')
    expect(outsideScope(PHYSICS, after([{ op: 'update', id: PHYSICS.id, set: { title: 'New' } }]), words, aliases)).toMatch(/title and rules are not part of the selection/)
  })

  it('refuses a new block outside the box, or next to what was not chosen', () => {
    const outside = { op: 'add' as const, block: { id: 'nm', r: 0, type: 'math' as const, page: 'p1', x: 2000, y: 23000, w: 4000, h: 1500, tex: 'x' } }
    expect(outsideScope(PHYSICS, after([outside]), words, aliases)).toBe('New things go only into the box, or right below what it holds.')
    const afterHeading = { op: 'add' as const, block: { id: 'nt', r: 0, type: 'text' as const, parent: 'f1', role: 'p' as const, indent: 0, md: 'x' }, at: 1 }
    expect(outsideScope(PHYSICS, after([afterHeading]), words, aliases)).toBe('A new block goes only next to what is selected.')
    const afterWords = { ...afterHeading, at: 2 }
    expect(outsideScope(PHYSICS, after([afterWords]), words, aliases)).toBeNull()
  })

  it('lets convert put new blocks in the place of chosen ones', () => {
    const selection: Selection = { blocks: ['t2'], here: box }
    const converted = after([
      { op: 'add', block: { id: 'l1', r: 0, type: 'text', parent: 'f1', role: 'li', indent: 0, md: 'one' }, at: 1 },
      { op: 'add', block: { id: 'l2', r: 0, type: 'text', parent: 'f1', role: 'li', indent: 0, md: 'two' }, at: 2 },
      { op: 'remove', id: 't2' },
    ])
    expect(outsideScope(PHYSICS, converted, selection, makeAliases(PHYSICS, selection))).toBeNull()
  })

  it('compares formatting too, letter by letter', () => {
    const words = [{ block: 't2', start: 3, end: 9 }]
    expect(sameOutside('An object at **rest**', 'An thing at **rest**', words)).toBe(true)
    expect(sameOutside('An object at **rest**', 'An thing at rest', words)).toBe(false)
    expect(sameOutside('An object at rest', 'An object at rest, added', words)).toBe(false)
    expect(sameOutside('An object at rest', 'An at rest', words)).toBe(true)
    // Two words cut from one sentence: the text between them loses a space, and the
    // stretch must be matched where it ends earliest (found by the benchmark's oracle).
    const two = [
      { block: 't2', start: 3, end: 9 },
      { block: 't2', start: 18, end: 23 },
    ]
    expect(sameOutside('An object at rest stays at rest unless a force acts.', 'An at rest at rest unless a force acts.', two)).toBe(true)
    expect(sameOutside('An object at rest stays at rest unless a force acts.', 'An at rest at rest unless a push acts.', two)).toBe(false)
  })
})
