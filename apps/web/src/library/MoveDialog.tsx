// Moving a note or a folder: every folder in the library as a tree, the top
// level first. A folder cannot go into itself or one of its own folders, so
// those are shown greyed out with the reason.
import { CornerDownRight, Folder, LibraryBig } from 'lucide-react'
import { useState } from 'react'
import { Dialog } from './Dialog.js'
import type { ItemRef, Library } from './store.js'
import { canMove, contents, sorted } from './tree.js'

interface Place {
  id: string | null
  name: string
  depth: number
}

/** The folders in sight, as a tree in reading order, with their depth. */
function places(library: Library): Place[] {
  const out: Place[] = [{ id: null, name: 'Notes (top level)', depth: 0 }]
  const walk = (parent: string | null, depth: number): void => {
    for (const folder of sorted(contents(library, parent).folders, 'created', 'oldest')) {
      out.push({ id: folder.id, name: folder.name, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}

export function MoveDialog({ library, item, name, from, onMove, onClose }: { library: Library; item: ItemRef; name: string; from: string | null; onMove: (to: string | null) => void; onClose: () => void }) {
  const all = places(library)
  const [choice, setChoice] = useState<string | null | undefined>(undefined)
  return (
    <Dialog
      title={`Move “${name}”`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={choice === undefined || choice === from} data-command={item.kind === 'note' ? 'note.move' : 'folder.move'} onClick={() => choice !== undefined && onMove(choice)}>
            Move here
          </button>
        </>
      }
    >
      <div className="move-list" role="radiogroup" aria-label="Folders">
        {all.map((place) => {
          const allowed = canMove(library, item, place.id)
          const here = place.id === from
          return (
            <button
              key={place.id ?? 'top'}
              type="button"
              role="radio"
              aria-checked={choice === place.id}
              className="move-place"
              disabled={!allowed}
              style={{ paddingLeft: 12 + place.depth * 18 }}
              title={allowed ? undefined : 'A folder cannot go into itself or into one of its own folders.'}
              onClick={() => setChoice(place.id)}
              onDoubleClick={() => allowed && !here && onMove(place.id)}
            >
              {place.depth > 1 ? <CornerDownRight size={14} aria-hidden className="move-indent" /> : null}
              {place.id === null ? <LibraryBig size={18} aria-hidden /> : <Folder size={18} aria-hidden />}
              <span>{place.name}</span>
              {here ? <span className="move-note">here now</span> : null}
              {!allowed ? <span className="move-note">not inside itself</span> : null}
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}
