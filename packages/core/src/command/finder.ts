// The command finder: from a request in
// plain words to the command it means, with its inputs, so the model never
// holds the whole table. Cheapest first:
//   1. the request's standard form matches a way of saying a command exactly   (instant)
//   2. typos corrected, then letter pieces or word overlap above 0.8           (instant)
//   3. meaning, when the caller passes one in: an embedding model at 0.85 or more, 0.05 ahead (nomic in LM
//      Studio)                                                                  (milliseconds)
//   4. nothing clearly ahead: the closest three, with their inputs, for the model to choose
// A winner must be above its cut-off and clearly ahead of the next command, so
// a near tie is never a guess. The cut-offs are starting points: the finder
// test's numbers settle them, the same for everyone. Words that are an input's
// value become that input: "a blue pencil" is pen.set { colour: blue, kind: pencil }.
import { z } from 'zod'
import { bare, describe, isNumber, valuesOf, type CommandSpec, type Limit } from './spec.js'
import { isSlot, kept, keyOf, letterOverlap, roots, spelled, stem, tokens, wordOverlap } from './words.js'

/** Step 2: letter pieces or word overlap at least this, to run. */
export const OVERLAP_CUTOFF = 0.8
/**
 * Step 3: an embedding model's likeness at least this, and this far ahead of the next command, to run. Measured with
 * nomic-embed-text-v1.5 in LM Studio: on 157 test requests 0.78 with a 0.02 lead was
 * never wrong; on 900 requests Gemma 4 E4B wrote it added 66 found right and 12 wrong (pnpm finder:check --model).
 * At 0.85 with a 0.05 lead: 6 more right and none wrong there, on each half alike; and the closest three it offers
 * hold the right command for 566 of the 900 (words alone 349).
 */
export const MEANING_CUTOFF = 0.85
export const MEANING_GAP = 0.05
/** Steps 1 and 2: a winner is at least this far ahead of the next command. */
export const CLEAR_GAP = 0.1
/** A typo corrected, then an exact match: step 2's best. */
const SPELLED = 0.95

/** Turns texts into vectors (an embedding model, as LM Studio serves one): the caller's, so core stays pure. */
export type Embedder = (texts: readonly string[], kind: 'query' | 'document') => Promise<readonly (readonly number[])[]>

/** Step 3's way of measuring meaning, with the cut-offs measured for it: an embedder alone has nomic's. */
export interface Meaning {
  readonly embed: Embedder
  readonly cutoff: number
  readonly gap: number
}
const meaningOf = (meaning: Embedder | Meaning): Meaning => (typeof meaning === 'function' ? { embed: meaning, cutoff: MEANING_CUTOFF, gap: MEANING_GAP } : meaning)

/** Which step decided. */
export type By = 'key' | 'letters' | 'meaning'

export interface Found {
  kind: 'found'
  command: string
  /** The inputs read from the request; the model fills the rest. */
  input: Record<string, unknown>
  /** Inputs the command needs that the request did not give. */
  missing: string[]
  score: number
  by: By
}
export interface Impossible {
  kind: 'impossible'
  why: string
  score: number
  by: By
}
export type Candidate = (ReturnType<typeof describe> & { score: number; filled: Record<string, unknown> }) | { limit: string; score: number }
export interface Unclear {
  kind: 'unclear'
  /** The closest three, best first: a command with its inputs, or a limit with its reason. */
  closest: Candidate[]
}
export type FindResult = Found | Impossible | Unclear

/** One way of saying a command, prepared. */
interface Way {
  key: string
  roots: string[]
  /** Its words as written, filler gone: what breaks a tie between two commands with the same roots. */
  words: string[]
}
/** A command's score for a request, and how much of the request's words, as written, one of its ways shares. */
interface Scored {
  entry: number
  score: number
  by: By
  written: number
}
interface Entry {
  spec?: CommandSpec
  limit?: Limit
  ways: Way[]
  /** What step 3 compares the request with: each way of saying it, a stand-in made an example. */
  texts: string[]
}

const TRUE = new Set(['on', 'enter', 'start', 'open', 'show', 'true', 'yes'])
const FALSE = new Set(['off', 'leave', 'exit', 'stop', 'close', 'hide', 'quit', 'false', 'no'])

/** A command's name as words: bin.deleteForever is "bin delete forever". */
const nameWords = (name: string): string => name.replace('.', ' ').replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase()

/**
 * The value of a short list a word means: itself; the same root ("typing" is
 * type); a longer word it begins ("selection" is select, for a value of five
 * letters or more, so "pencil" is never "pen"); or a typo of it.
 */
