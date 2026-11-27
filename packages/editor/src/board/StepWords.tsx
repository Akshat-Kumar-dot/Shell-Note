// A step's words typed in place: a line of formatted words in its own small editor over the step, as a picture's
// caption is typed (frame/CaptionEditor.tsx). Each change reaches core as a splice of the step's words, and the step is
// made the size its new words need in its shape (core's fitOps, from nodeSize: nothing is measured here), in the same
// undo step as the typing; a change from anywhere else, such as undo, is shown in place. Enter or Escape ends, and so
// does a press anywhere else; the step stays chosen.
import { fitOps, fromRuns, sameRuns, spliceFor, toRuns, wordsArea, type Doc, type Id, type NodeBlock } from '@shellnote/core'
import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useLayoutEffect, useRef } from 'react'
import { activeEditor, focusAt } from '../frame/active.js'
import { inlineJSON, runsOf } from '../frame/convert.js'
import { captionExtensions, OUTSIDE } from '../frame/schema.js'
import { mm } from '../geometry.js'
import { historyInput } from '../shortcuts.js'
import type { EditorStore } from '../store.js'
import { typingStep } from './active.js'

export function StepWords({ node, store }: { node: NodeBlock; store: EditorStore }) {
  const host = useRef<HTMLDivElement>(null)
  const id = node.id

  // Set up before the step is painted, and focused at once, so a letter typed straight after the step is made is kept.
  useLayoutEffect(() => {
    const origin = `step:${id}`
    const end = (): void => {
      if (typingStep.value === id) typingStep.set(undefined)
    }
    const editor = new Editor({
      element: host.current!,
      extensions: captionExtensions(),
      content: wordsJSON(wordsOf(store.doc, id)),
      editorProps: {
        attributes: { 'aria-label': 'The step’s words', class: 'nw-step-typing' },
        handleDOMEvents: { beforeinput: historyInput(store) },
        // Enter or Escape: the words are done; the step stays chosen.
        handleKeyDown: (_view, event) => {
          if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
            event.preventDefault()
            end()
            return true
          }
          return false
        },
      },
      onFocus: ({ editor }) => {
        activeEditor.set(origin, editor)
        store.select({ blocks: [id] }, 'objects')
      },
      onBlur: ({ editor }) => {
        activeEditor.blurred(editor)
        end()
      },
      onTransaction: ({ editor, transaction }) => {
        if (!transaction.docChanged || transaction.getMeta(OUTSIDE)) return
        const step = store.doc.block[id]
        if (step?.type !== 'node') return
        const typed = fromRuns(runsOf(editor.state.doc))
        // The same words and marks said another way: keep core's form.
        if (sameRuns(toRuns(step.md), toRuns(typed))) return
        try {
          store.apply([spliceFor(id, 'md', step.md, typed), ...fitOps(step, step.shape, typed)], { origin, key: `type:${id}` })
        } catch (error) {
          console.error("shellnote: a step's words were refused, so they were drawn again", error)
          show(editor, wordsOf(store.doc, id))
        }
      },
    })
    const stop = store.subscribe((change) => {
      if (change.origin === origin || !change.changed.has(id)) return
      // The step gone (undone, or taken out elsewhere): its words are done.
      if (change.doc.block[id]?.type !== 'node') end()
      else show(editor, wordsOf(change.doc, id))
    })
    // The caret at the end of the words, at once.
    focusAt(editor)
    return () => {
      stop()
      activeEditor.clear(editor)
      editor.destroy()
    }
  }, [id, store])

  const area = wordsArea(node.shape, node)
  return <div ref={host} className="nw-step-edit" data-for={id} style={{ left: mm(area.x), top: mm(area.y), width: mm(area.w), height: mm(area.h) }} />
}

function wordsOf(doc: Doc, id: Id): string {
  const block = doc.block[id]
  return block?.type === 'node' ? block.md : ''
}

function wordsJSON(md: string): JSONContent {
  const content = inlineJSON(md)
  return { type: 'caption', ...(content.length > 0 ? { content } : {}) }
}

/** Show words that changed elsewhere, keeping the caret where it was as far as the words allow. */
function show(editor: Editor, md: string): void {
  if (editor.isDestroyed || sameRuns(toRuns(md), runsOf(editor.state.doc))) return
  const next = editor.schema.nodeFromJSON(wordsJSON(md))
  const { from, to } = editor.state.selection
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content).setMeta(OUTSIDE, true).setMeta('addToHistory', false)
  const end = tr.doc.content.size
  tr.setSelection(TextSelection.create(tr.doc, Math.min(from, end), Math.min(to, end)))
  editor.view.dispatch(tr)
}
