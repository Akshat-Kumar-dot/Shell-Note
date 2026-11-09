// A frame you can type in: one Tiptap editor per frame on screen. Typing goes
// to core as operations (frameOps); a change from anywhere else (undo, the
// toolbar, an AI edit) comes back as the smallest replacement ProseMirror can
// find, so the caret stays where the person is typing. Pictures pasted or
// dropped on the text go into it, and so does a pasted Markdown pipe table.
import { frameOps, idTaken, newId, parsePipeTable, type Doc, type Frame, type Id, type Op } from '@shellnote/core'
import { Editor } from '@tiptap/core'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { CellSelection, isInTable } from '@tiptap/pm/tables'
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform'
import { useLayoutEffect, useRef, useState } from 'react'
import { pictureFiles } from '../assets.js'
import { mm } from '../geometry.js'
import { addPictures, caretIndex } from '../pictures.js'
import { historyInput } from '../shortcuts.js'
import { isInkTool, type EditorStore } from '../store.js'
import { startObjectDrag } from '../objectDrag.js'
import { addTable } from '../tables.js'
import { activeEditor, focusAt, frameEditors } from './active.js'
import { draftsOf, editorOffset, frameJSON, keepForms, selectionOf } from './convert.js'
import { CHOSEN, frameExtensions, LAST_CARET, OUTSIDE } from './schema.js'
import { TableMenu } from './TableMenu.js'

/**
 * One frame's Tiptap editor. React draws only the empty `host`: Tiptap owns everything inside it, made once in the layout
 * effect below. So its callbacks read `store.doc` at the moment they run, never a value from when it was made.
 */
