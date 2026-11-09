import { runEdit } from '@shellnote/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHYSICS } from '../../core/test/fixtures/index.js'
import { capsFor, OPENROUTER, openRouter, openRouterModels, toHosted } from '../src/index.js'

afterEach(() => vi.unstubAllGlobals())

const ok = { choices: [{ message: { content: '{"ops":[]}' } }], usage: { prompt_tokens: 900, completion_tokens: 20, cost: 0.0001 } }

describe('OpenRouter', () => {
  it('sends the key only to openrouter.ai, with usage accounting and only providers that honour the schema', async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers })
      return new Response(JSON.stringify(ok))
    })
    const model = openRouter({ model: 'anthropic/claude-haiku-5.5', apiKey: 'sk-or-test', effort: 'low' })
    const result = await model.complete({ messages: [{ role: 'user', content: 'hi' }], schema: { type: 'object' }, maxTokens: 300 })
    expect(OPENROUTER).toBe('https://openrouter.ai/api/v1')
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(calls[0]!.headers.authorization).toBe('Bearer sk-or-test')
    expect(calls[0]!.body).toMatchObject({
      model: 'anthropic/claude-haiku-5.5',
      usage: { include: true },
      provider: { require_parameters: true },
      reasoning: { effort: 'low' },
      response_format: { type: 'json_schema' },
    })
    expect(calls[0]!.body).not.toHaveProperty('temperature')
    expect(model.name).toBe('openrouter:anthropic/claude-haiku-5.5')
    expect(result.cost).toBe(0.0001)
  })

  it('marks the fixed prefix cacheable for Claude, and only for Claude', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>)
      return new Response(JSON.stringify(ok))
    })
    const messages = [
      { role: 'system' as const, content: 'The rules.' },
      { role: 'user' as const, content: 'ASK make it red' },
    ]
    await openRouter({ model: 'anthropic/claude-haiku-5.5', apiKey: 'k' }).complete({ messages, maxTokens: 10 })
    await openRouter({ model: 'nvidia/nemotron-3-super-120b-a12b:free', apiKey: 'k' }).complete({ messages, maxTokens: 10 })
    expect(bodies[0]!.messages).toEqual([
      { role: 'system', content: [{ type: 'text', text: 'The rules.', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: 'ASK make it red' },
    ])
    expect(bodies[1]!.messages).toEqual(messages)
  })

  it('reads its public model list: prices per million tokens, pictures, schema and thinking', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('https://openrouter.ai/api/v1/models')
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'anthropic/claude-haiku-5.5',
              name: 'Anthropic: Claude Haiku 5.5',
              context_length: 200000,
              pricing: { prompt: '0.0000001', completion: '0.0000005' },
              supported_parameters: ['max_tokens', 'reasoning', 'structured_outputs', 'response_format'],
              architecture: { input_modalities: ['text', 'image'] },
            },
            { id: 'liquid/lfm-2.5-2.6b:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['structured_outputs'], architecture: { input_modalities: ['text'] } },
          ],
        }),
      )
    })
    const [haiku, lfm] = await openRouterModels()
    expect(haiku).toEqual({ id: 'anthropic/claude-haiku-5.5', name: 'Anthropic: Claude Haiku 5.5', vision: true, jsonSchema: true, thinking: true, price: { in: 0.1, out: 0.5 }, contextLength: 200000 })
    expect(lfm).toMatchObject({ name: 'liquid/lfm-2.5-2.6b:free', vision: false, jsonSchema: true, thinking: false, price: { in: 0, out: 0 } })
  })

  it('takes capabilities from the list, and the operation set from the size in the name', () => {
    const small = toHosted({ id: 'liquid/lfm-2.5-2.6b:free', supported_parameters: ['structured_outputs'] })
    const large = toHosted({ id: 'nvidia/nemotron-3-super-120b-a12b:free', supported_parameters: ['reasoning'] })
    expect(capsFor(small)).toMatchObject({ opSet: 'small', jsonSchema: true, thinking: false, vision: false })
    expect(capsFor(large)).toMatchObject({ opSet: 'full', jsonSchema: false, thinking: true })
    expect(capsFor(large, { opSet: 'small' }).opSet).toBe('small')
  })

  it("holds Claude's schema to strict mode, with no maxItems or maxLength, and no other model's", async () => {
    expect(capsFor(toHosted({ id: 'anthropic/claude-haiku-5.5', supported_parameters: ['structured_outputs'] })).strictSchema).toBe(true)
    expect(capsFor(toHosted({ id: 'liquid/lfm-2.5-2.6b:free', supported_parameters: ['structured_outputs'] })).strictSchema).toBeUndefined()
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ops":[{"op":"none","why":"No."}]}' } }], usage: {} }))
    })
    const doc = PHYSICS
    for (const model of ['anthropic/claude-haiku-5.5', 'liquid/lfm-2.5-2.6b:free']) {
      await runEdit({ doc, selection: { blocks: ['t1'] }, instruction: 'make it blue', model: openRouter({ model, apiKey: 'k' }), tier0: false })
    }
    const schemaOf = (body: Record<string, unknown>): string => JSON.stringify((body.response_format as { json_schema: { schema: unknown } }).json_schema.schema)
    expect(schemaOf(bodies[0]!)).not.toMatch(/maxItems|maxLength/u)
    expect(schemaOf(bodies[1]!)).toContain('"maxItems":1')
  })
})
