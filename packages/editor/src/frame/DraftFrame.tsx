// A frame that does not exist yet. A click on bare paper puts a caret there,
// and the frame is made with the first letter typed, so a click that types
// nothing leaves nothing behind. The frame and its first words are one undo
// step. Then the frame's own editor (FrameEditor.tsx) takes the focus, with
// the caret at the end; until it has, this editor stays, unseen, and hands on
// whatever is typed, so no keystroke is lost on the way.
import { apply, frameOps, idTaken, newId, type Block, type Id, type Op } from '@shellnote/core'
import { Editor } from '@tiptap/core'
import { useLayoutEffect, useRef, useState } from 'react'
import { pictureFiles } from '../assets.js'
import { mm } from '../geometry.js'
import { addPictures } from '../pictures.js'
import { historyInput } from '../shortcuts.js'
import type { EditorStore } from '../store.js'
import { draftsOf, keepForms } from './convert.js'
import { frameExtensions } from './schema.js'

/** Where the frame will be: its page, its top-left corner and its width, in document units. */
export interface DraftSpot {
  page: Id
  x: number
  y: number
  w: number
}

export function DraftFrame({ store, spot, onDone }: { store: EditorStore; spot: DraftSpot; onDone: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  // Made: the frame exists, and its own editor shows the words.
  const [made, setMade] = useState(false)

  // Set up before the page is painted, and focused at once, so a letter typed straight after the click is not lost.
  useLayoutEffect(() => {
    const frameId = newId((id) => idTaken(store.doc, id))
    let exists = false
    const editor = new Editor({
      element: host.current!,
      extensions: frameExtensions({
        // As in FrameEditor: once the frame exists, its blocks are this editor's own.
        takenElsewhere: (id) => {
          if (id === frameId) return true
          const block = store.doc.block[id]
          return block ? !('parent' in block) || block.parent !== frameId : idTaken(store.doc, id)
        },
        newId: (alsoTaken) => newId((id) => id === frameId || idTaken(store.doc, id) || alsoTaken(id)),
        assetUrl: (hash) => store.assets.url(hash),
        asset: (hash) => store.doc.asset[hash],
      }),
      content: { type: 'doc', content: [{ type: 'textBlock' }] },
      editorProps: {
        handleDOMEvents: { beforeinput: historyInput(store) },
        // Pictures pasted before anything is typed go on the page, where the click was.
        handlePaste: (_view, event) => {
          const files = exists ? [] : pictureFiles(event.clipboardData)
          if (files.length === 0) return false
          void addPictures(store, files, { page: spot.page, x: spot.x, y: spot.y })
          done.current()
          return true
        },
      },
      // Gone when the focus leaves: to the frame's own editor once it exists, or anywhere before anything was typed.
      onBlur: ({ editor }) => {
        if (exists || draftsOf(editor.state.doc).length === 0) done.current()
      },
      onTransaction: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        const drafts = draftsOf(editor.state.doc)
        const first = drafts[0]
        const key = first?.type === 'text' ? { key: `type:${first.id}` } : {}
        try {
          if (exists) {
            // Typed before the frame's own editor took the focus: hand it on.
            store.apply(frameOps(store.doc, frameId, keepForms(drafts, store.doc)), { origin: 'draft', ...key })
          } else if (drafts.length > 0) {
            const add: Op = { op: 'add', block: { id: frameId, r: 0, type: 'frame', page: spot.page, x: spot.x, y: spot.y, w: spot.w, h: 0, kids: [] } as Block }
            const ops = [add, ...frameOps(apply(store.doc, [add]).doc, frameId, drafts)]
            store.focusRequest = { frame: frameId }
            store.apply(ops, { origin: 'draft', ...key })
            exists = true
            setMade(true)
          }
        } catch (error) {
          store.focusRequest = undefined
          console.error('shellnote: the new frame was not made', error)
          done.current()
        }
      },
    })
    editor.view.focus()
    return () => editor.destroy()
  }, [store, spot.page, spot.x, spot.y, spot.w])

  return <div ref={host} className="nw-frame nw-free nw-draft" data-made={made ? '' : undefined} style={{ left: mm(spot.x), top: mm(spot.y), width: mm(spot.w) }} />
}
