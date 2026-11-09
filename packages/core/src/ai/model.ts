// A model, as core sees it. Core never does network I/O itself: the providers
// package makes Models (LM Studio, Ollama, OpenRouter…) and the caller passes
// one in. The same pipeline therefore runs in a browser, in Node and in tests.
import type { OpSet } from '../schema/protocol.js'

/** A piece of a message: words, or a picture as a data URL (the vision request only). */
export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface Message {
  role: 'system' | 'user' | 'assistant'
  /** Words, or for the vision request, words and one picture. */
  content: string | Part[]
}

/**
 * A caller's AbortSignal, as core sees it: core has no DOM or Node types, so
 * it only reads `aborted` and passes the signal on to the model, which stops
 * its call when the person presses Stop.
 */
export interface StopSignal {
  readonly aborted: boolean
}

export interface CompleteRequest {
  messages: Message[]
  /** A JSON Schema the reply must follow, when the server can enforce one. */
  schema?: Record<string, unknown>
  maxTokens: number
  temperature?: number
  /** Cancels the call: the person pressed Stop. */
  signal?: StopSignal
  /**
   * Called as the reply comes in, for a person waiting on it. The reply is
   * the same either way: only how it arrives changes (the server streams it).
   */
  onProgress?: (progress: Progress) => void
}

/** How far a call has got: tokens thought and written so far, and the answer so far. */
export interface Progress {
  thinking: number
  written: number
  text: string
}

/** How far an edit or a question has got: writing content, or answering. */
export interface StepProgress extends Progress {
  step: 'write' | 'answer'
}

export interface CompleteResult {
  text: string
  tokensIn: number
  tokensOut: number
  /** Of tokensOut, the tokens the model spent thinking, when the server says. */
  thinkingTokens?: number
  /** What the call cost, in US dollars, when the server says (OpenRouter does). */
  cost?: number
  ms: number
}

/** What a model can do, set per model. */
export interface Caps {
  /** The server enforces a JSON Schema on the reply (constrained decoding). */
  jsonSchema: boolean
  /** Strong enough to send long content inside the JSON, saving a call. */
  inlineContent: boolean
  /** Accepts images. Only the vision request uses it. */
  vision: boolean
  /** The operations it is offered: small models choose better from fewer. */
  opSet: OpSet
  /**
   * Thinks before it answers. Its thinking counts against the reply's token
   * limit, so the adapter gives it room for both.
   */
  thinking?: boolean
  /**
   * Holds the JSON Schema to Anthropic's strict mode, which refuses
   * `maxItems` and `maxLength`: the schema then leaves them out, and code
   * alone checks how many operations a reply has. Every other server gets
   * both, which keeps a small model to its one operation.
   */
  strictSchema?: boolean
}

export interface Model {
  /** For the edit log, for example "lmstudio:qwen2.5-1.5b-instruct". */
  name: string
  caps: Caps
  complete(request: CompleteRequest): Promise<CompleteResult>
  /**
   * Get ready for a request soon, as when the prompt box opens: a local
   * server that unloaded the model loads it again while the request is typed.
   * Optional, and never throws.
   */
  prepare?(): Promise<void>
}
