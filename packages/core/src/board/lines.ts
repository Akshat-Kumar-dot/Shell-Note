// A node's ways out, as the words every reader of a board is given: the outline, a block read in full, the lines a
// model sees. A node's line holds where it points, so a reader never has to look the links up in another list.
import type { NodeBlock } from '../schema/doc.js'

/**
 * Where a node points, after its own words: " → n3 yes, n1 no". Empty for a node that points nowhere. A link's words
 * are the note's: one line, cut short, and never able to pose as another link (no comma, no arrow).
 */
export function waysOut(node: Pick<NodeBlock, 'to'>): string {
  if (node.to === undefined || node.to.length === 0) return ''
  const one = (label: string): string => {
    const plain = label.replace(/[,→\s]+/gu, ' ').trim()
    return plain.length > 40 ? `${plain.slice(0, 39)}…` : plain
  }
  return ` → ${node.to.map((link) => (link.label === undefined ? link.node : `${link.node} ${one(link.label)}`)).join(', ')}`
}
