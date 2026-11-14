// What both of the note's rows of tools hold: undo and redo, and a picture from the person's files.
import { Image, Redo2, Undo2 } from 'lucide-react'
import { useRef, useSyncExternalStore } from 'react'
import { PICTURE_TYPES } from './assets.js'
import { keepFocus } from './BarMenu.js'
import { commands } from './commands/index.js'
import { addPictures, pictureSpot, type PictureSpot } from './pictures.js'
import type { EditorStore } from './store.js'

const ICON = 18

/** Undo and redo, in both rows. */
export function UndoRedo({ store }: { store: EditorStore }) {
  useSyncExternalStore(store.subscribe, store.snapshot)
  return (
    <>
      <button type="button" className="sh-b" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!store.canUndo} data-command="edit.undo" onMouseDown={keepFocus} onClick={() => void commands.do('edit.undo')}>
        <Undo2 size={ICON} aria-hidden />
      </button>
      <button type="button" className="sh-b" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!store.canRedo} data-command="edit.redo" onMouseDown={keepFocus} onClick={() => void commands.do('edit.redo')}>
        <Redo2 size={ICON} aria-hidden />
      </button>
    </>
  )
}

/** A picture from the person's files: at the caret, or on the page. In both rows. */
export function PictureButton({ store }: { store: EditorStore }) {
  const files = useRef<HTMLInputElement>(null)
  const spot = useRef<PictureSpot | undefined>(undefined)
  return (
    <>
      <button
        type="button"
        className="sh-b"
        aria-label="Picture"
        title="Add a picture: at the caret, or on the page"
        onMouseDown={keepFocus}
        onClick={() => {
          spot.current = pictureSpot(store)
          files.current?.click()
        }}
      >
        <Image size={ICON} aria-hidden />
      </button>
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
    </>
  )
}
