// The AI settings: which server answers, which model, and the operation set.
// They are this browser's own, kept in localStorage, and the app works without
// them. An OpenRouter key is kept apart from them, on this device only, until
// "Forget key": never in a note, the library, the edit log or an error message,
// and sent only to openrouter.ai. In the Windows app it is kept by Windows,
// sealed for the person's account, and not in the browser's storage.
import type { Caps, Model, OpSet } from '@shellnote/core'
import { listModels, openAICompatible, openRouter, openRouterModels, type PageSetting } from '@shellnote/providers'

export type Provider = 'lmstudio' | 'openrouter'

export interface AiSettings {
  provider: Provider
  /** LM Studio's address. */
  baseUrl: string
  /** The model's id on that server; empty until one is chosen. */
  model: string
  /** The operation set, when chosen in Settings; else it is guessed from the model's size. */
  opSet?: OpSet
  /** What the server's list said about the model when it was chosen. */
  known?: { vision?: boolean; jsonSchema?: boolean; thinking?: boolean }
  /** The terminal's page, when chosen in Settings: one for every model, or the small models'; else by the model's size. */
  page?: Exclude<PageSetting, 'auto'>
  /**
   * How much the terminal's model thinks, where LM Studio can switch it: as the model is set (on, left out), low, or off
   * (the person's, measured on the agent test before one is chosen, 24 October 2026). The AI box's is as set.
   */
  thinking?: 'low' | 'off'
}

/** LM Studio's own address, the default. */
export const LM_STUDIO = 'http://127.0.0.1:1234/v1'

const SETTINGS = 'shellnote:ai'
const heard = new Set<() => void>()

/** Hear each change of the settings (Settings shows a model the agent chose, too). */
export function onSettings(listener: () => void): () => void {
  heard.add(listener)
  return () => heard.delete(listener)
}
const KEY = 'shellnote:openrouter-key'
const DEFAULT: AiSettings = { provider: 'lmstudio', baseUrl: LM_STUDIO, model: '' }

/** The settings kept in this browser, or the defaults. */
export function loadSettings(): AiSettings {
  try {
    const kept = JSON.parse(localStorage.getItem(SETTINGS) ?? 'null') as Partial<AiSettings> | null
    if (!kept || typeof kept !== 'object') return DEFAULT
    return {
      provider: kept.provider === 'openrouter' ? 'openrouter' : 'lmstudio',
      baseUrl: typeof kept.baseUrl === 'string' && kept.baseUrl !== '' ? kept.baseUrl : LM_STUDIO,
      model: typeof kept.model === 'string' ? kept.model : '',
      ...(kept.opSet === 'small' || kept.opSet === 'full' ? { opSet: kept.opSet } : {}),
      ...(kept.known && typeof kept.known === 'object' ? { known: kept.known } : {}),
      ...(kept.page === 'overall' || kept.page === 'small' ? { page: kept.page } : {}),
      ...(kept.thinking === 'low' || kept.thinking === 'off' ? { thinking: kept.thinking } : {}),
    }
  } catch {
    return DEFAULT
  }
}

export function saveSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(settings))
  } catch {
    // Not kept, as in a private window: the settings hold until the page closes.
  }
  for (const listener of [...heard]) listener()
}

/**
 * Where the key is kept when the browser's own storage is not the place: in the Windows app, Windows itself, which
 * seals it for the person's account (apps/desktop/src-tauri/src/keys.rs). The browser's storage lies on the disk
 * as plain text.
 */
export interface KeyKeeper {
  read(): Promise<string | undefined>
  keep(key: string): Promise<void>
  forget(): Promise<void>
}

/** The keeper in use, and the key as it last gave it: asked once as the app starts, then held while the page lives. */
let keeper: KeyKeeper | undefined
let held: string | undefined

const fromStorage = (): string | undefined => {
  try {
    return localStorage.getItem(KEY) || undefined
  } catch {
    return undefined
  }
}
const outOfStorage = (): void => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing was kept.
  }
}

/**
 * Keep the key with a keeper from here on (the Windows app, as it starts). A key the browser's storage still holds,
 * from before, moves to the keeper and leaves the storage, once the keeper has it. A keeper that cannot be asked
 * (a page that is not the app's own) is not used: the key stays where it was.
 */
export async function keepKeyWith(next: KeyKeeper): Promise<void> {
  let kept: string | undefined
  try {
    kept = await next.read()
    const before = fromStorage()
    if (before !== undefined) {
      if (kept === undefined) {
        await next.keep(before)
        kept = before
      }
      outOfStorage()
    }
  } catch {
    return
  }
  keeper = next
  held = kept
  for (const listener of [...heard]) listener()
  // Another window of the app that keeps or forgets the key says so, and this one asks the keeper again: each
  // window holds the key in its own memory, where the browser's storage was shared between them.
  if (typeof BroadcastChannel !== 'undefined') {
    told = new BroadcastChannel(KEY)
    told.onmessage = () => {
      void next.read().then(
        (now) => {
          if (keeper !== next) return
          held = now
          for (const listener of [...heard]) listener()
        },
        () => undefined,
      )
    }
  }
}

