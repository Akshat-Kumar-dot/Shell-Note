// The embedding model on LM Studio (app control's step 5): its words before each text, the vectors in order, and
// which of a server's models are embedding models.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { embeddingModels, embeddingPrefix, lmStudioEmbedder } from '../src/index.js'

afterEach(() => vi.unstubAllGlobals())

describe('the embedding model', () => {
  it("puts nomic's words before a request and a document, and none before another family's", () => {
    expect(embeddingPrefix('text-embedding-nomic-embed-text-v1.5', 'query')).toBe('search_query: ')
    expect(embeddingPrefix('text-embedding-nomic-embed-text-v1.5', 'document')).toBe('search_document: ')
    expect(embeddingPrefix('some-other-embedder', 'query')).toBe('')
  })

  it('asks /v1/embeddings in batches and gives the vectors back in the order of the texts', async () => {
    const asked: string[][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_: string, init: RequestInit) => {
        const input = (JSON.parse(String(init.body)) as { input: string[] }).input
        asked.push(input)
        // Answered out of order, as a server may: the index puts them back.
        return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [index] })).reverse() }))
      }),
    )
    const embed = lmStudioEmbedder({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'text-embedding-nomic-embed-text-v1.5' })
    const texts = Array.from({ length: 70 }, (_, i) => `text ${i}`)
    const vectors = await embed(texts, 'document')
    expect(asked.map((batch) => batch.length)).toEqual([64, 6])
    expect(asked[0]![0]).toBe('search_document: text 0')
    expect(vectors.map((v) => v[0])).toEqual([...Array.from({ length: 64 }, (_, i) => i), 0, 1, 2, 3, 4, 5])
  })

  it('with loaded, only one LM Studio has loaded: loading another could unload the chat model in use', async () => {
    const data = [
      { id: 'qwen', type: 'llm', state: 'loaded' },
      { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings', state: 'not-loaded' },
      { id: 'text-embedding-other', type: 'embeddings', state: 'loaded' },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }))))
    expect(await embeddingModels('http://127.0.0.1:1234/v1', { loaded: true })).toEqual(['text-embedding-other'])
    expect(await embeddingModels('http://127.0.0.1:1234/v1')).toEqual(['text-embedding-nomic-embed-text-v1.5', 'text-embedding-other'])
  })

  it('finds the embedding models LM Studio lists, and none from a server that cannot say', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'qwen', type: 'llm' }, { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings' }] }))))
    expect(await embeddingModels('http://127.0.0.1:1234/v1')).toEqual(['text-embedding-nomic-embed-text-v1.5'])
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await embeddingModels('http://127.0.0.1:1234/v1')).toEqual([])
  })
})
