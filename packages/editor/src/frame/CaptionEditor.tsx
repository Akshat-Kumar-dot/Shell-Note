// The caption under a picture placed on the page: a line of formatted words in
// its own small editor. Typing reaches core as splices of the picture's
// caption, as typing in a frame does (FrameEditor.tsx), and a change from
// anywhere else, such as undo, is shown in place.
import { fromRuns, sameRuns, spliceFor, toRuns, type Doc, type Id } from '@shellnote/core'
import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useEffect, useRef } from 'react'
import { historyInput } from '../shortcuts.js'
import { isInkTool, type EditorStore } from '../store.js'
import { activeEditor } from './active.js'
import { inlineJSON, runsOf } from './convert.js'
import { captionExtensions, OUTSIDE } from './schema.js'

export function CaptionEditor({ id, store }: { id: Id; store: EditorStore }) {
  const host = useRef<HTMLElement>(null)

  useEffect(() => {
    const origin = `caption:${id}`
    const editor = new Editor({
      element: host.current!,
      // As a frame: not while an ink tool is chosen (FrameEditor.tsx).
      editable: !isInkTool(store.tool),
      extensions: captionExtensions(),
      content: captionJSON(captionOf(store.doc, id)),
      editorProps: {
        attributes: { 'aria-label': 'Caption' },
        handleDOMEvents: { beforeinput: historyInput(store) },
      },
      onFocus: ({ editor }) => {
        activeEditor.set(origin, editor)
        // The picture stays chosen while its caption is typed.
        store.select({ blocks: [id] }, 'objects')
      },
      onBlur: ({ editor }) => activeEditor.blurred(editor),
      onTransaction: ({ editor, transaction }) => {
        if (!transaction.docChanged || transaction.getMeta(OUTSIDE)) return
        const before = captionOf(store.doc, id)
        const typed = fromRuns(runsOf(editor.state.doc))
        // The same words and marks said another way: keep core's form.
        if (sameRuns(toRuns(before), toRuns(typed))) return
        try {
          store.apply([spliceFor(id, 'caption', before, typed)], { origin, key: `type:${id}` })
        } catch (error) {
          console.error('shellnote: a caption edit was refused, so the caption was redrawn', error)
          show(editor, captionOf(store.doc, id))
        }
      },
    })
    const stop = store.subscribe((change) => {
      if (change.origin !== origin && change.changed.has(id)) show(editor, captionOf(change.doc, id))
    })
    const stopTool = store.subscribeTool(() => editor.setEditable(!isInkTool(store.tool), false))
    return () => {
      stopTool()
      stop()
      activeEditor.clear(editor)
      editor.destroy()
    }
  }, [id, store])

  return <figcaption ref={host} className="nw-caption" />
}

function captionOf(doc: Doc, id: Id): string {
  const block = doc.block[id]
  return block?.type === 'image' ? (block.caption ?? '') : ''
}

function captionJSON(md: string): JSONContent {
  const content = inlineJSON(md)
  return { type: 'caption', ...(content.length > 0 ? { content } : {}) }
}

/** Show a caption that changed elsewhere, keeping the caret where it was as far as the words allow. */
function show(editor: Editor, md: string): void {
  if (editor.isDestroyed || sameRuns(toRuns(md), runsOf(editor.state.doc))) return
  const next = editor.schema.nodeFromJSON(captionJSON(md))
  const { from, to } = editor.state.selection
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content).setMeta(OUTSIDE, true).setMeta('addToHistory', false)
  const end = tr.doc.content.size
  tr.setSelection(TextSelection.create(tr.doc, Math.min(from, end), Math.min(to, end)))
  editor.view.dispatch(tr)
}