function valueOf(word: string, values: ReadonlySet<string>): string | undefined {
  if (values.has(word)) return word
  const root = stem(word)
  for (const value of values) if (stem(value) === root) return value
  for (const value of values) if (value.length >= 5 && word.length > value.length && word.startsWith(value)) return value
  return spelled(word, values)
}

/**
 * Read a command's inputs out of some words: a value of a short list (a pair
 * of words for "extra fine"; one typo forgiven), the one number for a command
 * with one number, on or off for a switch. Values become {field}, so "use the
 * pencil" and "use the marker" are both "use the {kind}".
 */
function fill(words: readonly string[], spec: CommandSpec | undefined): { words: string[]; input: Record<string, unknown> } {
  const out = [...words]
  const input: Record<string, unknown> = {}
  if (!spec) return { words: out, input }
  const shape = spec.input.shape as Record<string, z.ZodType>
  const numbers = Object.keys(shape).filter((field) => isNumber(shape[field]!))
  for (const [field, schema] of Object.entries(shape)) {
    const values = valuesOf(schema)
    if (values) {
      const set = new Set(values)
      for (let i = 0; i < out.length && !(field in input); i++) {
        const word = out[i]!
        if (isSlot(word)) continue
        const next = out[i + 1]
        const pair = next !== undefined && !isSlot(next) ? `${word}-${next}` : undefined
        if (pair !== undefined && set.has(pair)) {
          input[field] = pair
          out.splice(i, 2, `{${field}}`)
          continue
        }
        const value = valueOf(word, set)
        if (value !== undefined) {
          input[field] = value
          out[i] = `{${field}}`
        }
      }
    } else if (bare(schema) instanceof z.ZodBoolean) {
      const word = out.find((w) => TRUE.has(w) || FALSE.has(w))
      if (word !== undefined) input[field] = TRUE.has(word)
    }
  }
  if (numbers.length === 1) {
    const field = numbers[0]!
    const i = out.findIndex((word) => /^\d/u.test(word))
    if (i >= 0) {
      const value = Number(out[i])
      if (shape[field]!.safeParse(value).success) input[field] = value
      out[i] = `{${field}}`
    }
  }
  return { words: out, input }
}

/** A name given after these words: "a note called Waves". */
const CALLED = /\b(?:called|named|titled)\s+(?:"([^"]+)"|'([^']+)'|(.+?))(?=\s+(?:in|into|inside|under|to|then|and|with|on)\b|[.,;!?]|$)/iu
/** A name in quotes; a single quote only around whole words, never an apostrophe ("note's"). */
const QUOTED = /"([^"]+)"|“([^”]+)”|(?:^|\s)'([^']+)'(?=\s|$|[.,;!?])/gu

/**
 * Names given in plain words, as models write them (the agent test, 19 October 2026): words after "called", "named" or "titled" are the command's name, or the note or folder it acts on when they follow "note"
 * or "folder" and the command takes one; a name in quotes is the first free-text input still needed, else its name. Free text is what no short list of values can read: "do note rename "Optics"" is name =
 * Optics.
 */
function namesOf(request: string, spec: CommandSpec): Record<string, string> {
  const shape = spec.input.shape as Record<string, z.ZodType>
  const out: Record<string, string> = {}
  const called = CALLED.exec(request)
  const calledName = called ? (called[1] ?? called[2] ?? called[3])!.trim() : undefined
  // "the note called Waves" names the note to act on, when the command takes one (rename the note called Waves);
  // otherwise it is the name to give ("a new note called Waves").
  const named = called ? /\b(note|folder)\s*$/iu.exec(request.slice(0, called.index))?.[1]?.toLowerCase() : undefined
  const target = named !== undefined && named in shape ? named : 'name'
  if (calledName && target in shape) out[target] = calledName
  const quoted = [...request.matchAll(QUOTED)].map((match) => (match[1] ?? match[2] ?? match[3])!.trim()).filter((text) => text !== '' && text !== calledName)
  const free = Object.keys(shape).filter((field) => !(field in out) && valuesOf(shape[field]!) === undefined && bare(shape[field]!) instanceof z.ZodString)
  const needed = free.filter((field) => !(shape[field] instanceof z.ZodOptional))
  for (const field of needed.length > 0 ? needed : free.filter((field) => field === 'name')) {
    const text = quoted.shift()
    if (text === undefined) break
    out[field] = text
  }
  return out
}

/** A request with the names it gives taken out, and the word that gave each: what it asks for, not what it names. */
const unnamed = (request: string): string => request.replace(CALLED, ' ').replace(QUOTED, ' ')

/** Best first; on the same score, the one sharing more of the request's words as written. */
const byScore = (a: { score: number; written?: number }, b: { score: number; written?: number }): number =>
  b.score - a.score || (b.written ?? 0) - (a.written ?? 0)

