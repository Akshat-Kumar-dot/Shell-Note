import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetThinkers, guessCaps, openAICompatible, pageFor, sizeFromName, takesTemperature } from '../src/index.js'

afterEach(() => {
  vi.unstubAllGlobals()
  // Each test starts as a new page would, knowing no model thinks.
  forgetThinkers()
})

/** Stand in for the server: record the request, answer with `reply`. */
function server(reply: unknown, status = 200) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers })
    return new Response(JSON.stringify(reply), { status })
  })
  return calls
}

describe('the terminal page by the model\'s size', () => {
  it('gives the small models\' page under 3B by the name, the page for every model otherwise, and the person\'s choice first', () => {
    expect(['qwen2.5-1.5b-instruct', 'google/gemma-4-e2b', 'google/gemma-4-e4b', 'qwen/qwen3-vl-8b', 'deepseek/deepseek-r1-0528-qwen3-8b', 'anthropic/claude-haiku-5.5'].map((name) => pageFor(name))).toEqual([
      'small',
      'small',
      'overall',
      'overall',
      'overall',
      'overall',
    ])
    expect(pageFor('qwen/qwen3-vl-8b', 'small')).toBe('small')
    expect(pageFor('google/gemma-4-e2b', 'overall')).toBe('overall')
  })
})

