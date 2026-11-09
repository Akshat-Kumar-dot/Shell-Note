// Tier 0: simple commands handled by code, with no model
// and zero tokens. A fixed vocabulary, with typos forgiven by edit distance.
// Only a request where every word is understood is handled here; anything
// else goes to the model.
import type { Doc } from '../schema/doc.js'
import type { AiOp } from '../schema/protocol.js'
import { isKind } from '../select/kind.js'
import type { Selection } from '../select/selection.js'
import type { Aliases } from './alias.js'
import { colourIn } from './content.js'

/** "the heading", "this formula": words that describe the selection rather than change it. */
export const POINTER = /\b(?:the|this|that|these|those|my)\s+(headings?|headers?|titles?|paragraphs?|bullets?|list items?|items?|to-?dos?|tasks?|quotes?|formulas?|formulae|equations?|maths?|images?|pictures?|photos?|diagrams?|charts?|flowcharts?|drawings?|handwriting|lines?|text)\b/gu

export type Change =
  | { style: Record<string, string | boolean> }
  | { mark: Record<string, string | boolean> }
  | { size: 'up' | 'down' }
  | { action: 'delete' | 'up' | 'down' }

/** Words that carry no instruction of their own. */
export const FILLER: ReadonlySet<string> = new Set(
  'make it this that these those the a an to please pls set turn into change selected selection text word words block blocks them its colour color font size style and be more bit slightly as in on is are of now so all very font-size too also with should give use using apply'.split(' '),
)

const COLORS: Record<string, string> = {
  red: 'red', orange: 'orange', yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple', violet: 'purple',
  gray: 'gray', grey: 'gray', black: 'ink', ink: 'ink', default: 'ink',
}
const SIZES: Record<string, string> = { tiny: 's', small: 's', normal: 'm', medium: 'm', regular: 'm', large: 'l', big: 'l', huge: 'xl', xl: 'xl', largest: 'xl', biggest: 'xl' }
const FONTS: Record<string, string> = { serif: 'serif', sans: 'sans', 'sans-serif': 'sans', mono: 'mono', monospace: 'mono', handwriting: 'hand', handwritten: 'hand', hand: 'hand' }
const ALIGNS: Record<string, string> = { left: 'left', right: 'right', center: 'center', centre: 'center', centered: 'center', centred: 'center', middle: 'center' }
const ROLES: Record<string, string> = {
  title: 'h1', h1: 'h1', heading: 'h2', header: 'h2', h2: 'h2', subheading: 'h3', h3: 'h3',
  paragraph: 'p', plain: 'p', bullet: 'li', bullets: 'li', list: 'li', numbered: 'oli', todo: 'todo', 'to-do': 'todo',
  task: 'todo', checkbox: 'todo', quote: 'quote', quotation: 'quote',
}
const MARKS: Record<string, [string, boolean]> = {
  bold: ['bold', true], unbold: ['bold', false], italic: ['italic', true], italics: ['italic', true], unitalic: ['italic', false],
  strikethrough: ['strike', true], strike: ['strike', true], unstrike: ['strike', false],
  highlight: ['highlight', true], highlighted: ['highlight', true], unhighlight: ['highlight', false], code: ['code', true],
  underline: ['underline', true], underlined: ['underline', true], ununderline: ['underline', false], ununderlined: ['underline', false],
  subscript: ['sub', true], superscript: ['sup', true],
}
const DONE: Record<string, boolean> = { done: true, tick: true, ticked: true, check: true, checked: true, complete: true, completed: true, finished: true, undone: false, untick: false, uncheck: false, unchecked: false }
const INDENT: Record<string, string> = { indent: 'in', subpoint: 'in', 'sub-point': 'in', outdent: 'out', unindent: 'out', dedent: 'out' }
const SIZE_STEP: Record<string, 'up' | 'down'> = { bigger: 'up', larger: 'up', grow: 'up', enlarge: 'up', smaller: 'down', shrink: 'down' }
const ACTIONS: Record<string, 'delete'> = { delete: 'delete', remove: 'delete', erase: 'delete', cut: 'delete' }

