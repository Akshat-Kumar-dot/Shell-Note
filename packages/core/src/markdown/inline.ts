// The inline Markdown subset held in a text block's `md`:
//
//   **bold**  *italic*  `code`  ~~strike~~  ==highlight==  [link](https://…)
//   $inline math$  [coloured words]{color=red}  [own colour]{color=#e0563a}
//
// From the file format's version 2 (10 October 2026), in Pandoc's span form:
//   [words]{.underline}  [H]{.sub}  [2]{.sup}  [words]{size=l}  [words]{font=lora}
//
// Nothing else, and no HTML. Inline math follows Pandoc's rule, so prices such
// as "$5 or $10" stay text: the opening $ needs a non-space after it, and the
// closing $ needs a non-space before it and no digit after it.
//
// Two extra forms exist so that any content can be written down exactly. The
// writer uses them only when the usual form would be read back differently:
//   \(math\)        inline math that the $ rule cannot express (say, before a digit)
//   [words]{.b}     a span carrying a mark (.b .i .s .hl), for awkward nesting
import { Color, type AnyColor } from '../schema/doc.js'

/** Marks: bold, italic, strike, highlight, and from version 2 underline, subscript and superscript. */
export type Mark = 'b' | 'i' | 's' | 'hl' | 'u' | 'sub' | 'sup'

/** A size token, as a block's style holds it; on words, from version 2. */
export type Size = 's' | 'm' | 'l' | 'xl'

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'math'; v: string }
  | { t: Mark; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'color'; color: AnyColor; c: Inline[] }
  | { t: 'size'; size: Size; c: Inline[] }
  | { t: 'font'; font: string; c: Inline[] }

/** Which version of the grammar to read: 1 reads the version 2 spans as plain text, as an app of version 1 did. */
export interface ReadOptions {
  version?: 1 | 2
}

type Parent = Extract<Inline, { c: Inline[] }>
type Found = { node: Inline; pos: number }

const MARKS: readonly Mark[] = ['b', 'i', 's', 'hl', 'u', 'sub', 'sup']
const COLORS: readonly string[] = Color.options
const PUNCT = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')
const DELIMS = ['**', '~~', '==', '*', '_'] as const
const MARK_OF: Record<(typeof DELIMS)[number], Mark> = { '**': 'b', '~~': 's', '==': 'hl', '*': 'i', _: 'i' }
const SPAN_MARK_V1: Record<string, Mark> = { '.b': 'b', '.i': 'i', '.s': 's', '.hl': 'hl' }
const SPAN_MARK: Record<string, Mark> = { ...SPAN_MARK_V1, '.underline': 'u', '.sub': 'sub', '.sup': 'sup' }
/** How each mark is written as a span; underline, subscript and superscript have no other form. */
const SPAN_CLASS: Record<Mark, string> = { b: '.b', i: '.i', s: '.s', hl: '.hl', u: '.underline', sub: '.sub', sup: '.sup' }
const SIZES: readonly string[] = ['s', 'm', 'l', 'xl']
/** A font on words: a font style or a library font's id, as a block's style takes it. */
const FONT_ID = /^[a-z][a-z0-9-]{1,39}$/
/** Deeper nesting than this is read as plain text, so hostile input cannot exhaust the stack. */
const MAX_DEPTH = 24

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/u.test(ch)
const isWord = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9'
const isMark = (node: Inline): node is Extract<Inline, { t: Mark }> => (MARKS as readonly string[]).includes(node.t)

// ----- reading ---------------------------------------------------------------

/** Read `md` into a tree of inline nodes. Never throws: anything unmatched is text. */
export function parseInline(md: string, options: ReadOptions = {}): Inline[] {
  return normalize(new Reader(md, options.version ?? 2).read())
}

/**
 * A recursive reader over one string. `run` reads a stretch, and at each character tries the one form that can start
 * with it (`escape`, `code`, `dollarMath`, `bracket`, `emphasis`). Each returns its node and where it ended, or null
 * when it never closes, and then that character is plain text: so no input can fail, it only reads as more text.
 */
