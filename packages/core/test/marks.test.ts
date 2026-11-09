// Protocol v1.1: underline, subscript and superscript, and a colour code the
// request itself gives.
import { describe, expect, it } from 'vitest'
import {
  apply,
  colourIn,
  compile,
  makeAliases,
  parseInline,
  parseReply,
  plainText,
  replyJsonSchema,
  runEdit,
  type Caps,
  type Doc,
  type Model,
  type Scope,
  type Selection,
  type TextBlock,
} from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'

const md = (doc: Doc, id: string): string => (doc.block[id] as TextBlock).md
function words(text: string, doc: Doc = PHYSICS): Selection {
  const start = plainText(parseInline(md(doc, 't2'))).indexOf(text)
  return { blocks: [], range: { block: 't2', start, end: start + text.length } }
}
function scripted(replies: string[], caps: Partial<Caps> = {}): Model {
  return {
    name: 'scripted',
    caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'small', ...caps },
    complete: async () => ({ text: replies.shift() ?? '', tokensIn: 10, tokensOut: 5, ms: 1 }),
  }
}
const scope = (colors: string[] = []): Scope => ({ set: 'small', selected: ['a'], refs: ['a'], here: false, maxOps: 1, inline: false, shape: 'list', colors })

describe('underline, subscript and superscript', () => {
  it('are word changes the model can choose', async () => {
    const out = await runEdit({ doc: PHYSICS, selection: words('object'), instruction: 'underline it', model: scripted(['{"ops":[{"op":"mark","id":"a","set":[{"underline":true}]}]}']), tier0: false })
    expect(md(out.doc, 't2')).toBe('An [object]{.underline} at rest stays at rest unless a **force** acts on it.')
    expect(JSON.stringify(replyJsonSchema(scope()))).toContain('"underline"')
  })

  it('are understood by tier 0, with no model', async () => {
    const none = scripted([])
    const under = await runEdit({ doc: PHYSICS, selection: words('object'), instruction: 'underline this', model: none })
    expect(under).toMatchObject({ tier: 0 })
    expect(md(under.doc, 't2')).toBe('An [object]{.underline} at rest stays at rest unless a **force** acts on it.')
    const sup = await runEdit({ doc: PHYSICS, selection: words('object'), instruction: 'make it superscript', model: none })
    expect(md(sup.doc, 't2')).toBe('An [object]{.sup} at rest stays at rest unless a **force** acts on it.')
    const sub = await runEdit({ doc: sup.doc, selection: words('object', sup.doc), instruction: 'subscript', model: none })
    // Subscript and superscript exclude each other, as in Word.
    expect(md(sub.doc, 't2')).toBe('An [object]{.sub} at rest stays at rest unless a **force** acts on it.')
    const plain = await runEdit({ doc: under.doc, selection: words('object', under.doc), instruction: 'remove the underline', model: none })
    expect(md(plain.doc, 't2')).toBe(md(PHYSICS, 't2'))
  })
})

describe('a colour code in the request', () => {
  it('is found in its long or short form', () => {
    expect(colourIn('make it #E0563A please')).toBe('#e0563a')
    expect(colourIn('use #e05 for this')).toBe('#ee0055')
    expect(colourIn('issue #12, not a colour')).toBeUndefined()
    expect(colourIn('#abc123x is not one either')).toBeUndefined()
  })

  it('joins the colours the reply schema allows, for that request only', () => {
    expect(JSON.stringify(replyJsonSchema(scope(['#e0563a'])))).toContain('"#e0563a"')
    expect(JSON.stringify(replyJsonSchema(scope()))).not.toContain('#')
    expect(parseReply('{"op":"style","ids":["a"],"set":[{"color":"#e0563a"}]}', scope(['#e0563a']))).toEqual([{ op: 'style', ids: ['a'], color: '#e0563a' }])
    expect(() => parseReply('{"op":"style","ids":["a"],"set":[{"color":"#123456"}]}', scope(['#e0563a']))).toThrow('Use a colour from the list, or #e0563a.')
    expect(() => parseReply('{"op":"style","ids":["a"],"set":[{"color":"#123456"}]}', scope())).toThrow('Use a colour from the list.')
  })

  it('is used exactly, on a block or on words, by tier 0 or by the model', async () => {
    const heading = await runEdit({ doc: PHYSICS, selection: { blocks: ['t1'] }, instruction: 'make the heading #E0563A', model: scripted([]) })
    expect(heading).toMatchObject({ tier: 0 })
    expect(heading.doc.block.t1).toMatchObject({ style: { color: '#e0563a' } })
    const model = scripted(['{"ops":[{"op":"mark","id":"a","set":[{"color":"#2a9d8f"}]}]}'])
    const word = await runEdit({ doc: PHYSICS, selection: words('object'), instruction: 'give it the colour #2a9d8f, my highlight colour', model, tier0: false })
    expect(md(word.doc, 't2')).toBe('An [object]{color=#2a9d8f} at rest stays at rest unless a **force** acts on it.')
  })

  it('recolours handwriting too, since ink takes colour codes (file format version 3)', () => {
    const selection: Selection = { blocks: ['k1'] }
    const aliases = makeAliases(PHYSICS, selection)
    const coded = compile({ op: 'style', ids: ['a'], color: '#e0563a' }, { doc: PHYSICS, aliases, selection, newId: () => 'n1' })
    expect(apply(PHYSICS, coded).doc.block.k1).toMatchObject({ strokes: [{ color: '#e0563a' }] })
    const blue = compile({ op: 'style', ids: ['a'], color: 'blue' }, { doc: PHYSICS, aliases, selection, newId: () => 'n1' })
    expect(apply(PHYSICS, blue).doc.block.k1).toMatchObject({ strokes: [{ color: 'blue' }] })
  })
})
