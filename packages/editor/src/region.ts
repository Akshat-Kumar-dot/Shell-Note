// What a Select box holds: only what is
// inside it. A letter counts when its middle is inside the box, as in Word's
// box selection, so a box over part of a long word holds just the letters
// under it, and a box around whole words holds them whole. An inline formula
// counts as one letter. A text block whose letters are all inside counts
// whole; any other block counts when its centre is inside, or 30% of it is.
// The box itself is `here`.
import { parseInline, plainText, type Doc, type Here, type Id, type Selection, type WordRange } from '@shellnote/core'
import type { Editor } from '@tiptap/core'
import { frameEditors } from './frame/active.js'
import { coreOffset } from './frame/convert.js'
import type { ScreenRect } from './selection.js'

const inside = (box: ScreenRect, x: number, y: number): boolean => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
const middleInside = (box: ScreenRect, drawn: DOMRect): boolean => inside(box, (drawn.left + drawn.right) / 2, (drawn.top + drawn.bottom) / 2)
const touches = (box: ScreenRect, drawn: DOMRect): boolean => drawn.right > box.left && drawn.left < box.right && drawn.bottom > box.top && drawn.top < box.bottom
const within = (box: ScreenRect, drawn: DOMRect): boolean => drawn.left >= box.left && drawn.right <= box.right && drawn.top >= box.top && drawn.bottom <= box.bottom

/** A block counts as held when its centre is inside the box, or 30% of its area is. */
function holds(box: ScreenRect, drawn: DOMRect): boolean {
  if (middleInside(box, drawn)) return true
  const across = Math.max(0, Math.min(box.right, drawn.right) - Math.max(box.left, drawn.left))
  const down = Math.max(0, Math.min(box.bottom, drawn.bottom) - Math.max(box.top, drawn.top))
  return drawn.width * drawn.height > 0 && (across * down) / (drawn.width * drawn.height) >= 0.3
}

/** The letters of one text block whose middles are inside the box, as pieces in reading order, in core's plain-text positions. */
function textInside(editor: Editor, id: Id, element: Element, text: string, box: ScreenRect): WordRange[] {
  const view = editor.view
  let blockPos = -1
  editor.state.doc.forEach((node, pos) => {
    if (node.attrs.id === id) blockPos = pos
  })
  const block = blockPos < 0 ? null : editor.state.doc.nodeAt(blockPos)
  if (!block) return []
  const core = (dom: Node, offset: number): number => coreOffset(block, view.posAtDOM(dom, offset) - blockPos - 1)
  const hits: { start: number; end: number }[] = []
  // The text, word by word; a formula's own text is left to the formula, below.
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('.nw-math-inline') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const range = element.ownerDocument.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of (node.textContent ?? '').matchAll(/\S+/gu)) {
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      // A word on two lines is drawn as two boxes.
      const drawn = [...range.getClientRects()]
      if (!drawn.some((part) => touches(box, part))) continue
      if (drawn.every((part) => within(box, part))) {
        hits.push({ start: core(node, match.index), end: core(node, match.index + match[0].length) })
        continue
      }
      // A word the box cuts: the letters whose middles are inside it.
      let at = match.index
      for (const letter of match[0]) {
        range.setStart(node, at)
        range.setEnd(node, at + letter.length)
        if (middleInside(box, range.getBoundingClientRect())) hits.push({ start: core(node, at), end: core(node, at + letter.length) })
        at += letter.length
      }
    }
  }
  // An inline formula counts as one letter.
  for (const formula of element.querySelectorAll('.nw-math-inline')) {
    if (!middleInside(box, formula.getBoundingClientRect())) continue
    const at = view.posAtDOM(formula, 0) - blockPos - 1
    hits.push({ start: coreOffset(block, at), end: coreOffset(block, at + 1) })
  }
  // Letters side by side, or with only spaces between them, make one piece.
  hits.sort((a, b) => a.start - b.start)
  const pieces: WordRange[] = []
  for (const hit of hits) {
    const last = pieces.at(-1)
    if (last && text.slice(last.end, hit.start).trim() === '') last.end = Math.max(last.end, hit.end)
    else pieces.push({ block: id, start: hit.start, end: hit.end })
  }
  return pieces
}

/** What a box drawn on one page holds: pieces of text, whole blocks, and the box itself as `here`. */
export function regionChoice(doc: Doc, pageId: Id, sheet: Element, box: ScreenRect, here: Extract<Here, { page: Id }>): Selection {
  const page = doc.page[pageId]
  const blocks: Id[] = []
  const words: WordRange[] = []
  const drawn = (id: Id): Element | null => sheet.querySelector(`[data-id="${CSS.escape(id)}"]`)
  for (const id of page?.free ?? []) {
    const block = doc.block[id]
    if (!block) continue
    if (block.type !== 'frame') {
      const element = drawn(id)
      if (element && holds(box, element.getBoundingClientRect())) blocks.push(id)
      continue
    }
    const editor = frameEditors.get(id)
    for (const kid of block.kids) {
      const child = doc.block[kid]
      const element = drawn(kid)
      if (!child || !element) continue
      if (child.type !== 'text') {
        if (holds(box, element.getBoundingClientRect())) blocks.push(kid)
        continue
      }
      if (!editor) continue
      const text = plainText(parseInline(child.md))
      const pieces = textInside(editor, kid, element, text, box)
      // Every letter inside: the block itself is held.
      const whole = pieces.length === 1 && text.slice(0, pieces[0]!.start).trim() === '' && text.slice(pieces[0]!.end).trim() === ''
      if (whole) blocks.push(kid)
      else words.push(...pieces)
    }
  }
  return { blocks, ...(words.length > 0 ? { words } : {}), here }
}
