import { describe, expect, it } from 'vitest'
import { parseReply, replyJsonSchema, type Scope } from '../src/index.js'
import { expectError } from './helpers.js'

const scope: Scope = { set: 'small', selected: ['a', 'b'], refs: ['a', 'b', 'c'], here: false, maxOps: 1, inline: false, shape: 'list' }

describe('the reply schema for constrained decoding', () => {
  const schema = replyJsonSchema(scope) as { properties: { ops: { maxItems: number; items: { anyOf: Record<string, unknown>[] } } } }
  const ops = schema.properties.ops.items.anyOf as { properties: Record<string, { const?: string; items?: unknown; enum?: string[] }> }[]

  it('lists the small set, and only real aliases for ids', () => {
    expect(ops.map((op) => op.properties.op!.const)).toEqual(['style', 'mark', 'rewrite', 'insert', 'delete', 'move', 'none'])
    const del = ops.find((op) => op.properties.op!.const === 'delete')!
    expect(del.properties.ids!.items).toMatchObject({ enum: ['a', 'b'] })
    const move = ops.find((op) => op.properties.op!.const === 'move')!
    expect(move.properties.ref).toMatchObject({ enum: ['a', 'b', 'c'] })
    // The schema holds a small model to one operation and a short reason, as in v1.
    expect(schema.properties.ops.maxItems).toBe(1)
    const none = ops.find((op) => op.properties.op!.const === 'none')!
    expect(none.properties.why).toMatchObject({ maxLength: 80 })
    expect(() => parseReply('{"ops":[{"op":"delete","ids":["a"]},{"op":"delete","ids":["b"]}]}', scope)).toThrow('Reply with at most 1 operation.')
  })

  it("leaves out maxItems and maxLength for Anthropic's strict mode, which refuses them; reading the reply still checks both", () => {
    const strict = { ...scope, strict: true }
    expect(JSON.stringify(replyJsonSchema(strict))).not.toMatch(/maxItems|maxLength/)
    expect(() => parseReply('{"ops":[{"op":"delete","ids":["a"]},{"op":"delete","ids":["b"]}]}', strict)).toThrow('Reply with at most 1 operation.')
    expect(JSON.stringify(replyJsonSchema({ ...scope, set: 'full', maxOps: 8 }))).toContain('"maxItems":8')
  })

  it('gives style its changes as a list of single changes', () => {
    const style = ops.find((op) => op.properties.op!.const === 'style')!
    const items = (style.properties.set as { items: { anyOf: { required: string[] }[] } }).items.anyOf
    expect(items.map((item) => item.required[0])).toEqual(['size', 'color', 'font', 'align', 'role', 'indent', 'done'])
  })

  it('leaves out fields with no possible value: with nothing selected, only insert "here" and none', () => {
    const json = JSON.stringify(replyJsonSchema({ ...scope, selected: [], refs: [], here: true }))
    expect(json).not.toContain('"not"')
    const empty = replyJsonSchema({ ...scope, selected: [], refs: [], here: true }) as typeof schema
    const names = (empty.properties.ops.items.anyOf as { properties: { op: { const: string }; at?: { enum: string[] } } }[]).map((op) => op.properties.op.const)
    expect(names).toEqual(['insert', 'none'])
  })

  it('makes insert name its neighbour when it cannot go "here"', () => {
    const insertOf = (s: Scope) =>
      ((replyJsonSchema(s) as typeof schema).properties.ops.items.anyOf as { properties: { op: { const: string } }; required: string[] }[]).find(
        (op) => op.properties.op.const === 'insert',
      )!
    expect(insertOf(scope).required).toContain('ref')
    expect(insertOf({ ...scope, here: true }).required).not.toContain('ref')
  })

  it('in the merged shape, offers no mark and lets style change words', () => {
    const merged = replyJsonSchema({ ...scope, merged: true }) as typeof schema
    const all = merged.properties.ops.items.anyOf as { properties: Record<string, { const?: string }> }[]
    expect(all.map((op) => op.properties.op!.const)).not.toContain('mark')
    const style = all.find((op) => op.properties.op!.const === 'style')!
    const items = (style.properties.set as unknown as { items: { anyOf: { required: string[] }[] } }).items.anyOf.map((item) => item.required[0])
    expect(items).toEqual(expect.arrayContaining(['size', 'color', 'bold', 'italic', 'link']))
  })

  it('adds convert and calc for the full set', () => {
    const full = replyJsonSchema({ ...scope, set: 'full' }) as typeof schema
    expect(full.properties.ops.items.anyOf).toHaveLength(9)
  })
})

