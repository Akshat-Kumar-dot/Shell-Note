// From AI operations to internal operations. Every case goes through step(),
// which also checks the result is valid and that undo restores the note.
import { describe, expect, it } from 'vitest'
import {
  compile,
  makeAliases,
  parseInline,
  parseReply,
  plainText,
  spliceFor,
  type Doc,
  type Op,
  type Selection,
  type TextBlock,
} from '../src/index.js'
import { MIXED, PHYSICS } from './fixtures/index.js'
import { expectError, step } from './helpers.js'

let counter = 0
const newId = (): string => `n${counter++}`

/** Read a reply as the model would send it, compile it, and apply the result. */
function run(doc: Doc, selection: Selection, reply: string, extra: { content?: string; href?: string } = {}) {
  const aliases = makeAliases(doc, selection)
  const scope = {
    set: 'full' as const,
    selected: aliases.selected.map((s) => s.alias),
    refs: aliases.refs,
    here: selection.here !== undefined,
    maxOps: 8,
    inline: false,
    shape: 'list' as const,
  }
  const ops: Op[] = parseReply(reply, scope).flatMap((op) => compile(op, { doc, aliases, selection, newId, ...extra }))
  return { ops, doc: ops.length > 0 ? step(doc, ops).doc : doc }
}

function words(doc: Doc, block: string, text: string): NonNullable<Selection['range']> {
  const start = plainText(parseInline((doc.block[block] as TextBlock).md)).indexOf(text)
  return { block, start, end: start + text.length }
}

describe('style', () => {
  it('sets several changes at once, in any order', () => {
    const { doc } = run(PHYSICS, { blocks: ['t1'] }, '{"op":"style","ids":["a"],"set":[{"color":"blue"},{"size":"l"}]}')
    expect(doc.block.t1).toMatchObject({ style: { color: 'blue', size: 'l' } })
  })

  it('removes a field set back to the default', () => {
    const { doc } = run(MIXED, { blocks: ['h1'] }, '{"op":"style","ids":["a"],"set":[{"color":"ink"}]}')
    expect((doc.block.h1 as TextBlock).style).toEqual({ size: 'xl' })
  })

  it('changes roles, nesting and ticks', () => {
    expect(run(MIXED, { blocks: ['l2'] }, '{"op":"style","ids":["a"],"set":[{"indent":"out"}]}').doc.block.l2).toMatchObject({ indent: 0 })
    expect(run(MIXED, { blocks: ['td'] }, '{"op":"style","ids":["a"],"set":[{"done":true}]}').doc.block.td).toMatchObject({ done: true })
    expect(run(MIXED, { blocks: ['p1'] }, '{"op":"style","ids":["a"],"set":[{"role":"todo"},{"done":true}]}').doc.block.p1).toMatchObject({
      role: 'todo',
      done: true,
    })
  })

  it('refuses what does not fit the block, with a hint', () => {
    expectError(() => run(MIXED, { blocks: ['p1'] }, '{"op":"style","ids":["a"],"set":[{"done":true}]}'), 'bad_value', /not a to-do/)
    expectError(() => run(PHYSICS, { blocks: ['m1'] }, '{"op":"style","ids":["a"],"set":[{"size":"l"}]}'), 'wrong_type', /math block/)
    expectError(() => run(PHYSICS, { blocks: ['k1'] }, '{"op":"style","ids":["a"],"set":[{"size":"l"}]}'), 'wrong_type', /only its color/)
  })

  it('takes word changes too: they go to the selected words, or the whole text', () => {
    const selection = { blocks: ['t2'], range: words(PHYSICS, 't2', 'object') }
    expect((run(PHYSICS, selection, '{"op":"style","ids":["a"],"set":[{"bold":true}]}').doc.block.t2 as TextBlock).md).toBe(
      'An **object** at rest stays at rest unless a **force** acts on it.',
    )
    // Colour goes to the words when some are selected, otherwise to the block.
    expect((run(PHYSICS, selection, '{"op":"style","ids":["a"],"set":[{"color":"red"}]}').doc.block.t2 as TextBlock).md).toContain('[object]{color=red}')
    expect(run(PHYSICS, { blocks: ['t2'] }, '{"op":"style","ids":["a"],"set":[{"color":"red"}]}').doc.block.t2).toMatchObject({ style: { color: 'red' } })
    expectError(() => run(PHYSICS, { blocks: ['k1'] }, '{"op":"style","ids":["a"],"set":[{"bold":true}]}'), 'wrong_type', /only its color/)
  })

  it('recolours handwriting stroke by stroke', () => {
    const { doc, ops } = run(PHYSICS, { blocks: ['k1'] }, '{"op":"style","ids":["a"],"set":[{"color":"blue"}]}')
    expect(ops.map((op) => op.op)).toEqual(['stroke', 'stroke'])
    expect(doc.block.k1).toMatchObject({ strokes: [{ color: 'blue' }] })
  })
})

