// The shapes of a board's nodes, and how a Mermaid flowchart writes each: a pair of brackets round the words. They
// are Mermaid's own, so that a flowchart a model writes in Mermaid is kept as it was written, and a board's
// flowchart can be written out as Mermaid again.
import type { NodeShape } from '../schema/doc.js'

/** Each shape's brackets in a Mermaid flowchart: A[box], A(round), A([pill]), A{diamond}… */
export const BRACKETS: Readonly<Record<NodeShape, readonly [open: string, close: string]>> = {
  box: ['[', ']'],
  round: ['(', ')'],
  pill: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  'double-circle': ['(((', ')))'],
  flag: ['>', ']'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  slant: ['[/', '/]'],
  'slant-back': ['[\\', '\\]'],
  trapezoid: ['[/', '\\]'],
  'trapezoid-down': ['[\\', '/]'],
}

/** The shapes, those with the longest opening bracket first: "((" is read before "(". */
export const BY_BRACKET: readonly NodeShape[] = (Object.keys(BRACKETS) as NodeShape[]).sort((a, b) => BRACKETS[b][0].length - BRACKETS[a][0].length)

/**
 * The names Mermaid gives its shapes in its longer form, A@{ shape: diamond }, and the words of a flowchart's own
 * language (a decision, a database), each as the shape a board keeps.
 */
export const SHAPE_WORDS: Readonly<Record<string, NodeShape>> = {
  box: 'box', rect: 'box', rectangle: 'box', proc: 'box', process: 'box', step: 'box', square: 'box',
  round: 'round', rounded: 'round', event: 'round',
  pill: 'pill', stadium: 'pill', terminal: 'pill', start: 'pill', end: 'pill',
  subroutine: 'subroutine', subproc: 'subroutine', subprocess: 'subroutine', 'fr-rect': 'subroutine', 'framed-rectangle': 'subroutine',
  cylinder: 'cylinder', cyl: 'cylinder', database: 'cylinder', db: 'cylinder',
  circle: 'circle', circ: 'circle', join: 'circle', connector: 'circle',
  'double-circle': 'double-circle', 'dbl-circ': 'double-circle', stop: 'double-circle',
  flag: 'flag', odd: 'flag',
  diamond: 'diamond', diam: 'diamond', decision: 'diamond', question: 'diamond', rhombus: 'diamond',
  hexagon: 'hexagon', hex: 'hexagon', prepare: 'hexagon', preparation: 'hexagon',
  slant: 'slant', 'lean-r': 'slant', 'lean-right': 'slant', 'in-out': 'slant', input: 'slant', output: 'slant', parallelogram: 'slant',
  'slant-back': 'slant-back', 'lean-l': 'slant-back', 'lean-left': 'slant-back', 'out-in': 'slant-back',
  trapezoid: 'trapezoid', 'trap-b': 'trapezoid', 'trapezoid-bottom': 'trapezoid', priority: 'trapezoid',
  'trapezoid-down': 'trapezoid-down', 'trap-t': 'trapezoid-down', 'inv-trapezoid': 'trapezoid-down', 'trapezoid-top': 'trapezoid-down', manual: 'trapezoid-down',
}