export function FrameEditor({ frame, store }: { frame: Frame; store: EditorStore }) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  // The right-click menu of a table, at the pointer.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // Set up as soon as the frame is drawn, so a frame that text was just pushed into can take the caret before the next key.
  useLayoutEffect(() => {
    const frameId = frame.id
    const editor = new Editor({
      element: host.current!,
      // Not while an ink tool is chosen: text that can be typed in is where an iPad's Scribble takes the pen's strokes.
      editable: !isInkTool(store.tool),
      extensions: frameExtensions({
        takenElsewhere: (id) => {
          const block = store.doc.block[id]
          return block ? !('parent' in block) || block.parent !== frameId : idTaken(store.doc, id)
        },
        newId: (alsoTaken) => newId((id) => idTaken(store.doc, id) || alsoTaken(id)),
        // Read when a picture is drawn, from the store itself: a picture just added has its URL before React has redrawn.
        assetUrl: (hash) => store.assets.url(hash),
        asset: (hash) => store.doc.asset[hash],
        // A table's or a diagram's ⊕: a click chooses it, a drag moves it.
        objectHandle: (id, event) => startObjectDrag(store, id, event),
      }),
      content: frameJSON(store.doc, frameId),
      editorProps: {
        handleDOMEvents: {
          beforeinput: historyInput(store),
          // A right-click in a table opens its menu, as in Word, acting on the cell clicked.
          contextmenu: (view, event) => {
            if (!(event.target as Element).closest('td, th')) return false
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (at && !(view.state.selection instanceof CellSelection)) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))))
            view.focus()
            event.preventDefault()
            setMenu({ x: event.clientX, y: event.clientY })
            return true
          },
        },
        // Pictures pasted at the caret go into the text there. So does a Markdown
        // pipe table, unless the caret is in a table already or the clipboard
        // holds the table as HTML, which the editor reads itself.
        handlePaste: (view, event) => {
          const kids = (store.doc.block[frameId] as Frame).kids.length
          const files = pictureFiles(event.clipboardData)
          if (files.length > 0) {
            void addPictures(store, files, { frame: frameId, at: caretIndex(view.state, kids) })
            return true
          }
          const html = event.clipboardData?.getData('text/html') ?? ''
          const table = isInTable(view.state) || /<table[\s>]/iu.test(html) ? undefined : parsePipeTable(event.clipboardData?.getData('text/plain') ?? '')
          if (!table) return false
          addTable(store, frameId, caretIndex(view.state, kids), table)
          return true
        },
        // Pictures dropped on the text go in where they were dropped: before the block they land at the start of, else after it.
        handleDrop: (view, event, _slice, moved) => {
          const files = moved ? [] : pictureFiles(event.dataTransfer)
          if (files.length === 0) return false
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const kids = (store.doc.block[frameId] as Frame).kids.length
          let at = kids
          if (pos) {
            const $pos = view.state.doc.resolve(pos.pos)
            at = Math.min(kids, $pos.depth === 0 || $pos.parentOffset === 0 ? $pos.index(0) : $pos.index(0) + 1)
          }
          void addPictures(store, files, { frame: frameId, at })
          return true
        },
      },
      onFocus: ({ editor }) => {
        if (store.focusRequest?.frame === frameId) store.focusRequest = undefined
        activeEditor.set(frameId, editor)
        store.select(selectionOf(editor.state, store.doc))
      },
      onBlur: ({ editor }) => activeEditor.blurred(editor),
      onSelectionUpdate: ({ editor }) => {
        if (editor.isFocused) store.select(selectionOf(editor.state, store.doc))
      },
      onTransaction: ({ editor, transaction }) => {
        if (!transaction.docChanged || transaction.getMeta(OUTSIDE)) return
        const ops = frameOps(store.doc, frameId, keepForms(draftsOf(editor.state.doc), store.doc))
        if (ops.length === 0) return
        try {
          store.apply(ops, { origin: frameId, ...typingKey(ops, transaction) })
        } catch (error) {
          // The edit did not fit the document: show the note as core has it, rather than drift apart.
          console.error('shellnote: an edit was refused, so the frame was redrawn', error)
        }
        // Show what core now holds where the editor held more than core keeps,
        // such as merged cells in a pasted table. Nothing changes otherwise.
        patch(editor, store.doc, frameId)
      },
    })

    const editorIds = (): Set<string> => {
      const ids = new Set<string>()
      editor.state.doc.forEach((node) => {
        if (typeof node.attrs.id === 'string') ids.add(node.attrs.id)
      })
      return ids
    }
    const stop = store.subscribe((change) => {
      if (change.origin === frameId) return
      const frameNow = change.doc.block[frameId] as Frame | undefined
      if (!frameNow) return
      const touched = change.changed.has(frameId) || frameNow.kids.some((id) => change.changed.has(id)) || [...editorIds()].some((id) => change.changed.has(id))
      if (touched) patch(editor, change.doc, frameId)
    })
    // Mark this frame's blocks while they are chosen as objects, and the words of its blocks a Select box holds.
    const showChosen = (): void => {
      const objects = store.selectionKind === 'objects'
      const inFrame = (id: Id): boolean => (store.doc.block[id] as { parent?: Id } | undefined)?.parent === frameId
      const blocks = objects ? store.selection.blocks.filter(inFrame) : []
      const words: [number, number][] = []
      for (const piece of objects ? (store.selection.words ?? []) : []) {
        if (!inFrame(piece.block)) continue
        editor.state.doc.forEach((node, pos) => {
          if (node.attrs.id === piece.block && node.type.name === 'textBlock') words.push([pos + 1 + editorOffset(node, piece.start), pos + 1 + editorOffset(node, piece.end)])
        })
      }
      const now = CHOSEN.getState(editor.state)
      if (now && now.blocks.size === blocks.length && blocks.every((id) => now.blocks.has(id)) && JSON.stringify(now.words) === JSON.stringify(words)) return
      editor.view.dispatch(editor.state.tr.setMeta(CHOSEN, { blocks: new Set(blocks), words }).setMeta(OUTSIDE, true).setMeta('addToHistory', false))
    }
    const stopChosen = store.subscribeSelection(showChosen)
    showChosen()
    // Where the caret last was, or the words selected, in grey while no text has
    // the focus: when nothing is chosen (target.ts), or while a control of the
    // toolbar has the focus, such as More colours, as Word keeps a selection in view.
    const showLastCaret = (): void => {
      if (editor.isDestroyed) return
      const nothing = store.selectionKind === 'objects' && store.selection.blocks.length === 0 && (store.selection.words?.length ?? 0) === 0
      const show = (nothing || store.selectionKind === 'text') && activeEditor.get() === editor && !editor.isFocused
      if ((LAST_CARET.getState(editor.state) ?? false) === show) return
      editor.view.dispatch(editor.state.tr.setMeta(LAST_CARET, show).setMeta(OUTSIDE, true).setMeta('addToHistory', false))
    }
    const stopCaretBySelection = store.subscribeSelection(showLastCaret)
    const stopCaretByEditor = activeEditor.subscribe(showLastCaret)
    frameEditors.set(frameId, editor)
    editorRef.current = editor
    // A frame just made by typing on bare paper, or one that text with the
    // caret was pushed into, carries on where the typing was. The request is
    // cleared only once the focus has arrived (onFocus), since React may set
    // an editor up twice and drop the first.
    const request = store.focusRequest
    if (request?.frame === frameId) focusAt(editor, request.block, request.offset)
    const stopTool = store.subscribeTool(() => editor.setEditable(!isInkTool(store.tool), false))
    return () => {
      stopTool()
      stop()
      stopChosen()
      stopCaretBySelection()
      stopCaretByEditor()
      // Taken down while typed in, as React may do to set it up again: the next editor of this frame takes the caret.
      const head = editor.state.selection.$head
      if (editor.isFocused && store.doc.block[frameId]) {
        store.focusRequest = head.depth > 0 ? { frame: frameId, block: head.node(1).attrs.id as Id, offset: head.depth === 1 ? head.parentOffset : 0 } : { frame: frameId }
      }
      if (frameEditors.get(frameId) === editor) frameEditors.delete(frameId)
      if (editorRef.current === editor) editorRef.current = null
      activeEditor.clear(editor)
      editor.destroy()
    }
  }, [frame.id, store])

  return (
    <>
      <div ref={host} className="nw-frame nw-free" data-id={frame.id} style={{ left: mm(frame.x), top: mm(frame.y), width: mm(frame.w) }} />
      {menu && editorRef.current ? <TableMenu editor={editorRef.current} store={store} x={menu.x} y={menu.y} onClose={() => setMenu(null)} /> : null}
    </>
  )
}

