// One adapter reaches most servers: the OpenAI-compatible
// chat completions API with a JSON Schema response format. LM Studio, Ollama,
// the llama.cpp server, OpenRouter and OpenAI all speak it.
import type { Caps, CompleteRequest, CompleteResult, Model, Progress } from '@shellnote/core'
import { guessCaps, takesTemperature } from './caps.js'

/** How hard a thinking model thinks: OpenRouter's reasoning.effort. */
export type Effort = 'low' | 'medium' | 'high'

export interface OpenAIOptions {
  /** For example http://127.0.0.1:1234 for LM Studio. A trailing /v1 is fine too. */
  baseUrl: string
  /** The model id the server knows, for example "qwen2.5-1.5b-instruct". */
  model: string
  /** Sent as a Bearer token. Local servers need none. */
  apiKey?: string
  /** Overrides for the capabilities guessed from the model's name. */
  caps?: Partial<Caps>
  /** How long one call may take before it is abandoned. Default two minutes, enough to load a model. */
  timeoutMs?: number
  /** A prefix for the model's name in the edit log. Default "openai". */
  label?: string
  /** How hard a thinking model thinks. Sent only when given, as OpenRouter's reasoning.effort. */
  effort?: Effort
  /**
   * 'off': asked not to think, 'low': to think little, where its server can switch thinking (LM Studio lists each
   * model's reasoning options): for the terminal's agent (measured before it is chosen). Left out: the model as
   * it is set.
   */
  thinking?: 'off' | 'low'
  /** More fields for every request body, such as OpenRouter's usage accounting. */
  extra?: Record<string, unknown>
  /**
   * Mark the system prompt, the fixed prefix, as cacheable (Anthropic's
   * cache_control, which OpenRouter passes on), so repeated calls read it
   * for a fraction of the price.
   */
  cacheSystem?: boolean
}

/**
 * The room a thinking model gets for its thinking, on top of the reply's own
 * limit: its thinking counts against max_tokens, and a reply cut off while it
 * still thinks comes back empty.
 */
export const THINKING_ROOM: Record<Effort, number> = { low: 1024, medium: 2048, high: 4096 }

/**
 * The room for a thinking model given no effort, as on LM Studio, which is
 * sent none: small, so a local thinking model answers in seconds rather than
 * thinking for a minute or two.
 */
export const LOCAL_THINKING_ROOM = 512

/**
 * Models known to think, by server and name, kept while the page or process
 * lives: the app makes a new Model for each request, and each had to learn
 * again. Learning costs a reply: gemma-4-e4b, asked to shorten a long
 * paragraph with no room to think, ran out of room and was asked again, 15 s
 * where 8 s did (11 October 2026).
 */
const thinkers = new Set<string>()

/** Forget which models think, as a new page would: for tests. */
export function forgetThinkers(): void {
  thinkers.clear()
  warming.clear()
  switchable.clear()
}

/** Whether a local model's thinking can be switched off, by server and name, asked once while the page lives. */
const switchable = new Map<string, Promise<boolean>>()

/**
 * Whether a local model can be asked not to think: LM Studio (0.4.8 on) lists each model's reasoning options at
 * /api/v1/models, "off" among them for Gemma 4 and Qwen3.5, only "on" for DeepSeek R1, none for a model that never
 * thinks (checked on a test laptop, 24 October 2026). A server that cannot say: no. Never throws.
 */
function canSwitchOff(base: string, model: string, known: string): Promise<boolean> {
  let asked = switchable.get(known)
  if (!asked) {
    asked = (async () => {
      if (!LOCAL.test(base)) return false
      try {
        const listed = await fetch(`${base}/api/v1/models`, { signal: AbortSignal.timeout(5_000) })
        if (!listed.ok) return false
        const models = ((await listed.json()) as { models?: { key?: string; capabilities?: { reasoning?: { allowed_options?: string[] } } }[] }).models ?? []
        return models.find((one) => one.key === model)?.capabilities?.reasoning?.allowed_options?.includes('off') === true
      } catch {
        return false
      }
    })()
    switchable.set(known, asked)
  }
  return asked
}

/** When each model was last asked to load, by server and name: one warm-up a minute is enough. */
const warming = new Map<string, number>()

/** A server on this computer, as LM Studio is: one that loads and unloads models. */
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu

/**
 * Load a local model that its server has unloaded, as LM Studio does after an
 * hour unused: a request of one token makes it load while the person types
 * (14.8 s for gemma-4-e4b, 7.2 s for gemma-4-e2b, measured on 12 October
 * 2026). Nothing is sent when the model is loaded, or when the server cannot
 * say; it never throws.
 */
async function warmUp(base: string, model: string, known: string): Promise<void> {
  if (!LOCAL.test(base) || Date.now() - (warming.get(known) ?? 0) < 60_000) return
  warming.set(known, Date.now())
  try {
    const listed = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(5_000) })
    if (!listed.ok) return
    const state = ((await listed.json()) as { data?: { id: string; state?: string }[] }).data?.find((m) => m.id === model)?.state
    if (state !== 'not-loaded') return
    await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    // Not a server that says, or not up: the request itself will tell the person.
  }
}

