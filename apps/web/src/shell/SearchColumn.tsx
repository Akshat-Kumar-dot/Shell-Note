// Search in every note, in the left column (Ctrl+Shift+F, or the rail's Search): the words looked for, then each note
// that holds them, with its lines, the words marked. A click on a note opens it; a click on a line opens the note
// there, the line in sight and chosen. Typing runs library.findWords, as the terminal and the agent do.
import { commands } from '@shellnote/editor'
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { KIND_ICON } from '../library/kinds.js'
import { found, type HitLine } from '../library/searchAll.js'
import { closeSearch, searchAsked, treeAt } from './state.js'

/** The last time the box was asked to take the caret, so it takes it once for each time. */
let focused = 0

/** A line with the words looked for marked. */
function Marked({ line }: { line: HitLine }) {
  const parts: ReactNode[] = []
  let at = 0
  line.spans.forEach(([from, to], i) => {
    if (from > at) parts.push(line.text.slice(at, from))
    parts.push(<mark key={i}>{line.text.slice(from, to)}</mark>)
    at = to
  })
  if (at < line.text.length) parts.push(line.text.slice(at))
  return (
    <>
      {line.cutBefore ? '…' : ''}
      {parts}
      {line.cutAfter ? '…' : ''}
    </>
  )
}

/** The note opened, then the line brought into sight and chosen, once the note is on screen. */
async function openAt(note: string, line?: HitLine): Promise<void> {
  await commands.do('note.open', { note })
  if (!line) return
  try {
    await commands.until('workspace', (workspace) => workspace.entry() === note && workspace.ready())
  } catch {
    // The note did not come in time: it is open, the line not brought into sight.
    return
  }
  // Its blocks are drawn a moment after the note opens.
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  const where = document.querySelector(`[data-id="${CSS.escape(line.block)}"]`) ?? (line.frame ? document.querySelector(`[data-id="${CSS.escape(line.frame)}"]`) : null)
  where?.scrollIntoView({ block: 'center' })
  try {
    await commands.do('select.blocks', { blocks: [line.block] })
  } catch {
    // A block that cannot be chosen (a part of a table): it is in sight all the same.
  }
}

export function SearchColumn() {
  const at = useSyncExternalStore(treeAt.subscribe, treeAt.snapshot)
  const asked = useSyncExternalStore(searchAsked.subscribe, searchAsked.snapshot)
  const result = useSyncExternalStore(found.subscribe, found.snapshot)
  const [words, setWords] = useState(asked.words)
  const box = useRef<HTMLInputElement>(null)

  // Words asked from elsewhere (the terminal, the agent): the box shows them.
  useEffect(() => {
    setWords((now) => (now.trim() === asked.words.trim() ? now : asked.words))
  }, [asked.words])
  // The key or the rail: the caret into the box, its words chosen to be typed over. A search from the terminal leaves
  // the caret there.
  useEffect(() => {
    if (asked.focus === focused) return
    focused = asked.focus
    box.current?.focus()
    box.current?.select()
  }, [asked.focus])
  // A search a moment after typing stops; none for an empty box.
  useEffect(() => {
    const text = words.trim()
    if (text === asked.words.trim() && (text === '' || result?.words === text)) return
    const timer = window.setTimeout(() => {
      if (text === '') {
        searchAsked.set({ ...searchAsked.value, words: '' })
        found.set(undefined)
      } else commands.tap('library.findWords', { text })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [words, asked.words, result?.words])

  const shown = result && result.words === words.trim() ? result : undefined
  const count = shown?.hits.length ?? 0
  return (
    <nav className="tree sx" data-at={at} aria-label="Search in every note">
      <div className="tree-head">
        <b>Search</b>
        <small className="sx-every">every note</small>
        <span className="sh-grow" />
        <button type="button" className="sh-b" aria-label="Close the search" title="Back to the library's folders and notes (Escape)" onClick={closeSearch}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <label className="tree-find">
        <Search size={15} strokeWidth={1.75} aria-hidden />
        <input
          ref={box}
          type="search"
          aria-label="Search in every note"
          placeholder="Words, or “words side by side”"
          spellCheck={false}
          data-command="library.findWords"
          value={words}
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            if (words !== '') setWords('')
            else closeSearch()
          }}
        />
      </label>
      <div className="tree-list sx-list">
        {words.trim() === '' ? (
          <p className="tree-quiet">Every word, in any order, anywhere in a word: “photo” finds photosynthesis. Words in quotes, side by side.</p>
        ) : !shown || (shown.busy && count === 0) ? (
          <p className="tree-quiet">Looking in every note…</p>
        ) : count === 0 ? (
          <p className="tree-quiet">No note holds “{shown.words}”.</p>
        ) : (
          <ul className="sx-notes">
            {shown.hits.map((hit) => {
              const Kind = KIND_ICON[hit.kind]
              return (
                <li key={hit.id}>
                  <button type="button" className="tree-row sx-note" title={`${hit.title}, in ${hit.where}`} data-command="note.open" onClick={() => void openAt(hit.id)}>
                    <Kind size={16} strokeWidth={1.75} aria-hidden />
                    <span className="tree-name">{hit.title}</span>
                    {hit.count > 0 ? (
                      <span className="tree-count" title={`${hit.count} ${hit.count === 1 ? 'line holds' : 'lines hold'} the words`}>
                        {hit.count}
                      </span>
                    ) : null}
                  </button>
                  {hit.count === 0 ? (
                    <button type="button" className="sx-line sx-title" data-command="note.open" onClick={() => void openAt(hit.id)}>
                      In its title
                    </button>
                  ) : null}
                  {hit.lines.map((line) => (
                    <button key={line.block} type="button" className="sx-line" data-command="note.open" onClick={() => void openAt(hit.id, line)}>
                      <Marked line={line} />
                    </button>
                  ))}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {shown && count > 0 ? (
        <div className="tree-foot sx-foot" role="status">
          {count} {count === 1 ? 'note' : 'notes'}
          {shown.more > 0 ? `, and ${shown.more} more: add a word to narrow it` : ''}
          {shown.busy ? ' · looking…' : ''}
        </div>
      ) : null}
    </nav>
  )
}
