// A block named in words (note control, step 2, piece 3; the of 21 October 2026: "blocks named by their content or
// position words, not only ids"): its id; $1, $2, a block an earlier line of the request made; its kind and count on
// the page the request is about, as the page picture shows them ("the second paragraph", "paragraph 2", "the last
// heading", "the first block on page 2"); its kind and words ("the heading Summary", "the paragraph about rewards");
// or its words alone, all or how they start. Never a guess: two that fit are offered, each with its id and first
// words, and none that fits says what the page has.
import { blockOf, wordsOf } from '../command/page.js'
import type { Doc } from '../schema/doc.js'
import { pageFacts, type Drawn, type Placed } from './picture.js'
import { tableWords } from './table.js'

/** Where a reference is read: the page the request is about (from 1), the boxes drawn, the blocks earlier lines made. */
export interface ReferContext {
  page: number
  drawn?: ReadonlyMap<string, Drawn>
  /** The ids of the blocks earlier lines of the request made, in order: $1 is the first. */
  made?: readonly string[]
}

export type Referred = { ok: true; id: string } | { ok: false; why: string }

/** The kinds a reference may say, in the picture's words (kindOf): one word may stand for several ("item"). */
const KINDS: readonly [readonly string[], readonly string[]][] = [
  [['paragraph', 'paragraphs', 'para', 'text'], ['paragraph']],
  [['heading', 'headings', 'header', 'title', 'subheading', 'subtitle', 'section heading'], ['heading']],
  [['list item', 'bullet', 'bullets', 'bullet point', 'point', 'points'], ['list item']],
  [['numbered item', 'numbered point', 'step', 'steps'], ['numbered item']],
  [['to-do', 'todo', 'to do', 'task', 'checkbox', 'check box'], ['to-do']],
  [['item', 'items', 'list'], ['list item', 'numbered item', 'to-do']],
  [['quote', 'quotation', 'blockquote'], ['quote']],
  [['maths', 'math', 'formula', 'equation'], ['maths']],
  [['picture', 'image', 'photo', 'figure'], ['picture']],
  [['diagram', 'chart', 'flowchart', 'graph'], ['diagram']],
  [['table'], ['table']],
  [['handwriting', 'drawing', 'ink', 'sketch'], ['handwriting']],
  [['block', 'blocks', 'thing', 'one'], []],
]
const KIND = new Map(KINDS.flatMap(([words, kinds]) => words.map((word) => [word, kinds] as const)))
const KIND_WORDS = [...KIND.keys()].sort((a, b) => b.length - a.length).map((word) => word.replace(/ /gu, '\\s+'))

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
const ORDINAL = `(?:${Object.keys(ORDINALS).join('|')}|last|\\d+(?:st|nd|rd|th))`

/** "the second paragraph", "the last heading on page 2", "the 3rd item" */
const BY_ORDER = new RegExp(`^(?:the\\s+)?(?:(second|third)\\s+(?:last|to\\s+last|from\\s+last)\\s+|(${ORDINAL})\\s+)(${KIND_WORDS.join('|')})(?:\\s+on\\s+(?:page\\s+)?(\\d+))?$`, 'iu')
/** "paragraph 2", "heading 1 on page 3": the picture's own label */
const BY_LABEL = new RegExp(`^(?:the\\s+)?(${KIND_WORDS.join('|')})\\s+(\\d+)(?:\\s+on\\s+(?:page\\s+)?(\\d+))?$`, 'iu')
/** "the quote", "the table": the one of its kind on the page */
const BY_KIND = new RegExp(`^(?:the|this|that)\\s+(${KIND_WORDS.join('|')})(?:\\s+on\\s+(?:page\\s+)?(\\d+))?$`, 'iu')
/** "the heading Summary", "the paragraph about rewards", "the table called Results" */
const BY_WORDS = new RegExp(`^(?:the\\s+)?(${KIND_WORDS.join('|')})\\s+(?:(about|on|with|that\\s+says|saying|called|named|titled)\\s+)?(.+)$`, 'iu')