/** Thinking a model wrote into its answer, between think tags, or cut off before the closing tag. */
const THINK = /<think>[\s\S]*?(?:<\/think>|$)/giu

/**
 * The answer in a reply. Thinking is never shown as one: written into the
 * content between think tags, it is taken out. The reasoning channel holds
 * an answer only for a choice held to a JSON Schema, where a thinking model
 * may leave the content empty;
 * for words, what is there is thinking. LM Studio calls that channel
 * reasoning_content; OpenRouter, reasoning.
 */
function answerOf(message: ChatMessage, json: boolean): string {
  const content = (message.content ?? '').replace(THINK, '')
  if (content.trim() !== '') return content
  return json ? message.reasoning_content || message.reasoning || '' : ''
}

/** Whether a reply shows its model thought before answering: thinking tokens counted, or thinking sent. */
function thought(reply: ChatResponse): boolean {
  const usage = reply.usage ?? {}
  const tokens = usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? 0
  const message = reply.choices?.[0]?.message ?? {}
  return tokens > 0 || Boolean(message.reasoning_content || message.reasoning) || /<think>/iu.test(message.content ?? '')
}

/** One chunk of a streamed reply, as an OpenAI-compatible server sends it. */
interface ChatChunk {
  choices?: { delta?: ChatMessage; finish_reason?: string | null }[]
  usage?: ChatResponse['usage']
  error?: string | { message?: string }
}

/**
 * A streamed reply (server-sent events), read as it comes and told to
 * `onProgress`, put together into the reply a call without streaming gets:
 * the same answer, thinking, finish and usage. LM Studio sends thinking as
 * reasoning_content and OpenRouter as reasoning; usage comes in the last chunk.
 */
async function readStream(body: ReadableStream<Uint8Array>, onProgress: (progress: Progress) => void, fail: (reason: string) => Error): Promise<ChatResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let content = ''
  let reasoning = ''
  let thinking = 0
  let written = 0
  let finish: string | null = null
  let usage: ChatResponse['usage']
  let rest = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const lines = (rest + decoder.decode(value, { stream: true })).split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (data === '' || data === '[DONE]') continue
      const chunk = JSON.parse(data) as ChatChunk
      if (chunk.error) throw fail(typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? 'error'))
      const choice = chunk.choices?.[0]
      const said = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
      if (said) reasoning += said
      const before = content.replace(THINK, '').length
      if (choice?.delta?.content) content += choice.delta.content
      // Thinking written between think tags counts as thinking, not as the answer.
      if (content.replace(THINK, '').length > before) written++
      else if (said || choice?.delta?.content) thinking++
      if (choice?.finish_reason) finish = choice.finish_reason
      if (chunk.usage) usage = chunk.usage
      onProgress({ thinking, written, text: content.replace(THINK, '') })
    }
  }
  return { choices: [{ message: { content, ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: finish }], ...(usage ? { usage } : {}) }
}

/**
 * A Model that talks to any server with the OpenAI chat completions API. Beside sending the request, it deals with
 * what those servers do differently, so core never has to know:
 *
 * - a thinking model gets room to think on top of the reply's limit, and a model is known to think by its first reply
 *   that does (`thinks`); a reply cut off at its limit goes once more, with four times the room;
 * - LM Studio's "Model is unloaded", when another model has just taken its place, is sent again, up to twice;
 * - a caller showing progress gets the reply streamed, and a server that does not stream is read as usual;
 * - an error message never carries the key.
 *
 * The app makes a new Model for each request, so what one learns about a model is kept outside it (`thinkers`).
 */