class Reader {
  /** Ranges already known to have no closing delimiter, to keep parsing fast on bad input. */
  private readonly failed = new Set<string>()
  private readonly spans: Record<string, Mark>

  constructor(
    private readonly s: string,
    private readonly version: 1 | 2,
  ) {
    this.spans = version === 1 ? SPAN_MARK_V1 : SPAN_MARK
  }

  read(): Inline[] {
    return this.run(0, this.s.length, null, 0)!.nodes
  }

  /**
   * Read s[start, end). With a closer, stop where it can close and return the
   * position after it, or null if it never does. Without one, read to `end`.
   */
  private run(start: number, end: number, closer: string | null, depth: number): { nodes: Inline[]; pos: number } | null {
    const key = `${start}:${end}:${closer}`
    if (closer !== null && this.failed.has(key)) return null
    const out = new Nodes()
    let pos = start
    while (pos < end) {
      if (closer !== null && pos > start && this.closes(pos, end, closer)) return { nodes: out.list, pos: pos + closer.length }
      const ch = this.s[pos]!
      const found =
        ch === '\\'
          ? this.escape(pos, end)
          : ch === '`'
            ? this.code(pos, end)
            : ch === '$'
              ? this.dollarMath(pos, end)
              : ch === '['
                ? this.bracket(pos, end, depth)
                : depth < MAX_DEPTH
                  ? this.emphasis(pos, end, depth)
                  : null
      if (found) {
        out.push(found.node)
        pos = found.pos
      } else {
        // An unmatched run of backticks is text as a whole, as in CommonMark.
        const n = ch === '`' ? this.runOf(pos, end, '`') : 1
        out.text(this.s.slice(pos, pos + n))
        pos += n
      }
    }
    if (closer === null) return { nodes: out.list, pos }
    this.failed.add(key)
    return null
  }

  private closes(pos: number, end: number, closer: string): boolean {
    if (!this.s.startsWith(closer, pos) || pos + closer.length > end) return false
    if (isSpace(this.s[pos - 1])) return false
    return closer !== '_' || !isWord(this.s[pos + 1])
  }

  /** `\` before ASCII punctuation makes it plain text; `\(` may open math. */
  private escape(pos: number, end: number): Found | null {
    const next = this.s[pos + 1]
    if (next === '(') {
      const math = this.parenMath(pos, end)
      if (math) return math
    }
    if (next !== undefined && pos + 1 < end && PUNCT.has(next)) return { node: { t: 'text', v: next }, pos: pos + 2 }
    return null
  }

  private code(pos: number, end: number): Found | null {
    const n = this.runOf(pos, end, '`')
    for (let j = pos + n; j < end; ) {
      if (this.s[j] !== '`') {
        j++
        continue
      }
      const m = this.runOf(j, end, '`')
      if (m === n) {
        let v = this.s.slice(pos + n, j)
        // As in CommonMark, one space at each end is padding when both are there.
        if (v.length >= 2 && v.startsWith(' ') && v.endsWith(' ') && v.trim() !== '') v = v.slice(1, -1)
        return { node: { t: 'code', v }, pos: j + m }
      }
      j += m
    }
    return null
  }

  private dollarMath(pos: number, end: number): Found | null {
    const first = this.s[pos + 1]
    if (pos + 1 >= end || isSpace(first) || first === '$') return null
    for (let j = pos + 1; j < end; j++) {
      if (this.s[j] === '\\') {
        j++
        continue
      }
      if (this.s[j] === '$' && !isSpace(this.s[j - 1]) && !isDigit(this.s[j + 1])) {
        return { node: { t: 'math', v: this.s.slice(pos + 1, j) }, pos: j + 1 }
      }
    }
    return null
  }