describe('mark', () => {
  it('formats the selected words with a small splice', () => {
    const selection = { blocks: ['t2'], range: words(PHYSICS, 't2', 'object') }
    const { doc, ops } = run(PHYSICS, selection, '{"op":"mark","id":"a","set":[{"bold":true}]}')
    expect((doc.block.t2 as TextBlock).md).toBe('An **object** at rest stays at rest unless a **force** acts on it.')
    // One small splice, not a rewrite of the whole paragraph.
    expect(ops).toEqual([{ op: 'splice', id: 't2', field: 'md', at: 3, del: 6, ins: '**object**' }])
  })

  it('formats the whole block when no words are selected', () => {
    const { doc } = run(PHYSICS, { blocks: ['t1'] }, '{"op":"mark","id":"a","set":[{"italic":true}]}')
    expect((doc.block.t1 as TextBlock).md).toBe("*Newton's laws*")
  })

  it('gives a block its colour, as style would, when none of its words are selected', () => {
    const { doc, ops } = run(PHYSICS, { blocks: ['t1'] }, '{"op":"mark","id":"a","set":[{"color":"blue"},{"bold":true}]}')
    expect(doc.block.t1).toMatchObject({ style: { color: 'blue' }, md: "**Newton's laws**" })
    expect(ops.map((op) => op.op)).toEqual(['update', 'splice'])
    // Handwriting too: its strokes are recoloured.
    expect(run(PHYSICS, { blocks: ['k1'] }, '{"op":"mark","id":"a","set":[{"color":"blue"}]}').doc.block.k1).toMatchObject({ strokes: [{ color: 'blue' }] })
  })

  it('links words to an address found in the request', () => {
    const selection = { blocks: ['t2'], range: words(PHYSICS, 't2', 'force') }
    const { doc } = run(PHYSICS, selection, '{"op":"mark","id":"a","set":[{"link":true}]}', { href: 'https://example.com/force' })
    expect((doc.block.t2 as TextBlock).md).toContain('[**force**](https://example.com/force)')
    expectError(() => run(PHYSICS, selection, '{"op":"mark","id":"a","set":[{"link":true}]}'), 'bad_value', /No link address/)
  })
})

describe('rewrite', () => {
  it('replaces a whole block, or only the selected words', () => {
    expect((run(PHYSICS, { blocks: ['t2'] }, '{"op":"rewrite","id":"a"}', { content: 'A push changes motion.' }).doc.block.t2 as TextBlock).md).toBe(
      'A push changes motion.',
    )
    const selection = { blocks: ['t2'], range: words(PHYSICS, 't2', 'force') }
    expect((run(PHYSICS, selection, '{"op":"rewrite","id":"a"}', { content: 'push' }).doc.block.t2 as TextBlock).md).toBe(
      'An object at rest stays at rest unless a **push** acts on it.',
    )
  })

  it('rewrites a formula, and its cached result goes', () => {
    const { doc } = run(MIXED, { blocks: ['mc'] }, '{"op":"rewrite","id":"a"}', { content: '\\sum_{x=1}^{20} x' })
    expect(doc.block.mc).toMatchObject({ tex: '\\sum_{x=1}^{20} x' })
    expect(doc.block.mc).not.toHaveProperty('value')
  })
})