/** Several words that mean one thing, joined before the request is split into words. */
export const PHRASES: readonly [RegExp, string][] = [
  [/\bheading\s*1\b/g, 'h1'],
  [/\bheading\s*2\b/g, 'h2'],
  [/\bheading\s*3\b/g, 'h3'],
  [/\bbullet\s+points?\b/g, 'bullet'],
  [/\bnumbered\s+(?:list|items?|points?)\b/g, 'numbered'],
  [/\b(?:cross|strike)\s+(?:it\s+|this\s+|them\s+)?out\b/g, 'strike'],
  [/\bextra\s+large\b/g, 'xl'],
  // A complaint says the opposite of its size word: "this heading is too big" asks for smaller.
  [/\b(?:way\s+)?too\s+(?:big|large|huge)\b/g, 'smaller'],
  [/\b(?:way\s+)?too\s+(?:small|tiny)\b/g, 'bigger'],
  [/\bnormal\s+text\b/g, 'paragraph'],
  [/\bsub\s+point\b/g, 'subpoint'],
  [/\b(?:not|no|remove(?:\s+the)?)\s+(bold|italics?|highlight|strikethrough|underline|underlined)\b/g, 'un$1'],
  [/\bmark(?:\s+\w+)?\s+as\s+done\b/g, 'done'],
  [/\bmark(?:\s+\w+)?\s+as\s+not\s+done\b|\bnot\s+done\b/g, 'undone'],
  [/\bmove\s+(?:it\s+|this\s+)?up\b/g, 'moveup'],
  [/\bmove\s+(?:it\s+|this\s+)?down\b/g, 'movedown'],
]

const VOCABULARY = [
  ...FILLER,
  ...Object.keys(COLORS),
  ...Object.keys(SIZES),
  ...Object.keys(FONTS),
  ...Object.keys(ALIGNS),
  ...Object.keys(ROLES),
  ...Object.keys(MARKS),
  ...Object.keys(DONE),
  ...Object.keys(INDENT),
  ...Object.keys(SIZE_STEP),
  ...Object.keys(ACTIONS),
  'moveup',
  'movedown',
  'colourcode',
]

/**
 * The operations for a request tier 0 understands completely, in alias terms,
 * or undefined to hand the request to the model.
 */
