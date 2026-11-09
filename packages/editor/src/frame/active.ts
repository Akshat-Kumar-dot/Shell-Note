// The editor last typed in, for the toolbar: with only a caret, Bold switches
// bold on for the next words typed there, as in any word processor. It is a
// frame's editor, or the caption editor of a picture placed on the page. The
// toolbar listens, since some buttons work only while an editor has the focus.
import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'

/** Whose editor it is: a frame's id, or `caption:` and a picture's id. */
let active: { owner: string; editor: Editor } | undefined
let version = 0
const listeners = new Set<() => void>()

function changed(): void {
  version++
  for (const listener of [...listeners]) listener()
}

export const activeEditor = {
  get: (): Editor | undefined => (active?.editor.isDestroyed ? undefined : active?.editor),
  /** The frame the active editor belongs to; undefined for a caption's editor. */
  frame: (): string | undefined => (active === undefined || active.editor.isDestroyed || active.owner.startsWith('caption:') ? undefined : active.owner),
  /** Called when an editor gets the focus. */
  set: (owner: string, editor: Editor): void => {
    active = { owner, editor }
    changed()
  },
  /** Called when an editor loses the focus. */
  blurred: (editor: Editor): void => {
    if (active?.editor === editor) changed()
  },
  clear: (editor: Editor): void => {
    if (active?.editor !== editor) return
    active = undefined
    changed()
  },
  /** Listen for the focus moving between editors, for React's useSyncExternalStore. */
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  snapshot: (): number => version,
}

/** Words typed outside a text block: a picture's caption, in a frame or under a picture on the page, and a table's cells and caption. */
const WORD_HOLDERS = new Set(['imageBlock', 'caption', 'tableCell', 'tableHeader', 'tableCaption'])

/** True when the caret or selection is in a caption or a table cell, where the toolbar's word marks act through the editor. */
export function inWords(editor: Editor): boolean {
  return WORD_HOLDERS.has(editor.state.selection.$from.parent.type.name)
}

/** Every frame's editor on screen, by frame id, so text pushed onto the next page can take the caret along. */
export const frameEditors = new Map<string, Editor>()

/**
 * Focus an editor with the caret in a block at an offset, or at the end when
 * the block is not in it. At once, not on the next frame as Tiptap's focus
 * does, so the next key typed lands here.
 */
export function focusAt(editor: Editor, block?: string, offset = 0): void {
  const { doc } = editor.state
  let at: number | undefined
  doc.forEach((node, pos) => {
    if (block !== undefined && node.attrs.id === block) at = pos + 1 + (node.isTextblock ? Math.min(offset, node.content.size) : 0)
  })
  const selection = at === undefined ? Selection.atEnd(doc) : Selection.near(doc.resolve(at))
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView())
  editor.view.focus()
}
