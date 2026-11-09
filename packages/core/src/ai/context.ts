// What the model is told. Two parts:
//
// - a fixed prefix: the core rules, one line per operation, and a few
//   examples. It depends only on the operation set and reply shape, so it is
//   byte-identical on every call and a local runtime can reuse its cache;
// - a short part for this call: the page, the selected blocks, their
//   neighbours, the notebook rules, recent edits when the request refers back,
//   and the request itself.
import { parseInline, plainText } from '../markdown/inline.js'
import { pipeTable } from '../markdown/table.js'
import type { Block, Doc } from '../schema/doc.js'
import { ALIGNS, FONTS, INTO, ACTIONS, KINDS, SIZES, type OpSet, type Scope, type Shape } from '../schema/protocol.js'
import { Color } from '../schema/doc.js'
import type { Selection, WordRange } from '../select/selection.js'
import { boxPlace, type Aliases } from './alias.js'
import { RULEBOOK } from './rulebook.generated.js'

export interface Prompt {
  /** The fixed prefix. */
  system: string
  /** The part for this call. */
  user: string
}

export interface PrefixOptions {
  set: OpSet
  shape: Shape
  maxOps: number
  /** Include worked examples. Default true; the benchmark compares both. */
  examples?: boolean
  /** One formatting operation: style also takes the word changes of mark, and mark is not offered. */
  merged?: boolean
  /** One call: the model writes new content in "content" itself, instead of a second call writing it. */
  inline?: boolean
}

const list = (values: readonly string[]): string => values.join(', ')

/** The fixed prefix: identical for every call with the same options. */
export function systemPrompt(options: PrefixOptions): string {
  const listShape = options.shape === 'list'
  const changes = (what: string): string => (listShape ? `"set" lists ${what}, each as its own item` : `give ${what} as fields`)
  const roles = 'p: paragraph, h1 h2 h3: headings, li: bullet, oli: numbered item, todo: to-do, quote'
  const colours = `${list(Color.options)}, or a colour code the request gives`
  const blockChanges = `size (${list(SIZES)}), color (${colours}), font (${list(FONTS)}), align (${list(ALIGNS)}), role (${roles}), indent (in: make it a sub-point, out), done (true or false: tick or untick a to-do)`
  const wordChanges = 'bold, italic, strike, code, highlight, underline, sub (subscript), sup (superscript) (each true or false), link (true: link the words to the address in the request; false: remove a link)'
  const next = options.inline ? 'put the new content in "content"' : 'the new content is written next'
  const lines = [RULEBOOK.topics.core, '', 'Operations:']
  if (options.merged) {
    lines.push(
      `- style: change blocks, or words; ${changes('the changes')}: ${blockChanges}, ${wordChanges}. On words, only color and the word changes.`,
    )
  } else {
    lines.push(
      `- style: change whole blocks; ${changes('the changes')}: ${blockChanges}. On words, only color.`,
      `- mark: change words, or all the words of one block; ${changes('the changes')}: ${wordChanges}, color (${colours}).`,
    )
  }
  lines.push(
    `- rewrite: new content for one block or one item of words: new words (simpler, shorter, in another language), a changed formula, diagram or table. Choose it${options.inline ? '' : ' only'}; ${next}.`,
    `- insert: add a new block (${list(KINDS)}) after or before a block, or "here" when HERE is given. A change inside a block, even adding to it, is a rewrite. Choose where and what kind; ${options.inline ? next : 'the content is written next'}.`,
    '- delete: remove blocks or words.',
    '- move: put a block after or before another block.',
    '- none: do nothing when the request is unclear or is not an edit, and say why in a few words.',
  )
  if (options.set === 'full') {
    lines.push(
      options.inline
        ? `- convert: turn blocks into one of: ${list(INTO)}; ${next}, one list item or step per line. To change one block's role (heading, bullet, numbered item, quote), use style.`
        : `- convert: turn blocks into one of: ${list(INTO)}. The new content is written next. To change one block's role (heading, bullet, numbered item, quote), use style.`,
      `- calc: one formula: ${list(ACTIONS)} ("derive" means differentiate; "check" checks worked steps). Code does the math.`,
    )
  }
  lines.push(
    '',
    options.maxOps === 1
      ? 'Reply with JSON: {"ops":[ ... ]}, with one operation.'
      : `Reply with JSON: {"ops":[ ... ]}. Usually one operation; up to ${options.maxOps} only when the request asks for several different changes.`,
  )
  if (options.inline) {
    lines.push('', 'In "content", follow the rules for its kind.', '', 'Text:', RULEBOOK.topics.text, '', 'Formula:', RULEBOOK.topics.math, '', 'Diagram:', RULEBOOK.topics.diagram)
  }
  if (options.examples !== false) lines.push('', 'Examples:', ...examples(listShape, options.merged === true, options.inline === true))
  return lines.join('\n')
}

