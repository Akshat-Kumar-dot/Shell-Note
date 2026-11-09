/** A plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Own-key lookup. `key in obj` would also see inherited keys like "toString". */
export function has(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key)
}

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

/**
 * True when `text` is valid UTF-16: no half of an emoji (a lone surrogate) on
 * its own. Saved files are UTF-8, which cannot hold a lone surrogate.
 */
export function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (isHigh(code) && isLow(text.charCodeAt(i + 1))) i++
    else if (isHigh(code) || isLow(code)) return false
  }
  return true
}

/** True when position `i` falls between the two halves of one character. */
export function splitsCharacter(text: string, i: number): boolean {
  return i > 0 && i < text.length && isHigh(text.charCodeAt(i - 1)) && isLow(text.charCodeAt(i))
}