/**
 * Typing in one block merges into one undo step, including the keystroke that
 * made the block (a first letter in an empty frame, or Enter at the end of a
 * line). Anything else is a step of its own, such as a mark put on or taken
 * off by its key (Ctrl+B, Ctrl+U), though it changes the block's text the way
 * typing does.
 */
function typingKey(ops: readonly Op[], transaction: Transaction): { key?: string } {
  if (transaction.steps.some((step) => step instanceof AddMarkStep || step instanceof RemoveMarkStep)) return {}
  const only = ops.length === 1 ? ops[0] : undefined
  if (only?.op === 'splice') return { key: `type:${only.id}` }
  if (only?.op === 'add' && only.block.type === 'text') return { key: `type:${only.block.id}` }
  // Typing in a table's cell changes its rows.
  if (only?.op === 'update' && Object.keys(only.set).join() === 'rows') return { key: `type:${only.id}` }
  return {}
}

/**
 * Bring the editor up to date with core by replacing only the part that
 * differs, so the caret, and anything typed elsewhere in the frame, stays.
 */
export function patch(editor: Editor, doc: Doc, frameId: Id): void {
  const frame = doc.block[frameId] as Frame
  const current = editor.state.doc
  // An empty frame and an editor showing only its empty paragraph already agree.
  if (frame.kids.length === 0 && current.childCount === 1 && current.firstChild?.type.name === 'textBlock' && current.firstChild.content.size === 0) return
  const next = editor.schema.nodeFromJSON(frameJSON(doc, frameId))
  const start = current.content.findDiffStart(next.content)
  if (start === null) return
  let { a: endA, b: endB } = current.content.findDiffEnd(next.content)!
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  const { from, to } = editor.state.selection
  const keep = editor.state.selection instanceof TextSelection && current.content.size === next.content.size
  const tr = editor.state.tr.replace(start, endA, next.slice(start, endB)).setMeta(OUTSIDE, true).setMeta('addToHistory', false)
  // A change of style or marks leaves every position where it was: keep the selection exactly, so the toolbar can be used again.
  if (keep) tr.setSelection(TextSelection.create(tr.doc, from, to))
  editor.view.dispatch(tr)
}