describe('insert', () => {
  it('goes after or before a block in its frame', () => {
    const after = run(PHYSICS, { blocks: ['t1'] }, '{"op":"insert","at":"after","ref":"a","kind":"text"}', { content: 'Three laws.' })
    expect((after.doc.block.f1 as { kids: string[] }).kids).toEqual(['t1', expect.any(String), 't2', 'm1'])
    const before = run(PHYSICS, { blocks: ['t1'] }, '{"op":"insert","at":"before","ref":"a","kind":"math","role":"p"}', { content: 'a = F/m' })
    expect((before.doc.block.f1 as { kids: string[] }).kids[0]).not.toBe('t1')
  })

  it('goes "here": inside a frame at a place, or as a new frame on an empty area', () => {
    const inFrame = run(PHYSICS, { blocks: [], here: { parent: 'f1', at: 2 } }, '{"op":"insert","at":"here","kind":"text","role":"li"}', { content: 'item' })
    expect((inFrame.doc.block.f1 as { kids: string[] }).kids).toHaveLength(4)
    const area = { page: 'p1', x: 2000, y: 22000, w: 8000, h: 3000 }
    const onPage = run(PHYSICS, { blocks: [], here: area }, '{"op":"insert","at":"here","kind":"text"}', { content: 'A note.' })
    expect(onPage.ops.map((op) => op.op)).toEqual(['add', 'add'])
    expect(onPage.doc.page.p1!.free).toHaveLength(4)
  })

  it('puts a new list item at the level of the item beside it', () => {
    const item = run(MIXED, { blocks: ['l2'] }, '{"op":"insert","at":"after","ref":"a","kind":"text","role":"li"}', { content: 'Surface waves' })
    expect(item.ops[0]).toMatchObject({ op: 'add', block: { role: 'li', indent: 1 } })
    // Not for another kind of block: a paragraph after it starts at the margin.
    const para = run(MIXED, { blocks: ['l2'] }, '{"op":"insert","at":"after","ref":"a","kind":"text","role":"p"}', { content: 'A note.' })
    expect(para.ops[0]).toMatchObject({ op: 'add', block: { role: 'p', indent: 0 } })
    // "Here", between l2 and l3, looks at the block before the place.
    const here = run(MIXED, { blocks: [], here: { parent: 'fa', at: 5 } }, '{"op":"insert","at":"here","kind":"text","role":"li"}', { content: 'Surface waves' })
    expect(here.ops[0]).toMatchObject({ op: 'add', at: 5, block: { role: 'li', indent: 1 } })
  })

  it('finds free space below a block placed on the page', () => {
    const { doc, ops } = run(PHYSICS, { blocks: ['g1'] }, '{"op":"insert","at":"after","ref":"a","kind":"math"}', { content: 'F = ma' })
    const added = (ops[0] as { block: { id: string } }).block.id
    expect(doc.block[added]).toMatchObject({ type: 'math', page: 'p1', x: 11000, y: 18500, w: 8000, h: 1500 })
  })
})

describe('move, delete and convert', () => {
  it('moves a block before another in its frame', () => {
    const { doc } = run(PHYSICS, { blocks: ['t1', 'm1'] }, '{"op":"move","id":"b","at":"before","ref":"a"}')
    expect(doc.block.f1).toMatchObject({ kids: ['m1', 't1', 't2'] })
    expectError(() => run(PHYSICS, { blocks: ['t2', 'g1'] }, '{"op":"move","id":"a","at":"after","ref":"b"}'), 'wrong_type', /text column/)
  })

  it('makes no move when the block is already there', () => {
    // o2 already follows o1.
    expect(run(MIXED, { blocks: ['o1', 'o2'] }, '{"op":"move","id":"b","at":"after","ref":"a"}').ops).toEqual([])
    expect(run(MIXED, { blocks: ['o1', 'o2'] }, '{"op":"move","id":"a","at":"after","ref":"b"}').ops).toHaveLength(1)
  })

  it('deletes several blocks', () => {
    const { doc } = run(PHYSICS, { blocks: ['t2', 'm1'] }, '{"op":"delete","ids":["a","b"]}')
    expect(doc.block.f1).toMatchObject({ kids: ['t1'] })
  })

  it('turns paragraphs into a list where they were', () => {
    const { doc } = run(MIXED, { blocks: ['p1', 'p2'] }, '{"op":"convert","ids":["a","b"],"into":"list"}', { content: 'Waves carry energy\nPrices vary' })
    const kids = (doc.block.fa as { kids: string[] }).kids
    expect(kids.slice(0, 4).map((id) => (doc.block[id] as TextBlock).role)).toEqual(['h1', 'li', 'li', 'li'])
    expect(doc.block.p1).toBeUndefined()
  })

  it('leaves math actions for phase 4: the choice is kept, the formula unchanged', () => {
    expect(run(MIXED, { blocks: ['mc'] }, '{"op":"calc","id":"a","action":"simplify"}').ops).toEqual([])
  })
})

describe('the smallest splice', () => {
  it('keeps only what changed, never half a character', () => {
    expect(spliceFor('t', 'md', 'abcdef', 'abXYef')).toEqual({ op: 'splice', id: 't', field: 'md', at: 2, del: 2, ins: 'XY' })
    expect(spliceFor('t', 'md', 'a🍎b', 'a🍐b')).toEqual({ op: 'splice', id: 't', field: 'md', at: 1, del: 2, ins: '🍐' })
  })
})