  private parenMath(pos: number, end: number): Found | null {
    const close = this.s.indexOf('\\)', pos + 2)
    if (close === -1 || close + 2 > end || close === pos + 2) return null
    return { node: { t: 'math', v: this.s.slice(pos + 2, close) }, pos: close + 2 }
  }

  /** `[words](href)`, `[words]{color=red}`, `[words]{.b}`, and from version 2 `[words]{.underline}`, `[words]{size=l}` or `[words]{font=lora}`. */
  private bracket(pos: number, end: number, depth: number): Found | null {
    if (depth >= MAX_DEPTH) return null
    const close = this.matchBracket(pos, end)
    if (close === -1) return null
    const inside = (): Inline[] => this.run(pos + 1, close, null, depth + 1)!.nodes
    if (this.s[close + 1] === '(') {
      const shut = this.hrefEnd(close + 2, end)
      if (shut === -1) return null
      return { node: { t: 'link', href: this.s.slice(close + 2, shut), c: inside() }, pos: shut + 1 }
    }
    if (this.s[close + 1] === '{') {
      const shut = this.s.indexOf('}', close + 2)
      if (shut === -1 || shut >= end) return null
      const attr = this.s.slice(close + 2, shut)
      // A named colour, or a person's colour code, kept in lowercase.
      const color = /^color=([a-z]+|#[0-9a-fA-F]{6})$/.exec(attr)?.[1]?.toLowerCase()
      if (color !== undefined && (COLORS.includes(color) || color.startsWith('#'))) {
        return { node: { t: 'color', color: color as AnyColor, c: inside() }, pos: shut + 1 }
      }
      if (Object.hasOwn(this.spans, attr)) return { node: { t: this.spans[attr]!, c: inside() }, pos: shut + 1 }
      if (this.version === 2) {
        const size = /^size=(.+)$/.exec(attr)?.[1]
        if (size !== undefined && SIZES.includes(size)) return { node: { t: 'size', size: size as Size, c: inside() }, pos: shut + 1 }
        const font = /^font=(.+)$/.exec(attr)?.[1]
        if (font !== undefined && FONT_ID.test(font)) return { node: { t: 'font', font, c: inside() }, pos: shut + 1 }
      }
    }
    return null
  }

  /** The `]` that closes the `[` at `pos`, skipping escapes, code and math; or -1. */
  private matchBracket(pos: number, end: number): number {
    let depth = 0
    for (let j = pos; j < end; ) {
      const ch = this.s[j]
      if (ch === '\\') {
        j = (this.s[j + 1] === '(' ? this.parenMath(j, end)?.pos : undefined) ?? j + 2
        continue
      }
      if (ch === '`') {
        j = this.code(j, end)?.pos ?? j + this.runOf(j, end, '`')
        continue
      }
      if (ch === '$') {
        j = this.dollarMath(j, end)?.pos ?? j + 1
        continue
      }
      if (ch === '[') depth++
      else if (ch === ']' && --depth === 0) return j
      j++
    }
    return -1
  }

  /** The `)` that ends a link address starting at `from`; or -1. Addresses have no spaces. */
  private hrefEnd(from: number, end: number): number {
    let depth = 0
    for (let j = from; j < end; j++) {
      const ch = this.s[j]!
      if (/\s/u.test(ch) || ch === '\\' || ch === '<' || ch === '>') return -1
      if (ch === '(') depth++
      else if (ch === ')') {
        if (depth === 0) return j === from ? -1 : j
        depth--
      }
    }
    return -1
  }

  private emphasis(pos: number, end: number, depth: number): Found | null {
    for (const delim of DELIMS) {
      if (!this.s.startsWith(delim, pos)) continue
      const after = pos + delim.length
      if (after >= end || isSpace(this.s[after])) return null
      if (delim === '_' && isWord(this.s[pos - 1])) return null
      const inner = this.run(after, end, delim, depth + 1)
      return inner && { node: { t: MARK_OF[delim], c: inner.nodes }, pos: inner.pos }
    }
    return null
  }

  private runOf(pos: number, end: number, ch: string): number {
    let n = 0
    while (pos + n < end && this.s[pos + n] === ch) n++
    return n
  }
}

/** Builds a node list, joining neighbours that can be joined. */
class Nodes {
  readonly list: Inline[] = []

