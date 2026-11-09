// The scratch pad: what the AI made, a table, a flowchart or a summary, waiting
// in the side panel's Output until the person puts it into the note, with a press, or by dragging it onto a page. Kept
// per note in their browser, not in the note's file, until it is put in. In the note, it is blocks like an answer's
// (core's answerOps: paragraphs, list items, a pipe table, a fenced Mermaid diagram), one undo step.
import { parsePipeTable, type Block } from '@shellnote/core'
import { GripVertical, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { DiagramView } from '../../blocks.js'
import { commands } from '../../commands/index.js'
import type { EditorStore } from '../../store.js'
import { MADE_TYPE, padOf, type Made } from './pad.js'

export { addMade, emptyPartInView, MADE_TYPE, padOf, putMade, removeMade, roomAt, type Made, type Room } from './pad.js'

function Preview({ item }: { item: Made }) {
  if (item.kind === 'table') {
    const table = parsePipeTable(item.text.trim())
    if (table)
      return (
        <table className="nw-made-table">
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (r === 0 && table.head ? <th key={c}>{cell}</th> : <td key={c}>{cell}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
  if (item.kind === 'diagram') {
    const src = /```mermaid[ \t]*\n([\s\S]*?)\n```/u.exec(item.text)?.[1] ?? item.text
    return <DiagramView block={{ id: `made-${item.id}`, r: 0, type: 'diagram', parent: 'made', lang: 'mermaid', src } as unknown as Extract<Block, { type: 'diagram' }>} />
  }
  return <p className="nw-made-text">{item.text}</p>
}

/** The scratch pad's list, newest first. */
export function MadeList({ store }: { store: EditorStore }) {
  const docId = useSyncExternalStore(store.subscribe, () => store.doc.id)
  const pad = padOf(docId)
  const items = useSyncExternalStore(pad.subscribe, pad.snapshot)
  if (items.length === 0) return <p className="nw-video-note">Nothing made yet. In the AI tab, make a table, a flowchart or a summary, with “On the scratch pad” chosen.</p>
  return (
    <ol className="nw-made">
      {items.map((item) => (
        <li
          key={item.id}
          className="nw-made-item"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(MADE_TYPE, item.text)
            event.dataTransfer.setData('text/plain', item.text)
            event.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <header className="nw-made-head">
            <GripVertical size={14} aria-hidden />
            <span className="nw-made-about">{item.kind === 'table' ? 'Table' : item.kind === 'diagram' ? 'Flowchart' : 'Summary'}: {item.about}</span>
            <button type="button" className="nw-ibtn" aria-label={`Take away ${item.about}`} title="Take it off the scratch pad" data-command="pad.remove" onClick={() => commands.tap('pad.remove', { made: item.id })}>
              <X size={14} aria-hidden />
            </button>
          </header>
          <Preview item={item} />
          <button
            type="button"
            className="nw-video-add"
            title="Into what is chosen in the note, or the empty part of the page in view; or drag it onto a page"
            data-command="pad.put"
            onClick={() => commands.tap('pad.put', { made: item.id })}
          >
            Put into the note
          </button>
        </li>
      ))}
    </ol>
  )
}
