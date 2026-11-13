// The OpenRouter key with a keeper (the Windows app, where Windows seals it for the person's account): it is read
// from the keeper and held while the page lives, and it is never in the browser's storage, which lies on the disk as
// plain text. A key the storage holds from before moves to the keeper.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetKey, keepKeyInStorage, keepKeyWith, onSettings, saveKey, savedKey, type KeyKeeper } from '../src/ai/settings.js'

const KEY = 'sk-or-test-key'
const STORED = 'shellnote:openrouter-key'

/** A keeper in memory, as Windows is in the app; `broken` makes it refuse, as for a page that is not the app's own. */
function keeperOf(start?: string): KeyKeeper & { kept: string | undefined; broken: boolean; calls: string[] } {
  const keeper = {
    kept: start,
    broken: false,
    calls: [] as string[],
    async read() {
      keeper.calls.push('read')
      if (keeper.broken) throw new Error('refused')
      return keeper.kept
    },
    async keep(key: string) {
      keeper.calls.push('keep')
      if (keeper.broken) throw new Error('refused')
      keeper.kept = key
    },
    async forget() {
      keeper.calls.push('forget')
      if (keeper.broken) throw new Error('refused')
      keeper.kept = undefined
    },
  }
  return keeper
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let stored: Map<string, string>
beforeEach(() => {
  stored = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => stored.get(name) ?? null,
    setItem: (name: string, value: string) => void stored.set(name, String(value)),
    removeItem: (name: string) => void stored.delete(name),
  })
  vi.stubGlobal('BroadcastChannel', undefined)
})
afterEach(() => {
  keepKeyInStorage()
  vi.unstubAllGlobals()
})

describe('the key with a keeper', () => {
  it('is read from the keeper as the app starts, and those who show it are told', async () => {
    const keeper = keeperOf(KEY)
    let told = 0
    const stop = onSettings(() => told++)
    expect(savedKey()).toBeUndefined()
    await keepKeyWith(keeper)
    expect(savedKey()).toBe(KEY)
    expect(told).toBe(1)
    expect(stored.has(STORED)).toBe(false)
    stop()
  })

  it('is kept by the keeper and never written into the storage; forgotten, it is gone from both', async () => {
    const keeper = keeperOf()
    await keepKeyWith(keeper)
    saveKey(`  ${KEY} `)
    // Known at once, as before, and with the keeper a moment later.
    expect(savedKey()).toBe(KEY)
    await settle()
    expect(keeper.kept).toBe(KEY)
    expect(stored.has(STORED)).toBe(false)
    forgetKey()
    expect(savedKey()).toBeUndefined()
    await settle()
    expect(keeper.kept).toBeUndefined()
    expect(stored.has(STORED)).toBe(false)
  })

  it('moves a key the storage holds from before to the keeper, and takes it out of the storage only once it is there', async () => {
    stored.set(STORED, KEY)
    const keeper = keeperOf()
    await keepKeyWith(keeper)
    expect(keeper.kept).toBe(KEY)
    expect(savedKey()).toBe(KEY)
    expect(stored.has(STORED)).toBe(false)
    // The keeper's own key stands, should both hold one: it is the later.
    stored.set(STORED, 'sk-or-an-older-key')
    const second = keeperOf(KEY)
    await keepKeyWith(second)
    expect(savedKey()).toBe(KEY)
    expect(stored.has(STORED)).toBe(false)
  })

  it('a keeper that cannot be asked is not used: the key stays where it was, and is not lost', async () => {
    stored.set(STORED, KEY)
    const keeper = keeperOf()
    keeper.broken = true
    await keepKeyWith(keeper)
    expect(savedKey()).toBe(KEY)
    expect(stored.get(STORED)).toBe(KEY)
    saveKey('sk-or-another')
    expect(stored.get(STORED)).toBe('sk-or-another')
  })

  it('a keeper that fails as the key is kept leaves the key as it was kept before, not lost when the app closes', async () => {
    const keeper = keeperOf()
    await keepKeyWith(keeper)
    keeper.broken = true
    saveKey(KEY)
    expect(savedKey()).toBe(KEY)
    await settle()
    expect(stored.get(STORED)).toBe(KEY)
  })
})
