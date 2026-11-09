import type { Doc } from './schema/doc.js'
import { has } from './util.js'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Generated ids are this long: 62^8 is about 2 × 10^14 possible ids. */
export const ID_LENGTH = 8

interface RandomSource {
  getRandomValues<T extends Uint8Array>(array: T): T
}

/** A random 8-character id that `isTaken` does not reject. */
export function newId(isTaken: (id: string) => boolean = () => false): string {
  for (;;) {
    const id = randomId()
    if (!isTaken(id)) return id
  }
}

/** True when `id` is already the document's own id, or a page or block id in it. */
export function idTaken(doc: Doc, id: string): boolean {
  return id === doc.id || has(doc.page, id) || has(doc.block, id) || (doc.media?.some((m) => m.id === id) ?? false) || (doc.clips?.some((c) => c.id === id) ?? false) || (doc.programs?.some((p) => p.id === id) ?? false)
}

function randomId(): string {
  // Browsers and Node 20+ both provide crypto.getRandomValues on globalThis.
  const random = (globalThis as unknown as { crypto: RandomSource }).crypto
  const bytes = new Uint8Array(ID_LENGTH * 2)
  let id = ''
  while (id.length < ID_LENGTH) {
    random.getRandomValues(bytes)
    for (const byte of bytes) {
      // Bytes from 248 up are skipped so every character is equally likely (248 = 4 × 62).
      if (byte < 248 && id.length < ID_LENGTH) id += ALPHABET.charAt(byte % 62)
    }
  }
  return id
}
