// A board's commands (the Board, step 2) made into the note's own operations, as the rest of the note's commands are
// (compile.ts). Steps are named by their ids or in words, never by a place: code puts a new step beside the one it
// follows (step 1's layout.ts), lays a whole flowchart out where the board has room, and runs every link (route.ts).
// Also here: a step named in words ("the step Review", "the diamond", "the first step"), and what the note's other
// commands do on a board that they do not do elsewhere.
import { diagramHint, diagramKind, mendFlowchart } from '../ai/mermaid.js'
import { chartOps, emptySpot, fitOps, stepOps, tidyChartOps } from '../board/layout.js'
import { readFlowchart } from '../board/mermaid.js'
import { chartsIn } from '../board/order.js'
import { SHAPE_WORDS } from '../board/shape.js'
import { blockOf } from '../command/page.js'
import { parseInline, plainText } from '../markdown/inline.js'
import { isEndless, MAX_LABEL, MAX_LINKS, type Block, type Doc, type Id, type Link, type NodeBlock } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { spliceFor } from '../splice.js'
import type { Compiled, NoteContext, NoteInput } from './compile.js'
import { quoted } from './picture.js'
import type { Referred } from './refer.js'

/** A board's one page; or, on a note of pages, why steps and links have no place there. */
export function boardPage(doc: Doc): Id {
  const id = doc.pages[0]
  const page = id === undefined ? undefined : doc.page[id]
  if (doc.kind !== 'board' || !page || !isEndless(page)) throw new Error('This note is not a board: steps and links go on a board (note.new type=board). In a note of pages, a flowchart is a diagram (diagram: add).')
  return id!
}

// ----- a step named in words ---------------------------------------------------------

/** Words that mean any step. */
const STEP_WORDS: ReadonlySet<string> = new Set(['step', 'box', 'node', 'card', 'shape'])
/** Words that mean a step of one shape: "the diamond", "the decision". */
const SHAPE_NAMES = Object.keys(SHAPE_WORDS).filter((word) => !STEP_WORDS.has(word))
const KIND = `(${[...STEP_WORDS, ...SHAPE_NAMES].sort((a, b) => b.length - a.length).join('|')})`
const ORDINALS: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
const BY_ORDER = /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th))\s+(?:step|box|node|card)$/u
const BY_NUMBER = /^(?:step|box|node|card)\s+(\d+)$/u
const KIND_THEN_WORDS = new RegExp(`^${KIND}\\s+(?:(called|named|that says|saying|about|with)\\s+)?(.+)$`, 'u')
const WORDS_THEN_KIND = new RegExp(`^(.+?)\\s+${KIND}$`, 'u')
const KIND_ALONE = new RegExp(`^${KIND}$`, 'u')

