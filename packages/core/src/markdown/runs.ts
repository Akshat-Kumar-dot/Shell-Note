// Between a text block's inline Markdown and the flat runs editors work with:
// pieces of text, or formulas, each with the marks that apply to it. Editors
// such as ProseMirror store "bold" on each piece of text rather than as a node
// around it, so the editor adapter reads and writes through these.
import type { AnyColor } from '../schema/doc.js'
import { normalize, parseInline, serializeInline, type Inline, type Size } from './inline.js'

export interface Marks {
  b?: true
  i?: true
  s?: true
  hl?: true
  /** From version 2: underline, subscript and superscript. */
  u?: true
  sub?: true
  sup?: true
  code?: true
  link?: string
  color?: AnyColor
  /** From version 2: the words' own size and font. */
  size?: Size
  font?: string
}

export type Run = { text: string; marks: Marks } | { math: string; marks: Marks }

/** Flatten md into runs: each piece of text, or each formula, with every mark that applies to it. */
export function toRuns(md: string): Run[] {
  return runsOf(parseInline(md))
}

/** The runs of a tree of inline nodes. */
function runsOf(nodes: readonly Inline[]): Run[] {
  const out: Run[] = []
  const walk = (nodes: readonly Inline[], marks: Marks): void => {
    for (const node of nodes) {
      switch (node.t) {
        case 'text':
          out.push({ text: node.v, marks })
          break
        case 'code':
          out.push({ text: node.v, marks: { ...marks, code: true } })
          break
        case 'math':
          out.push({ math: node.v, marks })
          break
        case 'link':
          walk(node.c, { ...marks, link: node.href })
          break
        case 'color':
          walk(node.c, { ...marks, color: node.color })
          break
        case 'size':
          walk(node.c, { ...marks, size: node.size })
          break
        case 'font':
          walk(node.c, { ...marks, font: node.font })
          break
        default:
          walk(node.c, { ...marks, [node.t]: true })
      }
    }
  }
  walk(nodes, {})
  return out
}

/** Marks in the order that breaks ties: the earlier one goes outside. */
const NESTING = ['link', 'color', 'size', 'font', 'b', 'i', 's', 'hl', 'u', 'sub', 'sup'] as const
type Nestable = (typeof NESTING)[number]

/**
 * Build md from runs. At each point the mark that runs furthest goes outside,
 * as HTML serializers do, so "*italic with **bold** inside*" keeps its spaces
 * italic and "**bold with *italic* inside**" keeps them bold. Reading the
 * result back with toRuns gives the same formatting, and writing it again
 * gives the same md.
 */
export function fromRuns(runs: readonly Run[]): string {
  // Spaces at a mark's edge move outside it, which can change which mark runs
  // furthest when the words are read back (" ==x==" with a colour inside):
  // nest again until the tree settles. The md written reads back as exactly
  // this tree, so its runs need no reading.
  let tree = normalize(nest(runs))
  for (let i = 0; i < 3; i++) {
    const again = normalize(nest(runsOf(tree)))
    if (JSON.stringify(again) === JSON.stringify(tree)) break
    tree = again
  }
  return serializeInline(tree)
}

function nest(runs: readonly Run[]): Inline[] {
  const out: Inline[] = []
  let i = 0
  while (i < runs.length) {
    const run = runs[i]!
    const reach = (mark: Nestable): number => {
      let j = i
      while (j < runs.length && runs[j]!.marks[mark] !== undefined && runs[j]!.marks[mark] === run.marks[mark]) j++
      return j
    }
    const present = NESTING.filter((mark) => run.marks[mark] !== undefined)
    if (present.length === 0) {
      out.push('math' in run ? { t: 'math', v: run.math } : run.marks.code ? { t: 'code', v: run.text } : { t: 'text', v: run.text })
      i++
      continue
    }
    const outer = present.reduce((best, mark) => (reach(mark) > reach(best) ? mark : best))
    const end = reach(outer)
    const value = run.marks[outer]
    const inner = nest(
      runs.slice(i, end).map((r): Run => {
        const marks = { ...r.marks }
        delete marks[outer]
        return 'math' in r ? { math: r.math, marks } : { text: r.text, marks }
      }),
    )
    if (outer === 'link') out.push({ t: 'link', href: value as string, c: inner })
    else if (outer === 'color') out.push({ t: 'color', color: value as AnyColor, c: inner })
    else if (outer === 'size') out.push({ t: 'size', size: value as Size, c: inner })
    else if (outer === 'font') out.push({ t: 'font', font: value as string, c: inner })
    else out.push({ t: outer, c: inner })
    i = end
  }
  return out
}

/** Runs compared by what they show: neighbours with the same marks are joined, empty text dropped. */
export function sameRuns(a: readonly Run[], b: readonly Run[]): boolean {
  return JSON.stringify(joined(a)) === JSON.stringify(joined(b))
}

function joined(runs: readonly Run[]): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    const marks = sortedMarks(run.marks)
    const last = out.at(-1)
    if ('text' in run && run.text === '') continue
    if (last && 'text' in last && 'text' in run && JSON.stringify(last.marks) === JSON.stringify(marks)) {
      out[out.length - 1] = { text: last.text + run.text, marks }
    } else {
      out.push('text' in run ? { text: run.text, marks } : { math: run.math, marks })
    }
  }
  return out
}

function sortedMarks(marks: Marks): Marks {
  return Object.fromEntries(
    Object.entries(marks)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  ) as Marks
}
