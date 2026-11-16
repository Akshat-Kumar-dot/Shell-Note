// A flowchart in Mermaid, read into the nodes and links a board keeps, and a board's nodes written out as Mermaid.
//
// Mermaid is what a model writes for a whole flowchart: it knows the notation, it is the shortest there is, and the
// app's models write it already for diagrams. Code reads it once into real nodes; from then on a change names one
// node by its id. The reader is the app's own, for the flowchart alone (Mermaid's own needs a browser, and core has
// none): the fourteen shapes, links of every kind with their words, chains, several nodes at once. What a board does
// not keep is said, never dropped in silence; a line that does not read is refused with its number, for a model's
// one retry. A `click` line is never kept: nothing on a board opens or runs anything.
import { mendFlowchart } from '../ai/mermaid.js'
import { parseInline, plainText } from '../markdown/inline.js'
import { MAX_LABEL, MAX_LINKS, type NodeBlock, type NodeShape } from '../schema/doc.js'
import { ValidationError } from '../validate/errors.js'
import { BRACKETS, BY_BRACKET, SHAPE_WORDS } from './shape.js'

/** The most nodes one flowchart is read into. */
export const MAX_CHART_NODES = 500

/** Which way a flowchart runs: Mermaid's TD (or TB), LR, BT and RL. */
export type Flow = 'down' | 'right' | 'up' | 'left'

export interface ChartNode {
  /** Its name in the Mermaid source (A, B, start): the note gives it an id of its own. */
  key: string
  shape: NodeShape
  /** Its words, as inline Markdown. */
  md: string
}

export interface ChartLink {
  from: string
  to: string
  label?: string
  line?: 'dotted' | 'thick'
  head?: 'none'
}

export interface Chart {
  flow: Flow
  /** In the order the source first names them. */
  nodes: ChartNode[]
  links: ChartLink[]
  /** What the source held that a board does not keep, each said once, for the reply. */
  left: string[]
}

const FLOWS: Readonly<Record<string, Flow>> = { TB: 'down', TD: 'down', LR: 'right', BT: 'up', RL: 'left' }
const FLOW_CODE: Readonly<Record<Flow, string>> = { down: 'TD', right: 'LR', up: 'BT', left: 'RL' }
/** Mermaid's other kinds of diagram: a board reads none of them. */
const OTHER_KINDS = /^(?:sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|zenuml|sankey|xychart|block|packet|kanban|architecture|radar|treemap|C4\w+)\b/u
/** A node's name: letters, digits and _, in any script, and a hyphen between them (step-1), never two (A-->B). */
const NAME = /^[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/u
/** Lines that style or group: read past, and said. */
const STYLING = /^(?:classDef|class|style|linkStyle)\b/u
const HOW = 'Write a step as A[words] and a link as A --> B, or A -->|yes| B with words on it.'

const refuse = (line: number, why: string): never => {
  throw new ValidationError('content', `Line ${line} of the flowchart does not read: ${why}. ${HOW}`, { line })
}

/** Words as Mermaid holds them, made the words a board keeps: its entities and line breaks plain, no HTML, one line. */
function wordsOf(raw: string): string {
  let text = raw.trim()
  // A Markdown string, "`**bold** words`": its words are Markdown already.
  if (text.startsWith('`') && text.endsWith('`') && text.length > 1) text = text.slice(1, -1)
  return text
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<\/?[A-Za-z][^>]*>/gu, '')
    // An icon named before the words, fa:fa-car Car: a board draws no icon font.
    .replace(/\bfa[a-z]?:fa-[\w-]+\s*/gu, '')
    .replace(/#(\d{1,7});/gu, (whole, code: string) => {
      const point = Number(code)
      return point > 31 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : whole
    })
    .replace(/(?:#|&)(quot|amp|lt|gt|apos|nbsp);/gu, (_, name: string) => ({ quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' })[name]!)
    .replace(/\s+/gu, ' ')
    .trim()
}

/** A statement's parts, split at `;` outside quotes and outside a node's brackets. */
function statements(line: string): string[] {
  const out: string[] = []
  let quoted = false
  let depth = 0
  let from = 0
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (char === '"') quoted = !quoted
    else if (quoted) continue
    else if ('[({'.includes(char)) depth++
    else if ('])}'.includes(char)) depth = Math.max(0, depth - 1)
    else if (char === ';' && depth === 0) {
      out.push(line.slice(from, i))
      from = i + 1
    }
  }
  out.push(line.slice(from))
  return out.map((part) => part.trim()).filter((part) => part !== '')
}

