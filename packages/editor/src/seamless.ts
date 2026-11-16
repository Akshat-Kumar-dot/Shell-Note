// The seamless view: a note's pages drawn as one sheet with no breaks. The pages are the same as in the pages view
// (a view, never a change): between two pages, the bottom margin of the one above and the top margin of the one below
// are folded away where they hold nothing, so typed lines run on and the page line is never seen. Where something
// lies in a margin, that much of it shows, so nothing is ever hidden. Under the last page there is room to write; what
// is put there goes on a new page (core's settle).
import { bodyOf, isPlacedBlock, marginOf, type Doc, sized } from '@shellnote/core'

/** How much of a page's top and bottom is folded away, in its units. */
export interface Fold {
  top: number
  bottom: number
}

/** How tall a video's mark on a page is taken to be, so a fold never hides one: 6 mm. */
const MARK_HEIGHT = 600

/** The folds of each page, in page order: all of each margin between two pages that holds nothing, none at the ends. */
export function foldsOf(doc: Doc): Fold[] {
  const last = doc.pages.length - 1
  return doc.pages.map((id, i) => {
    const page = sized(doc.page[id]!)
    const margin = marginOf(page)
    let top = i === 0 ? 0 : margin
    let bottom = i === last ? 0 : margin
    const keep = (y: number, h: number): void => {
      top = Math.min(top, Math.max(0, y))
      bottom = Math.min(bottom, Math.max(0, page.h - (y + h)))
    }
    for (const blockId of page.free) {
      const block = doc.block[blockId]
      if (!block || !('page' in block)) continue
      const box = isPlacedBlock(block) ? bodyOf(block) : block
      keep(box.y, box.h)
    }
    for (const clip of doc.clips ?? []) if (clip.page === id) keep(clip.y, MARK_HEIGHT)
    return { top, bottom }
  })
}

/** The room to write in under the last page of the seamless view stands for that page, past its foot: its sheet. */
export function sheetOfSpare(target: Element): HTMLElement | null {
  const spare = target.closest<HTMLElement>('.nw-spare')
  const id = spare?.dataset.for
  if (!spare || id === undefined) return null
  return spare.parentElement?.querySelector<HTMLElement>(`.nw-page[data-page="${CSS.escape(id)}"]`) ?? null
}