export function tier0(instruction: string, input: { doc: Doc; selection: Selection; aliases: Aliases }): AiOp[] | undefined {
  const { doc, aliases } = input
  if (aliases.selected.length === 0) return undefined
  let text = instruction.toLowerCase()
  // "the heading" points at the selection. If the selection is not that kind of block, the
  // request means something tier 0 cannot see, so the model takes it.
  for (const match of text.matchAll(POINTER)) {
    if (!aliases.selected.every((s) => isKind(match[1]!, doc.block[s.id]!) === true)) return undefined
  }
  text = text.replace(POINTER, ' ')
  // A colour code ("make it #e0563a") is one word of the vocabulary (v1.1).
  const code = colourIn(instruction)
  if (code !== undefined) text = text.replace(/#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/u, ' colourcode ')
  for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement)
  const words = text.split(/[^a-z0-9-]+/u).filter(Boolean)
  const changes: Change[] = []
  for (const raw of words) {
    const word = closest(raw)
    if (word === undefined) return undefined
    if (FILLER.has(word)) continue
    const change = word === 'colourcode' && code !== undefined ? { style: { color: code } } : meaning(word)
    if (!change) return undefined
    changes.push(change)
  }
  if (changes.length === 0) return undefined

  const ids = aliases.selected.map((s) => s.alias)
  const actions = changes.filter((c): c is { action: 'delete' | 'up' | 'down' } => 'action' in c)
  if (actions.length > 0) {
    // An action stands alone: "delete this", "move it up".
    if (actions.length !== changes.length || actions.length > 1) return undefined
    const action = actions[0]!.action
    if (action === 'delete') return [{ op: 'delete', ids }]
    // Only a whole block moves, and only outside a Select box, which keeps new places inside it.
    const side = action === 'up' ? 'before' : 'after'
    const neighbour = aliases.near.find((n) => n.side === side)
    if (ids.length !== 1 || aliases.blocks.length !== 1 || !neighbour || !aliases.refs.includes(neighbour.alias)) return undefined
    return [{ op: 'move', id: ids[0]!, at: side, ref: neighbour.alias }]
  }

  // Formatting words act on the chosen words when there are some (protocol v1.1); colour too.
  const ranged = aliases.pieces.length > 0
  const style: Record<string, string | boolean> = {}
  const mark: Record<string, string | boolean> = {}
  let step: 'up' | 'down' | undefined
  for (const change of changes) {
    if ('mark' in change) Object.assign(mark, change.mark)
    else if ('size' in change) step = change.size
    else if ('style' in change) {
      if (ranged && 'color' in change.style) Object.assign(mark, change.style)
      else Object.assign(style, change.style)
    }
  }

  const blocks = aliases.selected.map((s) => ({ alias: s.alias, block: doc.block[s.id]! }))
  // Tier 0 never guesses: styles and marks apply to text, and colour also to handwriting.
  const textOnly = blocks.every((b) => b.block.type === 'text')
  const colourOnly = Object.keys(style).every((key) => key === 'color') && !step
  const fits = textOnly || (colourOnly && blocks.every((b) => b.block.type === 'text' || b.block.type === 'ink'))
  const ops: AiOp[] = []
  if (Object.keys(style).length > 0 || step) {
    // A size, font, alignment or role belongs to whole blocks; with words chosen, the model decides.
    if (!fits || ranged) return undefined
    if (step) {
      for (const { alias, block } of blocks) {
        const current = block.type === 'text' ? (block.style?.size ?? 'm') : 'm'
        const order = ['s', 'm', 'l', 'xl']
        const next = order[Math.min(3, Math.max(0, order.indexOf(current) + (step === 'up' ? 1 : -1)))]!
        ops.push({ op: 'style', ids: [alias], ...style, size: next } as AiOp)
      }
    } else {
      ops.push({ op: 'style', ids, ...style } as AiOp)
    }
  }
  if (Object.keys(mark).length > 0) {
    if (!textOnly) return undefined
    // Each item of words, and each whole block (all its words).
    for (const id of ids) ops.push({ op: 'mark', id, ...mark } as AiOp)
  }
  return ops.length > 0 ? ops : undefined
}

/** Whether tier 0 reads a word as a change of look or an action: a colour, a size, a font, a kind of line, a mark… */
export function isFormatWord(word: string): boolean {
  return meaning(word) !== undefined
}

export function meaning(word: string): Change | undefined {
  if (word in COLORS) return { style: { color: COLORS[word]! } }
  if (word in SIZES) return { style: { size: SIZES[word]! } }
  if (word in FONTS) return { style: { font: FONTS[word]! } }
  if (word in ALIGNS) return { style: { align: ALIGNS[word]! } }
  if (word in ROLES) return { style: { role: ROLES[word]! } }
  if (word in MARKS) return { mark: { [MARKS[word]![0]]: MARKS[word]![1] } }
  if (word in DONE) return { style: { done: DONE[word]! } }
  if (word in INDENT) return { style: { indent: INDENT[word]! } }
  if (word in SIZE_STEP) return { size: SIZE_STEP[word]! }
  if (word in ACTIONS) return { action: 'delete' }
  if (word === 'moveup') return { action: 'up' }
  if (word === 'movedown') return { action: 'down' }
  return undefined
}

/** The vocabulary word a typed word means: exact, or within a small edit distance for longer words. */
export function closest(word: string): string | undefined {
  if (VOCABULARY.includes(word)) return word
  if (word.length < 4) return undefined
  const limit = word.length >= 8 ? 2 : 1
  let best: string | undefined
  let bestDistance = limit + 1
  for (const candidate of VOCABULARY) {
    // Short words are never typo targets: "read" must not become "red".
    if (candidate.length < 4 || Math.abs(candidate.length - word.length) > limit) continue
    const d = distance(word, candidate)
    if (d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }
  return best
}

/** Edit distance with swaps of neighbouring letters (optimal string alignment). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, d[i - 2]![j - 2]! + 1)
      d[i]![j] = value
    }
  }
  return d[a.length]![b.length]!
}
