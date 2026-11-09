// The key of an image asset: SHA-256 of its bytes, in lowercase hex (decided in
// phase 2; see docs/file-format.md). The same picture added twice is stored once.

interface Digester {
  subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> }
}

/** SHA-256 of the bytes, as 64 lowercase hex digits. Browsers and Node 20+ both provide crypto.subtle. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const crypto = (globalThis as unknown as { crypto: Digester }).crypto
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
