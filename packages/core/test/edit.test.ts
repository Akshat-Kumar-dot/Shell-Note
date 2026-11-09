// The whole edit pipeline, with a scripted model standing in for a real one.
import { describe, expect, it } from 'vitest'
import { LogEntry, runEdit, validateDoc, type Caps, type CompleteRequest, type Model, type TextBlock } from '../src/index.js'
import { MIXED, PHYSICS } from './fixtures/index.js'
import { content } from './helpers.js'

/** A model that answers with the given replies in turn, and records what it was asked. */
function scripted(replies: string[], caps: Partial<Caps> = {}): Model & { asked: CompleteRequest[] } {
  const asked: CompleteRequest[] = []
  return {
    name: 'scripted',
    caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'small', ...caps },
    asked,
    async complete(request) {
      asked.push(request)
      return { text: replies.shift() ?? '', tokensIn: 100, tokensOut: 10, ms: 1 }
    },
  }
}

const md = (doc: { block: Record<string, unknown> }, id: string): string => (doc.block[id] as TextBlock).md

describe('an AI edit', () => {
  it('is handled by tier 0, with no model call, when code understands it', async () => {
    const model = scripted([])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'make it red', model })
    expect(model.asked).toHaveLength(0)
    expect(out).toMatchObject({ tier: 0, calls: 0, tokensIn: 0, log: { model: 'tier0', result: 'applied' } })
    expect(out.doc.block.t2).toMatchObject({ style: { color: 'red' } })
  })

  it('asks the model otherwise, constrained to the reply schema', async () => {
    const model = scripted(['{"ops":[{"op":"style","ids":["a"],"set":[{"color":"red"},{"size":"xl"}]}]}'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t1'] }, instruction: 'make the heading stand out', model })
    expect(model.asked[0]!.schema).toBeDefined()
    expect(model.asked[0]!.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(out).toMatchObject({ tier: 1, calls: 1, tokensIn: 100, tokensOut: 10 })
    expect(out.doc.block.t1).toMatchObject({ style: { color: 'red', size: 'xl' } })
    // One undo step gives the note back.
    expect(validateDoc(out.doc)).toBe(out.doc)
  })

  it('writes new words in a second, plain-text call', async () => {
    const model = scripted(['{"op":"rewrite","id":"a"}', 'Sure! Here is the text:\nA push changes how things move.'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'say it more simply', model })
    expect(model.asked[1]!.schema).toBeUndefined()
    expect(md(out.doc, 't2')).toBe('A push changes how things move.')
    expect(out.calls).toBe(2)
  })

  it('adds up the thinking tokens and the cost of its calls, and logs them when the server says', async () => {
    const replies = ['{"op":"rewrite","id":"a"}', 'A push changes how things move.']
    const priced: Model = {
      name: 'priced',
      caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'small', thinking: true },
      complete: async () => ({ text: replies.shift() ?? '', tokensIn: 100, tokensOut: 30, thinkingTokens: 20, cost: 0.001, ms: 1 }),
    }
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'say it more simply', model: priced })
    expect(out).toMatchObject({ calls: 2, tokensOut: 60, thinking: 40, cost: 0.002 })
    expect(LogEntry.parse(out.log)).toMatchObject({ thinking: 40, cost: 0.002 })

    // A local server says neither, so the log leaves both out.
    const local = await runEdit({ doc: PHYSICS, selection: { blocks: ['t1'] }, instruction: 'make the heading stand out', model: scripted(['{"ops":[{"op":"style","ids":["a"],"set":[{"color":"red"}]}]}']) })
    expect(local).toMatchObject({ thinking: 0 })
    expect(local.log).not.toHaveProperty('thinking')
    expect(local.log).not.toHaveProperty('cost')
  })

  it('retries once with a teaching error, then succeeds', async () => {
    const model = scripted(['{"op":"delete","ids":["k"]}', '{"op":"delete","ids":["a"]}'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'get rid of this', model })
    expect(out.retries).toBe(1)
    const retry = model.asked[1]!.messages
    expect(retry.at(-1)!.content).toContain('{"error":"unknown_id","got":"k","valid":["a"],"hint":"Use an id listed under SELECTED."}')
    expect(out.doc.block.t2).toBeUndefined()
  })

  it('gives up after the retry, leaving the note as it was', async () => {
    const model = scripted(['not json', 'still not json'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'something odd', model })
    expect(out).toMatchObject({ retries: 1, calls: 2, error: expect.stringMatching(/^not_json/), log: { result: 'failed' } })
    expect(content(out.doc)).toStrictEqual(content(PHYSICS))
  })

  it('lets the model decline', async () => {
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'what is the weather?', model: scripted(['{"op":"none","why":"Not an edit."}']) })
    expect(out).toMatchObject({ declined: 'Not an edit.', log: { result: 'declined' } })
    expect(out.doc).toBe(PHYSICS)
  })

  it('rewrites content that breaks the text rules, once', async () => {
    // ("# Big title" would not do here: code tidies a heading marker away itself.)
    const model = scripted(['{"op":"rewrite","id":"a"}', '<b>Big</b> title', '**Big** title'])
    // tier0: false, since tier 0 alone would read this as "size l, role h1".
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'turn it into a big title', model, tier0: false })
    expect(model.asked[2]!.messages[1]!.content).toMatch(/refused: No HTML/)
    expect(md(out.doc, 't2')).toBe('**Big** title')
  })

  it('selects by kind before asking the model', async () => {
    const model = scripted(['{"op":"style","ids":["a"],"set":[{"font":"serif"}]}'])
    await runEdit({ doc: MIXED, selection: { blocks: ['p1'] }, instruction: 'give all headings an elegant look', model })
    expect(model.asked[0]!.messages[1]!.content).toContain('SELECTED\na h1 Chapter 3: Waves\n')
  })

  it('styles every selected block when the request says "these", unless it picks some', async () => {
    const blue = '{"op":"style","ids":["a"],"set":[{"color":"blue"}]}'
    const these = await runEdit({ doc: PHYSICS, selection: { blocks: ['t1', 't2'] }, instruction: 'make these calm and blue', model: scripted([blue]), tier0: false })
    expect(these.log.ops).toMatchObject([{ op: 'style', ids: ['t1', 't2'] }])
    expect(these.doc.block.t2).toMatchObject({ style: { color: 'blue' } })
    const first = await runEdit({ doc: PHYSICS, selection: { blocks: ['t1', 't2'] }, instruction: 'make the first of these blue', model: scripted([blue]), tier0: false })
    expect(first.log.ops).toMatchObject([{ op: 'style', ids: ['t1'] }])
  })

  it('continues a list when new text goes next to a list item, unless the model chose a role', async () => {
    const after = '{"op":"insert","at":"after","ref":"a","kind":"text"}'
    const item = await runEdit({ doc: MIXED, selection: { blocks: ['l2'] }, instruction: 'add another kind of wave', model: scripted([after, 'Surface waves']), tier0: false })
    expect(item.log.ops).toMatchObject([{ op: 'insert', role: 'li' }])
    // l2 is a sub-point, so the new item is one too.
    expect(item.applied[0]).toMatchObject({ op: 'add', block: { role: 'li', indent: 1, md: 'Surface waves' } })
    const chosen = '{"op":"insert","at":"after","ref":"a","kind":"text","role":"p"}'
    const para = await runEdit({ doc: MIXED, selection: { blocks: ['l2'] }, instruction: 'add a note after this', model: scripted([chosen, 'A note.']), tier0: false })
    expect(para.applied[0]).toMatchObject({ op: 'add', block: { role: 'p', indent: 0 } })
  })

  it('asks once more when the chosen edit would change nothing, and accepts it said twice', async () => {
    // p2 is already the normal size, so "size m" for "smaller" is a misreading.
    const normal = '{"op":"style","ids":["a"],"set":[{"size":"m"}]}'
    const model = scripted([normal, '{"op":"style","ids":["a"],"set":[{"size":"s"}]}'])
    const out = await runEdit({ doc: MIXED, selection: { blocks: ['p2'] }, instruction: 'make this text smaller', model, tier0: false })
    expect(model.asked[1]!.messages.at(-1)!.content).toContain('"error":"no_change"')
    expect(out).toMatchObject({ retries: 1, log: { result: 'applied' } })
    expect(out.doc.block.p2).toMatchObject({ style: { size: 's' } })
    const same = await runEdit({ doc: MIXED, selection: { blocks: ['p2'] }, instruction: 'make it the normal size', model: scripted([normal, normal]), tier0: false })
    expect(same).toMatchObject({ retries: 1, log: { result: 'unchanged' } })
  })

  it('counts the same operation twice once', async () => {
    const twice = '{"ops":[{"op":"delete","ids":["a"]},{"op":"delete","ids":["a"]}]}'
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'get rid of this', model: scripted([twice], { opSet: 'full' }), tier0: false })
    expect(out).toMatchObject({ retries: 0, ops: [{ op: 'delete', ids: ['a'] }] })
  })

  it('keeps a log entry with real ids', async () => {
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'remove it please now', model: scripted(['{"op":"delete","ids":["a"]}']), now: () => 5 })
    expect(LogEntry.parse(out.log)).toEqual(out.log)
    expect(out.log).toMatchObject({ at: 5, ops: [{ op: 'delete', ids: ['t2'] }], targets: ['t2'], rulebook: expect.stringMatching(/^[0-9a-f]{8}$/) })
  })

  it('compiles several operations in turn, and explains a conflict in aliases', async () => {
    const model = scripted(
      ['{"ops":[{"op":"delete","ids":["a"]},{"op":"style","ids":["a"],"set":[{"color":"red"}]}]}', '{"op":"delete","ids":["a"]}'],
      { opSet: 'full' },
    )
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'get rid of this', model })
    const retry = model.asked[1]!.messages.at(-1)!.content
    expect(retry).toContain('Block a is gone')
    expect(retry).not.toMatch(/\bt2\b/)
    expect(out.doc.block.t2).toBeUndefined()
  })

  it('takes content written inline in one call, and has the content step redo it if it breaks a rule', async () => {
    const inline = { inlineContent: true }
    const one = scripted(['{"op":"rewrite","id":"a","content":"A push changes how things move."}'], inline)
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'say it more simply', model: one, tier0: false })
    expect(out.calls).toBe(1)
    expect(md(out.doc, 't2')).toBe('A push changes how things move.')
    const broken = scripted(['{"op":"rewrite","id":"a","content":"<b>Push</b> changes motion."}', 'A push changes motion.'], inline)
    const redone = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'say it more simply', model: broken, tier0: false })
    expect(broken.asked[1]!.schema).toBeUndefined()
    expect(redone).toMatchObject({ calls: 2, retries: 1 })
    expect(md(redone.doc, 't2')).toBe('A push changes motion.')
  })

  it('can choose in two steps: the operation alone, then its fields', async () => {
    const model = scripted(['{"op":"style"}', '{"op":"style","ids":["a"],"set":[{"color":"red"}]}'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t1'] }, instruction: 'make the heading stand out', model, tier0: false, split: true })
    expect(JSON.stringify(model.asked[0]!.schema)).toContain('"enum":["style","mark","rewrite","insert","delete","move","none"]')
    const second = model.asked[1]!
    expect(second.messages[1]!.content).toMatch(/OPERATION style$/)
    expect((second.schema as { properties: { ops: { items: { properties: { op: { const: string } } } } } }).properties.ops.items.properties.op.const).toBe('style')
    // The prefix is the same in both calls, so a server can reuse its cache.
    expect(second.messages[0]).toEqual(model.asked[0]!.messages[0])
    expect(out).toMatchObject({ calls: 2, doc: { block: { t1: { style: { color: 'red' } } } } })
    // The retry after a split choice may choose another operation.
    const p2 = '{"op":"style","ids":["a"],"set":[{"size":"m"}]}'
    const again = scripted(['{"op":"style"}', p2, '{"op":"none","why":"It is already the normal size."}'])
    const declined = await runEdit({ doc: MIXED, selection: { blocks: ['p2'] }, instruction: 'normal size please', model: again, tier0: false, split: true })
    expect(JSON.stringify(again.asked[2]!.schema)).toContain('"none"')
    expect(again.asked[2]!.messages[1]!.content).not.toContain('OPERATION')
    expect(declined).toMatchObject({ retries: 1, declined: 'It is already the normal size.' })
  })

  it('sends no schema to a server that cannot enforce one', async () => {
    const model = scripted(['{"op":"delete","ids":["a"]}'], { jsonSchema: false })
    await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'get rid of this', model })
    expect(model.asked[0]!.schema).toBeUndefined()
  })
})
