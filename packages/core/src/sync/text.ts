// Merging two changed copies of one list, or of one text, when the version
// both came from is known: what only one side changed is taken from that
// side, and where both changed the same part the merge is refused, so that
// the caller keeps both rather than guess.

/** Above this many pairs to compare, the two are not merged part by part. */
const LIMIT = 4_000_000

/** The longest run of items two lists share, in order: pairs of indexes. Undefined when the lists are too long to compare. */
function shared(a: readonly string[], b: readonly string[]): [number, number][] | undefined {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let enda = a.length
  let endb = b.length
  while (enda > start && endb > start && a[enda - 1] === b[endb - 1]) {
    enda--
    endb--
  }
  const n = enda - start
  const m = endb - start
  if (n * m > LIMIT) return undefined
  const pairs: [number, number][] = []
  for (let i = 0; i < start; i++) pairs.push([i, i])
  if (n > 0 && m > 0) {
    // lengths[i][j]: the longest shared run of a from i and b from j, counted from the ends back.
    const width = m + 1
    const lengths = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * width + j] = a[start + i] === b[start + j] ? lengths[(i + 1) * width + j + 1]! + 1 : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j])
        i++
        j++
      } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) i++
      else j++
    }
  }
  for (let i = 0; enda + i < a.length; i++) pairs.push([enda + i, endb + i])
  return pairs
}

/** One change to the base: its items from `from` up to `to` become `put`. */
interface Hunk {
  from: number
  to: number
  put: string[]
}

function hunksOf(base: readonly string[], side: readonly string[]): Hunk[] | undefined {
  const pairs = shared(base, side)
  if (!pairs) return undefined
  const hunks: Hunk[] = []
  let b = 0
  let s = 0
  for (const [bi, si] of [...pairs, [base.length, side.length] as [number, number]]) {
    if (bi > b || si > s) hunks.push({ from: b, to: bi, put: side.slice(s, si) })
    b = bi + 1
    s = si + 1
  }
  return hunks
}

/**
 * Two changed copies of a list of keys, merged over the list both came from.
 * Undefined when both changed the same part, or parts that touch, in two
 * ways. The answer is the same whichever copy is named first.
 */
export function mergeList(base: readonly string[], mine: readonly string[], theirs: readonly string[]): string[] | undefined {
  const ours = hunksOf(base, mine)
  const others = hunksOf(base, theirs)
  if (!ours || !others) return undefined
  const out: string[] = []
  let at = 0
  let i = 0
  let j = 0
  while (i < ours.length || j < others.length) {
    const a = ours[i]
    const b = others[j]
    let hunk: Hunk
    if (a && b && a.from <= b.to && b.from <= a.to) {
      if (a.from !== b.from || a.to !== b.to || a.put.length !== b.put.length || a.put.some((key, k) => key !== b.put[k])) return undefined
      hunk = a
      i++
      j++
    } else if (a && (!b || a.from < b.from)) {
      hunk = a
      i++
    } else {
      hunk = b!
      j++
    }
    out.push(...base.slice(at, hunk.from), ...hunk.put)
    at = hunk.to
  }
  out.push(...base.slice(at))
  return out
}

/** A text as words, runs of space, and marks one by one: joined again, they are the text. */
function pieces(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []
}

/**
 * Two changed copies of a text, merged word by word over the text both came
 * from: a word corrected on one device and a sentence added on the other are
 * both kept. Undefined when both changed the same words.
 */
export function mergeText(base: string, mine: string, theirs: string): string | undefined {
  if (mine === theirs || theirs === base) return mine
  if (mine === base) return theirs
  return mergeList(pieces(base), pieces(mine), pieces(theirs))?.join('')
}