describe('model size and capabilities from the name', () => {
  it('reads the size', () => {
    expect(['qwen2.5-1.5b-instruct', 'google/gemma-4-e4b', 'qwen/qwen3-vl-8b', 'gemma-4-12b-it', 'qwen/qwen3.5-9b', 'glm-ocr'].map(sizeFromName)).toEqual([
      1.5,
      4,
      8,
      12,
      9,
      undefined,
    ])
  })

  it('gives models under 7B the small operation set', () => {
    expect(guessCaps('qwen2.5-1.5b-instruct').opSet).toBe('small')
    expect(guessCaps('google/gemma-4-e4b').opSet).toBe('small')
    expect(guessCaps('qwen2.5-coder-7b-instruct').opSet).toBe('full')
    expect(guessCaps('some-hosted-model').opSet).toBe('full')
    expect(guessCaps('qwen/qwen3-vl-8b').vision).toBe(true)
    expect(guessCaps('qwen2.5-1.5b-instruct', { opSet: 'full' }).opSet).toBe('full')
  })

  it('knows the thinking models, and the ones that refuse a temperature', () => {
    const thinks = ['anthropic/claude-haiku-5.5', 'anthropic/claude-opus-5.5', 'claude-sonnet-5-5', 'qwen/qwen3.5-9b', 'deepseek/deepseek-r1', 'some-thinking-model']
    const plain = ['qwen2.5-1.5b-instruct', 'google/gemma-4-e4b', 'qwen/qwen3-vl-8b', 'anthropic/claude-3.5-sonnet', 'anthropic/claude-sonnet-4.5', 'nvidia/nemotron-3-super-120b-a12b:free']
    expect(thinks.map((name) => guessCaps(name).thinking)).toEqual(thinks.map(() => true))
    expect(plain.map((name) => guessCaps(name).thinking)).toEqual(plain.map(() => false))
    expect(['anthropic/claude-haiku-5.5', 'claude-opus-5-5', 'anthropic/claude-fable-5.1'].map(takesTemperature)).toEqual([false, false, false])
    expect(['qwen2.5-1.5b-instruct', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-3.5-sonnet'].map(takesTemperature)).toEqual([true, true, true])
  })
})

describe('the OpenAI-compatible adapter', () => {
  const ok = { choices: [{ message: { content: '{"ops":[]}' } }], usage: { prompt_tokens: 380, completion_tokens: 20 } }

  it('sends the schema as a JSON Schema response format, at temperature 0', async () => {
    const calls = server(ok)
    const model = openAICompatible({ baseUrl: 'http://127.0.0.1:1234/v1/', model: 'qwen2.5-1.5b-instruct', label: 'lmstudio' })
    const result = await model.complete({ messages: [{ role: 'user', content: 'hi' }], schema: { type: 'object' }, maxTokens: 50 })
    expect(calls[0]!.url).toBe('http://127.0.0.1:1234/v1/chat/completions')
    expect(calls[0]!.body).toMatchObject({
      model: 'qwen2.5-1.5b-instruct',
      temperature: 0,
      max_tokens: 50,
      response_format: { type: 'json_schema', json_schema: { strict: true, schema: { type: 'object' } } },
    })
    expect(result).toMatchObject({ text: '{"ops":[]}', tokensIn: 380, tokensOut: 20 })
    expect(model.name).toBe('lmstudio:qwen2.5-1.5b-instruct')
  })

  it('reads the reasoning channel for a JSON choice a thinking model left out of its content', async () => {
    server({ choices: [{ message: { content: '', reasoning_content: '{"ops":[{"op":"none","why":"x"}]}' } }] })
    const result = await openAICompatible({ baseUrl: 'http://x', model: 'qwen/qwen3.5-9b' }).complete({ messages: [], schema: { type: 'object' }, maxTokens: 10 })
    expect(result.text).toBe('{"ops":[{"op":"none","why":"x"}]}')
  })

  it('never gives thinking as an answer in words: not from the reasoning channel, nor between think tags', async () => {
    server({ choices: [{ message: { content: '', reasoning_content: 'Thinking Process: the user wants a table...' } }] })
    const model = openAICompatible({ baseUrl: 'http://x', model: 'google/gemma-4-e4b' })
    expect((await model.complete({ messages: [], maxTokens: 10 })).text).toBe('')
    server({ choices: [{ message: { content: '<think>The user wants a list.</think>\n- one\n- two' } }] })
    expect((await model.complete({ messages: [], maxTokens: 10 })).text).toBe('\n- one\n- two')
    server({ choices: [{ message: { content: '<think>Still thinking when the room ran out' } }] })
    expect((await model.complete({ messages: [], maxTokens: 10 })).text).toBe('')
  })

  it('learns from a reply that a model thinks, as Gemma 4 does, and gives it room from then on', async () => {
    const calls = server({ choices: [{ message: { content: 'A tree.', reasoning_content: 'Thinking Process: ...' } }], usage: { completion_tokens: 240, completion_tokens_details: { reasoning_tokens: 229 } } })
    const model = openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-e4b' })
    await model.complete({ messages: [], maxTokens: 300 })
    await model.complete({ messages: [], maxTokens: 300 })
    expect(calls.map((c) => c.body.max_tokens)).toEqual([300, 300 + 512])
  })

  it('remembers a model thinks for the next Model made for it, as the app makes one per request, but not for another model', async () => {
    const calls = server({ choices: [{ message: { content: 'Shorter.', reasoning_content: 'Plan: ...' } }], usage: { completion_tokens: 240, completion_tokens_details: { reasoning_tokens: 229 } } })
    const made = () => openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-e4b' })
    await made().complete({ messages: [], maxTokens: 400 })
    await made().complete({ messages: [], maxTokens: 400 })
    await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-e2b' }).complete({ messages: [], maxTokens: 400 })
    expect(calls.map((c) => c.body.max_tokens)).toEqual([400, 400 + 512, 400])
  })

  it('asks once more, with four times the room, when a thinking model is cut off at its limit, and counts both calls', async () => {
    const replies = [
      { choices: [{ message: { content: '| Day | Rain |', reasoning_content: 'Thinking...' }, finish_reason: 'length' }], usage: { prompt_tokens: 900, completion_tokens: 812, completion_tokens_details: { reasoning_tokens: 700 } } },
      { choices: [{ message: { content: '| Day | Rain |\n| --- | --- |\n| Mon | 3 |' }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 1500, completion_tokens_details: { reasoning_tokens: 1300 } } },
    ]
    const calls: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body) as Record<string, unknown>)
      return new Response(JSON.stringify(replies[calls.length - 1]))
    })
    const result = await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'qwen/qwen3.5-9b' }).complete({ messages: [], maxTokens: 300 })
    expect(calls.map((c) => c.max_tokens)).toEqual([300 + 512, 300 + 512 * 4])
    expect(result).toMatchObject({ text: '| Day | Rain |\n| --- | --- |\n| Mon | 3 |', tokensIn: 1800, tokensOut: 2312, thinkingTokens: 2000 })
  })

  it('sends an API key only when given one, and reports server errors', async () => {
    const calls = server(ok)
    await openAICompatible({ baseUrl: 'https://openrouter.ai/api', model: 'm', apiKey: 'test-key' }).complete({ messages: [], maxTokens: 10 })
    expect(calls[0]!.headers.authorization).toBe('Bearer test-key')
    server({ error: { message: 'Model not loaded' } }, 404)
    await expect(openAICompatible({ baseUrl: 'http://x', model: 'm' }).complete({ messages: [], maxTokens: 10 })).rejects.toThrow(/404: Model not loaded/)
  })

  it('never puts the key in an error message, even when the server repeats it', async () => {
    server({ error: { message: 'Invalid key sk-or-test-1234 for this account' } }, 401)
    const failing = openAICompatible({ baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: 'sk-or-test-1234' }).complete({ messages: [], maxTokens: 10 })
    await expect(failing).rejects.toThrow('m: the server answered 401: Invalid key [key] for this account')
  })

  it('leaves the temperature out for Claude 5 and later, which refuse one', async () => {
    const calls = server(ok)
    await openAICompatible({ baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5' }).complete({ messages: [], maxTokens: 10 })
    expect(calls[0]!.body).not.toHaveProperty('temperature')
  })

  it('gives a thinking model room to think, little when it has no effort, and asks for the effort only when given one', async () => {
    const calls = server(ok)
    await openAICompatible({ baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5', effort: 'low' }).complete({ messages: [], maxTokens: 300 })
    await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'qwen/qwen3.5-9b' }).complete({ messages: [], maxTokens: 300 })
    await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-e4b' }).complete({ messages: [], maxTokens: 300 })
    expect(calls.map((c) => [c.body.max_tokens, c.body.reasoning])).toEqual([
      [300 + 1024, { effort: 'low' }],
      [300 + 512, undefined],
      [300, undefined],
    ])
  })

  it('reads OpenRouter\'s reasoning channel, thinking tokens and cost', async () => {
    server({
      choices: [{ message: { content: null, reasoning: '{"ops":[{"op":"none","why":"x"}]}' } }],
      usage: { prompt_tokens: 900, completion_tokens: 240, completion_tokens_details: { reasoning_tokens: 200 }, cost: 0.00042 },
    })
    const result = await openAICompatible({ baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5', extra: { usage: { include: true } } }).complete({ messages: [], schema: { type: 'object' }, maxTokens: 10 })
    expect(result).toMatchObject({ text: '{"ops":[{"op":"none","why":"x"}]}', tokensIn: 900, tokensOut: 240, thinkingTokens: 200, cost: 0.00042 })
  })

  it('sends extra fields with every request', async () => {
    const calls = server(ok)
    await openAICompatible({ baseUrl: 'https://openrouter.ai/api/v1', model: 'm', extra: { usage: { include: true } } }).complete({ messages: [], maxTokens: 10 })
    expect(calls[0]!.body).toMatchObject({ usage: { include: true } })
  })

  it('stops a call when the person presses Stop', async () => {
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const stop = new AbortController()
    const pending = openAICompatible({ baseUrl: 'http://x', model: 'm' }).complete({ messages: [], maxTokens: 10, signal: stop.signal })
    stop.abort()
    await expect(pending).rejects.toThrow('aborted')
  })
})

describe('a model LM Studio unloads while a request waits for it', () => {
  it('sends the request again: the model loads once more on the next one (seen 19 October 2026)', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      if (calls === 1) return new Response(JSON.stringify({ error: 'Model is unloaded.' }), { status: 400 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }))
    })
    const reply = await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-e4b' }).complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 })
    expect(reply.text).toBe('hello')
    expect(calls).toBe(2)
  })

  it('gives up after three tries, and never retries any other error', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return new Response(JSON.stringify({ error: 'Model is unloaded.' }), { status: 400 })
    })
    const model = openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'm' })
    await expect(model.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 })).rejects.toThrow(/Model is unloaded/u)
    expect(calls).toBe(3)
    calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return new Response(JSON.stringify({ error: 'No models loaded.' }), { status: 400 })
    })
    await expect(model.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 })).rejects.toThrow(/No models loaded/u)
    expect(calls).toBe(1)
  }, 10_000)
})

