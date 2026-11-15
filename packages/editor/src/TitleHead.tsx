// A text note's title at the top of its first page, in the page's top margin, and its line under it: the folder it is
// in and when it was edited. The title is typed here or in the note's tab, the same name either way, and it prints
// with the page.
import type { Doc } from '@shellnote/core'
import { commands } from './commands/index.js'

export interface TitleHeadProps {
  doc: Doc
  /** The line under the title, such as "College · edited 12 min ago". */
  line?: string | undefined
  /** Whether the title can be typed here: not when the note is only shown, nor in print. */
  editable: boolean
}

export function TitleHead({ doc, line, editable }: TitleHeadProps) {
  return (
    <div className="nw-title-head">
      {editable ? (
        <input
          className="nw-title"
          aria-label="The note's title, at the top of its page"
          data-command="note.rename"
          spellCheck={false}
          value={doc.title}
          onChange={(event) => void commands.do('note.rename', { name: event.target.value })}
          onBlur={(event) => {
            if (event.target.value.trim() === '') void commands.do('note.rename', { name: 'Untitled' })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      ) : (
        <div className="nw-title">{doc.title || 'Untitled'}</div>
      )}
      {line ? <p className="nw-title-line">{line}</p> : null}
    </div>
  )
}
