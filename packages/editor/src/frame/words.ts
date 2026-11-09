// A change of format goes to the selected words, not to the spaces at the ends
// of the selection: on Windows a double-click takes the space after a word too
// (found in Edge), and an underline or highlight should not run on under it.
// The selection itself stays as it was, so Delete still takes the space along,
// as Windows people expect.
import type { ChainedCommands, Editor } from '@tiptap/core'
import { TextSelection, type EditorState } from '@tiptap/pm/state'

const SPACE = /\s/u

/** The selection without the spaces at its ends; undefined for a caret, a selection that is only spaces, or one that needs no trimming. */
export function wordSpan(state: EditorState): { from: number; to: number } | undefined {
  const { selection, doc } = state
  if (selection.empty || !(selection instanceof TextSelection)) return undefined
  let from = selection.from
  let to = selection.to
  // One position at a time; a line's end counts as a space, a formula as a word.
  while (from < to && SPACE.test(doc.textBetween(from, from + 1, ' ', '￼') || ' ')) from++
  while (to > from && SPACE.test(doc.textBetween(to - 1, to, ' ', '￼') || ' ')) to--
  if (from >= to || (from === selection.from && to === selection.to)) return undefined
  return { from, to }
}

/** Run a change of format on the selected words without the spaces at the ends, then put the selection back as it was, in one step. */
export function onWords(editor: Editor, change: (chain: ChainedCommands) => ChainedCommands, focus = true): boolean {
  const span = wordSpan(editor.state)
  const start = focus ? editor.chain().focus() : editor.chain()
  if (!span) return change(start).run()
  const { from, to } = editor.state.selection
  return change(start.setTextSelection(span)).setTextSelection({ from, to }).run()
}

/** A mark switched on or off over the selected words, as a word mark's key does. */
export function toggleWords(editor: Editor, mark: string): boolean {
  return onWords(editor, (chain) => chain.toggleMark(mark), false)
}