  text(v: string): void {
    if (v === '') return
    const last = this.list.at(-1)
    if (last?.t === 'text') this.list[this.list.length - 1] = { t: 'text', v: last.v + v }
    else this.list.push({ t: 'text', v })
  }

  push(node: Inline): void {
    if (node.t === 'text') return this.text(node.v)
    const last = this.list.at(-1)
    // Two code spans side by side cannot be written: their backtick fences would run together.
    if (last?.t === 'code' && node.t === 'code') {
      this.list[this.list.length - 1] = { t: 'code', v: last.v + node.v }
    } else if (last && 'c' in last && 'c' in node && sameKind(last, node)) {
      this.list[this.list.length - 1] = { ...last, c: normalize([...last.c, ...node.c]) }
    } else {
      this.list.push(node)
    }
  }
}

function sameKind(a: Parent, b: Parent): boolean {
  if (a.t !== b.t) return false
  if (a.t === 'link') return a.href === (b as typeof a).href
  if (a.t === 'color') return a.color === (b as typeof a).color
  if (a.t === 'size') return a.size === (b as typeof a).size
  if (a.t === 'font') return a.font === (b as typeof a).font
  return true
}

// ----- the canonical form -----------------------------------------------------

const RANK: Record<Mark, number> = { b: 0, i: 1, s: 2, hl: 3, u: 4, sub: 5, sup: 6 }

/**
 * The canonical form of a node list, which reading and writing preserve:
 * no empty nodes, neighbours of the same kind joined, a mark never directly
 * inside the same mark, spaces at the edges of a mark moved outside it, and
 * a mark that only wraps another mark nested in the order b, i, s, hl, u,
 * sub, sup.
 */
export function normalize(nodes: readonly Inline[]): Inline[] {
  const out = new Nodes()
  for (const node of nodes) {
    switch (node.t) {
      case 'text':
        out.text(node.v)
        break
      case 'code':
      case 'math':
        if (node.v !== '') out.push({ t: node.t, v: node.v })
        break
      case 'link': {
        const c = normalize(node.c)
        const href = safeHref(node.href)
        if (c.length > 0 && href !== '') out.push({ t: 'link', href, c })
        else c.forEach((child) => out.push(child))
        break
      }
      case 'color': {
        const c = normalize(unwrap(normalize(node.c), (n) => n.t === 'color' && n.color === node.color))
        if (c.length > 0) out.push({ t: 'color', color: node.color, c })
        break
      }
      case 'size': {
        const c = normalize(unwrap(normalize(node.c), (n) => n.t === 'size' && n.size === node.size))
        if (c.length > 0) out.push({ t: 'size', size: node.size, c })
        break
      }
      case 'font': {
        const c = normalize(unwrap(normalize(node.c), (n) => n.t === 'font' && n.font === node.font))
        if (c.length > 0) out.push({ t: 'font', font: node.font, c })
        break
      }
      default: {
        const [lead, c, trail] = trimEdges(normalize(unwrap(normalize(node.c), (n) => n.t === node.t)))
        out.text(lead)
        if (c.length > 0) out.push(nestInOrder({ t: node.t, c }))
        out.text(trail)
      }
    }
  }
  return out.list
}

/** Replace children matching `same` by their own children. */
function unwrap(nodes: readonly Inline[], same: (node: Inline) => boolean): Inline[] {
  return nodes.flatMap((node) => (same(node) && 'c' in node ? node.c : [node]))
}

/** Split leading and trailing whitespace off a normalized list. */
function trimEdges(nodes: Inline[]): [string, Inline[], string] {
  let lead = ''
  let trail = ''
  const list = [...nodes]
  const first = list[0]
  if (first?.t === 'text') {
    const m = /^\s+/u.exec(first.v)
    if (m) {
      lead = m[0]
      const rest = first.v.slice(lead.length)
      if (rest) list[0] = { t: 'text', v: rest }
      else list.shift()
    }
  }
  const last = list.at(-1)
  if (last?.t === 'text') {
    const m = /\s+$/u.exec(last.v)
    if (m) {
      trail = m[0]
      const rest = last.v.slice(0, -trail.length)
      if (rest) list[list.length - 1] = { t: 'text', v: rest }
      else list.pop()
    }
  }
  return [lead, list, trail]
}

/** When a mark only wraps another mark, put the lower-ranked one outside. */
function nestInOrder(node: Extract<Inline, { t: Mark }>): Inline {
  const only = node.c.length === 1 ? node.c[0]! : undefined
  if (only && isMark(only) && RANK[only.t] < RANK[node.t]) {
    // normalize, not just nest: the swap can put a mark directly inside the same mark.
    return { t: only.t, c: normalize([{ t: node.t, c: only.c }]) }
  }
  return node
}

/** Link addresses cannot hold spaces, backslashes, angle brackets or unbalanced parentheses. */
function safeHref(href: string): string {
  let out = href.replace(/[\s\\<>]/gu, (ch) => encodeURIComponent(ch))
  let depth = 0
  for (const ch of out) {
    if (ch === '(') depth++
    if (ch === ')' && --depth < 0) break
  }
  if (depth !== 0) out = out.replace(/[()]/g, (ch) => (ch === '(' ? '%28' : '%29'))
  return out
}

// ----- writing ---------------------------------------------------------------

interface Style {
  /** Delimiter for italic, or 'span' to write every mark as [words]{.b}. */
  italic: '*' | '_' | 'span'
  /** Escape $ wherever it could open math, not only where it would. */
  dollars: boolean
  /** For export only: underline, subscript and superscript as HTML tags, which this reader does not read. */
  html?: boolean
}

// Tried in order; the first that reads back as the same tree wins. Most text
// passes the first. The last always works, at the cost of looking busier.
const STYLES: readonly Style[] = [
  { italic: '*', dollars: false },
  { italic: '*', dollars: true },
  { italic: '_', dollars: true },
  { italic: 'span', dollars: true },
]

/** Write nodes as `md`. Reading the result back gives normalize(nodes). */
export function serializeInline(nodes: readonly Inline[]): string {
  const tree = normalize(nodes)
  let md = ''
  for (const style of STYLES) {
    md = write(tree, '', style)
    if (sameTree(parseInline(md), tree)) return md
  }
  return md
}

/** `after` is the character that follows these nodes once written, or '' at the end. */
function write(nodes: readonly Inline[], after: string, style: Style): string {
  let out = ''
  nodes.forEach((node, i) => {
    const next = i + 1 < nodes.length ? firstChar(nodes[i + 1]!, style) : after
    out += writeNode(node, next, style)
  })
  return out
}

function writeNode(node: Inline, next: string, style: Style): string {
  switch (node.t) {
    case 'text': {
      const text = style.italic === 'span' ? escapeAll(node.v) : escapeText(node.v, style.dollars)
      // An HTML-like word in the text of an export must stay text.
      return style.html ? text.replace(/</gu, '\\<') : text
    }
    case 'code':
      return writeCode(node.v)
    case 'math':
      return writeMath(node.v, next)
    case 'link':
      return `[${write(node.c, ']', style)}](${node.href})`
    case 'color':
      return `[${write(node.c, ']', style)}]{color=${node.color}}`
    case 'size':
      return `[${write(node.c, ']', style)}]{size=${node.size}}`
    case 'font':
      return `[${write(node.c, ']', style)}]{font=${node.font}}`
    default: {
      if (style.html && HTML_TAG[node.t] !== undefined) return `<${HTML_TAG[node.t]}>${write(node.c, '<', style)}</${HTML_TAG[node.t]}>`
      if (style.italic === 'span' || SPAN_ONLY.has(node.t)) return `[${write(node.c, ']', style)}]{${SPAN_CLASS[node.t]}}`
      const delim = node.t === 'b' ? '**' : node.t === 's' ? '~~' : node.t === 'hl' ? '==' : style.italic
      return delim + write(node.c, delim[0]!, style) + delim
    }
  }
}

/** Marks with no delimiter of their own: always written as spans. */
const SPAN_ONLY: ReadonlySet<Mark> = new Set(['u', 'sub', 'sup'])
/** The HTML tag each of those marks becomes in a Markdown export. */
const HTML_TAG: Partial<Record<Mark, string>> = { u: 'u', sub: 'sub', sup: 'sup' }

function firstChar(node: Inline, style: Style): string {
  if (node.t === 'text') return node.v[0] ?? ''
  if (node.t === 'code') return '`'
  if (node.t === 'math') return '$'
  if (style.html && HTML_TAG[node.t as Mark] !== undefined) return '<'
  if (node.t === 'link' || node.t === 'color' || node.t === 'size' || node.t === 'font' || style.italic === 'span' || SPAN_ONLY.has(node.t)) return '['
  return node.t === 'b' ? '*' : node.t === 's' ? '~' : node.t === 'hl' ? '=' : style.italic
}

/** Escape only what could be read as syntax. */
function escapeText(v: string, dollars: boolean): string {
  let out = ''
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]!
    const prev = v[i - 1]
    const next = v[i + 1]
    let escape = false
    switch (ch) {
      case '\\':
      case '`':
      case '*':
      case '[':
      case ']':
        escape = true
        break
      case '_':
        escape = !(isWord(prev) && isWord(next))
        break
      case '~':
      case '=':
        escape = prev === undefined || next === undefined || prev === ch || next === ch
        break
      case '$':
        escape = dollars && !isSpace(next)
        break
    }
    out += escape ? `\\${ch}` : ch
  }
  return out
}

