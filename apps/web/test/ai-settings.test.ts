// The AI settings: kept in this browser, with the OpenRouter key apart from
// them, and the model they name made ready to call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetKey, LM_STUDIO, loadSettings, missing, modelFrom, saveKey, savedKey, saveSettings } from '../src/ai/settings.js'

const KEY = 'sk-or-test-key'

beforeEach(() => {
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => kept.get(name) ?? null,
    setItem: (name: string, value: string) => void kept.set(name, String(value)),
    removeItem: (name: string) => void kept.delete(name),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('the AI settings', () => {
  it('start with LM Studio on this computer and no model', () => {
    expect(loadSettings()).toEqual({ provider: 'lmstudio', baseUrl: LM_STUDIO, model: '' })
    expect(missing(loadSettings(), undefined)).toMatch(/Choose a model/u)
    expect(modelFrom(loadSettings(), undefined)).toBeUndefined()
  })

  it('come back as they were saved, and ignore what they do not know', () => {
    saveSettings({ provider: 'openrouter', baseUrl: LM_STUDIO, model: 'anthropic/claude-haiku-5.5', opSet: 'full', known: { vision: true, jsonSchema: true, thinking: true } })
    expect(loadSettings()).toMatchObject({ provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', opSet: 'full' })
    localStorage.setItem('shellnote:ai', '{"provider":"elsewhere","opSet":"huge"}')
    expect(loadSettings()).toEqual({ provider: 'lmstudio', baseUrl: LM_STUDIO, model: '' })
    localStorage.setItem('shellnote:ai', 'not json')
    expect(loadSettings().provider).toBe('lmstudio')
  })

  it('keep the key apart from the settings, until it is forgotten', () => {
    saveSettings({ provider: 'openrouter', baseUrl: LM_STUDIO, model: 'anthropic/claude-haiku-5.5' })
    expect(missing(loadSettings(), savedKey())).toMatch(/OpenRouter key/u)
    saveKey(`  ${KEY} `)
    expect(savedKey()).toBe(KEY)
    expect(localStorage.getItem('shellnote:ai')).not.toContain(KEY)
    expect(missing(loadSettings(), savedKey())).toBeUndefined()
    forgetKey()
    expect(savedKey()).toBeUndefined()
  })

  it('make the model they name: LM Studio by its address, OpenRouter with the key and a low effort for a thinking model', async () => {
    const calls: { url: string; body: Record<string, unknown>; auth?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, ...(init.headers.authorization ? { auth: init.headers.authorization } : {}) })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ops":[]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    })
    const local = modelFrom({ provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen2.5-1.5b-instruct', known: { vision: false } }, KEY)!
    expect(local.name).toBe('lmstudio:qwen2.5-1.5b-instruct')
    expect(local.caps.opSet).toBe('small')
    await local.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 })
    expect(calls[0]).toEqual({ url: 'http://127.0.0.1:1234/v1/chat/completions', body: expect.anything() as unknown })

    const hosted = modelFrom({ provider: 'openrouter', baseUrl: LM_STUDIO, model: 'anthropic/claude-haiku-5.5', opSet: 'small', known: { thinking: true, jsonSchema: true } }, KEY)!
    expect(hosted.caps).toMatchObject({ opSet: 'small', thinking: true, jsonSchema: true })
    await hosted.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 })
    expect(calls[1]).toMatchObject({ url: 'https://openrouter.ai/api/v1/chat/completions', auth: `Bearer ${KEY}`, body: { reasoning: { effort: 'low' } } })
  })
})
