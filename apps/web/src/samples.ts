// Sample notes, for development and the end-to-end tests: ?sample=… in the
// address opens one of core's sample notes. A sample is not kept in the
// browser, so it never takes the place of the note being worked on.
import { apply, createDoc, MARGIN, parseDoc, type Block, type Doc, type Op } from '@shellnote/core'
import mixed from '../../../packages/core/test/fixtures/mixed.json' with { type: 'json' }
import physics from '../../../packages/core/test/fixtures/physics.json' with { type: 'json' }

/** The sample the address asks for, or undefined. */
export function sampleDoc(search: string): Doc | undefined {
  switch (new URLSearchParams(search).get('sample')) {
    case 'mixed':
      return parseDoc(mixed)
    case 'physics':
      return parseDoc(physics)
    case 'long':
      return manyPages(30)
    default:
      return undefined
  }
}

/** A note of many pages, each with a heading, built through core's operations. */
function manyPages(count: number): Doc {
  let doc = createDoc({ title: `${count} pages` })
  const first = doc.pages[0]!
  const { w, h } = doc.page[first]!
  const heading = (id: string, parent: string, n: number): Op => ({
    op: 'add',
    block: { id, r: 0, type: 'text', parent, role: 'h1', indent: 0, md: `Page ${n}` } as Block,
    at: 0,
  })
  const ops: Op[] = [heading('t1', doc.page[first]!.free[0]!, 1)]
  for (let n = 2; n <= count; n++) {
    ops.push(
      { op: 'page', add: { id: `p${n}`, w, h, bg: 'blank', free: [] } },
      { op: 'add', block: { id: `f${n}`, r: 0, type: 'frame', page: `p${n}`, x: MARGIN, y: MARGIN, w: w - 2 * MARGIN, h: 0, kids: [] } as Block },
      heading(`t${n}`, `f${n}`, n),
    )
  }
  doc = apply(doc, ops).doc
  return doc
}
