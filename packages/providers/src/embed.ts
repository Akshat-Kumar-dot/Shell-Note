// An embedding model on LM Studio (app control's step 5: the finder's third way, by meaning). Texts become vectors
// through LM Studio's /v1/embeddings, and the finder compares them. The model is the person's own, loaded in LM
// Studio; none comes with the app. nomic-embed-text-v1.5 (Apache-2.0, checked 19 October 2026) wants a task's words
// before each text: search_query for a request, search_document for what it is matched against (its model card).
import type { Embedder } from '@shellnote/core'

/** How many texts go in one request. */
const BATCH = 64

/** A model family's own words before a text, from its card; none for a family that has none. */
export function embeddingPrefix(model: string, kind: 'query' | 'document'): string {
  if (/nomic-embed/iu.test(model)) return kind === 'query' ? 'search_query: ' : 'search_document: '
  return ''
}

/** LM Studio's server without /v1, as its two APIs need. */
const serverOf = (baseUrl: string): string => baseUrl.replace(/\/+$/u, '').replace(/\/v1$/u, '')

/** An embedder on an OpenAI-compatible server (LM Studio): throws when it cannot answer, so the finder goes without. */
export function lmStudioEmbedder(options: { baseUrl: string; model: string }): Embedder {
  const base = serverOf(options.baseUrl)
  return async (texts, kind) => {
    const prefix = embeddingPrefix(options.model, kind)
    const vectors: number[][] = []
    for (let at = 0; at < texts.length; at += BATCH) {
      const batch = texts.slice(at, at + BATCH).map((text) => prefix + text)
      const response = await fetch(`${base}/v1/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: options.model, input: batch }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) throw new Error(`The embedding model did not answer (${response.status}).`)
      const json = (await response.json()) as { data?: { embedding: number[]; index?: number }[] }
      const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      if (data.length !== batch.length) throw new Error('The embedding model gave back the wrong number of vectors.')
      for (const item of data) vectors.push(item.embedding)
    }
    return vectors
  }
}

/**
 * The embedding models a server offers: LM Studio says which models are; another server, none known. With `loaded`,
 * only those loaded now: asking LM Studio for one it must load first can unload the chat model in use (its setting
 * to keep one model loaded on demand, seen 19 October 2026: each request then waits for two models to load).
 */
export async function embeddingModels(baseUrl: string, options: { loaded?: boolean } = {}): Promise<string[]> {
  const response = await fetch(`${serverOf(baseUrl)}/api/v0/models`, { signal: AbortSignal.timeout(5_000) }).catch(() => undefined)
  if (!response?.ok) return []
  const json = (await response.json()) as { data?: { id: string; type?: string; state?: string }[] }
  return (json.data ?? []).filter((m) => m.type === 'embeddings' && (!options.loaded || m.state === 'loaded')).map((m) => m.id)
}