function examples(listShape: boolean, merged: boolean, inline: boolean): string[] {
  const style = listShape ? '"set":[{"color":"red"},{"align":"center"}]' : '"color":"red","align":"center"'
  const bold = listShape ? '"set":[{"bold":true}]' : '"bold":true'
  return [
    `ASK make the title red and centred → {"ops":[{"op":"style","ids":["a"],${style}}]}`,
    merged ? `ASK bold the selected words → {"ops":[{"op":"style","ids":["b"],${bold}}]}` : `ASK bold the selected words → {"ops":[{"op":"mark","id":"b",${bold}}]}`,
    inline
      ? 'ASK say it more simply → {"ops":[{"op":"rewrite","id":"b","content":"A push or a pull changes how things move."}]}'
      : 'ASK say it more simply → {"ops":[{"op":"rewrite","id":"b"}]}',
    'ASK put this below the formula → {"ops":[{"op":"move","id":"a","at":"after","ref":"c"}]}',
    inline
      ? 'ASK add a diagram of these steps after it → {"ops":[{"op":"insert","at":"after","ref":"b","kind":"diagram","content":"flowchart LR\\n  A[Measure] --> B[Divide]"}]}'
      : 'ASK add a diagram of these steps after it → {"ops":[{"op":"insert","at":"after","ref":"b","kind":"diagram"}]}',
    inline
      ? 'ASK make a table of these results here → {"ops":[{"op":"insert","at":"here","kind":"table","content":"| Day | Rain |\\n| --- | --- |\\n| Mon | 3 |"}]}'
      : 'ASK make a table of these results here → {"ops":[{"op":"insert","at":"here","kind":"table"}]}',
    'ASK ok so → {"ops":[{"op":"none","why":"Unclear: what should change?"}]}',
  ]
}

export interface CallInput {
  doc: Doc
  selection: Selection
  aliases: Aliases
  instruction: string
  /** Recent AI edits as short lines, sent only when the request refers back ("same for this one"). */
  recent?: readonly string[]
  /**
   * The person sent a picture with the request. Only the step that writes the
   * content sees it, so this call is told it exists: without it, "make this
   * graph" points at nothing, and a model declines (found in testing).
   */
  picture?: boolean
}

/** The part for this call. */
export function userPrompt(input: CallInput): string {
  const { doc, selection, aliases } = input
  const lines: string[] = []
  const firstPage = pageOf(doc, aliases.selected[0]?.id ?? hereAnchor(selection))
  if (firstPage !== undefined) lines.push(`PAGE ${doc.pages.indexOf(firstPage) + 1}/${doc.pages.length}`)

  if (aliases.selected.length > 0) {
    lines.push('SELECTED')
    for (const { alias, id, words } of aliases.selected) lines.push(`${alias} ${words ? wordsLine(doc, words) : blockLine(doc.block[id]!, 300)}`)
  }
  if (selection.here) {
    const here = selection.here
    if ('parent' in here) {
      const before = aliases.near.find((n) => n.side === 'before')
      lines.push(`HERE: a place in the text${before ? `, after ${before.alias}` : ', at the start'}`)
    } else {
      // A Select box: new things go only into it (v1.1).
      const place = boxPlace(doc, aliases)
      lines.push(place === 'words' ? 'HERE: after the chosen words' : place === 'blocks' ? 'HERE: after the chosen blocks' : 'HERE: an empty area of the page')
    }
  }
  if (aliases.near.length > 0) {
    lines.push('NEAR')
    for (const near of aliases.near) lines.push(`${near.alias} ${near.side}: ${blockLine(doc.block[near.id]!, 80)}`)
  }
  if (doc.rules.length > 0) lines.push('NOTEBOOK RULES', ...doc.rules.map((rule) => `- ${rule}`))
  if (input.recent && input.recent.length > 0 && refersBack(input.instruction)) lines.push('EARLIER', ...input.recent.slice(-2))
  if (input.picture) lines.push('PICTURE: sent with the request; the step that writes the content sees it')
  lines.push('ASK', input.instruction.trim())
  return lines.join('\n')
}