describe('a model asked not to think (the terminal\'s agent)', () => {
  /** LM Studio's list of models with their reasoning options, and a reply; every request recorded. */
  function lmStudio(reasoning: string[] | undefined) {
    const calls: { url: string; body?: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      calls.push({ url, ...(init?.body ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}) })
      if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify({ models: [{ key: 'google/gemma-4-e4b', capabilities: reasoning ? { reasoning: { allowed_options: reasoning, default: 'on' } } : {} }] }))
      return new Response(JSON.stringify({ choices: [{ message: { content: 'pen: use a red pencil' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 8, completion_tokens_details: { reasoning_tokens: 0 } } }))
    })
    return calls
  }
  const ask = { messages: [{ role: 'user' as const, content: 'a red pencil' }], maxTokens: 100 }

  it('sends reasoning_effort none, with no room for thinking, to a model LM Studio says can switch it off; asks once', async () => {
    const calls = lmStudio(['off', 'on'])
    const model = openAICompatible({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'google/gemma-4-e4b', thinking: 'off' })
    await model.complete(ask)
    await model.complete(ask)
    expect(calls.map((c) => c.url)).toEqual(['http://127.0.0.1:1234/api/v1/models', 'http://127.0.0.1:1234/v1/chat/completions', 'http://127.0.0.1:1234/v1/chat/completions'])
    expect(calls[1]!.body).toMatchObject({ reasoning_effort: 'none', max_tokens: 100 })
    forgetThinkers()
    const low = lmStudio(['off', 'on'])
    await openAICompatible({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'google/gemma-4-e4b', thinking: 'low' }).complete(ask)
    expect(low.at(-1)!.body).toMatchObject({ reasoning_effort: 'low' })
  })

  it('sends nothing of it to a model that cannot switch it off, to one never asked to, or to a server not on this computer', async () => {
    const onlyOn = lmStudio(['on'])
    await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-e4b', thinking: 'off' }).complete(ask)
    expect(onlyOn.at(-1)!.body).not.toHaveProperty('reasoning_effort')
    forgetThinkers()
    const none = lmStudio(undefined)
    await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-e4b', thinking: 'off' }).complete(ask)
    expect(none.at(-1)!.body).not.toHaveProperty('reasoning_effort')
    forgetThinkers()
    // The AI box asks nothing of it: its request as before, and no list asked for.
    const asBefore = lmStudio(['off', 'on'])
    await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-e4b' }).complete(ask)
    expect(asBefore.map((c) => c.url)).toEqual(['http://127.0.0.1:1234/v1/chat/completions'])
    expect(asBefore[0]!.body).not.toHaveProperty('reasoning_effort')
    forgetThinkers()
    const hosted = lmStudio(['off', 'on'])
    await openAICompatible({ baseUrl: 'https://openrouter.ai/api', model: 'google/gemma-4-e4b', thinking: 'off' }).complete(ask)
    expect(hosted.map((c) => c.url)).toEqual(['https://openrouter.ai/api/v1/chat/completions'])
  })
})

