// Recipes and the shape rules (note control, step 5; the design 6 of 19 October 2026 of 25 October): so the model
// thinks less, it chooses and writes the words, code builds the layout. A recipe is a fixed layout for a known job (a
// Q and A, a section, a summary, a comparison, steps, a definition). The shape rules, a small decision tree
// shape from the content alone (`write: add`), and say why. Each choice is recorded by the content's features only,
// never its words (cl1), for a learned chooser later.
import { diagramKind } from '../ai/mermaid.js'
import type { Role } from '../schema/doc.js'
import { itemsOf, paragraphsOf } from './compile.js'
import { tableOf } from './table.js'

/** A block of text a recipe makes: its role, its words, its level in. */
export interface Part {
  role: Role
  md: string
  indent: number
}

/** The shapes the rules choose among. */
export type Shape = 'list' | 'steps' | 'table' | 'definition' | 'formula' | 'diagram' | 'paragraphs'

/** What the rules read of a content, and all the choices log keeps of it (cl1): no word of it. */
export interface Features {
  lines: number
  /** Blocks of lines parted by blank lines. */
  parts: number
  /** Letters a line, on average. */
  length: number
  /** Lines that start with a number (1., 2)) or a word of order (first, then, next, finally, step). */
  ordered: number
  /** Lines that start with a list's sign (-, *, •). */
  bulleted: number
  /** Lines with a | between cells. */
  piped: number
  /** A term (four words at most), then a colon, "is" or "means", then its meaning. */
  term: boolean
  /** LaTeX commands or a line of maths. */
  maths: boolean
  /** A diagram's kind on the first line (flowchart, pie, xychart…). */
  diagram: boolean
  /** Lines that end a sentence (. ! ?). */
  sentences: number
}

const ORDER = /^(?:\d+[.)]\s|step\s+\d+\b|first(?:ly)?\b|second(?:ly)?\b|third(?:ly)?\b|then\b|next\b|after that\b|finally\b|lastly\b)/iu
const BULLET = /^[-*•–]\s/u
const TERM = /^([^:.!?]{1,40}?)\s*(?::|\s(?:is|are|means)\s)\s*(\S.*)$/iu
/** A LaTeX command (\frac, \int…), or only maths' own characters with an = and no long word but a function's name. */
const COMMAND = /\\[a-z]{2,}/iu
const MATHS_ONLY = /^[\p{L}\p{N}\s+\-*/^_=(){}[\],.\\|<>!']+$/u
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'log', 'exp', 'lim', 'sqrt', 'max', 'min'])
const isMaths = (line: string): boolean =>
  COMMAND.test(line) || (line.includes('=') && MATHS_ONLY.test(line) && !(line.replace(/\\[a-z]+/giu, '').match(/\p{L}{4,}/gu) ?? []).some((word) => !FUNCTIONS.has(word.toLowerCase())))

export function featuresOf(words: string): Features {
  const lines = words.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const parts = words.split(/\n\s*\n/u).filter((part) => part.trim() !== '').length
  const length = lines.length > 0 ? Math.round(lines.reduce((sum, line) => sum + line.length, 0) / lines.length) : 0
  const term = TERM.exec(lines[0] ?? '')
  return {
    lines: lines.length,
    parts,
    length,
    ordered: lines.filter((line) => ORDER.test(line)).length,
    bulleted: lines.filter((line) => BULLET.test(line)).length,
    piped: lines.filter((line) => /(?<!\\)\|/u.test(line)).length,
    // A term and its meaning: one line (Term: its meaning, or Term is …, a sentence alone), or a short term on a line
    // of its own and its meaning under it. Not lines of Pros: …, Cons: …, each with its colon: a list.
    term:
      (lines.length === 1 && term !== null && term[1]!.trim().split(/\s+/u).length <= 4 && (/:/u.test(lines[0]!) || (lines[0]!.match(/[.!?](?:\s|$)/gu) ?? []).length <= 1)) ||
      (lines.length === 2 && parts === 1 && lines[0]!.split(/\s+/u).length <= 4 && !/[.:!?]$/u.test(lines[0]!) && /[.!?]$/u.test(lines[1]!)),
    maths: lines.length > 0 && lines.length <= 3 && lines.every(isMaths),
    diagram: diagramKind(words) !== undefined,
    sentences: lines.filter((line) => /[.!?]["”']?$/u.test(line)).length,
  }
}

/** The shape the rules choose for a content, and why, in a few words (the person's decision tree, sh1). */
export function shapeOf(words: string): { shape: Shape; why: string; features: Features } {
  const f = featuresOf(words)
  const pick = (shape: Shape, why: string) => ({ shape, why, features: f })
  if (f.diagram) return pick('diagram', "a diagram's kind on its first line")
  if (f.piped >= 2 && f.piped >= f.lines - 1) return pick('table', 'cells between | signs')
  if (f.maths) return pick('formula', 'a line of maths')
  if (f.term && f.lines <= 3 && !(f.ordered >= 2)) return pick('definition', 'a term and its meaning')
  // st1: steps in order make a numbered list; a flowchart only when the request asks for one (diagram:).
  if (f.lines >= 2 && f.ordered >= Math.ceil(f.lines / 2)) return pick('steps', 'steps in order')
  if (f.lines >= 2 && (f.bulleted >= Math.ceil(f.lines / 2) || (f.length <= 80 && f.parts === 1 && f.sentences < f.lines))) return pick('list', 'a few short points')
  return pick('paragraphs', 'sentences')
}

/** A line's sign of order or of a list taken off: 1. Measure → Measure; Step 2: Mix → Mix; - Light → Light. */
const unsigned = (line: string): string => line.replace(/^(?:\d+[.)]|step\s+\d+[:.)]?|[-*•–])\s*/iu, '').trim()