const plain = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[“”"'‘’]/gu, '').replace(/\s+/gu, ' ').trim()
const stepWords = (node: NodeBlock): string => plainText(parseInline(node.md))
/** A step as an offer: its id, shape and first words. */
const offer = (node: NodeBlock): string => `${node.id} (${node.shape}${node.md === '' ? '' : ` ${quoted(stepWords(node))}`})`

/** The steps of a board, in the order its flowcharts read. */
const stepsOf = (doc: Doc): NodeBlock[] => chartsIn(doc).flat()

/** The steps a reference's words name: all its words, or how they start (three letters or more), or within them (about). */
function byWords(steps: readonly NodeBlock[], wanted: string, about = false): NodeBlock[] {
  const words = (node: NodeBlock): string => plain(stepWords(node))
  const exact = steps.filter((node) => words(node) === wanted)
  if (exact.length > 0 && !about) return exact
  return steps.filter((node) => (about ? words(node).includes(wanted) : wanted.length >= 3 && words(node).startsWith(wanted)))
}

/** The steps of a shape a word names, or every step for a word that means any step. */
const ofKind = (steps: readonly NodeBlock[], kind: string): NodeBlock[] => (STEP_WORDS.has(kind) ? [...steps] : steps.filter((node) => node.shape === SHAPE_WORDS[kind]))

/** One step, or why the words name none or several. */
function one(found: readonly NodeBlock[], said: string): Referred | undefined {
  if (found.length === 1) return { ok: true, id: found[0]!.id }
  if (found.length > 1) return { ok: false, why: `${found.length} steps fit "${said}": ${found.slice(0, 6).map(offer).join(', ')}. Name one by its id.` }
  return undefined
}

/**
 * A block of a board named in words: a step by its place in the order the chart reads ("the first step", "step 2"),
 * by its shape ("the diamond", "the decision"), by its words with or without a kind ("the step Review", "the Review
 * step", "Review"); anything else by its words. Never a guess: two that fit are offered, and none says what the board has.
 */
export function referOnBoard(doc: Doc, written: string): Referred {
  const said = written.trim().replace(/[.,;:!?]+$/u, '')
  const text = plain(said).replace(/^(?:the|this|that|my)\s+/u, '')
  const steps = stepsOf(doc)

  const order = BY_ORDER.exec(text) ?? BY_NUMBER.exec(text)
  if (order) {
    const word = order[1]!
    const nth = word === 'last' ? steps.length : (ORDINALS[word] ?? Number.parseInt(word, 10))
    const step = steps[nth - 1]
    return step ? { ok: true, id: step.id } : { ok: false, why: `The board has ${steps.length === 0 ? 'no' : steps.length} ${steps.length === 1 ? 'step' : 'steps'}${steps.length > 0 ? `: ${steps.slice(0, 10).map(offer).join(', ')}` : ''}.` }
  }

  // Its kind alone: the diamond, the decision. Words of its own come first: "the end" is the step that says End.
  const alone = KIND_ALONE.exec(text)
  if (alone) {
    const found = one(byWords(steps, text), said) ?? one(ofKind(steps, alone[1]!), said)
    if (found) return found
  }

  const kindFirst = KIND_THEN_WORDS.exec(text)
  if (kindFirst) {
    const found = one(byWords(ofKind(steps, kindFirst[1]!), kindFirst[3]!, kindFirst[2] === 'about' || kindFirst[2] === 'with'), said)
    if (found) return found
  }
  const kindLast = WORDS_THEN_KIND.exec(text)
  if (kindLast) {
    const found = one(byWords(ofKind(steps, kindLast[2]!), kindLast[1]!), said)
    if (found) return found
  }
  const found = one(byWords(steps, text), said)
  if (found) return found

  // Not a step: a text box's words, a picture's description.
  try {
    return { ok: true, id: blockOf(doc, said) }
  } catch {
    return { ok: false, why: `No step of the board is "${said}". ${steps.length === 0 ? 'The board has no steps yet: board: add makes one.' : `Its steps: ${steps.slice(0, 10).map(offer).join(', ')}${steps.length > 10 ? `, and ${steps.length - 10} more` : ''}.`}` }
  }
}

/** A step of a board named in words, or why not. */
function stepOf(doc: Doc, written: string | number | undefined, what: string): NodeBlock {
  if (written === undefined || String(written).trim() === '') throw new Error(`Name the ${what}: its id, or words such as "the step Review".`)
  const found = referOnBoard(doc, String(written))
  if (!found.ok) throw new Error(found.why)
  const block = doc.block[found.id]!
  if (block.type !== 'node') throw new Error(`${found.id} is not a step of the flowchart: ${what === 'step' ? 'name a step' : 'a link joins two steps'}.`)
  return block
}

// ----- the commands ---------------------------------------------------------------------

/** Words written under a line, as a step's or a link's: one line. */
const oneLine = (words: string): string => words.replace(/\s*\n\s*/gu, ' ').trim()

/** Text at most `most` long, never cutting a character in two. */
function cut(text: string, most: number): string {
  let out = ''
  for (const char of text) {
    if (out.length + char.length > most) break
    out += char
  }
  return out
}

/** A step's words, as the terminal says them. */
const shownStep = (md: string): string => (md === '' ? 'with no words yet' : quoted(plainText(parseInline(md))))

/** A link with what a command gives changed, the rest kept. */
function changedLink(had: Link | undefined, to: Id, input: NoteInput): Link {
  const link: Record<string, unknown> = { ...(had ?? {}), node: to }
  if (input.label !== undefined) {
    const label = cut(oneLine(input.label), MAX_LABEL).trim()
    if (label === '') delete link.label
    else link.label = label
  }
  if (input.route !== undefined) {
    if (input.route === 'angled') delete link.path
    else link.path = input.route
  }
  if (input.line !== undefined) {
    if (input.line === 'plain') delete link.line
    else link.line = input.line
  }
  if (input.arrow !== undefined) {
    if (input.arrow) delete link.head
    else link.head = 'none'
  }
  return link as Link
}

/** What a link is like, as the terminal says it: its words and its look. */
function linkWords(link: Link): string {
  const parts = [link.label !== undefined ? quoted(link.label) : undefined, link.path, link.line, link.head === 'none' ? 'no arrow' : undefined].filter(Boolean)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

/**
 * A board's command, or another note command as it works on a board; undefined for one that works on a board as it
 * works anywhere (block.remove, text.rewrite of a text box's words).
 */
export function compileOnBoard(doc: Doc, command: string, input: NoteInput, context: NoteContext, fresh: () => Id): Compiled | undefined {
  if (!command.startsWith('board.')) {
    if (doc.kind !== 'board') return undefined
    return otherOnBoard(doc, command, input, context, fresh)
  }
  const page = boardPage(doc)
  switch (command) {
    case 'board.add': {
      if (input.after !== undefined && input.before !== undefined) throw new Error('Give after=… or before=…, not both.')
      const md = oneLine(input.words ?? '')
      const shape = input.shape ?? 'box'
      const color = input.colour !== undefined && input.colour !== 'ink' ? input.colour : undefined
      const near = input.after ?? input.before
      if (near !== undefined) {
        const side = input.after !== undefined ? 'after' : 'before'
        const ref = stepOf(doc, near, 'step')
        const done = stepOps(doc, ref.id, side, { md, shape, ...(color === undefined ? {} : { color }) }, fresh)
        return { ops: done.ops, made: [done.id], said: `added the step ${shownStep(md)} (${done.id}) ${side} ${ref.id}` }
      }
      const done = chartOps(doc, page, { flow: 'down', nodes: [{ key: 'step', shape, md }], links: [] }, fresh, context.near)
      const id = done.made.get('step')!
      const ops = color === undefined ? done.ops : done.ops.map((op): Op => (op.op === 'add' && op.block.id === id ? { ...op, block: { ...op.block, color } as Block } : op))
      return { ops, made: [id], said: `added the step ${shownStep(md)} (${id}) on its own, where the board has room` }
    }
    case 'board.link': {
      const from = stepOf(doc, input.from, 'step a link leaves')
      const to = stepOf(doc, input.to, 'step a link leads to')
      if (from.id === to.id) throw new Error('A step does not lead to itself: name another step as to=.')
      const list = from.to ?? []
      const at = list.findIndex((link) => link.node === to.id)
      if (at < 0 && list.length >= MAX_LINKS) throw new Error(`${from.id} leads to ${MAX_LINKS} steps already, the most a step has.`)
      const link = changedLink(at < 0 ? undefined : list[at], to.id, input)
      const next = at < 0 ? [...list, link] : list.map((each, i) => (i === at ? link : each))
      if (JSON.stringify(next) === JSON.stringify(list)) return { ops: [], made: [], said: `${from.id} → ${to.id} is so already: nothing changed` }
      return { ops: [{ op: 'update', id: from.id, set: { to: next } }], made: [], said: `${at < 0 ? 'linked' : 'changed the link'} ${from.id} → ${to.id}${linkWords(link)}` }
    }
    case 'board.unlink': {
      const from = stepOf(doc, input.from, 'step a link leaves')
      const to = stepOf(doc, input.to, 'step a link leads to')
      const list = from.to ?? []
      if (!list.some((link) => link.node === to.id)) {
        const back = to.to?.some((link) => link.node === from.id)
        return { ops: [], made: [], said: `${from.id} does not lead to ${to.id}${back ? `; ${to.id} leads to ${from.id}: board: unlink from=${to.id} to=${from.id}` : ''}: nothing changed` }
      }
      const kept = list.filter((link) => link.node !== to.id)
      return { ops: [{ op: 'update', id: from.id, set: { to: kept.length > 0 ? kept : null } }], made: [], said: `unlinked ${from.id} → ${to.id}` }
    }
    case 'board.look': {
      const step = stepOf(doc, input.block, 'step')
      if (input.shape === undefined && input.colour === undefined) throw new Error('Say the look: shape=… (box, round, pill, diamond…) or colour=….')
      const set: Record<string, unknown> = {}
      if (input.colour !== undefined && input.colour !== (step.color ?? 'ink')) set.color = input.colour === 'ink' ? null : input.colour
      const shape = input.shape ?? step.shape
      if (shape !== step.shape) set.shape = shape
      const ops: Op[] = [...(Object.keys(set).length > 0 ? [{ op: 'update', id: step.id, set } as Op] : []), ...(shape === step.shape ? [] : fitOps(step, shape, step.md))]
      const changes = [input.shape && `shape ${input.shape}`, input.colour && `colour ${input.colour}`].filter(Boolean).join(', ')
      return { ops, made: [], said: ops.length === 0 ? `${step.id} looks so already: nothing changed` : `${step.id}: ${changes}` }
    }
    case 'board.draw':
      return drawn(doc, page, input, context, fresh)
    case 'board.tidy': {
      const ops = tidyChartOps(doc, page, input.flow)
      return { ops, made: [], said: ops.length === 0 ? 'the flowchart is laid out so already: nothing changed' : `laid the flowchart out again${input.flow === undefined ? '' : `, running ${input.flow}`}` }
    }
    default:
      throw new Error(`${command} is not a command of a board.`)
  }
}

/** A whole flowchart, read from its Mermaid and laid out where the board has room. */
function drawn(doc: Doc, page: Id, input: NoteInput, context: NoteContext, fresh: () => Id): Compiled {
  if (input.words === undefined || input.words.trim() === '') throw new Error('No flowchart: write its Mermaid on the lines under the command (flowchart TD, then A[words] --> B[words]), then a line end.')
  const chart = readFlowchart(mendFlowchart(input.words.trim()))
  if (chart.nodes.length === 0) throw new Error('The flowchart has no steps: write each as A[words], and a link as A --> B.')
  const done = chartOps(doc, page, chart, fresh, context.near)
  const made = chart.nodes.map((node) => done.made.get(node.key)!)
  const left = chart.left.length > 0 ? `; not kept: ${chart.left.join('; ')}` : ''
  return { ops: done.ops, made, said: `drew a flowchart of ${made.length} ${made.length === 1 ? 'step' : 'steps'} (${made.join(', ')})${left}` }
}

/** The note's other commands that work otherwise on a board: undefined for those that work as anywhere. */
function otherOnBoard(doc: Doc, command: string, input: NoteInput, context: NoteContext, fresh: () => Id): Compiled | undefined {
  const page = boardPage(doc)
  switch (command) {
    case 'text.rewrite': {
      if (input.block === undefined) return undefined
      const found = referOnBoard(doc, input.block)
      const step = found.ok ? doc.block[found.id] : undefined
      if (step?.type !== 'node') return undefined
      if (input.words === undefined || input.words.trim() === '') throw new Error('No words: write the step\'s words on the line under the command, then a line end (block.remove takes the step away).')
      const md = oneLine(input.words)
      if (md === step.md) return { ops: [], made: [], said: `${step.id} says that already: nothing changed` }
      return { ops: [spliceFor(step.id, 'md', step.md, md), ...fitOps(step, step.shape, md)], made: [], said: `rewrote the step ${step.id}: ${shownStep(md)}` }
    }
    case 'block.move': {
      if (input.block === undefined) return undefined
      const found = referOnBoard(doc, input.block)
      if (found.ok && doc.block[found.id]?.type === 'node') throw new Error(`${found.id} is a step: its place follows its links. board: link changes where a step leads, board: tidy lays the flowchart out again; on the screen a person drags it anywhere.`)
      return undefined
    }
    case 'diagram.add': {
      if (input.words === undefined || input.words.trim() === '') return undefined
      // A flowchart on a board is made of steps; a pie or a chart is a diagram where the board has room.
      if (diagramKind(input.words.trim()) === 'flowchart') return drawn(doc, page, input, context, fresh)
      const src = input.words.trim()
      const hint = diagramHint(src)
      if (hint !== null) throw new Error(`The diagram cannot go in: ${hint}`)
      const size = { w: 12000, h: 6000 }
      const at = emptySpot(doc, page, size, context.near)
      const id = fresh()
      return { ops: [{ op: 'add', block: { id, r: 0, type: 'diagram', page, ...at, ...size, lang: 'mermaid', src } as Block }], made: [id], said: `added a diagram (${id}) where the board has room`, diagrams: [src] }
    }
    default:
      return undefined
  }
}
