// The library beside a note, on the left (or, moved there, the right): the folders, what each holds and the notes, to
// open one with a click; a search over their names; and a new note or folder. The arrows hide it to a slim strip and
// bring it back. Its side, whether it shows, and which folders are open are kept in this browser; the open note's
// folders open on their own.
import { commands } from '@shellnote/editor'
import { ChevronRight, ChevronsLeft, ChevronsRight, FilePlus, FileText, Folder, FolderOpen, FolderPlus, LibraryBig, PanelLeft, PanelRight, Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { FolderEntry, Library, LibraryStore, NoteEntry } from '@shellnote/library'
import type { Tabs } from './tabs.js'
import { contents, folderPath, hidden, search } from '@shellnote/library/tree'

const SHOWN = 'shellnote:library-side'
const OPENED = 'shellnote:library-side-open'
const AT = 'shellnote:library-side-at'
/** Narrower than this, the library starts hidden: the pages need the room. */
const ROOMY = 1400
/** The library as last read, shown at once beside the next note opened while it is read again. */
let lastRead: Library | undefined

function kept<T>(key: string, otherwise: T): T {
  try {
    const value = localStorage.getItem(key)
    return value === null ? otherwise : (JSON.parse(value) as T)
  } catch {
    return otherwise
  }
}

function keep(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A private window keeps nothing: the library beside the note works all the same.
  }
}

/** Names in the order people expect: "Chapter 2" before "Chapter 10", capitals aside. */
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

const notesWord = (count: number): string => (count === 1 ? '1 note' : `${count} notes`)

/** The side of the note the library is on. */
export type SideAt = 'left' | 'right'

/** Which side the library is on: the left, unless the person moved it; kept in this browser. */
export function useLibrarySideAt(): [SideAt, (at: SideAt) => void] {
  const [at, setAt] = useState<SideAt>(() => (kept<unknown>(AT, 'left') === 'right' ? 'right' : 'left'))
  const move = useCallback((next: SideAt) => {
    setAt(next)
    keep(AT, next)
  }, [])
  return [at, move]
}

export interface LibrarySideProps {
  store: LibraryStore
  tabs: Tabs
  /** The note open now (none for a sample), its folder, and its title as it is now, renamed or not. */
  note: string | undefined
  folder: string | null
  title: string
  /** Its side, and moving it to the other. */
  at: SideAt
  onMove: (at: SideAt) => void
}