/** The steps of a content, a line each, their signs of order taken off ("first", "then" kept: they are words). */
export function stepParts(words: string): Part[] {
  return itemsOf(words).map((item) => ({ role: 'oli', md: unsigned(item.md), indent: item.indent }))
}

/** A Q and A: Q: and A: lines, or a question ending in ? with its answer under it; each question a heading 3. */
export function qaParts(words: string): Part[] {
  const lines = words.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const parts: Part[] = []
  let answer: string[] = []
  const flush = (): void => {
    if (answer.length > 0) parts.push({ role: 'p', md: answer.join(' '), indent: 0 })
    answer = []
  }
  for (const line of lines) {
    const asked = /^(?:q(?:uestion)?\s*\d*\s*[:.)-])\s*(.+)$/iu.exec(line)
    const answered = /^(?:a(?:nswer)?\s*\d*\s*[:.)-])\s*(.+)$/iu.exec(line)
    if (asked || (!answered && /\?["”']?$/u.test(line))) {
      flush()
      parts.push({ role: 'h3', md: (asked ? asked[1]! : line).replace(/^#{1,6}\s+/u, ''), indent: 0 })
    } else answer.push(answered ? answered[1]! : line)
  }
  flush()
  if (!parts.some((part) => part.role === 'h3')) throw new Error('No question: write each as Q: … (or a line ending in ?), its answer under it as A: …')
  return parts
}

/** A section: its title on the first line (a heading 2), then a point a line (a list). */
export function sectionParts(words: string, title?: string): Part[] {
  const lines = words.split('\n').filter((line) => line.trim() !== '')
  const head = title ?? lines.shift()?.trim().replace(/^#{1,6}\s+/u, '').replace(/:$/u, '')
  if (!head) throw new Error('No title: write it on the first line under the command, then a point a line.')
  const points = itemsOf(lines.join('\n'))
  if (points.length === 0) throw new Error('No points: write one a line under the title, then end.')
  return [{ role: 'h2', md: head, indent: 0 }, ...points.map((point): Part => ({ role: 'li', md: point.md, indent: point.indent }))]
}

/** A definition (df1): a quote in the text, the term in bold: "**Wavelength**: the distance between two crests". */
export function definitionMd(words: string): string {
  const lines = paragraphsOf(words.replace(/\n(?!\s*\n)/gu, '\n\n'))
  const one = lines.length === 1 ? TERM.exec(lines[0]!) : null
  const term = (one ? one[1]! : lines[0] ?? '').trim().replace(/^\*\*(.*)\*\*$/u, '$1')
  const meaning = (one ? one[2]! : lines.slice(1).join(' ')).trim()
  if (term === '' || meaning === '') throw new Error('Write the term on the first line and its meaning under it, or Term: its meaning.')
  return `**${term}**: ${meaning}`
}

/** A comparison (compare): a Markdown table, or Thing: a; b; c lines, the first line the header row. */
export function compareRows(words: string): string[][] {
  const lines = words.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const colon = lines.every((line) => /^[^:|]+:\s*\S/u.test(line))
  if (colon) {
    const rows = lines.map((line) => [line.slice(0, line.indexOf(':')).trim(), ...line.slice(line.indexOf(':') + 1).split(/\s*;\s*/u).map((cell) => cell.trim())])
    const width = Math.max(...rows.map((row) => row.length))
    return rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')])
  }
  return tableOf(words).rows
}