/** The source without what wraps it: a code fence a model put round it, front matter, comments. */
function bodyOf(src: string): { lines: { text: string; n: number }[]; flow: Flow } {
  const all = src.replace(/\r\n?/gu, '\n').split('\n')
  let lines = all.map((text, i) => ({ text: text.trim(), n: i + 1 })).filter(({ text }) => !/^```/u.test(text))
  // Front matter: --- … ---
  if (lines[0]?.text === '---') {
    const end = lines.findIndex(({ text }, i) => i > 0 && text === '---')
    lines = end < 0 ? [] : lines.slice(end + 1)
  }
  lines = lines.filter(({ text }) => text !== '' && !text.startsWith('%%'))
  const first = lines[0]
  if (!first) throw new ValidationError('content', `The flowchart is empty. Start with flowchart TD, then a line a link: A[Start] --> B[End].`)
  if (OTHER_KINDS.test(first.text)) throw new ValidationError('content', `A board draws a flowchart, not a ${/^\w+/u.exec(first.text)![0]}. Start with flowchart TD, then a line a link: A[Start] --> B[End].`)
  const head = /^(?:flowchart|graph)(?:-elk)?\b[ \t]*(TB|TD|BT|RL|LR)?\b[ \t]*;?[ \t]*(.*)$/iu.exec(first.text)
  // No first line saying what it is: read as a flowchart from the top down, as models write one when they forget it.
  if (!head) return { lines, flow: 'down' }
  const rest = head[2]!.trim()
  return { lines: [...(rest === '' ? [] : [{ text: rest, n: first.n }]), ...lines.slice(1)], flow: FLOWS[(head[1] ?? 'TD').toUpperCase()] ?? 'down' }
}

/**
 * Read a Mermaid flowchart. Throws a ValidationError (`content`) that says which line does not read and how one is
 * written; never keeps a click, a style or a group, and says so in `left`.
 */
export function readFlowchart(src: string): Chart {
  const { lines, flow } = bodyOf(src)
  // The slips small models make, mended as they are for a diagram (ai/mermaid.ts): each line keeps its number.
  const mended = lines.length === 0 ? [] : mendFlowchart(`flowchart TD\n${lines.map(({ text }) => text).join('\n')}`).split('\n').slice(1)
  const nodes = new Map<string, ChartNode>()
  const links: ChartLink[] = []
  const seen = { groups: 0, styles: false, clicks: false, ends: false, twice: false, self: false, hidden: false }

  const node = (key: string, shape: NodeShape | undefined, words: string | undefined, line: number): void => {
    const have = nodes.get(key)
    if (have) {
      // Named again with brackets: its shape and words are the later ones.
      if (shape !== undefined) Object.assign(have, { shape, md: words === undefined || words === '' ? have.md : words })
      return
    }
    if (nodes.size >= MAX_CHART_NODES) throw new ValidationError('content', `A flowchart is read into at most ${MAX_CHART_NODES} steps, and line ${line} names one more. Draw it as several flowcharts.`, { line })
    nodes.set(key, { key, shape: shape ?? 'box', md: words === undefined || words === '' ? key : words })
  }

  mended.forEach((text, index) => {
    const n = lines[index]!.n
    for (const part of statements(text)) {
      if (/^subgraph\b/u.test(part)) seen.groups++
      else if (/^end$/u.test(part) || /^direction\b/u.test(part) || /^acc(?:Title|Descr)\b/u.test(part)) continue
      else if (STYLING.test(part)) seen.styles = true
      else if (/^click\b/u.test(part)) seen.clicks = true
      else chain(part, n)
    }
  })

  /** A link as it is read: both ways for A <--> B, backwards for A <-- B. */
  type Joined = Omit<ChartLink, 'from' | 'to'> & { both: boolean; back: boolean }

  /** One statement: nodes joined by links, A --> B & C -->|yes| D. */
  function chain(text: string, line: number): void {
    let at = 0
    const space = (): void => {
      while (at < text.length && /\s/u.test(text[at]!)) at++
    }
    const ref = (): string => {
      space()
      const name = NAME.exec(text.slice(at))
      if (!name) return refuse(line, at >= text.length ? 'a link leads nowhere' : `a step's name was expected at "${text.slice(at, at + 12)}"`)
      const key = name[0]
      at += key.length
      let shape: NodeShape | undefined
      let words: string | undefined
      if (text.startsWith('@{', at)) {
        // Mermaid's longer form: A@{ shape: diamond, label: "Passed?" }
        const end = text.indexOf('}', at)
        if (end < 0) return refuse(line, `the { after ${key} is not closed`)
        const inside = text.slice(at + 2, end)
        const named = /\bshape\s*:\s*"?([\w-]+)"?/u.exec(inside)?.[1]?.toLowerCase()
        shape = (named !== undefined ? SHAPE_WORDS[named] : undefined) ?? 'box'
        const label = /\blabel\s*:\s*(?:"([^"]*)"|([^,]+))/u.exec(inside)
        words = label ? wordsOf(label[1] ?? label[2] ?? '') : undefined
        at = end + 1
      } else {
        const open = BY_BRACKET.map((each) => BRACKETS[each][0]).find((bracket) => text.startsWith(bracket, at))
        if (open !== undefined) {
          // The shapes that open so, told apart by how they close: [/words/] and [/words\].
          const closers = BY_BRACKET.filter((each) => BRACKETS[each][0] === open).map((each) => ({ shape: each, close: BRACKETS[each][1] }))
          let from = at + open.length
          while (from < text.length && /\s/u.test(text[from]!)) from++
          if (text[from] === '"') {
            const quote = text.indexOf('"', from + 1)
            if (quote < 0) return refuse(line, `the quote in ${key}'s words is not closed`)
            let after = quote + 1
            while (after < text.length && /\s/u.test(text[after]!)) after++
            const closed = closers.find((each) => text.startsWith(each.close, after))
            if (!closed) return refuse(line, `${key}${open}"…" is not closed with ${closers.map((each) => each.close).join(' or ')}`)
            shape = closed.shape
            words = wordsOf(text.slice(from + 1, quote))
            at = after + closed.close.length
          } else {
            const found = closers.map((each) => ({ ...each, end: text.indexOf(each.close, from) })).filter((each) => each.end >= 0).sort((a, b) => a.end - b.end || b.close.length - a.close.length)[0]
            if (!found) return refuse(line, `${key}${open}… is not closed with ${closers.map((each) => each.close).join(' or ')}`)
            shape = found.shape
            words = wordsOf(text.slice(from, found.end))
            at = found.end + found.close.length
          }
        }
      }
      // A class named after it, A:::warm, is a style: read past.
      const styled = /^:::[\w-]+/u.exec(text.slice(at))
      if (styled) {
        at += styled[0].length
        seen.styles = true
      }
      node(key, shape, words, line)
      return key
    }
    const group = (): string[] => {
      const keys = [ref()]
      for (space(); text[at] === '&'; space()) {
        at++
        keys.push(ref())
      }
      return keys
    }
    /** A link, or null for one that is drawn hidden (~~~), which joins nothing on a board. */
    const link = (): Joined | null => {
      space()
      const rest = text.slice(at)
      const label = (raw: string | undefined): { label?: string } => {
        const words = wordsOf((raw ?? '').replace(/^"(.*)"$/u, '$1')).slice(0, MAX_LABEL).trim()
        return words === '' ? {} : { label: words }
      }
      const made = (taken: number, kind: string, back: string | undefined, tip: string | undefined, raw: string | undefined): Joined => {
        at += taken
        if (tip === 'o' || tip === 'x' || back === 'o' || back === 'x') seen.ends = true
        return { ...label(raw), ...(kind.startsWith('=') ? { line: 'thick' as const } : kind.startsWith('-.') ? { line: 'dotted' as const } : {}), ...(tip === undefined && back !== '<' ? { head: 'none' as const } : {}), both: back !== undefined && tip !== undefined, back: back === '<' && tip === undefined }
      }
      if (/^~{3,}/u.test(rest)) {
        at += /^~+/u.exec(rest)![0].length
        seen.hidden = true
        return null
      }
      // Words in the middle: A -- yes --> B, A -. maybe .-> B, A == surely ==> B
      const middle = /^(<)?(--|-\.|==)[ \t]+(?![-=.>|])(.+?)[ \t]*(?:-{2,}|\.-+|={2,})(>|[ox](?=\s|$))?/u.exec(rest)
      if (middle) return made(middle[0].length, middle[2]!, middle[1], middle[4], middle[3])
      const plain = /^(<|[ox](?=[-=]))?(-{2,}|={2,}|-\.+-|-(?=>))(>|[ox](?=\s|\||$))?/u.exec(rest)
      if (!plain) return refuse(line, `a link was expected at "${rest.slice(0, 12)}"`)
      const piped = /^[ \t]*\|([^|]*)\|/u.exec(rest.slice(plain[0].length))
      return made(plain[0].length + (piped ? piped[0].length : 0), plain[2]!, plain[1], plain[3], piped?.[1])
    }

    let from = group()
    for (space(); at < text.length; space()) {
      const how = link()
      const to = group()
      if (how === null) {
        from = to
        continue
      }
      const { both, back, ...kind } = how
      for (const a of from) {
        for (const b of to) {
          for (const [x, y] of both ? [[a, b], [b, a]] : back ? [[b, a]] : [[a, b]]) {
            if (x === y) seen.self = true
            else if (links.some((have) => have.from === x && have.to === y)) seen.twice = true
            else links.push({ from: x!, to: y!, ...kind })
          }
        }
      }
      from = to
    }
  }

  if (nodes.size === 0) throw new ValidationError('content', `The flowchart has no steps. ${HOW}`)
  const out = new Map<string, number>()
  for (const each of links) {
    const count = (out.get(each.from) ?? 0) + 1
    out.set(each.from, count)
    if (count > MAX_LINKS) throw new ValidationError('content', `The step ${each.from} points to more than ${MAX_LINKS} others. Give it fewer ways out.`)
  }
  const left = [
    ...(seen.groups > 0 ? [`the grouping of ${seen.groups === 1 ? 'a subgraph' : `${seen.groups} subgraphs`} (the steps in ${seen.groups === 1 ? 'it' : 'them'} are kept)`] : []),
    ...(seen.styles ? ['colours and styles (classDef, class, style)'] : []),
    ...(seen.clicks ? ['click lines (a step never opens or runs anything)'] : []),
    ...(seen.ends ? ['round and crossed ends of links (they are arrows)'] : []),
    ...(seen.twice ? ['a second link between the same two steps'] : []),
    ...(seen.self ? ['a link from a step to itself'] : []),
    ...(seen.hidden ? ['hidden links (~~~)'] : []),
  ]
  return { flow, nodes: [...nodes.values()], links, left }
}

