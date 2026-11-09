import { newId } from './ids.js'
import { SCHEMA_VERSION, type Doc, type Page } from './schema/doc.js'
import { MARGIN, PAGE_SIZES, type PageSize } from './units.js'

export interface NewDoc {
  title?: string
  /** A4 unless given. A custom size is in units of 0.01 mm. */
  size?: PageSize | { w: number; h: number }
  bg?: Page['bg']
}

/** A new document: one page holding one empty text frame, as wide as the margins. */
export function createDoc(options: NewDoc = {}): Doc {
  const used = new Set<string>()
  const id = (): string => {
    const value = newId((candidate) => used.has(candidate))
    used.add(value)
    return value
  }
  const [docId, pageId, frameId] = [id(), id(), id()]
  const size = typeof options.size === 'object' ? options.size : PAGE_SIZES[options.size ?? 'A4']
  return {
    v: SCHEMA_VERSION,
    id: docId,
    title: options.title ?? 'Untitled',
    rev: 0,
    pages: [pageId],
    page: {
      [pageId]: { id: pageId, w: size.w, h: size.h, bg: options.bg ?? 'blank', free: [frameId] },
    },
    block: {
      // A frame's h is a layout cache: the editor writes it after measuring the text.
      [frameId]: {
        id: frameId,
        r: 0,
        type: 'frame',
        page: pageId,
        x: MARGIN,
        y: MARGIN,
        w: Math.max(0, size.w - 2 * MARGIN),
        h: 0,
        kids: [],
      },
    },
    asset: {},
    rules: [],
  }
}
