// Find and replace, done by code before any model: "change Smith to Akshat",
// "replace colour with color", "rename Q3 to Quarter 3", "Smith -> Akshat",
// "Akshat instead of Smith". When the words to find are in what is chosen, code
// swaps every one of them, each keeping its formatting, with no model and no
// tokens. Asked of gemma-4-e4b, that change to a 15-row table took 35 s: it
// wrote the whole table again. Words that are not there, or a request that is
// not a swap, such as "change it to French", go on to tier 0 and the model.
import { replaceMatches } from '../markdown/range.js'
import type { Doc } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import type { AiOp } from '../schema/protocol.js'
import { spliceFor } from '../splice.js'
import type { Aliases } from './alias.js'
import { distance, isFormatWord } from './tier0.js'

/** The operations of a swap, and what it did in alias terms, for the log. */
export interface Swap {
  ops: Op[]
  ai: AiOp[]
}

/** The verbs of a swap; one wrong letter in a longer one is forgiven. */
const VERBS = ['change', 'replace', 'rename', 'swap', 'switch', 'correct', 'substitute']
/** Verbs that always ask for a swap. "Change" and the others may name a property instead: "change the colour to blue". */
const SURE = new Set(['replace', 'rename', 'swap', 'substitute'])
/** Polite words before the verb. */
const LEAD = /^(?:(?:please|pls|kindly|now|just|can\s+you|could\s+you)\s+)+/iu
/** The word between what to find and what to put: "X to Y", "X with Y". */
const BETWEEN = /\s+(?:to|with|by|into|for)\s+/iu
/** Words around what to find that are not part of it: "all the", "the name". */
const FIND_LEAD = /^(?:(?:all|every|each|the|a|an|any)\s+)*(?:(?:names?|words?|values?|entry|entries|cells?|spelling\s+of)\s+(?=\S))?/iu
/** Words after what to put that say where, not what: "in the table", "everywhere". */
const PUT_TAIL = /\s+(?:please|everywhere|throughout|(?:in|on|across|throughout)\s+(?:it|(?:the|this|that|all|every|each|whole)\b.*))$/iu
const QUOTED = /^["'“”‘’`](.*)["'“”‘’`]$/su

/** Words that point at what is chosen, never words to find in it: "replace it with a table". */
const POINTERS = new Set('it this that these those them they here there everything all selection selected'.split(' '))

/**
 * Properties of what is chosen, not words in it: "change the font to serif",
 * "change the language to Hindi". Searched for only after a verb in SURE.
 */
const PROPERTIES = new Set(
  'text word words line lines sentence sentences paragraph paragraphs heading headings title titles table tables row rows column columns cell cells list bullet bullets item items name names language tone tense case font fonts colour color size style format formatting layout order number numbers value values diagram chart graph picture image caption formula equation'.split(' '),
)

const LANGUAGE_WORDS = 'english hindi french spanish german italian portuguese russian chinese japanese korean arabic urdu bengali bangla tamil telugu marathi gujarati kannada malayalam punjabi latin greek dutch turkish persian'

/** Languages a request may ask a translation into. */
export const LANGUAGES: ReadonlySet<string> = new Set(LANGUAGE_WORDS.split(' '))

/**
 * What to put that is not words to write, but a language, a letter case, a
 * tone or a kind of block: "change hello to Hindi" asks for a translation,
 * "replace it with a table" for a table.
 */
const NOT_PUT = new Set(
  `${LANGUAGE_WORDS} uppercase lowercase upper lower capitals capital caps titlecase plural singular simpler shorter longer formal informal polite casual passive active numbered past present future tense case table tables diagram diagrams chart charts graph graphs flowchart picture image formula equation math code link summary points`.split(' '),
)

/** What a request asks to find and what to put instead, if it is a swap. */
export function swapOf(instruction: string): { find: string; put: string } | undefined {
  const text = instruction.trim().replace(/[.!]+$/u, '').replace(/\s+/gu, ' ').replace(LEAD, '')
  let find: string | undefined
  let put: string | undefined
  // An arrow, "instead of" and the verbs in SURE ask for a swap outright: "replace colour with color".
  let sure = true
  const arrow = /^(.+?)\s*(?:->|→|=>|⇒)\s*(.+)$/u.exec(text)
  const instead = /^(?:(?:write|put|use|say|type|make\s+it)\s+)?(.+?)\s+instead\s+of\s+(.+)$/iu.exec(text)
  if (arrow) [find, put] = [arrow[1]!, arrow[2]!]
  else if (instead) [find, put] = [instead[2]!, instead[1]!]
  else {
    const verb = /^(\p{L}+)\s+(.+)$/u.exec(text)
    if (!verb) return undefined
    const word = verb[1]!.toLowerCase()
    const named = VERBS.find((v) => v === word || (word.length >= 5 && distance(word, v) <= 1))
    if (named === undefined) return undefined
    sure = SURE.has(named)
    const rest = verb[2]!
    // A quoted find may hold the word "to" itself: replace "to" with "too".
    const quoted = /^(["'“‘`])(.+?)["'”’`]\s+(?:to|with|by|into|for)\s+(.+)$/su.exec(rest)
    if (quoted) [find, put] = [`"${quoted[2]!}"`, quoted[3]!]
    else {
      const at = BETWEEN.exec(rest)
      if (!at) return undefined
      ;[find, put] = [rest.slice(0, at.index), rest.slice(at.index + at[0].length)]
    }
  }
  // Words in quotes are taken exactly as typed.
  const exactFind = QUOTED.test(find.trim())
  const exactPut = QUOTED.test(put.trim())
  // "change the date to tomorrow" names a value to change, not the word "date": one plain word after "the" is left to the model.
  const definite = !exactFind && /^the\s+(?!(?:names?|words?|values?|entry|entries|cells?|spelling\s+of)\s)/iu.test(find.trim())
  find = unquote(exactFind ? find : find.replace(FIND_LEAD, ''))
  put = unquote(exactPut ? put : put.replace(PUT_TAIL, '').replace(/^(?:the|a|an)\s+(?=\S)/iu, ''))
  if (find === '' || put === '') return undefined
  const lower = find.toLowerCase()
  if (!exactFind && (POINTERS.has(lower) || (!sure && PROPERTIES.has(lower)) || (definite && /^[\p{Ll}\p{N}'’-]+$/u.test(find)))) return undefined
  if (!exactPut && !putIsWords(put)) return undefined
  return { find, put }
}

/** Whether what to put is words to write: "change it to a numbered list", "to bold", "to Hindi" ask for a change of look or language instead. */
export function putIsWords(put: string): boolean {
  const words = put.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean)
  const notWords = (w: string): boolean => NOT_PUT.has(w) || isFormatWord(w)
  return words.length > 0 && !(words.length <= 2 ? words.some(notWords) : words.every(notWords))
}

/** Whether words to find name words, not what is chosen ("it", "this") or a property of it ("the font", "the language"). */
export function findIsWords(find: string): boolean {
  const lower = find.toLowerCase()
  return !POINTERS.has(lower) && !PROPERTIES.has(lower)
}

/** Where words stand in a text as words of their own, in any letter case, spaces between them counting as any spaces. */
export function findPattern(find: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(find).replace(/\s+/gu, '\\s+')}(?![\\p{L}\\p{N}_])`, 'giu')
}

/**
 * The operations that swap the words a request names, in what is chosen:
 * chosen words, whole text blocks, tables (each cell) and the captions of
 * tables and pictures. Undefined when the request is not a swap, or the words
 * are in none of them.
 */
export function swapOps(instruction: string, input: { doc: Doc; aliases: Aliases }): Swap | undefined {
  const { doc, aliases } = input
  if (aliases.selected.length === 0) return undefined
  const asked = swapOf(instruction)
  if (!asked) return undefined
  const put = (found: string): string => cased(found, asked.put)
  const tryFind = (find: string): Swap | undefined => {
    const pattern = findPattern(find)
    const ops: Op[] = []
    const ai: AiOp[] = []
    // Chosen words, from the last piece of a block back, so the earlier pieces' positions still hold.
    const pieces = aliases.selected.filter((s) => s.words !== undefined).sort((a, b) => b.words!.start - a.words!.start)
    const texts = new Map<string, { before: string; after: string; aliases: string[] }>()
    for (const { alias, words } of pieces) {
      const block = doc.block[words!.block]
      if (block?.type !== 'text') continue
      const entry = texts.get(block.id) ?? { before: block.md, after: block.md, aliases: [] }
      const after = replaceMatches(entry.after, pattern, put, words!.start, words!.end)
      if (after !== entry.after) entry.aliases.push(alias)
      texts.set(block.id, { ...entry, after })
    }
    for (const { alias, id, words } of aliases.selected) {
      if (words !== undefined) continue
      const block = doc.block[id]
      if (block?.type === 'text') {
        const after = replaceMatches(block.md, pattern, put)
        if (after !== block.md) texts.set(id, { before: block.md, after, aliases: [alias] })
      } else if (block?.type === 'table' || block?.type === 'image') {
        let changed = false
        if (block.type === 'table') {
          const rows = block.rows.map((row) => row.map((cell) => replaceMatches(cell, pattern, put)))
          if (JSON.stringify(rows) !== JSON.stringify(block.rows)) {
            ops.push({ op: 'update', id, set: { rows } })
            changed = true
          }
        }
        if (block.caption !== undefined) {
          const caption = replaceMatches(block.caption, pattern, put)
          if (caption !== block.caption) {
            ops.push(spliceFor(id, 'caption', block.caption, caption))
            changed = true
          }
        }
        if (changed) ai.push({ op: 'rewrite', id: alias })
      }
    }
    for (const [id, { before, after, aliases: which }] of texts) {
      if (after === before) continue
      ops.push(spliceFor(id, 'md', before, after))
      ai.push(...which.map((alias): AiOp => ({ op: 'rewrite', id: alias })))
    }
    return ops.length > 0 ? { ops, ai } : undefined
  }
  // "change all the smiths to akshat": the plural is looked for as one name too.
  return tryFind(asked.find) ?? (/[^s]s$/iu.test(asked.find) && asked.find.length > 3 ? tryFind(asked.find.slice(0, -1)) : undefined)
}

/** What to put, in the letter case of the words found, unless it was typed with capitals of its own. */
function cased(found: string, put: string): string {
  if (put !== put.toLowerCase()) return put
  if (found.length > 1 && found === found.toUpperCase() && found !== found.toLowerCase()) return put.toUpperCase()
  const first = found.charAt(0)
  return first !== first.toLowerCase() ? put.charAt(0).toUpperCase() + put.slice(1) : put
}

function unquote(text: string): string {
  const trimmed = text.trim()
  return QUOTED.exec(trimmed)?.[1]?.trim() ?? trimmed
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