export function openAICompatible(options: OpenAIOptions): Model {
  const base = options.baseUrl.replace(/\/+$/u, '').replace(/\/v1$/u, '')
  const caps = guessCaps(options.model, options.caps)
  // An error message never carries the key, even when a server repeats it back.
  const redact = (text: string): string => (options.apiKey ? text.split(options.apiKey).join('[key]') : text)
  // A model whose name does not say it thinks, as Gemma 4 does on LM Studio, is
  // known to by its first reply that thinks: from then on it gets room to.
  const known = `${base} ${options.model}`
  let thinks = caps.thinking === true || thinkers.has(known)
  const room = (): number => (thinks ? (options.effort ? THINKING_ROOM[options.effort] : LOCAL_THINKING_ROOM) : 0)
  return {
    name: `${options.label ?? 'openai'}:${options.model}`,
    caps,
    prepare: () => warmUp(base, options.model, known),
    async complete(request: CompleteRequest): Promise<CompleteResult> {
      const started = Date.now()
      const temperature = takesTemperature(options.model) ? (request.temperature ?? 0) : undefined
      const messages = options.cacheSystem
        ? request.messages.map((message) =>
            message.role === 'system' && typeof message.content === 'string'
              ? { role: 'system', content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }] }
              : message,
          )
        : request.messages
      // The caller's signal is a real AbortSignal; core only knows it as StopSignal.
      const stop = request.signal as AbortSignal | undefined
      // Asked to think less, and able to: LM Studio's reasoning_effort "none" (its "off" is refused), with no room
      // kept for thinking, or "low".
      const switched = options.thinking !== undefined && (await canSwitchOff(base, options.model, known))
      const off = switched && options.thinking === 'off'
      const post = async (extra: number): Promise<ChatResponse> => {
        const body = {
          model: options.model,
          messages,
          max_tokens: request.maxTokens + extra,
          ...(temperature === undefined ? {} : { temperature }),
          ...(request.schema
            ? { response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: request.schema } } }
            : {}),
          ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
          ...(switched ? { reasoning_effort: off ? 'none' : 'low' } : {}),
          // Streamed only for a caller showing progress: the same reply, told as it comes.
          ...(request.onProgress ? { stream: true, stream_options: { include_usage: true } } : {}),
          ...options.extra,
        }
        const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000)
        const response = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: stop ? AbortSignal.any([stop, timeout]) : timeout,
        })
        // A server that does not stream answers as usual, and is read as usual.
        if (request.onProgress && response.ok && response.body && (response.headers.get('content-type') ?? '').includes('text/event-stream')) {
          return readStream(response.body, request.onProgress, (reason) => new Error(redact(`${options.model}: the server answered ${response.status}: ${reason}`)))
        }
        const json = (await response.json().catch(() => ({}))) as ChatResponse
        if (!response.ok || json.error) {
          const reason = typeof json.error === 'string' ? json.error : (json.error?.message ?? response.statusText)
          throw new Error(redact(`${options.model}: the server answered ${response.status}: ${reason}`))
        }
        return json
      }
      // LM Studio unloading the model a request waits for (another model loaded in its place, seen 19 October 2026)
      // answers "Model is unloaded": the model loads again on the next request, so the request is sent again.
      const sent = async (extra: number): Promise<ChatResponse> => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await post(extra)
          } catch (error) {
            const unloaded = error instanceof Error && /model (is|was) unloaded/iu.test(error.message)
            if (!unloaded || attempt >= 2 || stop?.aborted) throw error
            await new Promise((resolve) => setTimeout(resolve, 1_000))
          }
        }
      }
      let given = off ? 0 : room()
      let reply = await sent(given)
      const replies = [reply]
      if (thought(reply)) {
        thinks = true
        thinkers.add(known)
      }
      // Cut off at its limit while it thinks, or before its answer is whole: once more, with four times the room.
      if (reply.choices?.[0]?.finish_reason === 'length' && thinks) {
        given = Math.max(given, LOCAL_THINKING_ROOM) * 4
        reply = await sent(given)
        replies.push(reply)
      }
      const used = (key: 'prompt_tokens' | 'completion_tokens'): number => replies.reduce((sum, r) => sum + (r.usage?.[key] ?? 0), 0)
      const thinking = replies.reduce<number | undefined>((sum, r) => {
        const tokens = r.usage?.completion_tokens_details?.reasoning_tokens ?? r.usage?.reasoning_tokens
        return typeof tokens === 'number' ? (sum ?? 0) + tokens : sum
      }, undefined)
      const costs = replies.map((r) => r.usage?.cost).filter((cost): cost is number => typeof cost === 'number')
      return {
        text: answerOf(reply.choices?.[0]?.message ?? {}, request.schema !== undefined),
        tokensIn: used('prompt_tokens'),
        tokensOut: used('completion_tokens'),
        ...(thinking === undefined ? {} : { thinkingTokens: thinking }),
        ...(costs.length > 0 ? { cost: costs.reduce((sum, cost) => sum + cost, 0) } : {}),
        ms: Date.now() - started,
      }
    },
  }
}

interface ChatMessage {
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
}

interface ChatResponse {
  choices?: { message?: ChatMessage; finish_reason?: string | null }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
    reasoning_tokens?: number
    /** OpenRouter: what the call cost, in US dollars. */
    cost?: number
  }
  error?: string | { message?: string }
}

/** The models a server offers. LM Studio also says whether each is a language or vision model. */
export async function listModels(baseUrl: string): Promise<{ id: string; type?: string }[]> {
  const base = baseUrl.replace(/\/+$/u, '').replace(/\/v1$/u, '')
  const detailed = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  if (detailed?.ok) {
    const json = (await detailed.json()) as { data?: { id: string; type?: string }[] }
    return (json.data ?? []).filter((m) => m.type !== 'embeddings').map((m) => ({ id: m.id, ...(m.type ? { type: m.type } : {}) }))
  }
  const plain = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(10_000) })
  const json = (await plain.json()) as { data?: { id: string }[] }
  return (json.data ?? []).map((m) => ({ id: m.id }))
}
