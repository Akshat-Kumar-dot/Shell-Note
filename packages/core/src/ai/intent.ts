// The instant-command router. People seldom type
// "replace Smith with Akshat": they write "I typed Smith everywhere but his
// name is actually Akshat, please fix it", and the instant functions, which
// read fixed forms, handed that to the model. This reads such a request as the
// short commands those functions already understand (ai/swap.ts,
// ai/tableEdit.ts, ai/tier0.ts), so they, unchanged, do the work.
//
// It never guesses alone. Every value it reads is checked against what is
// chosen: the words to replace must be in it, a column must be one of the
// table's. A request that asks for writing (simpler, shorter, translate, a
// summary…), or names an action it does not handle, is left to the model.
// A reading is "sure", and runs at once, or "likely", and is only offered.
import { parseInline, plainText } from '../markdown/inline.js'
import type { Doc, TableBlock } from '../schema/doc.js'
import type { Selection } from '../select/selection.js'
import type { Aliases } from './alias.js'
import { colourIn } from './content.js'
import { findIsWords, findPattern, LANGUAGES, putIsWords, swapOps } from './swap.js'
import { tableEditOps } from './tableEdit.js'
import { closest, FILLER, meaning, PHRASES, POINTER, tier0, type Change } from './tier0.js'

/** How sure a reading is: sure runs at once; likely is offered to the person first. */
export type Band = 'sure' | 'likely'

export interface Reading {
  /** Short commands, in order, each one a swap, a table edit or a tier 0 command. */
  commands: string[]
  band: Band
}

interface Context {
  doc: Doc
  selection: Selection
  aliases: Aliases
}

// ----- cleaning -------------------------------------------------------------------