describe('reading a reply', () => {
  it('reads the list shape into flat fields', () => {
    expect(parseReply('{"ops":[{"op":"style","ids":["a"],"set":[{"color":"blue"},{"size":"l"}]}]}', scope)).toEqual([
      { op: 'style', ids: ['a'], color: 'blue', size: 'l' },
    ])
  })

  it('forgives the wrapper and id or ids mix-ups', () => {
    const expected = [{ op: 'delete', ids: ['b'] }]
    expect(parseReply('{"ops":[{"op":"delete","ids":["b"]}]}', scope)).toEqual(expected)
    expect(parseReply('{"op":"delete","ids":["b"]}', scope)).toEqual(expected)
    expect(parseReply('[{"op":"delete","id":"b"}]', scope)).toEqual(expected)
    expect(parseReply('```json\n{"op":"delete","ids":["b"]}\n```', scope)).toEqual(expected)
    expect(parseReply('{"op":"mark","ids":["b"],"bold":true}', scope)).toEqual([{ op: 'mark', id: 'b', bold: true }])
  })

  it('answers mistakes with teaching errors in the teaching format', () => {
    const unknown = expectError(() => parseReply('{"op":"delete","ids":["k"]}', scope), 'unknown_id')
    expect(JSON.parse(JSON.stringify(unknown))).toEqual({ error: 'unknown_id', got: 'k', valid: ['a', 'b'], hint: 'Use an id listed under SELECTED.' })
    expectError(() => parseReply('{"op":"move","id":"a","at":"after","ref":"z"}', scope), 'unknown_id', /SELECTED or NEAR/)
    expectError(() => parseReply('Sure! I made it blue.', scope), 'not_json', /JSON only/)
    expectError(() => parseReply('{"op":"paint","ids":["a"]}', scope), 'unknown_op', /style, mark, rewrite/)
    expectError(() => parseReply('{"op":"convert","ids":["a"],"into":"list"}', scope), 'unknown_op')
    expectError(() => parseReply('{"ops":[{"op":"delete","ids":["a"]},{"op":"delete","ids":["b"]}]}', scope), 'too_many', /at most 1/)
    expectError(() => parseReply('{"op":"style","ids":["a"],"set":[{"colour":"blue"}]}', scope), 'bad_value', /"colour" is not a style change/)
    expectError(() => parseReply('{"op":"style","ids":["a"],"set":[{"color":"pink"}]}', scope), 'bad_value', /color/)
    expectError(() => parseReply('{"op":"style","ids":["a"],"set":[]}', scope), 'bad_value', /at least one change/)
    expectError(() => parseReply('{"op":"insert","at":"here","kind":"text"}', scope), 'bad_value', /No place was marked/)
    expectError(() => parseReply('{"op":"insert","at":"after","kind":"text"}', scope), 'bad_value', /add "ref"/)
  })

  it('drops inline content unless the model may send it', () => {
    expect(parseReply('{"op":"rewrite","id":"a","content":"New words"}', scope)).toEqual([{ op: 'rewrite', id: 'a' }])
    expect(parseReply('{"op":"rewrite","id":"a","content":"New words"}', { ...scope, inline: true })).toEqual([
      { op: 'rewrite', id: 'a', content: 'New words' },
    ])
  })
})
