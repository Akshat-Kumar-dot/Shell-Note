// Select by kind: "all headings", "every formula". Code
// turns the phrase into a selection before any model is called, so page-wide
// edits never need the model to read the whole page. Only the person's
// request can widen a selection this way, never note content.
import type { Block, Doc, Id } from '../schema/doc.js'
import { linearise } from '../linearise.js'
import type { Selection } from './selection.js'

const KINDS: [RegExp, (block: Block) => boolean][] = [
  [/^(headings?|headers?|titles?)$/, (b) => b.type === 'text' && ['h1', 'h2', 'h3'].includes(b.role)],
  [/^paragraphs?$/, (b) => b.type === 'text' && b.role === 'p'],
  [/^(bullets?|list ?items?|items?)$/, (b) => b.type === 'text' && b.role === 'li'],
  [/^(numbered ?items?|steps?)$/, (b) => b.type === 'text' && b.role === 'oli'],
  [/^(to-?dos?|tasks?|checkboxe?s?)$/, (b) => b.type === 'text' && b.role === 'todo'],
  [/^(quotes?|quotations?)$/, (b) => b.type === 'text' && b.role === 'quote'],
  [/^(text|text blocks?|lines?)$/, (b) => b.type === 'text'],
  [/^(formulas?|formulae|equations?|maths?)$/, (b) => b.type === 'math'],
  [/^(images?|pictures?|photos?|figures?)$/, (b) => b.type === 'image'],
  [/^(diagrams?|charts?|flowcharts?|graphs?)$/, (b) => b.type === 'diagram'],
  [/^(drawings?|handwriting|ink|sketch(es)?|strokes?)$/, (b) => b.type === 'ink'],
  [/^tables?$/, (b) => b.type === 'table'],
]

/**
 * Whether `block` is of the kind a word names ("heading", "formulas"), or
 * undefined when the word names no kind.
 */
export function isKind(word: string, block: Block): boolean | undefined {
  const test = KINDS.find(([pattern]) => pattern.test(word.toLowerCase()))?.[1]
  return test ? test(block) : undefined
}

const PHRASE = /\b(?:all|every|each)\s+(?:the\s+|of\s+the\s+)?((?:numbered|list|text)\s+\w+|[\w-]+)(\s+(?:on|in)\s+(?:this|the)\s+(?:page|note|document)|\s+everywhere)?/iu

export interface ByKind {
  selection: Selection
  /** The request without the phrase that chose the blocks. */
  rest: string
}

/**
 * When the request names a kind of block ("all headings"), select every block
 * of that kind: on the current page, or in the whole note when the request
 * says so. Undefined when the request names no kind.
 */
export function selectByKind(doc: Doc, selection: Selection, instruction: string): ByKind | undefined {
  const match = PHRASE.exec(instruction)
  if (!match) return undefined
  const word = match[1]!.toLowerCase()
  const test = KINDS.find(([pattern]) => pattern.test(word))?.[1]
  if (!test) return undefined
  const whole = /note|document|everywhere/iu.test(match[2] ?? '')
  const page = whole ? undefined : currentPage(doc, selection)
  const blocks = linearise(doc, page === undefined ? {} : { page })
    .map((item) => item.block)
    .filter(test)
    .map((block) => block.id)
  const rest = (instruction.slice(0, match.index) + instruction.slice(match.index + match[0].length)).replace(/\s+/gu, ' ').trim()
  return { selection: { blocks }, rest }
}

const EVERY = /\b(?:these|those|them|both|all|each|every)\b/iu
const SOME = /\b(?:first|second|third|fourth|fifth|last|one|only|except|but|other|others|not)\b/iu

/**
 * True when a request is about every selected block: "make these blue",
 * "both of them". A word that picks some of them ("the first", "except")
 * cancels it, so the model's own choice stands.
 */
export function meansEvery(instruction: string): boolean {
  return EVERY.test(instruction) && !SOME.test(instruction)
}

/** True when a request picks out some of what is selected: "the first", "only", "except". */
export function singlesOut(instruction: string): boolean {
  return SOME.test(instruction)
}

/** The page the selection is on: its first block's, or the marked place's, or the first page. */
export function currentPage(doc: Doc, selection: Selection): Id {
  const pageOf = (id: Id): Id | undefined => {
    const block = doc.block[id]
    if (!block) return undefined
    if ('page' in block) return block.page
    const frame = doc.block[block.parent]
    return frame && 'page' in frame ? frame.page : undefined
  }
  for (const id of selection.blocks) {
    const page = pageOf(id)
    if (page !== undefined) return page
  }
  const here = selection.here
  if (here) return 'page' in here ? here.page : (pageOf(here.parent) ?? doc.pages[0]!)
  return doc.pages[0]!
}
