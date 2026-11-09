// How the finder reads words: one standard form, so that
// "Closes the Note" and "note close" are the same request; then letter pieces
// and word overlap, for typos and other phrasings. Steps 1 and 2 of the finder;
// step 3, meaning, is an embedding the caller passes in (finder.ts).
import { distance } from '../ai/tier0.js'

/** Words that carry no instruction of their own. Prepositions that do (in, on, out, off, into) are kept. */
export const FILLER: ReadonlySet<string> = new Set(
  "a an the this that these those my your our its it please pls kindly can could would will you i me we us to for of with and now just then some current currently go let lets want wanna need like".split(' '),
)

/**
 * A request's words: lowercase, letters and digits, a {field} stand-in kept
 * whole. "150%" is "150", "note's" is "note", and "full-screen" is two words, as
 * "full screen" is (a value of two words, "extra-fine", is found from the pair).
 */
export function tokens(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']s\b/gu, '')
    .match(/\{[a-z]+\}|\d+(?:\.\d+)?|[\p{L}\p{N}]+/gu) ?? []
}

/** Whether a word is a {field} stand-in. */
export const isSlot = (word: string): boolean => word.startsWith('{')

/**
 * A word's root, by taking off common endings, the same way on every side:
 * close, closes, closed, closing are all "clos"; setting and set are "set". A
 * root is never shorter than three letters.
 */
export function stem(word: string): string {
  if (isSlot(word) || /^\d/u.test(word)) return word
  let s = word
  const cut = (ending: string, put = ''): boolean => {
    if (!s.endsWith(ending) || s.length - ending.length + put.length < 3) return false
    s = s.slice(0, s.length - ending.length) + put
    return true
  }
  if (!cut('ies', 'y') && !cut('sses', 'ss') && !(s.endsWith('es') && !s.endsWith('ses') && cut('es'))) {
    if (!s.endsWith('ss') && !s.endsWith('us') && !s.endsWith('is')) cut('s')
  }
  // An ending that would leave too short a root gives its e back: using and used are use.
  if (!cut('ing') && !cut('ing', 'e') && !cut('ed')) cut('ed', 'e')
  cut('e')
  // A doubled last letter, as in sett(ing) or stopp(ed), is one letter: set, stop.
  if (s.length > 3 && /([b-df-hj-km-np-rtv-z])\1$/u.test(s)) s = s.slice(0, -1)
  return s
}

/** The words that matter, as roots: filler gone, each once, in order of first use. */
export function roots(words: readonly string[]): string[] {
  const out: string[] = []
  for (const word of words) {
    if (FILLER.has(word)) continue
    const root = stem(word)
    if (!out.includes(root)) out.push(root)
  }
  return out
}

/**
 * The words that matter, as written: filler gone, each once. Roots make "settings" and "set" one word, so "pen set"
 * and "settings pen" share a standard form; these tell them apart.
 */
export function kept(words: readonly string[]): string[] {
  return [...new Set(words.filter((word) => !FILLER.has(word)))]
}

/** The standard form of some words: their roots, sorted, so word order does not matter. */
export const keyOf = (words: readonly string[]): string => [...roots(words)].sort().join(' ')

/** How much two sets of words share, from 0 to 1 (Dice: twice the shared, over both sizes). */
export function wordOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const set = new Set(b)
  const shared = new Set(a.filter((word) => set.has(word))).size
  return (2 * shared) / (new Set(a).size + set.size)
}

/** Pieces of three letters, a word's ends marked, so typos still share most of them. */
function pieces(words: readonly string[]): string[] {
  const out: string[] = []
  for (const word of words) {
    const padded = ` ${word} `
    for (let i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3))
  }
  return out
}

/** How much two sets of words share in letter pieces, from 0 to 1. */
export function letterOverlap(a: readonly string[], b: readonly string[]): number {
  const left = pieces(a)
  const right = pieces(b)
  if (left.length === 0 || right.length === 0) return 0
  const counts = new Map<string, number>()
  for (const piece of right) counts.set(piece, (counts.get(piece) ?? 0) + 1)
  let shared = 0
  for (const piece of left) {
    const n = counts.get(piece) ?? 0
    if (n > 0) {
      shared++
      counts.set(piece, n - 1)
    }
  }
  return (2 * shared) / (left.length + right.length)
}

/**
 * The word of a vocabulary a typed word means: itself, or one within a small
 * edit distance for a word of four letters or more (two for eight or more), or
 * undefined. Short words are never typo targets: "pen" must not become "open".
 */
export function spelled(word: string, vocabulary: ReadonlySet<string>): string | undefined {
  if (vocabulary.has(word)) return word
  if (word.length < 4 || isSlot(word) || /^\d/u.test(word)) return undefined
  const limit = word.length >= 8 ? 2 : 1
  let best: string | undefined
  let bestDistance = limit + 1
  for (const candidate of vocabulary) {
    if (candidate.length < 4 || isSlot(candidate) || Math.abs(candidate.length - word.length) > limit) continue
    const d = distance(word, candidate)
    if (d < bestDistance || (d === bestDistance && best !== undefined && candidate < best)) {
      best = candidate
      bestDistance = d
    }
  }
  return best
}