/** Cosine likeness of two vectors. */
function likeness(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

/**
 * The finder over one set of commands. Making one works out, once, every way each command can be said (its standard
 * key, roots and words) and the vocabulary typos are corrected against, so a request costs only a comparison. The
 * meaning vectors are asked for the first time they are needed, and kept for as long as the same embedder is used.
 * `limits` are things the app cannot do: they are found like commands, and answer with why (kind 'impossible').
 *
 * `findNow` is steps 1, 2 and 4, instant and with no model; `find` adds step 3 for what those leave unclear.
 */
export class Finder {
  readonly #entries: Entry[]
  readonly #byName: Map<string, CommandSpec>
  readonly #vocabulary: Set<string>
  #vectors: { embedder: Embedder; vectors: readonly (readonly number[])[]; owners: number[] } | undefined

  constructor(commands: readonly CommandSpec[], limits: readonly Limit[] = []) {
    this.#byName = new Map(commands.map((spec) => [spec.name, spec]))
    this.#vocabulary = new Set()
    const prepare = (spec: CommandSpec | undefined, says: readonly string[]): Way[] =>
      says.map((text) => {
        const words = fill(tokens(text), spec).words
        for (const word of tokens(text)) if (!isSlot(word)) this.#vocabulary.add(word)
        return { key: keyOf(words), roots: roots(words), words: kept(words) }
      })
    const example = (spec: CommandSpec | undefined, text: string): string =>
      text.replace(/\{([a-z]+)\}/gu, (_, field: string) => {
        const value = spec?.example[field]
        return typeof value === 'string' || typeof value === 'number' ? String(value) : field
      })
    this.#entries = [
      ...commands.map((spec) => {
        const says = [nameWords(spec.name), ...spec.says]
        for (const schema of Object.values(spec.input.shape as Record<string, z.ZodType>)) for (const value of valuesOf(schema) ?? []) this.#vocabulary.add(value)
        return { spec, ways: prepare(spec, says), texts: [spec.does, ...spec.says.map((text) => example(spec, text))] }
      }),
      ...limits.map((limit) => ({ limit, ways: prepare(undefined, limit.says), texts: [...limit.says] })),
    ]
  }

  /** A command's spec, by its exact name. */
  spec(name: string): CommandSpec | undefined {
    return this.#byName.get(name)
  }

  /** The inputs some words give a command: values of its short lists, a number, a switch, a name in quotes. */
  inputsOf(request: string, name: string): Record<string, unknown> {
    const spec = this.#byName.get(name)
    return spec ? this.#read(request, spec) : {}
  }

  /** Steps 1, 2 and 4: no model, instant. */
  findNow(request: string): FindResult {
    return this.#decide(request, this.#quickScores(request))
  }

  /** How near in meaning a request is to each command: its nearest way of being said, or what it does. */
  async #meaningScores(request: string, meaning: Embedder): Promise<Map<number, number>> {
    if (this.#vectors?.embedder !== meaning) {
      const owners: number[] = []
      const texts: string[] = []
      this.#entries.forEach((entry, i) => {
        for (const text of entry.texts) {
          texts.push(text)
          owners.push(i)
        }
      })
      this.#vectors = { embedder: meaning, vectors: await meaning(texts, 'document'), owners }
    }
    const [query] = await meaning([request], 'query')
    const best = new Map<number, number>()
    if (!query) return best
    this.#vectors.vectors.forEach((vector, i) => {
      const owner = this.#vectors!.owners[i]!
      best.set(owner, Math.max(best.get(owner) ?? 0, likeness(query, vector)))
    })
    return best
  }

  /** Embed the table now, ahead of the first request (the terminal opening): never throws; true when it could. */
  async prepareMeaning(meaning: Embedder | Meaning): Promise<boolean> {
    try {
      await this.#meaningScores('', meaningOf(meaning).embed)
      return true
    } catch {
      return false
    }
  }

  /** The commands nearest a request in meaning, nearest first, with how near (0 to 1): for measuring the cut-offs. */
  async nearestInMeaning(request: string, meaning: Embedder | Meaning): Promise<{ command: string; score: number }[]> {
    const best = await this.#meaningScores(request, meaningOf(meaning).embed)
    return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([entry, score]) => ({ command: this.#entries[entry]!.spec?.name ?? '!', score }))
  }

  /** Steps 1 to 4: with `meaning`, an embedding model, for what steps 1 and 2 leave unclear. */
  async find(request: string, meaning?: Embedder | Meaning): Promise<FindResult> {
    const scored = this.#quickScores(request)
    const quick = this.#decide(request, scored)
    if (quick.kind !== 'unclear' || !meaning) return quick
    const { embed, cutoff, gap } = meaningOf(meaning)
    let best: Map<number, number>
    try {
      best = await this.#meaningScores(request, embed)
    } catch {
      // No embedding model to be had now (LM Studio closed, say): steps 1, 2 and 4 alone, as without one.
      return quick
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1])
    const [top, next] = ranked
    if (top && top[1] >= cutoff && (!next || top[1] - next[1] >= gap)) return this.#result(request, top[0], top[1], 'meaning')
    // Still unclear: the closest by either measure.
    const merged = scored.map((s) => ({ ...s, score: Math.max(s.score, best.get(s.entry) ?? 0) }))
    return { kind: 'unclear', closest: this.#closest(request, merged) }
  }

  /** Steps 1 and 2: each entry's score, whether it matched exactly, and how much it shares of the words as written. */
  #quickScores(request: string): Scored[] {
    // A name given ("called Waves", "Optics" in quotes) says nothing of which command: left out of the matching,
    // "called" with it (it pulled "a new folder called Physics" toward folder.rename).
    const raw = tokens(unnamed(request))
    const corrected = raw.map((word) => spelled(word, this.#vocabulary) ?? word)
    return this.#entries.map((entry, i) => {
      const words = fill(corrected, entry.spec).words
      const mineWritten = kept(words)
      const written = Math.max(0, ...entry.ways.map((way) => wordOverlap(mineWritten, way.words)))
      const exact = keyOf(fill(raw, entry.spec).words)
      if (entry.ways.some((way) => way.key === exact)) return { entry: i, score: 1, by: 'key' as const, written }
      const key = keyOf(words)
      if (entry.ways.some((way) => way.key === key)) return { entry: i, score: SPELLED, by: 'letters' as const, written }
      const mine = roots(words)
      // The request's values of this command's own inputs ("red", "marker", "broad" for pen.set) are evidence for it,
      // never words its ways of saying it lack: each way counts them as its own (found with a real model, 19 October).
      const given = mine.filter((root) => isSlot(root))
      const score = Math.max(
        0,
        ...entry.ways.map((way) => {
          const theirs = [...new Set([...way.roots, ...given])]
          return Math.max(wordOverlap(mine, theirs), letterOverlap(mine, theirs))
        }),
      )
      return { entry: i, score, by: 'letters' as const, written }
    })
  }

  #decide(request: string, scored: readonly Scored[]): FindResult {
    const ranked = [...scored].sort(byScore)
    const [top, next] = ranked
    if (top && top.score >= OVERLAP_CUTOFF && (!next || top.score - next.score >= CLEAR_GAP)) return this.#result(request, top.entry, top.score, top.by)
    // Two commands with the same roots ("pen set": pen.set, and settings.pen, whose "settings" is "set" too): the one
    // whose words, as written, are the request's words, every one, and the only one.
    if (top && next && top.score >= OVERLAP_CUTOFF && top.score === next.score && top.written === 1 && next.written < 1)
      return this.#result(request, top.entry, top.score, top.by)
    return { kind: 'unclear', closest: this.#closest(request, ranked) }
  }

  #result(request: string, index: number, score: number, by: By): Found | Impossible {
    const entry = this.#entries[index]!
    const rounded = Math.round(score * 1000) / 1000
    if (!entry.spec) return { kind: 'impossible', why: entry.limit!.why, score: rounded, by }
    const input = this.#read(request, entry.spec)
    const shape = entry.spec.input.shape as Record<string, z.ZodType>
    const missing = Object.keys(shape).filter((field) => !(shape[field] instanceof z.ZodOptional) && !(field in input))
    return { kind: 'found', command: entry.spec.name, input, missing, score: rounded, by }
  }

  /** The inputs a request gives a command, each checked against its field. */
  #read(request: string, spec: CommandSpec): Record<string, unknown> {
    const corrected = tokens(request).map((word) => spelled(word, this.#vocabulary) ?? word)
    const shape = spec.input.shape as Record<string, z.ZodType>
    const input = { ...fill(corrected, spec).input, ...namesOf(request, spec) }
    return Object.fromEntries(Object.entries(input).filter(([field, value]) => shape[field]!.safeParse(value).success))
  }

  #closest(request: string, scored: readonly { entry: number; score: number; written?: number }[]): Candidate[] {
    return [...scored]
      .sort(byScore)
      .slice(0, 3)
      .map(({ entry, score }) => {
        const found = this.#entries[entry]!
        const rounded = Math.round(score * 1000) / 1000
        return found.spec ? { ...describe(found.spec), score: rounded, filled: this.#read(request, found.spec) } : { limit: found.limit!.why, score: rounded }
      })
  }
}