/** Greetings and polite words, anywhere in a request: they say nothing about the edit. */
const POLITE =
  /\b(?:hey|hi|hello|ok(?:ay)?|um+|uh+|please|pls|plz|kindly|thanks|thank\s+you|thx|just|quickly|for\s+me|i\s+(?:want|need)\s+you\s+to|i(?:'d|’d|\s+would)\s+like\s+you\s+to|(?:can|could|would|will)\s+(?:you|u)|go\s+ahead\s+and|try\s+to)\b[,!]?/giu

/** A request without its polite words, its spaces tidied. */
export function clean(instruction: string): string {
  return instruction
    .replace(POLITE, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s,.;:!?]+|[\s,;:]+$/gu, '')
    .trim()
}

/** A request for writing, a question, or a translation: always the model's. */
const GENERATIVE = new RegExp(
  [
    String.raw`\b(?:translat\w*|simpl(?:e|er|est|ify|ified|ifies)|short(?:er|en|ened)|longer|lengthen|expand|elaborate|summar(?:y|ies|ise|ize|ised|ized)|explain\w*|rewrit\w*|re-?phras\w*|paraphras\w*|reword\w*|formal|informal|casual|polite|tone|sounds?|grammar|proofread\w*|typos?|improve\w*|better|clearer|nicer|prettier|neater|tidier|cleaner|fancier|concise|describe|generate|create|draft|compose|calculat\w*|solve|define|definition|meaning|means?)\b`,
    String.raw`\b(?:add|insert|write|draw)\s+(?:(?:a|an|another|some|one|more|the|new)\s+)*(?:sentences?|paragraphs?|words?|headings?|titles?|subtitles?|formulas?|equations?|diagrams?|charts?|graphs?|flowcharts?|tables?|lists?|pictures?|images?|examples?|notes?|summar(?:y|ies)|sections?|points?|captions?|quotes?)\b`,
    String.raw`\b(?:make|put)\s+(?:a|an|another|some|new)\s+(?:new\s+)?(?:sentence|paragraph|heading|title|subtitle|formula|equation|diagram|chart|graph|flowchart|table|list|picture|example|summary|section|caption)\b`,
    String.raw`\b(?:list|table|chart|diagram|graph|flowchart|summary|outline|example)s?\s+(?:of|about|for|showing)\b`,
    String.raw`\binto\s+(?:a\s+|an\s+)?(?:table|diagram|chart|graph|flowchart|formula|equation|paragraph|steps|sentences?)\b`,
    String.raw`\b(?:in|into|to)\s+(?:${[...LANGUAGES].join('|')})\b`,
    String.raw`^(?:what|why|how|which|who|whom|whose|when|where|does|did|is|are)\b`,
    String.raw`\b(?:what|why|how)\b[^.!]*\?`,
  ].join('|'),
  'iu',
)

/** Every action a request may name. A reading that leaves one of them unexplained goes to the model. */
const ACTIONS = /\b(?:add|append|insert|include|enter|write|create|draw|plot|copy|paste|duplicate|split|merge|join|sort|order|arrange|rank|swap|switch|replace|rename|substitute|correct|fix|move|remove|delete|drop|erase|cut|translate|link|attach|turn|make|set|change|put|use|give|apply|paint|colou?r|format|style|keep|spell|type|typed|wrote|say|bold|italici[sz]e|underline|highlight)\b/giu

/** The actions each reading accounts for. */
const REPLACE_ACTIONS = new Set('replace change rename swap switch correct fix substitute write put use say spell type typed wrote'.split(' '))
const TABLE_ACTIONS = new Set('sort order arrange rank delete remove drop erase cut add append insert put include enter'.split(' '))
const STYLE_ACTIONS = new Set('make turn set change put use give apply paint color colour format style keep delete remove erase cut switch bold italicise italicize underline highlight'.split(' '))

/** Whether every action a text names is one a reading accounts for. */
function onlyActions(text: string, allowed: ReadonlySet<string>): boolean {
  return [...text.toLowerCase().matchAll(ACTIONS)].every((m) => allowed.has(m[0]))
}

// ----- what is chosen ----------------------------------------------------------------

/** The words of what is chosen, as find and replace searches them: chosen words, text blocks, table cells, captions. */
export function chosenTexts(doc: Doc, aliases: Aliases): string[] {
  const out: string[] = []
  const words = (md: string): string => plainText(parseInline(md))
  for (const s of aliases.selected) {
    const block = doc.block[s.id]
    if (!block) continue
    if (block.type === 'text') out.push(s.words ? words(block.md).slice(s.words.start, s.words.end) : words(block.md))
    else if (s.words) continue
    else if (block.type === 'table') {
      for (const row of block.rows) for (const cell of row) out.push(words(cell))
      if (block.caption) out.push(words(block.caption))
    } else if (block.type === 'image' && block.caption) out.push(words(block.caption))
  }
  return out
}

/** How many times words stand in what is chosen. */
export function occurrences(texts: readonly string[], phrase: string): number {
  return texts.reduce((n, text) => n + [...text.matchAll(findPattern(phrase))].length, 0)
}

/** The one table chosen whole, if that is what is chosen. */
function chosenTable(ctx: Context): TableBlock | undefined {
  const only = ctx.aliases.selected.length === 1 ? ctx.aliases.selected[0]! : undefined
  const block = only && only.words === undefined ? ctx.doc.block[only.id] : undefined
  return block?.type === 'table' ? block : undefined
}

// ----- find and replace, said any way ----------------------------------------------------

/** Words that end the words to find or to put: "Akshat in the table", "Akshat and not Smith". */
const BOUNDARY = new Set('and but so because since as in on at everywhere throughout instead rather not then also please here there now when while if for from this that which who whom where'.split(' '))
/** Words at the edge of a phrase that are not part of the words themselves: "is actually Akshat", "it should say Akshat". */
const EDGE = new Set(
  'it its is was are were be become becomes should must say says said read show shows write use put the a an to his her their my your our name names word words spelled spelt spell spelling typed called named that this these those which actually really correctly properly fact in i we you he she they all every each wrong wrongly everywhere fix it'.split(' '),
)

/** The words at the start of a text, up to four, stopping at punctuation or a boundary word; "Akshat" from "Akshat, please fix it". */
function head(text: string): string | undefined {
  const quoted = /^\s*["“'‘`](.+?)["”'’`]/u.exec(text)
  if (quoted) return quoted[1]!.trim()
  const words: string[] = []
  for (const raw of text.trim().split(/\s+/u)) {
    const word = raw.replace(/[,.;:!?)]+$/u, '')
    if (word === '' || BOUNDARY.has(word.toLowerCase())) break
    words.push(word)
    if (word !== raw || words.length === 4) break
  }
  return trimEdges(words)
}

/** The words at the end of a text, up to four; "Akshat" from "it should say Akshat". */
function tail(text: string): string | undefined {
  const quoted = /["“'‘`]([^"“”'‘’`]+)["”'’`][\s,]*$/u.exec(text)
  if (quoted) return quoted[1]!.trim()
  const raws = text.trim().split(/\s+/u).filter(Boolean)
  const words: string[] = []
  for (let i = raws.length - 1; i >= 0; i--) {
    const raw = raws[i]!
    const word = raw.replace(/[,.;:!?]+$/u, '')
    if (word !== raw && words.length > 0) break
    if (word === '' || BOUNDARY.has(word.toLowerCase())) break
    words.unshift(word)
    if (words.length === 4) break
  }
  return trimEdges(words)
}

function trimEdges(words: string[]): string | undefined {
  const list = [...words]
  while (list.length > 0 && EDGE.has(list[0]!.toLowerCase())) list.shift()
  while (list.length > 0 && EDGE.has(list.at(-1)!.toLowerCase())) list.pop()
  return list.length > 0 ? list.join(' ') : undefined
}

/** Words that never stand alone as words to find. */
const STOP = new Set([...EDGE, ...BOUNDARY, ...FILLER, 'i', 'me', 'of', 'or', 'with', 'by', 'one', 'there', 'thing', 'things', 'something', 'person', 'people'])

/** Phrases of the request, one to three words long, that stand in what is chosen; the longest kept. */
function groundedPhrases(text: string, texts: readonly string[], not: readonly string[]): string[] {
  const words = text
    .split(/\s+/u)
    .map((w) => w.replace(/^["“'‘`(]+|[,.;:!?"”'’`)]+$/gu, ''))
    .filter(Boolean)
  const excluded = not.map((n) => n.toLowerCase())
  // A plain search first, the slower whole-word search only for what it finds.
  const all = texts.join('\n').toLowerCase()
  const found: string[] = []
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n)
      if (STOP.has(gram[0]!.toLowerCase()) || STOP.has(gram.at(-1)!.toLowerCase())) continue
      const phrase = gram.join(' ')
      const lower = phrase.toLowerCase()
      if (!all.includes(lower) || excluded.some((e) => e.includes(lower)) || found.some((f) => f.toLowerCase().includes(lower)) || !findIsWords(phrase)) continue
      if (occurrences(texts, phrase) > 0) found.push(phrase)
    }
  }
  return found
}

