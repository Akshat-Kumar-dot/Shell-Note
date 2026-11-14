// The tree: the library's column beside every screen. The folders, what each holds and the notes, to open one with a
// click; a search over their names; a new note or folder; Recently deleted at its foot. Its menu sorts it, moves it to
// the window's other side and hides it. Which folders are open, the order, its side and whether it shows are kept in
// this browser; the open note's folders open on their own.
import { BarMenu, commands, MenuItem } from '@shellnote/editor'
import type { FolderEntry, Library, LibraryStore, NoteEntry } from '@shellnote/library'
import { contents, deletedItems, folderPath, hidden, search } from '@shellnote/library/tree'
import { ArrowUpDown, ChevronDown, ChevronRight, FilePlus, Folder, FolderOpen, FolderPlus, Layers, PanelLeft, PanelLeftClose, PanelRight, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { Tabs } from '../library/tabs.js'
import { findWanted, noteScreen, showTree, tabsFollow, treeAt, treeShown, moveTree } from './state.js'

const OPENED = 'shellnote:library-side-open'
const SORT = 'shellnote:tree-sort'
/** The library as last read, shown at once on the next screen while it is read again. */
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
    // A private window keeps nothing: the tree works all the same.
  }
}

/** Names in the order people expect: "Chapter 2" before "Chapter 10", capitals aside. */
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

const notesWord = (count: number): string => (count === 1 ? '1 note' : `${count} notes`)

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export interface TreeProps {
  store: LibraryStore
  tabs: Tabs
  /** Recently deleted is the screen shown. */
  bin: boolean
  /** The library has started: where it is kept is known, so it can be read. */
  ready: boolean
}

