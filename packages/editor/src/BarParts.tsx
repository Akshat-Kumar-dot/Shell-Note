// What both of the note's rows of tools hold: undo and redo, and a picture from the person's files.
import { Image, Redo2, Undo2 } from 'lucide-react'
import { useRef, useSyncExternalStore, type ReactNode } from 'react'
import { PICTURE_TYPES } from './assets.js'
import { keepFocus } from './BarMenu.js'
import { commands } from './commands/index.js'
import { REDO_KEY, UNDO_KEY } from './keys.js'
import { addPictures, pictureSpot, type PictureSpot } from './pictures.js'
import type { EditorStore } from './store.js'

const ICON = 18

/** Undo, in both rows. */
export function UndoButton({ store }: { store: EditorStore }) {
  useSyncExternalStore(store.subscribe, store.snapshot)
  return (
    <button type="button" className="sh-b" aria-label="Undo" title={`Undo (${UNDO_KEY})`} disabled={!store.canUndo} data-command="edit.undo" onMouseDown={keepFocus} onClick={() => void commands.do('edit.undo')}>
      <Undo2 size={ICON} aria-hidden />
    </button>
  )
}

/** Redo, in both rows. */
export function RedoButton({ store }: { store: EditorStore }) {
  useSyncExternalStore(store.subscribe, store.snapshot)
  return (
    <button type="button" className="sh-b" aria-label="Redo" title={`Redo (${REDO_KEY})`} disabled={!store.canRedo} data-command="edit.redo" onMouseDown={keepFocus} onClick={() => void commands.do('edit.redo')}>
      <Redo2 size={ICON} aria-hidden />
    </button>
  )
}

/** Undo and redo, side by side. */
export function UndoRedo({ store }: { store: EditorStore }) {
  return (
    <>
      <UndoButton store={store} />
      <RedoButton store={store} />
    </>
  )
}

/**
 * The person's files, opened for pictures: the chooser's hidden input, and the way to open it, from a button or from
 * a menu. What is chosen goes in at the caret, or on the page.
 */
export function usePictures(store: EditorStore): { choose: () => void; input: ReactNode } {
  const files = useRef<HTMLInputElement>(null)
  const spot = useRef<PictureSpot | undefined>(undefined)
  const choose = (): void => {
    spot.current = pictureSpot(store)
    files.current?.click()
  }
  const input = (
    <input
      ref={files}
      type="file"
      accept={PICTURE_TYPES.join(',')}
      multiple
      hidden
      onChange={(event) => {
        const picked = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (spot.current) void addPictures(store, picked, spot.current)
      }}
    />
  )
  return { choose, input }
}

/** A picture from the person's files: at the caret, or on the page. In both rows. */
export function PictureButton({ store }: { store: EditorStore }) {
  const pictures = usePictures(store)
  return (
    <>
      <button type="button" className="sh-b" aria-label="Picture" title="Add a picture: at the caret, or on the page" onMouseDown={keepFocus} onClick={pictures.choose}>
        <Image size={ICON} aria-hidden />
      </button>
      {pictures.input}
    </>
  )
}