describe('getting a local model ready, as the prompt box opens', () => {
  it('loads a model the server has unloaded, with one request of one token, once a minute', async () => {
    const calls: { url: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      calls.push({ url, ...(init?.body ? { body: JSON.parse(init.body) as unknown } : {}) })
      if (url.endsWith('/api/v0/models')) return new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b', state: 'not-loaded' }, { id: 'other', state: 'loaded' }] }))
      return new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }))
    })
    const model = openAICompatible({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'google/gemma-4-e4b' })
    await model.prepare!()
    await model.prepare!()
    expect(calls.map((c) => c.url)).toEqual(['http://127.0.0.1:1234/api/v0/models', 'http://127.0.0.1:1234/v1/chat/completions'])
    expect(calls[1]!.body).toEqual({ model: 'google/gemma-4-e4b', messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 })
  })

  it('sends nothing for a loaded model, a server that cannot say, or one not on this computer, and never throws', async () => {
    const calls: string[] = []
    let listing: () => Response = () => new Response(JSON.stringify({ data: [{ id: 'm', state: 'loaded' }] }))
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return listing()
    })
    await openAICompatible({ baseUrl: 'http://localhost:1234', model: 'm' }).prepare!()
    forgetThinkers()
    listing = () => new Response('not found', { status: 404 })
    await openAICompatible({ baseUrl: 'http://localhost:1234', model: 'm' }).prepare!()
    forgetThinkers()
    listing = () => {
      throw new Error('connection refused')
    }
    await expect(openAICompatible({ baseUrl: 'http://localhost:1234', model: 'm' }).prepare!()).resolves.toBeUndefined()
    await openAICompatible({ baseUrl: 'https://openrouter.ai/api', model: 'm' }).prepare!()
    expect(calls).toEqual(['http://localhost:1234/api/v0/models', 'http://localhost:1234/api/v0/models', 'http://localhost:1234/api/v0/models'])
  })
})