/** Names, codes and numbers: words a person would replace, as against ordinary words that only happen to be there. */
const nameLike = (phrase: string): boolean => /[\p{Lu}\p{N}]/u.test(phrase)

type Pair = { find: string | undefined; put: string; quoted: boolean }

const BETWEEN = /\s+(?:to|with|into|by|for|as)\s+/iu
const FIND_LEAD = /^(?:(?:all|every|each|the|a|an|of)\s+)*(?:(?:names?|words?|values?|entry|entries|spelling\s+of)\s+)?/iu
const SHOULD_BE = /\b(?:should|must|needs?\s+to|has\s+to|ought\s+to|(?:is|was|are)\s+(?:supposed|meant)\s+to)\s+(?:be|become|say|read|show|spell)\b/giu
const IS_ACTUALLY = /\b(?:is|it'?s|its|was|are|were)\s+(?:actually|really|correctly|properly|in\s+fact)\b/giu
const NOT_BUT = /\bnot\s+(.+?)\s*,?\s+but\s+/giu
const NOT = /(?:,\s*|\s+)(?:and\s+)?not\s+/giu
const INSTEAD = /\s+(?:instead\s+of|rather\s+than|in\s+place\s+of)\s+/giu
/** Before "not", a verb it negates: "do not bold it" is not "X, not Y". */
const NEGATED_VERB = /\b(?:do|does|did|should|is|are|was|were|must|could|would|can|will|why)\s*$/iu

/** Each way of saying "this should be that" found in a request, the words to find when it says them. */
function pairs(text: string): Pair[] {
  const out: Pair[] = []
  const add = (find: string | undefined, putText: string | undefined, quoted = false): void => {
    if (putText) out.push({ find: find?.trim() || undefined, put: putText, quoted })
  }
  for (const m of text.matchAll(/\b(?:replace|change|rename|swap|switch|correct|fix|substitute)\s+/giu)) {
    const rest = text.slice(m.index + m[0].length)
    const quoted = /^["“'‘`](.+?)["”'’`]\s+(?:to|with|into|by|for|as)\s+(.+)$/su.exec(rest)
    if (quoted) {
      add(quoted[1], head(quoted[2]!), /^\s*["“'‘`]/u.test(quoted[2]!))
      continue
    }
    const at = BETWEEN.exec(rest)
    if (at) add(rest.slice(0, at.index).replace(FIND_LEAD, ''), head(rest.slice(at.index + at[0].length)))
  }
  for (const m of text.matchAll(SHOULD_BE)) add(tail(text.slice(0, m.index)), head(text.slice(m.index + m[0].length)))
  for (const m of text.matchAll(IS_ACTUALLY)) add(undefined, head(text.slice(m.index + m[0].length)))
  for (const m of text.matchAll(NOT_BUT)) add(head(m[1]!), head(text.slice(m.index + m[0].length)))
  for (const m of text.matchAll(NOT)) {
    const before = text.slice(0, m.index)
    if (NEGATED_VERB.test(before)) continue
    // "Akshat, not Smith": what follows "not" is what to find, what goes before it is what to put.
    add(head(text.slice(m.index + m[0].length)), tail(before))
  }
  for (const m of text.matchAll(INSTEAD)) add(head(text.slice(m.index + m[0].length)), tail(text.slice(0, m.index)))
  return out
}

/**
 * Find and replace in a request said any way: "his name is actually Akshat",
 * "it should say Akshat and not Smith", "Akshat, not Smith". The words to
 * find must be in what is chosen: named in the request, or else the one
 * phrase of the request that is. Refused when the request does ask for a
 * replacement but its words cannot be found: the model, as for "change
 * Jones to Akshat" when there is no Jones.
 */
function replaceReading(text: string, whole: string, texts: readonly string[]): Reading | 'refused' | undefined {
  // Words to put, unless in quotes, are a word, or a name or a number of up to three words ("Mary Jane", "Quarter 3"):
  // "… should be bigger next year" says something else.
  const shaped = (put: string): boolean => {
    const n = put.split(/\s+/u).length
    return n === 1 || (n <= 3 && nameLike(put))
  }
  const asked = pairs(text).filter((pair) => pair.quoted || (putIsWords(pair.put) && shaped(pair.put)))
  if (asked.length === 0) return undefined
  const found = new Map<string, { find: string; put: string; band: Band }>()
  for (const pair of asked) {
    let find = pair.find !== undefined && occurrences(texts, pair.find) > 0 && findIsWords(pair.find) ? pair.find : undefined
    let band: Band = 'sure'
    if (find === undefined) {
      // From the whole request: one part may say only what to put ("it should say Akshat"), another name the old words.
      const candidates = groundedPhrases(whole, texts, [pair.put])
      const names = candidates.filter(nameLike)
      const pick = candidates.length === 1 ? candidates[0] : names.length === 1 ? names[0] : undefined
      if (pick === undefined) continue
      find = pick
      // Sure only when it is the one phrase there and looks like a name: an ordinary word may only happen to be there.
      band = candidates.length === 1 && nameLike(pick) ? 'sure' : 'likely'
    }
    if (find.toLowerCase() === pair.put.toLowerCase() || pair.put.length > 60 || /["”]/u.test(find + pair.put)) continue
    const key = find.toLowerCase()
    const before = found.get(key)
    // One word asked to become two different things: the request contradicts itself.
    if (before && before.put !== pair.put) return 'refused'
    found.set(key, { find: before?.find ?? find, put: pair.put, band: before?.band === 'sure' || band === 'sure' ? 'sure' : 'likely' })
  }
  if (found.size === 0) return 'refused'
  // Another action besides ("… and make it bold"): not a replacement alone; read part by part.
  if (!onlyActions(text, REPLACE_ACTIONS)) return undefined
  const all = [...found.values()]
  return { commands: all.map(({ find, put }) => `replace "${find}" with "${put}"`), band: all.every((f) => f.band === 'sure') ? 'sure' : 'likely' }
}

// ----- tables, said any way --------------------------------------------------------

const DELETE = /\b(?:delete|remove|drop|erase|get\s+rid\s+of|take\s+out|cut|eliminate|scrap)\b/iu
const SORT = /\b(?:sort|order|arrange|rank|re-?order|organi[sz]e)\b/iu
const TOP = /\b(?:(?:on|at)\s+(?:the\s+)?top|first)\b/iu
const BOTTOM = /\b(?:(?:at|to)\s+the\s+bottom|last)\b/iu
const DESC = /\b(?:most|highest|biggest|largest|greatest|max(?:imum)?|best|descending|desc|high(?:est)?\s+to\s+low(?:est)?|z\s*(?:-|to)\s*a|most\s+expensive|dearest)\b/iu
const ASC = /\b(?:least|lowest|smallest|fewest|min(?:imum)?|worst|ascending|asc|low(?:est)?\s+to\s+high(?:est)?|a\s*(?:-|to)\s*z|alphabetical(?:ly)?|cheapest)\b/iu
const ALPHABET = /\b(?:alphabetical(?:ly)?|a\s*(?:-|to)\s*z|z\s*(?:-|to)\s*a|by\s+name)\b/iu
const ADD = /\b(?:add|append|insert|put|include|enter)\b/iu
const ROWISH = /\b(?:rows?|lines?|entr(?:y|ies)|records?|person|people|one\s+more|another(?:\s+one)?)\b/iu
const PLURAL = /\b(?:rows|lines|entries|records|people|all|every|both|them|everyone|each)\b/iu
const NUMBER = /^[-+]?[$€£₹]?\s?\d[\d,]*(?:\.\d+)?\s?%?$/u

const cellText = (md: string): string => plainText(parseInline(md)).trim()

/** Sort, delete rows, delete a column or add a row, read from a request said any way, on the one table chosen. */
function tableReading(text: string, table: TableBlock): Reading | undefined {
  if (!onlyActions(text, TABLE_ACTIONS)) return undefined
  const header = table.head ? table.rows[0]!.map(cellText) : []
  const body = table.rows.slice(table.head ? 1 : 0).map((row) => row.map(cellText))
  const width = table.rows[0]?.length ?? 0
  const named = header.filter((name) => name !== '' && findPattern(name).test(text)).sort((a, b) => b.length - a.length)
  const numeric = header.flatMap((name, c) => (body.some((row) => row[c] !== '') && body.every((row) => row[c] === '' || NUMBER.test(row[c]!)) ? [name] : []))

  if (DELETE.test(text) && /\bcolumns?\b/iu.test(text) && named.length === 1) return { commands: [`delete the column ${named[0]}`], band: 'sure' }

  if (SORT.test(text) || (TOP.test(text) && (DESC.test(text) || ASC.test(text)))) {
    if (!table.head) return undefined
    let down = DESC.test(text) && !ASC.test(text)
    if (BOTTOM.test(text) && !TOP.test(text) && (DESC.test(text) || ASC.test(text))) down = !down
    if (named.length === 1) return { commands: [`sort by ${named[0]} ${down ? 'descending' : 'ascending'}`], band: 'sure' }
    if (named.length === 0 && (DESC.test(text) || ASC.test(text)) && !ALPHABET.test(text) && numeric.length === 1) {
      return { commands: [`sort by ${numeric[0]} ${down ? 'descending' : 'ascending'}`], band: 'sure' }
    }
    const byName = header.find((name) => /name/iu.test(name)) ?? header.find((name) => !numeric.includes(name))
    if (named.length === 0 && ALPHABET.test(text) && byName) return { commands: [`sort by ${byName} ${/z\s*(?:-|to)\s*a/iu.test(text) ? 'descending' : 'ascending'}`], band: 'likely' }
    return undefined
  }

  if (DELETE.test(text)) {
    const values = valuesIn(text, body, header)
    if (values.length === 0) return undefined
    const commands: string[] = []
    let band: Band = 'sure'
    for (const { value, rows, whole } of values) {
      if (rows > 1 && !PLURAL.test(text)) return undefined
      commands.push(`delete the ${rows > 1 ? 'rows' : 'row'} with ${value}`)
      if (!whole) band = 'likely'
    }
    return { commands, band }
  }

  if (ADD.test(text) && ROWISH.test(text)) {
    const at = ROWISH.exec(text)!
    let rest = text.slice(at.index + at[0].length)
    const colon = rest.indexOf(':')
    if (colon >= 0) rest = rest.slice(colon + 1)
    const values = [...rest.matchAll(/"([^"]+)"|“([^”]+)”|([-+]?[$€£₹]?\d[\d,]*(?:\.\d+)?%?)|(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*)*)/gu)]
      .map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim())
      .filter((value) => value !== '' && value !== 'I' && !header.some((name) => name.toLowerCase() === value.toLowerCase()))
    if (values.length !== width) return undefined
    // Each value of the kind its column holds: numbers in a column of numbers, words elsewhere.
    const fits = values.every((value, c) => numeric.includes(header[c] ?? '') === NUMBER.test(value))
    if (!fits || values.some((value) => value.includes('|'))) return undefined
    return { commands: [`add a row ${values.join(' | ')}${TOP.test(text) && !BOTTOM.test(text) ? ' at the top' : ''}`], band: 'likely' }
  }
  return undefined
}

/** The values a request names that stand in the table's rows: a whole cell, or else a word in one. */
function valuesIn(text: string, body: readonly (readonly string[])[], header: readonly string[]): { value: string; rows: number; whole: boolean }[] {
  const words = text.split(/\s+/u).map((w) => w.replace(/^["“'‘`(]+|[,.;:!?"”'’`)]+$/gu, '')).filter(Boolean)
  const out: { value: string; rows: number; whole: boolean }[] = []
  const taken = (value: string): boolean => out.some((o) => o.value.toLowerCase().includes(value.toLowerCase()))
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n)
      if (STOP.has(gram[0]!.toLowerCase()) || STOP.has(gram.at(-1)!.toLowerCase())) continue
      const value = gram.join(' ')
      const lower = value.toLowerCase()
      if (taken(value) || header.some((name) => name.toLowerCase() === lower) || /^(?:rows?|lines?|entr(?:y|ies)|records?|columns?|table)$/iu.test(value)) continue
      const whole = body.filter((row) => row.some((cell) => cell.toLowerCase() === lower)).length
      if (whole > 0) {
        out.push({ value, rows: whole, whole: true })
        continue
      }
      if (!nameLike(value)) continue
      const inside = body.filter((row) => row.some((cell) => findPattern(value).test(cell))).length
      if (inside > 0) out.push({ value, rows: inside, whole: false })
    }
  }
  return out
}

// ----- look, said any way -------------------------------------------------------------

/** wordOf's answers kept, as one request asks after the same words several times; emptied past 5000 words. */
const vocabulary = new Map<string, string | undefined>()

/**
 * Tier 0's word for a word of a longer request. Tier 0 forgives one wrong
 * letter in a word of four or more; in a sentence that would read "back" as
 * "black" and "sold" as "bold", so here only words of six letters or more are
 * forgiven ("underlne").
 */
function wordOf(token: string): string | undefined {
  if (vocabulary.has(token)) return vocabulary.get(token)
  const word = closest(token)
  const kept = word === token || token.length >= 6 ? word : undefined
  if (vocabulary.size > 5000) vocabulary.clear()
  vocabulary.set(token, kept)
  return kept
}

/** Complaints that say what to do: "people cannot read it". ("Too small" and "too big" are tier 0's own phrases.) */
const COMPLAINTS: readonly [RegExp, string][] = [
  [/\b(?:hard|difficult|impossible)\s+to\s+(?:read|see)\b/gu, ' bigger '],
  [/\b(?:can'?t|can’t|cannot|can\s+not|could\s+not|couldn'?t|unable\s+to)\s+(?:read|see)\b/gu, ' bigger '],
]
const COMPLAINT = /\btoo\s+(?:small|tiny|big|large|huge)\b|\b(?:hard|difficult|impossible)\s+to\s+(?:read|see)\b|\b(?:can'?t|can’t|cannot|can\s+not|could\s+not|couldn'?t|unable\s+to)\s+(?:read|see)\b/u
/** Words that say why, or how much, and nothing about what: "it needs to stand out more". */
const QUIET: readonly RegExp[] = [/\b(?:stand\s+out|pop\s+out|catch\s+the\s+eye|look\s+important)\b/gu, /\b(?:whole|entire|full|all\s+of)\b/gu]
const NEUTRAL = new Set('because since so as cause cuz coz but then also too now it its they them that which who when while if here there again please thanks quickly everywhere throughout more less much way really very bit little lot lots one ones is are was were be been being i we you he she my our your his her their me us need needs needed want wants'.split(' '))
const SET_VERBS = /\b(?:make|turn|set|change|put|use|give|apply|colou?r|paint|switch|want|need|needs|should|could|would|let|format|style|keep)\b/u
const OBJECT = /\b(?:it|this|these|them|that|those|everything|all)\b/u
const NEGATION = /\b(?:not|don'?t|don’t|do\s+not|never|no\s+longer|without|stop)\b/u

/** The key a change sets, so two that disagree ("blue" and "red", "bigger" and "smaller") are caught. */
function keysOf(change: Change): [string, unknown][] {
  if ('style' in change) return Object.entries(change.style)
  if ('mark' in change) return Object.entries(change.mark)
  if ('size' in change) return [['size step', change.size]]
  return [['action', change.action]]
}

/**
 * A change of look, read from a request said any way: "hey, make this heading
 * red, it is the important one", "the font is way too small, people at the
 * back cannot read it". The words that say what to change are tier 0's own;
 * the rest only says why, or the request goes to the model.
 */
function styleReading(text: string): Reading | undefined {
  if (!onlyActions(text, STYLE_ACTIONS)) return undefined
  const original = text.toLowerCase()
  // Worn down in stages: tier 0's phrases made its words, complaints made changes, what says only why taken away,
  // pointers set aside. What is left must then be words tier 0 knows, or words that say nothing.
  let lower = original
  for (const [pattern, to] of PHRASES) lower = lower.replace(pattern, to)
  if (NEGATION.test(lower)) return undefined
  const complaint = COMPLAINT.test(original)
  for (const [pattern, to] of COMPLAINTS) lower = lower.replace(pattern, to)
  for (const pattern of QUIET) lower = lower.replace(pattern, ' ')
  const pointers = [...lower.matchAll(POINTER)].map((m) => m[0])
  lower = lower.replace(POINTER, ' ')
  const code = colourIn(text)
  if (code !== undefined) lower = lower.replace(/#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/u, ' colourcode ')

  // Words, phrase by phrase: punctuation ends a phrase, so "bigger, people" is two.
  const tokens = lower.split(/[,.;:!?]+/u).flatMap((phrase) => [...phrase.split(/[^a-z0-9'-]+/u).filter(Boolean), '|'])
  const known = (token: string): string | undefined => (token === 'colourcode' ? token : wordOf(token.replace(/'/gu, '')))
  const isValue = (word: string | undefined): word is string => word === 'colourcode' || (word !== undefined && meaning(word) !== undefined)
  const unknown = (token: string): boolean => {
    const word = known(token)
    return !isValue(word) && !(word !== undefined && FILLER.has(word)) && !NEUTRAL.has(token)
  }
  const values: string[] = []
  const set = new Map<string, unknown>()
  let others = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === '|') continue
    const word = known(token)
    if (!isValue(word)) {
      if (unknown(token)) others++
      continue
    }
    // A value word that describes a thing named next ("red fruits", "a title page") is content, not a change.
    const next = tokens[i + 1]
    if (next !== undefined && next !== '|' && unknown(next)) return undefined
    const change: Change = word === 'colourcode' ? { style: { color: code! } } : meaning(word)!
    for (const [key, value] of keysOf(change)) {
      if (set.has(key) && set.get(key) !== value) return undefined
      set.set(key, value)
    }
    if (set.has('size') && set.has('size step')) return undefined
    if (!values.includes(word)) values.push(word)
  }
  if (values.length === 0) return undefined
  const acts = set.has('action')
  if (acts && values.length > 1) return undefined
  // Value words among other words, with nothing asking for a change: a description, not a request.
  if (!SET_VERBS.test(original) && !complaint && others > 0 && !acts) return undefined
  const command = [...pointers, ...values.map((value) => (value === 'colourcode' ? code! : value))].join(' ')
  const sure = !acts && others <= 8 && (pointers.length > 0 || OBJECT.test(original) || others === 0)
  return { commands: [command], band: sure ? 'sure' : 'likely' }
}

// ----- several changes in one request ------------------------------------------------

/** Which instant function reads a short command as it stands, if one does. */
function exactly(command: string, ctx: Context): 'swap' | 'table' | 'look' | undefined {
  if (swapOps(command, ctx) !== undefined) return 'swap'
  if (tableEditOps(command, ctx) !== undefined) return 'table'
  return tier0(command, ctx) !== undefined ? 'look' : undefined
}

/** With a table chosen, words for its parts mean the request is about the table, not its look: "add one more person: Green …". */
const TABLE_WORDS = /\b(?:rows?|columns?|cells?|entr(?:y|ies)|records?|person|people|one\s+more|another)\b/iu
const lookReading = (text: string, table: TableBlock | undefined): Reading | undefined => (table && TABLE_WORDS.test(text) ? undefined : styleReading(text))

/** A part of a request that only says why ("it needs to stand out", "fix it"): no change, no words of the note, no action of its own. */
function saysWhy(clause: string, texts: readonly string[]): boolean {
  const tokens = clause.toLowerCase().split(/[^a-z0-9'-]+/u).filter(Boolean)
  if (tokens.some((token) => meaning(wordOf(token) ?? '') !== undefined)) return false
  if (groundedPhrases(clause, texts, []).length > 0) return false
  const acts = [...clause.toLowerCase().matchAll(ACTIONS)].map((m) => m[0])
  if (acts.length === 0) return true
  // "fix it", "do that": an action with nothing to act on but what is chosen.
  return tokens.every((token) => acts.includes(token) || FILLER.has(token) || NEUTRAL.has(token) || OBJECT.test(token))
}

/** A request of several parts, each one read on its own: "make the title blue and replace Smith with Akshat". */
function byParts(text: string, ctx: Context, texts: readonly string[], table: TableBlock | undefined): Reading | undefined {
  const parts = text
    .split(/\s*(?:[.;!?]+(?:\s+|$)|,\s+|\s+and\s+then\s+|\s+and\s+also\s+|\s+and\s+|\s+then\s+|\s+also\s+)\s*/iu)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return undefined
  const commands: string[] = []
  // The parts about look are read together, so "too small … make it bigger" is one step bigger, not two.
  const looks: string[] = []
  let band: Band = 'sure'
  for (const part of parts) {
    const kind = exactly(part, ctx)
    if (kind === 'look') looks.push(part)
    else if (kind) commands.push(part)
    else {
      const replaced = replaceReading(part, text, texts)
      if (replaced === 'refused') return undefined
      const reading = replaced ?? (table ? tableReading(part, table) : undefined)
      if (reading) {
        commands.push(...reading.commands)
        if (reading.band === 'likely') band = 'likely'
      } else if (lookReading(part, table)) looks.push(part)
      else if (!saysWhy(part, texts)) return undefined
    }
  }
  if (looks.length > 0) {
    const look = lookReading(looks.join(', '), table)
    if (!look) return undefined
    commands.unshift(...look.commands)
    if (look.band === 'likely') band = 'likely'
  }
  const unique = [...new Set(commands)]
  return unique.length > 0 ? { commands: unique, band } : undefined
}

// ----- the reading ------------------------------------------------------------------

/**
 * A request read as short instant commands, or undefined to leave it to the
 * model. Only requests the instant functions do not read as they stand come
 * here (ai/instant.ts).
 */
export function readRequest(instruction: string, ctx: Context): Reading | undefined {
  if (ctx.aliases.selected.length === 0) return undefined
  const text = clean(instruction)
  if (text === '' || GENERATIVE.test(text)) return undefined
  if (exactly(text, ctx)) return { commands: [text], band: 'sure' }
  const texts = chosenTexts(ctx.doc, ctx.aliases)
  const table = chosenTable(ctx)
  // 'refused': it asked for a replacement whose words are not there. No other reading may have it: the model does.
  const replaced = replaceReading(text, text, texts)
  if (replaced === 'refused') return undefined
  // Exactly one reading is taken. None, or more than one, and it is read part by part, each part accounting for itself.
  const readings = [replaced, table ? tableReading(text, table) : undefined, lookReading(text, table)].filter((r): r is Reading => r !== undefined)
  if (readings.length === 1) return readings[0]
  return byParts(text, ctx, texts, table)
}