/** A link's arrow in Mermaid, by its line and its head. */
function arrowOf(link: { line?: 'dotted' | 'thick' | undefined; head?: 'none' | undefined }): string {
  const headless = link.head === 'none'
  return link.line === 'dotted' ? (headless ? '-.-' : '-.->') : link.line === 'thick' ? (headless ? '===' : '==>') : headless ? '---' : '-->'
}

/**
 * A board's nodes as a Mermaid flowchart: each node a line with its shape's brackets and its words (plain, in
 * quotes), then each link. The nodes are named s1, s2… in the order given, since a note's ids are not all names
 * Mermaid takes. Links to nodes outside the list are left out.
 */
export function writeFlowchart(nodes: readonly Pick<NodeBlock, 'id' | 'shape' | 'md' | 'to'>[], flow: Flow = 'down'): string {
  const names = new Map(nodes.map((node, i) => [node.id, `s${i + 1}`]))
  const quoted = (words: string): string => `"${words.replace(/\s+/gu, ' ').trim().replace(/"/gu, '#quot;') || ' '}"`
  const lines = [`flowchart ${FLOW_CODE[flow]}`]
  for (const node of nodes) {
    const [open, close] = BRACKETS[node.shape]
    lines.push(`  ${names.get(node.id)!}${open}${quoted(plainText(parseInline(node.md)))}${close}`)
  }
  for (const node of nodes) {
    for (const link of node.to ?? []) {
      const to = names.get(link.node)
      if (to === undefined) continue
      const label = link.label === undefined ? '' : `|${quoted(link.label.replace(/\|/gu, '/'))}|`
      lines.push(`  ${names.get(node.id)!} ${arrowOf(link)}${label} ${to}`)
    }
  }
  return lines.join('\n')
}