describe('a reply streamed for a person waiting on it', () => {
  const sse = (chunks: unknown[]): Response =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  const delta = (d: Record<string, string>, finish: string | null = null) => ({ choices: [{ delta: d, finish_reason: finish }] })

  it('is told as it comes, thinking apart from the answer, and comes back as the same reply, with its usage', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>)
      return sse([
        delta({ reasoning_content: 'Plan: ' }),
        delta({ reasoning_content: 'say it simply.' }),
        delta({ content: 'Waves move ' }),
        delta({ content: 'energy.' }, 'stop'),
        { choices: [], usage: { prompt_tokens: 26, completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 2 } } },
      ])
    })
    const seen: { thinking: number; written: number; text: string }[] = []
    const result = await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'm' }).complete({ messages: [], maxTokens: 400, onProgress: (p) => seen.push(p) })
    expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(seen.map((p) => [p.thinking, p.written, p.text])).toEqual([
      [1, 0, ''],
      [2, 0, ''],
      [2, 1, 'Waves move '],
      [2, 2, 'Waves move energy.'],
      [2, 2, 'Waves move energy.'],
    ])
    expect(result).toMatchObject({ text: 'Waves move energy.', tokensIn: 26, tokensOut: 4, thinkingTokens: 2 })
  })

  it('counts thinking written between think tags as thinking, and never shows it', async () => {
    vi.stubGlobal('fetch', async () => sse([delta({ content: '<think>hmm' }), delta({ content: '</think>' }), delta({ content: 'Yes.' }, 'stop')]))
    const seen: { thinking: number; written: number; text: string }[] = []
    const result = await openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'm' }).complete({ messages: [], maxTokens: 50, onProgress: (p) => seen.push(p) })
    expect(seen.at(-1)).toEqual({ thinking: 2, written: 1, text: 'Yes.' })
    expect(result.text).toBe('Yes.')
  })

  it('is read as usual from a server that does not stream; is asked as usual without a caller waiting; and an error in it is told', async () => {
    const bodies: Record<string, unknown>[] = []
    let answer: () => Response = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Plain.' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } })
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>)
      return answer()
    })
    const model = openAICompatible({ baseUrl: 'http://127.0.0.1:1234', model: 'm' })
    expect((await model.complete({ messages: [], maxTokens: 10, onProgress: () => {} })).text).toBe('Plain.')
    await model.complete({ messages: [], maxTokens: 10 })
    expect(bodies[1]).not.toHaveProperty('stream')
    answer = () => sse([{ error: { message: 'out of memory' } }])
    await expect(model.complete({ messages: [], maxTokens: 10, onProgress: () => {} })).rejects.toThrow('m: the server answered 200: out of memory')
  })
})
