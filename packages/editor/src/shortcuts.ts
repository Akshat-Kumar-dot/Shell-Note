// Keyboard shortcuts that belong to the whole note rather than one frame.
import { useEffect } from 'react'
import type { EditorStore } from './store.js'

/**
 * Ctrl+Z undoes and Ctrl+Y or Ctrl+Shift+Z redoes (⌘ on a Mac), through
 * core's history, wherever the focus is. The browser's own undo is stopped, so
 * typing, the toolbar and later AI edits share one history.
 * A form field, such as a link address being typed, keeps its own undo.
 */
export function useUndoKeys(store: EditorStore, enabled = true): void {
  useEffect(() => {
    // A note shown read-only, as while another tab edits it, is not changed by these keys.
    if (!enabled) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        store.undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        store.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, enabled])
}

/**
 * For an editor's beforeinput: undo from the browser's Edit menu or a touch
 * gesture goes to core's history, never the browser's.
 */
export function historyInput(store: EditorStore): (view: unknown, event: Event) => boolean {
  return (_view, event) => {
    const type = (event as InputEvent).inputType
    if (type !== 'historyUndo' && type !== 'historyRedo') return false
    event.preventDefault()
    if (type === 'historyUndo') store.undo()
    else store.redo()
    return true
  }
}