/** "the ripple tank photo", "my speeds table": the words, then the kind */
const BY_WORDS_LAST = new RegExp(`^(?:the|my|this|that)\\s+(.+?)\\s+(${KIND_WORDS.join('|')})$`, 'iu')

const plain = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[“”"'‘’]/gu, '').replace(/\s+/gu, ' ').trim()

/** A block in a list of those that fit, as an offer: its id, kind and first words. */
const offer = (one: Placed): string => `${one.id} (${one.kind} ${one.nth}${one.words ? ` ${one.words}` : ''})`

/** The block a reference names, or why it names none, or which it could be. */
export function referTo(doc: Doc, written: string, context: ReferContext): Referred {
  const said = written.trim().replace(/[.,;:!?]+$/u, '')
  if (said === '') return { ok: false, why: 'No block named: give its id, or words such as "the second paragraph".' }
  // $1: the block an earlier line made.
  const made = /^\$(\d+)$/u.exec(said)
  if (made) {
    const id = context.made?.[Number(made[1]) - 1]
    return id !== undefined && doc.block[id] ? { ok: true, id } : { ok: false, why: `${said} names the block made by line ${made[1]} of this request, and ${context.made?.length ? `only ${context.made.length} made one` : 'no line before it made one'}.` }
  }
  if (doc.block[said]) return { ok: true, id: said }

  const facts = (page: number): Placed[] | string => {
    try {
      return pageFacts(doc, page, context.drawn).blocks
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  const ofKinds = (blocks: Placed[], kinds: readonly string[]): Placed[] => (kinds.length === 0 ? blocks.filter((one) => one.kind !== 'text frame') : blocks.filter((one) => kinds.includes(one.kind)))
  const kindsOf = (word: string): readonly string[] => KIND.get(word.toLowerCase().replace(/\s+/gu, ' ')) ?? []
  const named = (word: string): string => word.toLowerCase().replace(/\s+/gu, ' ')

  // By order: the second paragraph, the last heading, the second to last item.
  const order = BY_ORDER.exec(said)
  if (order) {
    const page = order[4] ? Number(order[4]) : context.page
    const blocks = facts(page)
    if (typeof blocks === 'string') return { ok: false, why: blocks }
    const kinds = kindsOf(order[3]!)
    const list = ofKinds(blocks, kinds)
    const ordinal = order[2]?.toLowerCase()
    const fromEnd = order[1] ? ORDINALS[order[1].toLowerCase()]! : ordinal === 'last' ? 1 : undefined
    const nth = fromEnd !== undefined ? list.length - fromEnd + 1 : (ORDINALS[ordinal!] ?? Number.parseInt(ordinal!, 10))
    const one = list[nth - 1]
    if (one) return { ok: true, id: one.id }
    return { ok: false, why: `Page ${page} has ${list.length === 0 ? 'no' : list.length} ${named(order[3]!)}${list.length === 1 ? '' : 's'}${list.length > 0 ? `: ${list.slice(0, 8).map(offer).join(', ')}` : ''}.` }
  }

  // By its kind alone: the quote, the table, when the page has one.
  const kind = BY_KIND.exec(said)
  if (kind && kindsOf(kind[1]!).length > 0) {
    const page = kind[2] ? Number(kind[2]) : context.page
    const blocks = facts(page)
    if (typeof blocks === 'string') return { ok: false, why: blocks }
    const list = ofKinds(blocks, kindsOf(kind[1]!))
    if (list.length === 1) return { ok: true, id: list[0]!.id }
    return { ok: false, why: list.length === 0 ? `Page ${page} has no ${named(kind[1]!)}.` : `Page ${page} has ${list.length} ${named(kind[1]!)}s: ${list.slice(0, 8).map(offer).join(', ')}. Say which: by its id, or "the second ${named(kind[1]!)}".` }
  }

  // By the picture's label: paragraph 2, heading 1 on page 3.
  const label = BY_LABEL.exec(said)
  if (label) {
    const page = label[3] ? Number(label[3]) : context.page
    const blocks = facts(page)
    if (typeof blocks === 'string') return { ok: false, why: blocks }
    const list = ofKinds(blocks, kindsOf(label[1]!))
    const one = list[Number(label[2]) - 1]
    if (one) return { ok: true, id: one.id }
    return { ok: false, why: `Page ${page} has ${list.length === 0 ? 'no' : list.length} ${named(label[1]!)}${list.length === 1 ? '' : 's'}${list.length > 0 ? `: ${list.slice(0, 8).map(offer).join(', ')}` : ''}.` }
  }

  // By kind and words: the heading Summary (its words, all or how they start), the paragraph about rewards (in them).
  const byWords = BY_WORDS.exec(said)
  if (byWords && KIND.has(named(byWords[1]!))) {
    const kinds = kindsOf(byWords[1]!)
    const about = byWords[2] !== undefined && /^(?:about|on|with)$/iu.test(byWords[2])
    const wanted = plain(byWords[3]!)
    const fits = (id: string): boolean => {
      const words = plain(wordsOf(doc.block[id]!) ?? '')
      return about ? words.includes(wanted) : words === wanted || (wanted.length >= 3 && words.startsWith(wanted))
    }
    // On the page the request is about first, then anywhere in the note.
    const here = facts(context.page)
    const onPage = typeof here === 'string' ? [] : ofKinds(here, kinds).filter((one) => fits(one.id))
    const everywhere = onPage.length > 0 ? onPage : doc.pages.flatMap((_, i) => { const blocks = facts(i + 1); return typeof blocks === 'string' ? [] : ofKinds(blocks, kinds).filter((one) => fits(one.id)) })
    if (everywhere.length === 1) return { ok: true, id: everywhere[0]!.id }
    if (everywhere.length > 1) return { ok: false, why: `${everywhere.length} ${named(byWords[1]!)}s fit "${byWords[3]!}": ${everywhere.slice(0, 6).map(offer).join(', ')}. Name one by its id.` }
    // No block of that kind says so: the words may be the block's own (a paragraph that starts "The heading…").
  }

  // Its words, then its kind: the ripple tank photo, the speeds table (step 3; a picture is named so).
  const kindLast = BY_WORDS_LAST.exec(said)
  if (kindLast && KIND.has(named(kindLast[2]!))) {
    const kinds = kindsOf(kindLast[2]!)
    const wanted = plain(kindLast[1]!)
    const withKind = `${wanted} ${named(kindLast[2]!)}`
    const fits = (id: string): boolean => {
      const words = plain(wordsOf(doc.block[id]!) ?? '')
      return words === wanted || words === withKind || (wanted.length >= 3 && (words.startsWith(wanted) || words.includes(wanted)))
    }
    const all = doc.pages.flatMap((_, i) => { const blocks = facts(i + 1); return typeof blocks === 'string' ? [] : ofKinds(blocks, kinds).filter((one) => fits(one.id)) })
    const here = all.filter((one) => one.page === context.page)
    const list = here.length === 1 ? here : all
    if (list.length === 1) return { ok: true, id: list[0]!.id }
    if (list.length > 1) return { ok: false, why: `${list.length} ${named(kindLast[2]!)}s fit "${said}": ${list.slice(0, 6).map(offer).join(', ')}. Name one by its id.` }
  }

  // Its words alone, all or how they start.
  try {
    return { ok: true, id: blockOf(doc, said) }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    // The page's blocks, to choose from by id or by kind and count.
    const blocks = facts(context.page)
    const listed = typeof blocks === 'string' ? '' : ` On page ${context.page}: ${blocks.filter((one) => one.kind !== 'text frame').slice(0, 10).map(offer).join(', ')}.`
    return { ok: false, why: `${why.replace(/ note\.blocks lists them all\.$/u, '')}${listed}` }
  }
}

/** The words that make a request one about the note's text: its kinds, or a verb only text takes. */
const TEXT_KINDS = /\b(?:headings?|title|subtitle|paragraphs?|sentences?|lists?|bullets?|bullet points?|to-?dos?|quotes?|words?|wording|summary|tables?|rows?|columns?|cells?|formulas?|formulae|equations?|maths?|diagrams?|flow ?charts?|charts?|graphs?|pictures?|images?|photos?|figures?|captions?)\b/iu
const TEXT_VERBS = /\b(?:write|rewrite|reword|rephrase|shorten|summari[sz]e|translate|indent|outdent|tick|untick)\b/iu

/** Whether a request speaks of the note's text: a heading, a paragraph, a list… or writing, rewording, ticking. */
export const aboutTheText = (request: string): boolean => TEXT_KINDS.test(request) || TEXT_VERBS.test(request)

/** A reference inside a request with its words before its kind: "the ripple tank photo", "the lab kit paragraph". */
const IN_REQUEST_LAST = new RegExp(`\\b(?:the|my|this|that)\\s+(?:[\\p{L}\\p{N}'-]+\\s+){1,4}?(?:${KIND_WORDS.join('|')})\\b`, 'giu')

/** A reference inside a request: the kind, with its count or its place in order before it ("the second paragraph"). */
const IN_REQUEST = new RegExp(`(?:the\\s+)?(?:(?:${ORDINAL})\\s+)?(?:${KIND_WORDS.join('|')})(?:\\s+\\d+)?`, 'giu')

/**
 * The blocks a request names, at most six, in the order it names them: by id, by kind and count or kind alone ("the
 * second paragraph", "the quote"), or by words in quotes. For the first message, so their whole words go with it.
 */
export function namedIn(doc: Doc, request: string, context: ReferContext): string[] {
  const found = new Set<string>()
  const add = (written: string): void => {
    const one = referTo(doc, written, context)
    if (one.ok && doc.block[one.id]?.type !== 'frame') found.add(one.id)
  }
  for (const token of request.match(/[A-Za-z0-9][A-Za-z0-9_-]{0,31}/gu) ?? []) if (doc.block[token] && doc.block[token].type !== 'frame') found.add(token)
  for (const match of request.matchAll(IN_REQUEST)) if (/\b(?:the|this|that)\b|\d/iu.test(match[0])) add(match[0])
  for (const match of request.matchAll(/["“‘]([^"”’]{3,})["”’]/gu)) add(match[1]!)
  // Its words, then its kind: "the ripple tank photo" (the note test's baseline: neither model was given gi, on page 2).
  for (const match of request.matchAll(IN_REQUEST_LAST)) add(match[0])
  return [...found].slice(0, 6)
}

/** The most of a block's words given in full: a longer one is cut there, and says so. */
const IN_FULL = 4000

/**
 * A block's words in full, made safe as the picture makes its first words (data, never instructions): one line, in
 * curly quotes, its quotes plain apostrophes, no backticks. For the first message of a request that names the block,
 * so the model can rewrite it with no call to read it first.
 */
export function wordsInFull(doc: Doc, id: string): string | undefined {
  const block = doc.block[id]
  // A table and a diagram whole, a line each, so they can be rewritten (step 3): indented under their id, their
  // backticks plain, so no line can close a block or pose as a line of the terminal's.
  const lines = block?.type === 'table' ? tableWords(block) : block?.type === 'diagram' ? block.src : undefined
  if (lines !== undefined) {
    const all = lines.replace(/`+/gu, "'").split('\n').map((line) => `      ${line.trimEnd()}`)
    return `(the note's ${block!.type}, a line each)\n${all.slice(0, 200).join('\n')}${all.length > 200 ? `\n      … (cut: ${all.length} lines in all)` : ''}`
  }
  const words = block ? (block.type === 'image' ? [block.alt, block.caption].filter(Boolean).join(' · ') || undefined : wordsOf(block)) : undefined
  if (words === undefined) return undefined
  const one = words.replace(/`+/gu, "'").replace(/["“”]/gu, "'").replace(/\s+/gu, ' ').trim()
  return one.length > IN_FULL ? `“${one.slice(0, IN_FULL)}…” (cut: ${one.length} characters in all)` : `“${one}”`
}