/** The word between the app's windows that the key changed. */
let told: BroadcastChannel | undefined

/** For tests: the key kept in the browser's storage again, as with no keeper. */
export function keepKeyInStorage(): void {
  keeper = undefined
  held = undefined
  told?.close()
  told = undefined
}

/** The OpenRouter key kept on this device, if any. */
export function savedKey(): string | undefined {
  return keeper ? held : fromStorage()
}

export function saveKey(key: string): void {
  const value = key.trim()
  if (keeper) {
    held = value
    // Should the keeper fail, the key is kept as before rather than lost when the app closes.
    keeper.keep(value).then(
      () => told?.postMessage('kept'),
      () => {
        try {
          localStorage.setItem(KEY, value)
        } catch {
          // Not kept: it holds until the page closes.
        }
      },
    )
    return
  }
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // Not kept, as in a private window.
  }
}

export function forgetKey(): void {
  if (keeper) {
    held = undefined
    keeper.forget().then(
      () => told?.postMessage('forgotten'),
      () => undefined,
    )
  }
  outOfStorage()
}

/** Why the AI cannot run with these settings, in words for the person; undefined when it can. */
export function missing(settings: AiSettings, key: string | undefined): string | undefined {
  if (settings.model === '') return 'Choose a model first, in Settings under AI.'
  if (settings.provider === 'openrouter' && key === undefined) return 'Add your OpenRouter key first, in Settings under AI.'
  return undefined
}

/**
 * The model the settings name, ready to call; undefined while something is missing. `use.thinking`: asked to think
 * little or not at all where LM Studio can switch it (the terminal's agent); the AI box gives none.
 */
export function modelFrom(settings: AiSettings, key: string | undefined, use: { thinking?: 'low' | 'off' } = {}): Model | undefined {
  if (missing(settings, key) !== undefined) return undefined
  const caps: Partial<Caps> = { ...settings.known, ...(settings.opSet ? { opSet: settings.opSet } : {}) }
  if (settings.provider === 'openrouter') {
    // A thinking model thinks a little: as the benchmark measured it, and quick.
    return openRouter({ model: settings.model, apiKey: key!, caps, ...(settings.known?.thinking ? { effort: 'low' as const } : {}) })
  }
  return openAICompatible({ baseUrl: settings.baseUrl, model: settings.model, label: 'lmstudio', caps, ...(use.thinking ? { thinking: use.thinking } : {}) })
}

/** A model a server offers, as Settings lists it. */
export type Listed = { id: string; label: string; known: NonNullable<AiSettings['known']> }

/** The models a server offers, as last asked: Settings' list, and ai.useModel's, without asking again each time. */
let lastListed: { provider: Provider; baseUrl: string; models: Listed[] } | undefined

/** Ask a server for its models (and remember the answer). Throws when it cannot be reached. */
export async function fetchModels(provider: Provider, baseUrl: string): Promise<Listed[]> {
  const models: Listed[] =
    provider === 'lmstudio'
      ? (await listModels(baseUrl)).map((m) => ({ id: m.id, label: m.id, known: { vision: m.type === 'vlm' } }))
      : (await openRouterModels())
          .map((m) => ({ id: m.id, label: `${m.name}: $${m.price.in} / $${m.price.out} per million tokens`, known: { vision: m.vision, jsonSchema: m.jsonSchema, thinking: m.thinking } }))
          .sort((a, b) => a.label.localeCompare(b.label))
  lastListed = { provider, baseUrl, models }
  return models
}

/** The models the settings' server offers: as last asked, or asked now. */
export async function modelsNow(settings: AiSettings): Promise<Listed[]> {
  const kept = lastListed
  if (kept && kept.provider === settings.provider && (settings.provider === 'openrouter' || kept.baseUrl === settings.baseUrl)) return kept.models
  return fetchModels(settings.provider, settings.baseUrl)
}

/** The settings with a model chosen from the list: what the list knows of it goes with it. */
export function withModel(settings: AiSettings, id: string, listed: Listed | undefined): AiSettings {
  const next: AiSettings = { provider: settings.provider, baseUrl: settings.baseUrl, model: id, ...(settings.opSet ? { opSet: settings.opSet } : {}), ...(settings.page ? { page: settings.page } : {}), ...(settings.thinking ? { thinking: settings.thinking } : {}) }
  return listed ? { ...next, known: listed.known } : next
}
