// Diagrams the AI writes (protocol v1.1): Mermaid source of three kinds only,
// flowchart, pie and xychart, each with one tiny example in the diagram
// guide. Fewer kinds to choose from is easier for a small model, and these
// three cover steps, parts of a whole and numbers over a range. A diagram that
// already has another kind may keep it when the AI changes it.
//
// This checks the kind only. Whether the source parses is up to Mermaid
// itself, which needs a browser, so the caller passes that check in.

/** The kinds of diagram the AI may write. */
export const DIAGRAM_KINDS = ['flowchart', 'pie', 'xychart'] as const

/** Every kind Mermaid 11 declares, without a "-beta" or "-v2" ending. */
const MERMAID_KINDS = new Set([
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'erDiagram', 'journey', 'gantt', 'pie',
  'quadrantChart', 'requirementDiagram', 'gitGraph', 'mindmap', 'timeline', 'zenuml', 'sankey', 'xychart', 'block',
  'packet', 'kanban', 'architecture', 'radar', 'treemap', 'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
])

/**
 * The kind a Mermaid source declares on its first line, after any front matter
 * and comments: "graph" is a flowchart's other name, "xychart-beta" an xychart's.
 */
export function diagramKind(src: string): string | undefined {
  const lines = src.split('\n').map((line) => line.trim())
  let i = 0
  // Front matter: --- … ---
  if (lines[0] === '---') {
    i = lines.indexOf('---', 1) + 1
    if (i === 0) return undefined
  }
  const first = lines.slice(i).find((line) => line !== '' && !line.startsWith('%%'))
  const word = first === undefined ? undefined : /^([A-Za-z][\w-]*)/u.exec(first)?.[1]?.replace(/-(?:beta|v2)$/u, '')
  if (word === undefined || !MERMAID_KINDS.has(word)) return undefined
  return word === 'graph' ? 'flowchart' : word
}

/**
 * A node's words in a box `[…]`, a diamond `{…}` or a round box `(…)`, not
 * quoted and not another shape such as `[(…)]` or `((…))`. The words end at
 * the bracket that ends the line, or comes before a line to the next node.
 */
const BOX_WORDS = /(^|\W)(\w+)(?:\[(?![[(/\\"])([^"\n]*?)\]|\{(?![{"])([^"\n]*?)\}|\((?![([{"])([^"\n]*?)\))(?=\s*(?:$|;|&|:::|--|==|-\.|<-|<=|~~))/gu

/** The words of a node BOX_WORDS found, in quotes when they have brackets. */
function quoteWords(whole: string, before: string, id: string, box?: string, diamond?: string, round?: string): string {
  const [open, words, close] = box !== undefined ? ['[', box, ']'] : diamond !== undefined ? ['{', diamond, '}'] : ['(', round ?? '', ')']
  return /[()[\]{}]/u.test(words) ? `${before}${id}${open}"${words}"${close}` : whole
}

/**
 * A flowchart's common slips, mended so that it draws, as small models write
 * them. Each was refused by Mermaid 11.17.2 (checked 11 October 2026): a
 * labelled line with two dashes, `A --|7| B`, which needs three; the same as
 * an arrow, `A --|7|> B`, which is `A -->|7| B`; a one-dash arrow, `A -> B`;
 * a bare pair of dashes, `A -- B`; a label after the node it points to,
 * `A --> B |7|`; and brackets in a box's words, `A[Force (F)]`, which Mermaid
 * reads as a shape unless the words are in quotes. Every other line, and every
 * other kind, stays as written.
 */
export function mendFlowchart(src: string): string {
  if (diagramKind(src) !== 'flowchart') return src
  return src
    .split('\n')
    .map((line) =>
      line
        .replace(/(^|[^-<.=])--\|([^|\n]*)\|>/gu, '$1-->|$2|')
        .replace(/(^|[^-<.=])--\|/gu, '$1---|')
        .replace(/(^|[\s\w\])}])->(?=[\s\w[(])/gu, '$1-->')
        .replace(/^(\s*\S+\s+)--(\s+\S+\s*)$/u, '$1---$2')
        .replace(/^(\s*\S+\s*)(-->|---)(\s*)(\S+)\s*\|([^|]*)\|\s*$/u, '$1$2|$5|$3$4')
        .replace(BOX_WORDS, quoteWords),
    )
    .join('\n')
}

/**
 * Null when the AI may write this diagram, or a hint for its one retry. `keep`
 * is the kind a diagram being changed already has, which it may keep.
 */
export function diagramHint(src: string, keep?: string): string | null {
  const kind = diagramKind(src)
  if (kind !== undefined && ((DIAGRAM_KINDS as readonly string[]).includes(kind) || kind === keep)) return null
  const also = keep !== undefined && !(DIAGRAM_KINDS as readonly string[]).includes(keep) ? `, or keep it a ${keep}` : ''
  return kind === undefined
    ? `Start with the diagram's kind on the first line: flowchart, pie or xychart${also}.`
    : `Write a flowchart, a pie or an xychart${also}, not a ${kind}.`
}