export function LibrarySide({ store, tabs, note, folder, title, at, onMove }: LibrarySideProps) {
  const [shown, setShown] = useState(() => kept(SHOWN, window.innerWidth >= ROOMY))
  const [library, setRead] = useState(lastRead)
  const setLibrary = useCallback((read: Library) => {
    lastRead = read
    setRead(read)
  }, [])
  const [opened, setOpened] = useState(() => new Set(kept<string[]>(OPENED, [])))
  const [query, setQuery] = useState('')
  const [naming, setNaming] = useState<{ id: string; name: string }>()
  const namingNow = useRef(naming)
  namingNow.current = naming
  const [problem, setProblem] = useState<string>()
  const list = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    store.list().then(setLibrary, (error: unknown) => setProblem((error as Error).message))
  }, [store, setLibrary])
  useEffect(() => {
    if (shown) refresh()
  }, [shown, refresh])
  // Another tab changed the library, or saved a note whose title may be new.
  useEffect(() => {
    if (!shown) return
    return tabs.subscribe((message) => {
      if (message.t === 'library' || message.t === 'saved') refresh()
    })
  }, [tabs, shown, refresh])

  // The open note's folders open on their own, and its line comes into sight.
  useEffect(() => {
    if (!library || folder === null) return
    const path = folderPath(library, folder).map((f) => f.id)
    setOpened((now) => (path.every((id) => now.has(id)) ? now : new Set([...now, ...path])))
  }, [library, folder])
  useEffect(() => keep(OPENED, [...opened]), [opened])
  useEffect(() => {
    if (shown && library) list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [shown, library])

  // How many notes each folder holds, at any depth.
  const counts = useMemo(() => {
    const found = new Map<string, number>()
    if (!library) return found
    for (const entry of library.notes) {
      if (entry.folder === null || hidden(library, entry)) continue
      for (const f of folderPath(library, entry.folder)) found.set(f.id, (found.get(f.id) ?? 0) + 1)
    }
    return found
  }, [library])

  const show = (value: boolean): void => {
    setShown(value)
    keep(SHOWN, value)
  }
  const toggle = (id: string): void =>
    setOpened((now) => {
      const next = new Set(now)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const titleOf = (entry: NoteEntry): string => (entry.id === note ? title : entry.title) || 'Untitled'
  const placeOf = (parent: string | null): string => (library && parent !== null ? folderPath(library, parent).map((f) => f.name).join(' / ') : 'Top level')

  /** Into a folder (null: the top level): the note open now is kept first, as with every other way to a note. */
  const addNote = (into: string | null): void => commands.press('note.new', into === null ? {} : { into })
  const openNote = (id: string): void => {
    if (id !== note) commands.press('note.open', { note: id })
  }
  /** A folder found by a search: shown in its place, its own folders open. */
  const reveal = (id: string): void => {
    if (!library) return
    const path = folderPath(library, id).map((f) => f.id)
    setOpened((now) => new Set([...now, ...path]))
    setQuery('')
    requestAnimationFrame(() => list.current?.querySelector(`[data-folder="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
  }

  /** A new folder at the top level, its name typed in place. */
  const addFolder = async (): Promise<void> => {
    setProblem(undefined)
    try {
      const made = await store.newFolder(null)
      tabs.libraryChanged()
      setQuery('')
      setLibrary(await store.list())
      setNaming({ id: made.id, name: made.name })
    } catch (error) {
      setProblem((error as Error).message)
    }
  }
  /** Enter, or the field left, keeps the name typed; Escape keeps the one it had. Once, though both may come. */
  const doneNaming = (keepIt: boolean): void => {
    const now = namingNow.current
    if (!now) return
    namingNow.current = undefined
    setNaming(undefined)
    const name = now.name.trim()
    const before = library?.folders.find((f) => f.id === now.id)?.name
    if (!keepIt || name === '' || name === before) return
    store.rename({ kind: 'folder', id: now.id }, name).then(
      () => {
        tabs.libraryChanged()
        refresh()
      },
      (error: unknown) => setProblem((error as Error).message),
    )
  }

  // The arrows point the way the library goes: out towards its edge, back in from it.
  const Away = at === 'left' ? ChevronsLeft : ChevronsRight
  const Back = at === 'left' ? ChevronsRight : ChevronsLeft
  const other: SideAt = at === 'left' ? 'right' : 'left'
  const Other = other === 'right' ? PanelRight : PanelLeft

  if (!shown) {
    return (
      <nav className="side-library" data-shown="false" data-at={at} aria-label="Library">
        <button type="button" className="icon-button side-library-toggle" aria-label="Show the library" title="Show the library: your folders and notes" aria-expanded={false} onClick={() => show(true)}>
          <Back size={18} aria-hidden />
        </button>
      </nav>
    )
  }

  const noteLine = (entry: NoteEntry, depth: number, where?: string): ReactNode => (
    <li key={entry.id}>
      <button
        type="button"
        className="side-item"
        style={{ '--depth': depth } as CSSProperties}
        aria-current={entry.id === note ? 'page' : undefined}
        aria-label={where === undefined ? undefined : `${titleOf(entry)}, in ${where}`}
        title={where === undefined ? titleOf(entry) : `${titleOf(entry)}, in ${where}`}
        data-command="note.open"
        onClick={() => openNote(entry.id)}
      >
        <FileText size={16} aria-hidden />
        <span className="side-name">{titleOf(entry)}</span>
        {where === undefined ? null : <span className="side-where">{where}</span>}
      </button>
    </li>
  )

  const folderLine = (entry: FolderEntry, depth: number): ReactNode => {
    const open = opened.has(entry.id)
    const count = counts.get(entry.id) ?? 0
    return (
      <li key={entry.id}>
        <div className="side-row" data-folder={entry.id}>
          {naming?.id === entry.id ? (
            <input
              className="side-library-naming"
              style={{ '--depth': depth } as CSSProperties}
              aria-label={`New name for ${entry.name}`}
              data-command="folder.rename"
              autoFocus
              spellCheck={false}
              value={naming.name}
              onChange={(event) => setNaming({ id: entry.id, name: event.target.value })}
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') doneNaming(true)
                else if (event.key === 'Escape') doneNaming(false)
              }}
              onBlur={() => doneNaming(true)}
            />
          ) : (
            <button
              type="button"
              className="side-item side-library-folder"
              style={{ '--depth': depth } as CSSProperties}
              aria-label={`${entry.name}: ${notesWord(count)}`}
              aria-expanded={open}
              title={entry.name}
              onClick={() => toggle(entry.id)}
            >
              <ChevronRight className="side-chevron" size={14} aria-hidden />
              {open ? <FolderOpen size={16} aria-hidden /> : <Folder size={16} aria-hidden />}
              <span className="side-name">{entry.name}</span>
              <span className="side-count" aria-hidden>
                {count}
              </span>
            </button>
          )}
          {naming?.id === entry.id ? null : (
            <button type="button" className="side-add" aria-label={`Add a note to ${entry.name}`} title={`A new note in ${entry.name}`} data-command="note.new" onClick={() => addNote(entry.id)}>
              <Plus size={14} aria-hidden />
            </button>
          )}
        </div>
        {open ? <ul>{branch(entry.id, depth + 1)}</ul> : null}
      </li>
    )
  }

  // A folder's folders, then its notes, each by name.
  function branch(parent: string | null, depth: number): ReactNode[] {
    if (!library) return []
    const { folders, notes } = contents(library, parent)
    return [...[...folders].sort((a, b) => byName(a.name, b.name)).map((f) => folderLine(f, depth)), ...[...notes].sort((a, b) => byName(titleOf(a), titleOf(b))).map((n) => noteLine(n, depth))]
  }

  const words = query.trim()
  let body: ReactNode
  if (!library) body = <p className="side-library-quiet">Opening the library…</p>
  else if (words !== '') {
    const found = search(library, words)
    body =
      found.folders.length + found.notes.length === 0 ? (
        <p className="side-library-quiet">Nothing is called “{words}”.</p>
      ) : (
        <ul className="side-tree">
          {[...found.folders]
            .sort((a, b) => byName(a.name, b.name))
            .map((f) => (
              <li key={f.id}>
                <button type="button" className="side-item side-library-folder" aria-label={`${f.name}, in ${placeOf(f.parent)}`} title={`${f.name}, in ${placeOf(f.parent)}`} onClick={() => reveal(f.id)}>
                  <Folder size={16} aria-hidden />
                  <span className="side-name">{f.name}</span>
                  <span className="side-where">{placeOf(f.parent)}</span>
                </button>
              </li>
            ))}
          {[...found.notes].sort((a, b) => byName(titleOf(a), titleOf(b))).map((n) => noteLine(n, 0, placeOf(n.folder)))}
        </ul>
      )
  } else {
    const all = branch(null, 0)
    body = all.length === 0 ? <p className="side-library-quiet">No notes yet.</p> : <ul className="side-tree">{all}</ul>
  }

  return (
    <nav className="side-library" data-shown="true" data-at={at} aria-label="Library">
      <div className="side-library-head">
        <LibraryBig size={17} aria-hidden />
        <span className="side-library-title">Library</span>
        <button type="button" className="icon-button side-library-toggle side-library-move" aria-label={`Move the library to the ${other}`} title={`Move the library to the ${other} side`} onClick={() => onMove(other)}>
          <Other size={17} aria-hidden />
        </button>
        <button type="button" className="icon-button side-library-toggle" aria-label="Hide the library" title="Hide the library" aria-expanded onClick={() => show(false)}>
          <Away size={18} aria-hidden />
        </button>
      </div>
      <label className="side-library-find">
        <Search size={15} aria-hidden />
        <input
          type="search"
          className="side-library-search"
          aria-label="Search the library"
          placeholder="Search notes and folders"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
        />
        {query === '' ? null : (
          <button type="button" className="side-library-clear" aria-label="Clear the search" onClick={() => setQuery('')}>
            <X size={14} aria-hidden />
          </button>
        )}
      </label>
      <div className="side-library-list" ref={list}>
        {body}
      </div>
      {problem ? (
        <p className="side-library-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="side-library-foot">
        <button type="button" className="side-library-action" title={folder === null || !library ? 'A new note at the top level' : `A new note in ${placeOf(folder)}`} data-command="note.new" onClick={() => addNote(folder)}>
          <FilePlus size={16} aria-hidden />
          <span>Add a note</span>
        </button>
        <button type="button" className="side-library-action" title="A new folder at the top level" data-command="folder.new" onClick={() => void addFolder()}>
          <FolderPlus size={16} aria-hidden />
          <span>Add a folder</span>
        </button>
      </div>
    </nav>
  )
}
