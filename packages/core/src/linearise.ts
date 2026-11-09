// Reading order. It is derived, never stored: free blocks
// and frames sort top to bottom, then left to right, and a frame's children
// follow its `kids`. One function produces it, and it feeds the Markdown,
// text and Word exports, the AI outline, and later the phone reading view.
import type { Block, Doc, FreeBlock, Id } from './schema/doc.js'

export interface Item {
  /** The page the block is on. */
  page: Id
  block: Block
  /** 0 for frames and free blocks, 1 for a frame's children. */
  depth: 0 | 1
}

/** Every block in reading order, page by page; or only those of one page. */
export function linearise(doc: Doc, options: { page?: Id } = {}): Item[] {
  const items: Item[] = []
  for (const pageId of options.page === undefined ? doc.pages : [options.page]) {
    const page = doc.page[pageId]
    if (!page) continue
    const placed = page.free
      .map((id, stack) => ({ block: doc.block[id] as FreeBlock | undefined, stack }))
      .filter((entry): entry is { block: FreeBlock; stack: number } => entry.block !== undefined)
      // Top to bottom, then left to right. Blocks at the same spot keep their stacking order.
      .sort((a, b) => a.block.y - b.block.y || a.block.x - b.block.x || a.stack - b.stack)
    for (const { block } of placed) {
      items.push({ page: pageId, block, depth: 0 })
      if (block.type !== 'frame') continue
      for (const id of block.kids) {
        const kid = doc.block[id]
        if (kid) items.push({ page: pageId, block: kid, depth: 1 })
      }
    }
  }
  return items
}
