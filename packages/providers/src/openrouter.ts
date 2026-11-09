// OpenRouter, the hosted service the person chose: one key reaches many hosted
// models through the same OpenAI-compatible API. The key goes only to
// openrouter.ai, because this adapter's address is fixed.
import type { Caps, Model } from '@shellnote/core'
import { guessCaps } from './caps.js'
import { openAICompatible, type Effort } from './openai.js'

export const OPENROUTER = 'https://openrouter.ai/api/v1'

export interface OpenRouterOptions {
  /** OpenRouter's id, for example "anthropic/claude-haiku-5.5" or "nvidia/nemotron-3-super-120b-a12b:free". */
  model: string
  apiKey: string
  /** How hard a thinking model thinks. */
  effort?: Effort
  /** Overrides for the guessed capabilities, for example from capsFor(). */
  caps?: Partial<Caps>
  timeoutMs?: number
}

export function openRouter(options: OpenRouterOptions): Model {
  return openAICompatible({
    baseUrl: OPENROUTER,
    model: options.model,
    apiKey: options.apiKey,
    label: 'openrouter',
    ...(options.caps ? { caps: options.caps } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    // Claude caches the fixed prefix when asked to; other providers cache on their own or not at all.
    cacheSystem: options.model.startsWith('anthropic/'),
    // The cost of each call in its reply, and only providers that honour every
    // parameter sent, the JSON Schema above all, so a reply is never silently
    // left unconstrained.
    extra: { usage: { include: true }, provider: { require_parameters: true } },
  })
}

/** A model OpenRouter offers, as its public list describes it. */
export interface HostedModel {
  id: string
  name: string
  /** Takes pictures: the vision request may use it. */
  vision: boolean
  /** Honours a JSON Schema on the reply (OpenRouter's "structured_outputs"). */
  jsonSchema: boolean
  /** Thinks before it answers, and takes reasoning.effort. */
  thinking: boolean
  /** US dollars per million tokens, in and out; 0 for a free model. */
  price: { in: number; out: number }
  contextLength?: number
}

interface RawModel {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
  architecture?: { input_modalities?: string[] }
}

const perMillion = (perToken: string | undefined): number => Math.round(Number(perToken ?? 0) * 1e6 * 1e6) / 1e6

export function toHosted(raw: RawModel): HostedModel {
  const params = raw.supported_parameters ?? []
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    vision: (raw.architecture?.input_modalities ?? []).includes('image'),
    jsonSchema: params.includes('structured_outputs'),
    thinking: params.includes('reasoning'),
    price: { in: perMillion(raw.pricing?.prompt), out: perMillion(raw.pricing?.completion) },
    ...(raw.context_length === undefined ? {} : { contextLength: raw.context_length }),
  }
}

/** The models OpenRouter offers, from its public list: no key needed. */
export async function openRouterModels(): Promise<HostedModel[]> {
  const response = await fetch(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`OpenRouter's model list answered ${response.status}`)
  const json = (await response.json()) as { data?: RawModel[] }
  return (json.data ?? []).map(toHosted)
}

/**
 * Capabilities from OpenRouter's own description of a model, on top of the
 * guess from its name: whether it takes a JSON Schema, pictures and an effort.
 * Without a schema, the edit asks for JSON, checks it and retries once.
 */
export function capsFor(model: HostedModel, overrides: Partial<Caps> = {}): Caps {
  return guessCaps(model.id, { jsonSchema: model.jsonSchema, vision: model.vision, thinking: model.thinking, ...overrides })
}
