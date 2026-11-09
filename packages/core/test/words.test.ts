// Words chosen inside a block (protocol v1.1): each piece is its own item for
// the model, and mark, colour, rewrite and delete act on it alone.
import { describe, expect, it } from 'vitest'
import {
  makeAliases,
  parseInline,
  parseReply,
  plainText,
  runEdit,
  tier0,
  userPrompt,
  type Caps,
  type CompleteRequest,
  type Doc,
  type Model,
  type Selection,
  type TextBlock,
  type WordRange,
} from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'

/** t2 reads "An object at rest stays at rest unless a force acts on it.", with "force" in bold. */
function piece(text: string, doc: Doc = PHYSICS, block = 't2'): WordRange {
  const start = plainText(parseInline((doc.block[block] as TextBlock).md)).indexOf(text)
  return { block, start, end: start + text.length }
}

const md = (doc: Doc, id: string): string => (doc.block[id] as TextBlock).md
const box = { page: 'p1', x: 2000, y: 2000, w: 17000, h: 3000 }

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

describe('words chosen inside a block', () => {
  const inBox: Selection = { blocks: ['t1'], words: [piece('object'), piece('force')], here: box }

  it('get an alias each, in reading order, standing for their block in the log', () => {
    const aliases = makeAliases(PHYSICS, inBox)
    expect(aliases.selected).toEqual([
      { alias: 'a', id: 't1' },
      { alias: 'b', id: 't2', words: piece('object') },
      { alias: 'c', id: 't2', words: piece('force') },
    ])
    expect(aliases.blocks).toEqual(['a'])
    expect(aliases.pieces).toEqual(['b', 'c'])
    expect(aliases.id('c')).toBe('t2')
    expect(aliases.words('c')).toEqual(piece('force'))
    expect(aliases.alias('t2')).toBe('b')
    // In a box, new things go only "here": no neighbour, and no words, is a place.
    expect(aliases.near).toEqual([{ alias: 'd', id: 'm1', side: 'after' }])
    expect(aliases.refs).toEqual(['a'])
    // Outside a box, words stand for their block as a place, and so do the neighbours.
    expect(makeAliases(PHYSICS, { blocks: ['t1'], words: inBox.words! }).refs).toEqual(['a', 'b', 'c', 'd'])
  })

  it('show the model the words and the text around them', () => {
    const user = userPrompt({ doc: PHYSICS, selection: inBox, aliases: makeAliases(PHYSICS, inBox), instruction: 'bold these' })
    expect(user).toContain('SELECTED\na h2 Newton\'s laws\nb words "object" in: "An object at rest stays at rest unless a force acts on it."\nc words "force" in: ')
    const long: Doc = { ...PHYSICS, block: { ...PHYSICS.block, t2: { ...(PHYSICS.block.t2 as TextBlock), md: `${'Words that run on and on. '.repeat(6)}The key point is here. ${'More words after it, many of them. '.repeat(4)}` } } }
    const aliases = makeAliases(long, { blocks: [], range: piece('key point', long) })
    expect(userPrompt({ doc: long, selection: { blocks: [], range: piece('key point', long) }, aliases, instruction: 'x' })).toContain(
      'a words "key point" in: "…that run on and on. Words that run on and on. The key point is here. More words after it, many of them. More words…"',
    )
  })

  it('keep their places when an earlier operation of the same reply changes the text before them', async () => {
    // Not a box: each operation acts on the words it names.
    const selection: Selection = { blocks: [], words: [piece('object'), piece('force')] }
    const model = scripted(['{"ops":[{"op":"rewrite","id":"a"},{"op":"mark","id":"b","set":[{"bold":false}]}]}', 'heavy object'])
    const out = await runEdit({ doc: PHYSICS, selection, instruction: 'make the first one more vivid and unbold the second', model })
    expect(md(out.doc, 't2')).toBe('An heavy object at rest stays at rest unless a force acts on it.')
    expect(out.log.ops).toEqual([
      { op: 'rewrite', id: 't2' },
      { op: 'mark', id: 't2', bold: false },
    ])
  })

  it('in a Select box, take a change to some of them as a change to all, unless the request picks some out', async () => {
    const red = await runEdit({ doc: PHYSICS, selection: inBox, instruction: 'make these words red', model: scripted(['{"ops":[{"op":"style","ids":["b"],"set":[{"color":"red"}]}]}']) })
    expect(md(red.doc, 't2')).toBe('An [object]{color=red} at rest stays at rest unless a [**force**]{color=red} acts on it.')
    // "These" is everything in the box, the whole heading too.
    expect(red.doc.block.t1).toMatchObject({ style: { color: 'red' } })

    const first = await runEdit({ doc: PHYSICS, selection: inBox, instruction: 'make only the first word red', model: scripted(['{"ops":[{"op":"mark","id":"b","set":[{"color":"red"}]}]}']) })
    expect(md(first.doc, 't2')).toBe('An [object]{color=red} at rest stays at rest unless a **force** acts on it.')

    const bold = await runEdit({ doc: PHYSICS, selection: inBox, instruction: 'italic', model: scripted(['{"ops":[{"op":"mark","id":"c","set":[{"italic":true}]}]}']), tier0: false })
    expect(md(bold.doc, 't2')).toBe('An *object* at rest stays at rest unless a ***force*** acts on it.')
  })

  it('take only a colour from style: a size or role is for whole blocks', async () => {
    const model = scripted(['{"ops":[{"op":"style","ids":["a"],"set":[{"size":"l"}]}]}', '{"ops":[{"op":"none","why":"Words cannot change size."}]}'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: [], range: piece('object') }, instruction: 'make it bigger', model, tier0: false })
    expect(model.asked[1]!.messages.at(-1)!.content).toContain('a is words, not a block: style changes only their color. To change size, choose a whole block.')
    expect(out.declined).toBe('Words cannot change size.')
    expect(out.doc).toBe(PHYSICS)
  })

  it('are cut out by delete as Delete does: whole words take one space along', async () => {
    const out = await runEdit({ doc: PHYSICS, selection: inBox, instruction: 'remove these words', model: scripted(['{"ops":[{"op":"delete","ids":["b"]}]}']), tier0: false })
    expect(plainText(parseInline(md(out.doc, 't2')))).toBe('An at rest stays at rest unless a acts on it.')
    expect(out.doc.block.t1).toEqual(PHYSICS.block.t1)
  })

  it('are never moved, converted or calculated: those take whole blocks', () => {
    const aliases = makeAliases(PHYSICS, inBox)
    const scope = { set: 'full' as const, selected: ['a', 'b', 'c'], blocks: aliases.blocks, refs: ['a', 'd'], here: true, maxOps: 8, inline: false, shape: 'list' as const }
    expect(() => parseReply('{"op":"move","id":"b","at":"after","ref":"d"}', scope)).toThrow(/move acts on whole blocks: choose a block listed under SELECTED, not words/)
    expect(() => parseReply('{"op":"convert","ids":["c"],"into":"list"}', scope)).toThrow(/convert acts on whole blocks/)
  })

  it('are marked and coloured by tier 0 one by one; a size goes to the model', () => {
    const aliases = makeAliases(PHYSICS, inBox)
    expect(tier0('bold', { doc: PHYSICS, selection: inBox, aliases })).toEqual([
      { op: 'mark', id: 'a', bold: true },
      { op: 'mark', id: 'b', bold: true },
      { op: 'mark', id: 'c', bold: true },
    ])
    const words: Selection = { blocks: [], words: inBox.words! }
    expect(tier0('make it red', { doc: PHYSICS, selection: words, aliases: makeAliases(PHYSICS, words) })).toEqual([
      { op: 'mark', id: 'a', color: 'red' },
      { op: 'mark', id: 'b', color: 'red' },
    ])
    expect(tier0('make it bigger', { doc: PHYSICS, selection: words, aliases: makeAliases(PHYSICS, words) })).toBeUndefined()
    expect(tier0('move it up', { doc: PHYSICS, selection: words, aliases: makeAliases(PHYSICS, words) })).toBeUndefined()
  })
})
