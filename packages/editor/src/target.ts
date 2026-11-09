// Where a change from the toolbar goes, as Word decides it, so the toolbar is
// never locked:
//
// 1. what is selected: words dragged over, the pieces a Select box holds, or
//    blocks chosen whole as objects;
// 2. else the caret: inside a word, the whole word; between words, the words
//    typed next;
// 3. else where the caret last was, which the frame shows as a grey caret.
//
// A change to blocks (a heading, alignment, indent) goes to the blocks those
// words are in, or the caret's block.
import { type Doc, type Id, type Selection, type WordRange } from '@shellnote/core'
import type { Editor } from '@tiptap/core'
import { activeEditor, frameEditors, inWords } from './frame/active.js'
import { coreOffset, selectionOf } from './frame/convert.js'
import { chosenPieces, trimRange } from './format.js'
import type { EditorStore } from './store.js'

export interface Aim {
  /** The words a change to words goes to, through core. */
  pieces: WordRange[]
  /** The text blocks a change to blocks goes to. */
  blocks: Id[]
  /**
   * When a change to words goes through the editor itself instead: the caret
   * between words (the words typed next), a caption or a table's cell, or a
   * selection across several lines, which the editor marks exactly.
   */
  editor?: Editor
}

/** Letters, digits and the joins inside words, as a word processor counts a word. */
const WORD = /[\p{L}\p{N}\p{M}_'’]/u

const textBlocks = (doc: Doc, ids: readonly Id[]): Id[] => [...new Set(ids)].filter((id) => doc.block[id]?.type === 'text')

/** Where a change would go now. It reads the editors; it moves no caret. */
export function aimAt(store: EditorStore): Aim {
  const { doc, selection } = store
  const active = activeEditor.get()
  // Typing now, in a frame, a caption or a cell: there, even while the picture whose caption it is stays chosen.
  if (active?.isFocused) return fromEditor(doc, active, store.selectionKind === 'text' ? selection : selectionOf(active.state, doc))
  if (store.selectionKind === 'objects') {
    const pieces = chosenPieces(doc, selection)
    if (pieces.length > 0 || selection.blocks.length > 0) return { pieces, blocks: textBlocks(doc, [...selection.blocks, ...pieces.map((piece) => piece.block)]) }
  }
  // Else where the caret was last, as its editor left it.
  const editor = active ?? firstFrameEditor(store)
  return editor ? fromEditor(doc, editor, selectionOf(editor.state, doc)) : { pieces: [], blocks: [] }
}

function fromEditor(doc: Doc, editor: Editor, selection: Selection): Aim {
  const blocks = textBlocks(doc, selection.blocks)
  if (inWords(editor)) return { pieces: [], blocks, editor }
  const range = selection.range
  if (range && range.start < range.end) return { pieces: [trimRange(doc, range)], blocks }
  if (!editor.state.selection.empty) return { pieces: [], blocks, editor }
  const word = wordAtCaret(editor, doc)
  return word ? { pieces: [word], blocks } : { pieces: [], blocks, editor }
}

/** The word the caret is inside, as a piece of text; none at a word's edge or between words. */
export function wordAtCaret(editor: Editor, doc: Doc): WordRange | undefined {
  const { selection } = editor.state
  if (!selection.empty) return undefined
  const { $head } = selection
  const parent = $head.parent
  const id = parent.attrs.id as string | null
  if (parent.type.name !== 'textBlock' || !id || doc.block[id]?.type !== 'text') return undefined
  // One character per position: a formula is one position, never part of a word.
  const text = parent.textBetween(0, parent.content.size, undefined, '￼')
  const at = $head.parentOffset
  if (!WORD.test(text[at - 1] ?? '') || !WORD.test(text[at] ?? '')) return undefined
  let start = at
  while (start > 0 && WORD.test(text[start - 1]!)) start--
  let end = at
  while (end < text.length && WORD.test(text[end]!)) end++
  return { block: id, start: coreOffset(parent, start), end: coreOffset(parent, end) }
}

/** Before anything was typed in: the first frame of the page in view, or of the note. */
function firstFrameEditor(store: EditorStore): Editor | undefined {
  const { doc } = store
  const pages = store.pageInView !== undefined && doc.page[store.pageInView] ? [store.pageInView, ...doc.pages] : doc.pages
  for (const page of pages) {
    for (const id of doc.page[page]?.free ?? []) {
      const editor = doc.block[id]?.type === 'frame' ? frameEditors.get(id) : undefined
      if (editor && !editor.isDestroyed) return editor
    }
  }
  return undefined
}