/** Escape every ASCII punctuation mark except parentheses, which are never syntax alone. */
function escapeAll(v: string): string {
  let out = ''
  for (const ch of v) out += PUNCT.has(ch) && ch !== '(' && ch !== ')' ? `\\${ch}` : ch
  return out
}

function writeCode(v: string): string {
  const longest = Math.max(0, ...Array.from(v.matchAll(/`+/g), (m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  const pad = v.startsWith('`') || v.endsWith('`') || (v.startsWith(' ') && v.endsWith(' ') && v.trim() !== '') ? ' ' : ''
  return fence + pad + v + pad + fence
}

function writeMath(v: string, next: string): string {
  const dollarsWork =
    !isSpace(v[0]) && !isSpace(v.at(-1)) && v[0] !== '$' && !v.endsWith('\\') && !hasBareDollar(v) && !isDigit(next)
  if (dollarsWork || v.includes('\\)')) return `$${v}$`
  return `\\(${v}\\)`
}

function hasBareDollar(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\') i++
    else if (v[i] === '$') return true
  }
  return false
}

function sameTree(a: readonly Inline[], b: readonly Inline[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ----- reading for people and checks ------------------------------------------

/** The words without markup. Inline math keeps its $ signs, so it still reads as math. */
export function plainText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => (node.t === 'text' || node.t === 'code' ? node.v : node.t === 'math' ? `$${node.v}$` : plainText(node.c)))
    .join('')
}

/**
 * A text block's words as standard Markdown, for export:
 * underline, subscript and superscript become <u>, <sub> and <sup>, which
 * GitHub, Obsidian and VS Code show; colours, sizes and fonts keep their words.
 */
export function exportMarkdown(md: string): string {
  const nodes = strip(parseInline(md), (node) => node.t === 'color' || node.t === 'size' || node.t === 'font')
  // Without those marks the usual writer does, with its check that the words read back the same.
  if (!hasMark(nodes, (node) => HTML_TAG[node.t as Mark] !== undefined)) return serializeInline(nodes)
  return write(nodes, '', { italic: '*', dollars: true, html: true })
}

function hasMark(nodes: readonly Inline[], test: (node: Parent) => boolean): boolean {
  return nodes.some((node) => 'c' in node && (test(node) || hasMark(node.c, test)))
}

/** Replace each node of a kind by its children: used to drop colours or links on export. */
export function strip(nodes: readonly Inline[], drop: (node: Parent) => boolean): Inline[] {
  return normalize(nodes.flatMap((node) => ('c' in node ? (drop(node) ? strip(node.c, drop) : [{ ...node, c: strip(node.c, drop) }]) : [node])))
}

const SAFE_LINK = /^(https?:|mailto:)/i
const COLOR_HINT = `Coloured words are written [words]{color=red}, with one of: ${COLORS.join(', ')}.`
/** The spans md may hold: a colour, a mark, and from version 2 a size or a font. */
const SPAN = /\]\{(?:color=(?:[a-z]+|#[0-9a-f]{6})|\.(?:b|i|s|hl|underline|sub|sup)|size=(?:s|m|l|xl)|font=[a-z][a-z0-9-]{1,39})\}/u
/**
 * An HTML tag: a model formatting with HTML instead of Markdown, or markup
 * that could act in an exported page. Other words in angle brackets are text,
 * such as `#include <iostream>` in program code: the note shows them as
 * written, and the Markdown export escapes them.
 */
const HTML_MARKUP =
  /<\/?(?:a|abbr|audio|b|big|blockquote|body|br|button|center|code|del|details|div|em|embed|font|form|h[1-6]|head|hr|html|i|iframe|img|input|ins|kbd|li|link|mark|math|meta|object|ol|p|pre|q|s|script|select|small|source|span|strike|strong|style|sub|summary|sup|svg|table|tbody|td|textarea|th|thead|tr|u|ul|video)(?=[\s/>])[^>]*>/iu

/**
 * A content check for `md` written by a model or another program (layer 3).
 * Returns null when it is fine, or a hint that says what to change.
 */
export function checkInline(md: string): string | null {
  const start = md.trimStart()
  if (/\n\s*\n/u.test(md)) return 'One paragraph per block. Split the text into two blocks instead of leaving a blank line.'
  if (/^#{1,6}\s/u.test(start)) return 'Headings are a block role, not "#". Set the role to h1, h2 or h3.'
  if (/^([-+*]|\d{1,9}[.)])\s/u.test(start)) return 'Lists are a block role. Set the role to li or oli instead of writing "-" or "1.".'
  if (/^>/u.test(start)) return 'Quotes are a block role. Set the role to quote instead of writing ">".'
  if (HTML_MARKUP.test(md)) return 'No HTML. Use **bold**, *italic*, ==highlight== or [words]{color=red}.'
  if (/!\[[^\]]*\]\(/u.test(md)) return 'Images are blocks of their own. Insert an image block instead.'
  if (md.includes('$$')) return 'Display math goes in a math block. Inside text, write $x^2$.'
  const spans = md.match(/\]\{[^}]*\}/gu) ?? []
  if (spans.some((span) => !SPAN.test(span)) || /\]\{color=(?!(?:ink|gray|red|orange|yellow|green|blue|purple|#[0-9a-f]{6})\})/u.test(md)) {
    return COLOR_HINT
  }
  const bad = findLink(parseInline(md), (href) => !SAFE_LINK.test(href))
  if (bad !== undefined) return `Links must start with https://, http:// or mailto:, not ${JSON.stringify(bad.slice(0, 30))}.`
  return null
}

function findLink(nodes: readonly Inline[], test: (href: string) => boolean): string | undefined {
  for (const node of nodes) {
    if (node.t === 'link' && test(node.href)) return node.href
    if ('c' in node) {
      const found = findLink(node.c, test)
      if (found !== undefined) return found
    }
  }
  return undefined
}