export function Tree({ store, tabs, bin, ready }: TreeProps) {
  const shown = useSyncExternalStore(treeShown.subscribe, treeShown.snapshot)
  const at = useSyncExternalStore(treeAt.subscribe, treeAt.snapshot)
  const now = useSyncExternalStore(noteScreen.subscribe, noteScreen.snapshot)
  const note = now?.id
  const folder = now?.folder ?? null
  const [library, setRead] = useState(lastRead)
  const setLibrary = useCallback((read: Library) => {
    lastRead = read
    setRead(read)
    // The tabs of notes that have gone go too; the others take their titles, but the one on screen, which has its own.
    const open = noteScreen.value?.id
    tabsFollow(new Map(read.notes.filter((entry) => !hidden(read, entry)).map((entry) => [entry.id, entry.title || 'Untitled'])), open)
  }, [])
  const [opened, setOpened] = useState(() => new Set(kept<string[]>(OPENED, [])))
  const [sort, setSort] = useState<'name' | 'edited'>(() => (kept<unknown>(SORT, 'name') === 'edited' ? 'edited' : 'name'))
  const [query, setQuery] = useState('')
  const [naming, setNaming] = useState<{ id: string; name: string }>()
  const namingNow = useRef(naming)
  namingNow.current = naming
  const [problem, setProblem] = useState<string>()
  const list = useRef<HTMLDivElement>(null)
  const searchBox = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    store.list().then(setLibrary, (error: unknown) => setProblem((error as Error).message))
  }, [store, setLibrary])
  // Read once the library has started, when the screen changes (a note made or opened), and when another tab or device
  // changes the library.
  useEffect(() => {
    if (ready) refresh()
  }, [refresh, note, bin, ready])
  useEffect(
    () =>
      ready
        ? tabs.subscribe((message) => {
            if (message.t === 'library' || message.t === 'saved') refresh()
          })
        : undefined,
    [tabs, refresh, ready],
  )

  // The open note's folders open on their own, and its line comes into sight.
  useEffect(() => {
    if (!library || folder === null) return
    const path = folderPath(library, folder).map((f) => f.id)
    setOpened((was) => (path.every((id) => was.has(id)) ? was : new Set([...was, ...path])))
  }, [library, folder])
  useEffect(() => keep(OPENED, [...opened]), [opened])
  useEffect(() => {
    if (shown && library) list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [shown, library, note])

  // The rail's Search: the tree shown, and the caret in its search box.
  useEffect(() => {
    const take = (): void => {
      if (!findWanted.value) return
      if (!searchBox.current) return showTree(true)
      findWanted.set(false)
      searchBox.current.focus()
    }
    take()
    return findWanted.subscribe(take)
  }, [shown])

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
  const gone = useMemo(() => (library ? deletedItems(library) : undefined), [library])
  const binCount = gone ? gone.folders.length + gone.notes.length : 0

  if (!shown) return null

  const toggle = (id: string): void =>
    setOpened((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  // The note on screen shows the title it has now, renamed or not.
  const titleOf = (entry: NoteEntry): string => (entry.id === note ? (now?.title ?? entry.title) : entry.title) || 'Untitled'
  const placeOf = (parent: string | null): string => (library && parent !== null ? folderPath(library, parent).map((f) => f.name).join(' / ') : 'Top level')
  const noteOrder = (a: NoteEntry, b: NoteEntry): number => (sort === 'edited' ? b.edited - a.edited : byName(titleOf(a), titleOf(b)))

  /** Into a folder (null: the top level): the note open now is kept first, as with every other way to a note. */
  const addNote = (into: string | null): void => commands.press('note.new', into === null ? {} : { into })
  const openNote = (id: string): void => {
    if (id !== note) commands.press('note.open', { note: id })
  }
  /** A folder found by a search: shown in its place, its own folders open. */
  const reveal = (id: string): void => {
    if (!library) return
    const path = folderPath(library, id).map((f) => f.id)
    setOpened((was) => new Set([...was, ...path]))
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
    const was = namingNow.current
    if (!was) return
    namingNow.current = undefined
    setNaming(undefined)
    const name = was.name.trim()
    const before = library?.folders.find((f) => f.id === was.id)?.name
    if (!keepIt || name === '' || name === before) return
    store.rename({ kind: 'folder', id: was.id }, name).then(
      () => {
        tabs.libraryChanged()
        refresh()
      },
      (error: unknown) => setProblem((error as Error).message),
    )
  }

  const noteLine = (entry: NoteEntry, depth: number, where?: string): ReactNode => (
    <li key={entry.id}>
      <button
        type="button"
        className="tree-row"
        style={{ '--depth': depth } as CSSProperties}
        aria-current={entry.id === note ? 'page' : undefined}
        aria-label={where === undefined ? undefined : `${titleOf(entry)}, in ${where}`}
        title={where === undefined ? titleOf(entry) : `${titleOf(entry)}, in ${where}`}
        data-command="note.open"
        onClick={() => openNote(entry.id)}
      >
        <span className="tree-indent" aria-hidden />
        <Layers {...ICON} />
        <span className="tree-name">{titleOf(entry)}</span>
        {where === undefined ? null : <span className="tree-where">{where}</span>}
      </button>
    </li>
  )

  const folderLine = (entry: FolderEntry, depth: number): ReactNode => {
    const open = opened.has(entry.id)
    const count = counts.get(entry.id) ?? 0
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <li key={entry.id}>
        <div className="tree-line" data-folder={entry.id}>
          {naming?.id === entry.id ? (
            <input
              className="tree-naming"
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
            <button type="button" className="tree-row tree-folder" style={{ '--depth': depth } as CSSProperties} aria-label={`${entry.name}: ${notesWord(count)}`} aria-expanded={open} title={entry.name} onClick={() => toggle(entry.id)}>
              <Chevron size={15} strokeWidth={1.75} aria-hidden />
              {open ? <FolderOpen {...ICON} /> : <Folder {...ICON} />}
              <span className="tree-name">{entry.name}</span>
              {open ? null : (
                <span className="tree-count" aria-hidden>
                  {count}
                </span>
              )}
            </button>
          )}
          {naming?.id === entry.id ? null : (
            <button type="button" className="tree-add" aria-label={`Add a note to ${entry.name}`} title={`A new note in ${entry.name}`} data-command="note.new" onClick={() => addNote(entry.id)}>
              <Plus size={14} aria-hidden />
            </button>
          )}
        </div>
        {open ? <ul>{branch(entry.id, depth + 1)}</ul> : null}
      </li>
    )
  }

  // A folder's folders by name, then its notes, in the order chosen.
  function branch(parent: string | null, depth: number): ReactNode[] {
    if (!library) return []
    const { folders, notes } = contents(library, parent)
    return [...[...folders].sort((a, b) => byName(a.name, b.name)).map((f) => folderLine(f, depth)), ...[...notes].sort(noteOrder).map((n) => noteLine(n, depth))]
  }

  const words = query.trim()
  let body: ReactNode
  if (!library) body = <p className="tree-quiet">Opening the library…</p>
  else if (words !== '') {
    const found = search(library, words)
    body =
      found.folders.length + found.notes.length === 0 ? (
        <p className="tree-quiet">Nothing is called “{words}”.</p>
      ) : (
        <ul className="tree-items">
          {[...found.folders]
            .sort((a, b) => byName(a.name, b.name))
            .map((f) => (
              <li key={f.id}>
                <button type="button" className="tree-row tree-folder" aria-label={`${f.name}, in ${placeOf(f.parent)}`} title={`${f.name}, in ${placeOf(f.parent)}`} onClick={() => reveal(f.id)}>
                  <Folder {...ICON} />
                  <span className="tree-name">{f.name}</span>
                  <span className="tree-where">{placeOf(f.parent)}</span>
                </button>
              </li>
            ))}
          {[...found.notes].sort(noteOrder).map((n) => noteLine(n, 0, placeOf(n.folder)))}
        </ul>
      )
  } else {
    const all = branch(null, 0)
    body = all.length === 0 ? <p className="tree-quiet">No notes yet.</p> : <ul className="tree-items">{all}</ul>
  }

  const other = at === 'left' ? 'right' : 'left'
  const Other = other === 'right' ? PanelRight : PanelLeft
  const sortBy = (next: 'name' | 'edited'): void => {
    setSort(next)
    keep(SORT, next)
  }

  return (
    <nav className="tree" data-at={at} aria-label="Library">
      <div className="tree-head">
        <b>Library</b>
        <span className="sh-grow" />
        <button type="button" className="sh-b" aria-label="Add a note" title={folder === null || !library ? 'A new note at the top level' : `A new note in ${placeOf(folder)}`} data-command="note.new" onClick={() => addNote(folder)}>
          <FilePlus {...ICON} />
        </button>
        <button type="button" className="sh-b" aria-label="Add a folder" title="A new folder at the top level, named in place" data-command="folder.new" onClick={() => void addFolder()}>
          <FolderPlus {...ICON} />
        </button>
        <BarMenu label="Sort and place" title="Sort the notes; move or hide this column" button={<ArrowUpDown {...ICON} />}>
          {(close) => (
            <>
              <div className="sh-menu-head">Notes sorted by</div>
              <MenuItem checked={sort === 'name'} onChoose={() => sortBy('name')}>
                Name
              </MenuItem>
              <MenuItem checked={sort === 'edited'} onChoose={() => sortBy('edited')}>
                Last edited, newest first
              </MenuItem>
              <hr />
              <MenuItem
                label={`Move the library to the ${other}`}
                onChoose={() => {
                  moveTree(other)
                  close()
                }}
              >
                <Other {...ICON} />
                Move to the {other} side
              </MenuItem>
              <MenuItem
                label="Hide the library"
                onChoose={() => {
                  showTree(false)
                  close()
                }}
              >
                <PanelLeftClose {...ICON} />
                Hide this column
              </MenuItem>
            </>
          )}
        </BarMenu>
      </div>
      <label className="tree-find">
        <Search size={15} strokeWidth={1.75} aria-hidden />
        <input
          ref={searchBox}
          type="search"
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
          <button type="button" className="tree-clear" aria-label="Clear the search" onClick={() => setQuery('')}>
            <X size={14} aria-hidden />
          </button>
        )}
      </label>
      <div className="tree-list" ref={list}>
        {body}
      </div>
      {problem ? (
        <p className="tree-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="tree-foot">
        {/* A link, so Ctrl+click opens it apart; a plain click goes through its command, the open note kept first. */}
        <a
          className="tree-row"
          href="#/deleted"
          aria-current={bin ? 'page' : undefined}
          data-command="bin.open"
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            commands.press('bin.open')
          }}
        >
          <Trash2 {...ICON} />
          <span className="tree-name">Recently deleted</span>
          {binCount > 0 ? <span className="tree-count">{binCount}</span> : null}
        </a>
      </div>
    </nav>
  )
}