/** True when a request points back at an earlier edit: "same", "again", "this one too". */
export function refersBack(instruction: string): boolean {
  return /\b(same|again|too|also|as well|likewise|like before|like that)\b/iu.test(instruction)
}

/** One line describing a block: its kind, then its content cut to `max` characters. */
export function blockLine(block: Block, max: number): string {
  const cut = (text: string): string => {
    const one = text.replace(/\s*\n\s*/gu, ' / ').trim()
    return one.length > max ? `${one.slice(0, max)}…` : one
  }
  switch (block.type) {
    case 'text': {
      const role = block.indent > 0 ? `${block.role}+${block.indent}` : block.role
      const tick = block.role === 'todo' ? (block.done ? ' [x]' : ' [ ]') : ''
      return `${role}${tick} ${cut(block.md) || '(empty)'}`
    }
    case 'math':
      return `math ${cut(block.tex) || '(empty)'}${block.value === undefined ? '' : ` = ${block.value}`}`
    case 'image':
      return `image ${cut(block.alt ?? '') || '(no description)'}`
    case 'diagram':
      return `diagram ${cut(block.src) || '(empty)'}`
    case 'ink':
      return block.text === undefined ? `ink (${block.strokes.length} strokes)` : `ink "${cut(block.text)}"`
    case 'table':
      return `table ${cut(pipeTable(block.rows, block.head === true))}`
    case 'frame':
      return 'frame'
  }
}

/**
 * Words chosen inside a block, as the model sees them (protocol v1.1): the
 * words, then the text around them, cut at word ends:
 * words "stays at rest" in: "An object at rest stays at rest unless a force…"
 */
export function wordsLine(doc: Doc, words: WordRange, around = 50): string {
  const text = textOf(doc.block[words.block])
  let from = Math.max(0, words.start - around)
  let to = Math.min(text.length, words.end + around)
  if (from > 0) from = text.lastIndexOf(' ', from) + 1
  if (to < text.length) to = Math.max(words.end, text.indexOf(' ', to) === -1 ? text.length : text.indexOf(' ', to))
  const one = (part: string): string => part.replace(/\s+/gu, ' ').trim()
  const excerpt = `${from > 0 ? '…' : ''}${one(text.slice(from, to))}${to < text.length ? '…' : ''}`
  return `words "${one(text.slice(words.start, words.end))}" in: "${excerpt}"`
}

/** The words of a text block, in the positions a selection range uses. */
export function textOf(block: Block | undefined): string {
  return block?.type === 'text' ? plainText(parseInline(block.md)) : ''
}

function hereAnchor(selection: Selection): string | undefined {
  const here = selection.here
  if (!here) return undefined
  return 'parent' in here ? here.parent : here.page
}

function pageOf(doc: Doc, id: string | undefined): string | undefined {
  if (id === undefined) return undefined
  const block = doc.block[id]
  if (!block) return doc.page[id] ? id : undefined
  if ('page' in block) return block.page
  const frame = doc.block[block.parent]
  return frame && 'page' in frame ? frame.page : undefined
}

/** Prefix options that match a request scope. */
export function prefixFor(scope: Scope, examples = true): PrefixOptions {
  return { set: scope.set, shape: scope.shape, maxOps: scope.maxOps, examples, ...(scope.merged ? { merged: true } : {}), ...(scope.inline ? { inline: true } : {}) }
}
