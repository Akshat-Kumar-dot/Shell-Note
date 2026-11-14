// The library's home page, the first thing the app shows: notes and folders as
// cards, folders inside folders, a path back up, search across the whole
// library, sorting by date, and Recently deleted, which keeps items 30 days.
// Every change goes through the storage interface (store.ts), and other tabs
// hear of it. Its buttons, menus and keys call the app's commands (app control,
// step 3b;../commands.ts), which reach this screen's own code, so the agent
// does what they do.
import { commands, inDesktopApp, tabWord, type By, type HomePlace, type LibraryAt, type NewNote } from '@shellnote/editor'
import { ArrowUpDown, ChevronRight, FilePlus, FolderOpen, FolderPlus, Info, NotebookPen, RotateCcw, Search, SquarePen, Trash2, FolderInput, PenLine, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Card, nameOf, type CardItem } from './Card.js'
import { Dialog, Menu, type MenuItem } from './Dialog.js'
import { importNote } from './importing.js'
import { MoveDialog } from './MoveDialog.js'
import { Settings } from './Settings.js'
import type { FolderEntry, ItemRef, Library, LibraryStore, NoteEntry } from '@shellnote/library'
import type { Tabs } from './tabs.js'
import { contents, counts, daysLeft, deletedItems, folderPath, inside, isOpenFolder, search, sorted, type SortKey, type SortOrder } from '@shellnote/library/tree'
import { drawThumbnail } from './thumbnail.js'
import { findWanted } from '../shell/state.js'

export type Place = { folder: string | null } | 'bin'

export interface HomeProps {
  store: LibraryStore
  tabs: Tabs
  place: Place
  /** A problem to show at the top, such as the old note not moving into the library. */
  problem?: string
  onOpen: (id: string) => void
}

const SORTS: [string, string, SortKey, SortOrder][] = [
  ['edited-newest', 'Last edited, newest first', 'edited', 'newest'],
  ['edited-oldest', 'Last edited, oldest first', 'edited', 'oldest'],
  ['created-newest', 'Date created, newest first', 'created', 'newest'],
  ['created-oldest', 'Date created, oldest first', 'created', 'oldest'],
]
const SORT_KEY = 'shellnote:sort'

function savedSort(): string {
  try {
    const value = localStorage.getItem(SORT_KEY)
    return SORTS.some(([id]) => id === value) ? value! : 'edited-newest'
  } catch {
    return 'edited-newest'
  }
}

/** How long ago, in words. */
export function ago(time: number, now = Date.now()): string {
  const minutes = Math.floor((now - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  return new Date(time).toLocaleDateString()
}

const ref = (item: CardItem): ItemRef => ({ kind: item.kind, id: item.entry.id })
const href = (folder: string | null): string => (folder === null ? '#/' : `#/folder/${folder}`)

/** The cards a library screen shows: Recently deleted's, the last deleted first; a folder's or a search's, folders then notes, sorted. */
function itemsOf(library: Library, bin: boolean, folder: string | null, query: string, key: SortKey, order: SortOrder): CardItem[] {
  if (bin) {
    const gone = deletedItems(library)
    const byDeleted = (a: { deleted?: number }, b: { deleted?: number }): number => (b.deleted ?? 0) - (a.deleted ?? 0)
    return [...[...gone.folders].sort(byDeleted).map((entry): CardItem => ({ kind: 'folder', entry })), ...[...gone.notes].sort(byDeleted).map((entry): CardItem => ({ kind: 'note', entry }))]
  }
  const found = query.trim() !== '' ? search(library, query) : contents(library, folder)
  return [...sorted(found.folders, key, order).map((entry): CardItem => ({ kind: 'folder', entry })), ...sorted(found.notes, key, order).map((entry): CardItem => ({ kind: 'note', entry }))]
}

/** How many cards the agent's line names; the rest are counted. */
const NAMED = 30

/** The screen as the agent reads it (the app-state map): where, how sorted, and its cards by name and id. */
function libraryLine(library: Library | undefined, bin: boolean, folder: string | null, query: string, sort: string): string {
  if (!library) return 'library: being read'
  if (!bin && !isOpenFolder(library, folder)) return `library: folder ${folder}, not in the library any more`
  const [, label, key, order] = SORTS.find(([id]) => id === sort) ?? SORTS[0]!
  const items = itemsOf(library, bin, folder, query, key, order)
  const where = bin ? 'Recently deleted' : query.trim() !== '' ? `search "${query.trim()}"` : folder === null ? 'the top' : `folder ${folderPath(library, folder).map((f) => `"${f.name}"`).join(' › ')} (${folder})`
  const folders = items.filter((item) => item.kind === 'folder').length
  const notes = items.length - folders
  const counted = `${folders} ${folders === 1 ? 'folder' : 'folders'}, ${notes} ${notes === 1 ? 'note' : 'notes'}`
  const named = items.slice(0, NAMED).map((item) => `${item.kind} "${nameOf(item)}" (${item.entry.id})`).join(', ')
  const more = items.length > NAMED ? `, and ${items.length - NAMED} more` : ''
  return `library: ${where}${bin ? '' : ` · ${label.toLowerCase()}`} · ${counted}${items.length > 0 ? `: ${named}${more}` : ''}`
}

interface Toast {
  text: string
  tone?: 'error'
  undo?: () => void
  /** The command its Undo calls. */
  command?: string
}

export function Home({ store, tabs, place, problem, onOpen }: HomeProps) {
  const bin = place === 'bin'
  const folder = place === 'bin' ? null : place.folder
  const [library, setLibrary] = useState<Library>()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(savedSort)
  const [active, setActive] = useState(0)
  const [renaming, setRenaming] = useState<ItemRef | null>(null)
  const renamingNow = useRef<ItemRef | null>(null)
  const [menu, setMenu] = useState<{ item: CardItem; x: number; y: number } | null>(null)
  const [moving, setMoving] = useState<CardItem | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: string; run: () => Promise<void> } | null>(null)
  const [settings, setSettings] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [elsewhere, setElsewhere] = useState<Set<string>>(() => tabs.editedElsewhere())
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const urls = useRef(new Map<string, string>())
  const list = useRef<HTMLDivElement>(null)
  // The rail's Search puts the caret in the search box, here or once this screen shows.
  const searchBox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const take = (): void => {
      if (!findWanted.value || !searchBox.current) return
      findWanted.set(false)
      searchBox.current.focus()
    }
    take()
    return findWanted.subscribe(take)
  }, [])
  // What the commands read: set with the state, so a command's next line sees it before the screen is drawn again.
  const now = useRef({ library, query, sort, elsewhere })
  now.current = { library, query, sort, elsewhere }

  const refresh = useCallback(async () => {
    try {
      const listed = await store.list()
      now.current.library = listed
      setLibrary(listed)
    } catch (error) {
      setToast({ text: `The library could not be read: ${(error as Error).message}`, tone: 'error' })
    }
  }, [store])
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Other tabs: the notes they edit, and changes that call for a fresh look.
  useEffect(() => {
    let live = true
    void tabs.survey().then((notes) => live && setElsewhere(notes))
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = tabs.subscribe((message) => {
      setElsewhere(tabs.editedElsewhere())
      if (message.t !== 'who') {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 150)
      }
    })
    const visible = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      live = false
      stop()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [tabs, refresh])

  // A toast goes by itself after a few seconds.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.undo ? 7000 : 5000)
    return () => clearTimeout(timer)
  }, [toast])

  // Thumbnails' picture addresses are let go when the page closes.
  useEffect(() => {
    const made = urls.current
    return () => made.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  const [, , key, order] = SORTS.find(([id]) => id === sort) ?? SORTS[0]!
  const searching = query.trim() !== ''
  const items = useMemo((): CardItem[] => (library ? itemsOf(library, bin, folder, query, key, order) : []), [library, bin, query, folder, key, order])

  // Thumbnails for the notes in view: the one kept, or drawn once for a note that has none, such as one just moved into the library.
  useEffect(() => {
    let live = true
    const notes = items.flatMap((item) => (item.kind === 'note' ? [item.entry] : []))
    void (async () => {
      for (const note of notes) {
        const name = `${note.id}@${note.edited}`
        if (!live) return
        if (urls.current.has(name)) continue
        let picture = await store.preview(note.id)
        if (!picture) {
          try {
            const opened = await store.open(note.id)
            picture = await drawThumbnail(opened.doc, (hash) => opened.assets.get(hash))
            if (picture) await store.setPreview(note.id, picture)
          } catch {
            continue
          }
        }
        if (!picture || !live) continue
        const url = URL.createObjectURL(picture)
        urls.current.set(name, url)
        setThumbs((now) => ({ ...now, [note.id]: url }))
      }
    })()
    return () => {
      live = false
    }
  }, [items, store])

  useEffect(() => setActive((now) => Math.min(now, Math.max(0, items.length - 1))), [items.length])

  /** Do a change through the storage and show how it went; a failure, after nothing changed, is thrown too, in the same words. */
  const act = async (change: () => Promise<void>, done?: Toast): Promise<void> => {
    try {
      await change()
    } catch (error) {
      const text = `${(error as Error).message || 'That did not work.'} Nothing was changed.`
      setToast({ text, tone: 'error' })
      await refresh()
      throw new Error(text, { cause: error })
    }
    tabs.libraryChanged()
    await refresh()
    if (done) setToast(done)
  }

  /** A note's or folder's name, as the library has it now. */
  const nameIn = (item: ItemRef): string => {
    const listed = now.current.library
    return (item.kind === 'note' ? listed?.notes.find((n) => n.id === item.id)?.title : listed?.folders.find((f) => f.id === item.id)?.name) ?? item.id
  }
  /** A folder (null: the top level) in words, as the toasts say it. */
  const folderWords = (id: string | null): string => (id === null ? 'the top level' : `“${now.current.library?.folders.find((f) => f.id === id)?.name ?? id}”`)

  /** The words that say a note, or a note inside a folder, is open in another tab, after showing them; undefined when none is. */
  const busyElsewhere = (item: ItemRef): string | undefined => {
    const { library: listed, elsewhere: open } = now.current
    const notes = item.kind === 'note' ? [item.id] : listed ? inside(listed, item.id).notes : []
    if (!notes.some((id) => open.has(id))) return undefined
    const text = item.kind === 'note' ? `“${nameIn(item)}” is open in another ${tabWord()}. Close it there first.` : `A note in “${nameIn(item)}” is open in another ${tabWord()}. Close it there first.`
    setToast({ text, tone: 'error' })
    return text
  }
  const refuseBusy = (item: ItemRef): void => {
    const busy = busyElsewhere(item)
    if (busy) throw new Error(busy)
  }

  const newNote = async (into: string | null): Promise<NewNote> => {
    try {
      const entry = await store.newNote(into)
      tabs.libraryChanged()
      onOpen(entry.id)
      return { id: entry.id, title: entry.title }
    } catch (error) {
      const text = `The note could not be made: ${(error as Error).message} Nothing was changed.`
      setToast({ text, tone: 'error' })
      throw new Error(text, { cause: error })
    }
  }
  const newFolder = async (into: string | null, name: string | undefined, by: By): Promise<string> => {
    let made: FolderEntry | undefined
    await act(async () => void (made = await store.newFolder(into)))
    const id = made!.id
    const wanted = name?.trim() ?? ''
    if (wanted !== '' && wanted !== made!.name) await act(() => store.rename({ kind: 'folder', id }, wanted))
    if (by === 'person') {
      // The person names it on its card, typed straight away.
      now.current.query = ''
      setQuery('')
      renamingNow.current = { kind: 'folder', id }
      setRenaming(renamingNow.current)
    }
    return `folder "${nameIn({ kind: 'folder', id })}" (${id}) made in ${folderWords(into)}`
  }
  const openFile = async (by: By): Promise<string> => {
    try {
      const imported = await importNote(store, folder)
      if (!imported) return 'not opened: the file picker was closed'
      tabs.libraryChanged()
      const damaged = imported.damaged > 0 ? `${imported.damaged === 1 ? 'One picture' : `${imported.damaged} pictures`} in this file did not match ${imported.damaged === 1 ? 'its' : 'their'} key, so the file was damaged; ${imported.damaged === 1 ? 'it shows' : 'they show'} as a grey box.` : ''
      if (damaged && by === 'person') window.alert(damaged)
      onOpen(imported.id)
      return `opened the file as note ${imported.id}${damaged ? `. ${damaged}` : ''}`
    } catch (error) {
      throw new Error(`This file could not be opened. ${(error as Error).message}`, { cause: error })
    }
  }
  const renameItem = async (item: ItemRef, name: string): Promise<string> => {
    if (item.kind === 'note') refuseBusy(item)
    const before = nameIn(item)
    await act(() => store.rename(item, name))
    return `${item.kind} "${before}" renamed "${name}"`
  }
  const move = async (item: ItemRef, to: string | null): Promise<string> => {
    const text = `Moved “${nameIn(item)}” to ${folderWords(to)}.`
    await act(() => store.move(item, to), { text })
    return text
  }
  const remove = async (item: ItemRef): Promise<string> => {
    refuseBusy(item)
    const name = nameIn(item)
    await act(() => store.delete(item), { text: `Moved “${name}” to Recently deleted.`, command: 'bin.restore', undo: () => commands.tap('bin.restore', { item: item.id }) })
    return `Moved “${name}” to Recently deleted, from where bin.restore brings it back.`
  }
  const restore = async (item: ItemRef): Promise<string> => {
    const listed = now.current.library
    const entry = item.kind === 'note' ? listed?.notes.find((n) => n.id === item.id) : listed?.folders.find((f) => f.id === item.id)
    const back = entry && ('folder' in entry ? entry.folder : entry.parent)
    const text = `Restored “${nameIn(item)}” to ${back && listed && isOpenFolder(listed, back) ? folderWords(back) : 'the top level'}.`
    await act(() => store.restore(item), { text })
    return text
  }
  const deleteForever = async (item: ItemRef, by: By): Promise<string> => {
    refuseBusy(item)
    const name = nameIn(item)
    const text = `Deleted “${name}” for good.`
    const gone = (): Promise<void> => act(() => store.deleteForever(item), { text })
    // The agent's call was asked already, in the terminal; a person is asked here.
    if (by === 'agent') return gone().then(() => text)
    setConfirm({
      title: 'Delete for good?',
      text: item.kind === 'folder' ? `“${name}” and everything in it will be gone for good. This cannot be undone.` : `“${name}” will be gone for good. This cannot be undone.`,
      action: 'Delete for good',
      run: () => gone().catch(() => undefined),
    })
    return 'asked the person first'
  }
  const emptyBin = async (by: By): Promise<string> => {
    const text = 'Recently deleted is empty.'
    const empty = (): Promise<void> => act(() => store.emptyBin(), { text })
    if (by === 'agent') return empty().then(() => text)
    setConfirm({
      title: 'Empty Recently deleted?',
      text: 'Everything in Recently deleted will be gone for good. This cannot be undone.',
      action: 'Empty it',
      run: () => empty().catch(() => undefined),
    })
    return 'asked the person first'
  }
  const searchFor = (text: string): string => {
    now.current.query = text
    setQuery(text)
    return text.trim() === '' ? 'search cleared' : `searching the library for "${text.trim()}"`
  }
  const sortBy = (date: SortKey | undefined, first: SortOrder | undefined): string => {
    const [, , nowKey, nowOrder] = SORTS.find(([id]) => id === now.current.sort) ?? SORTS[0]!
    const chosen = SORTS.find(([, , k, o]) => k === (date ?? nowKey) && o === (first ?? nowOrder))!
    now.current.sort = chosen[0]
    setSort(chosen[0])
    try {
      localStorage.setItem(SORT_KEY, chosen[0])
    } catch {
      // Kept for this visit only.
    }
    return `sorted: ${chosen[1].toLowerCase()}`
  }

  // This screen at the commands' disposal while it shows (app control): its buttons and the agent reach it alike.
  const own = useRef({ newNote, newFolder, openFile, renameItem, move, remove, restore, deleteForever, emptyBin, searchFor, sortBy })
  own.current = { newNote, newFolder, openFile, renameItem, move, remove, restore, deleteForever, emptyBin, searchFor, sortBy }
  const loaded = library !== undefined
  useEffect(() => {
    const at: LibraryAt = bin ? { bin: true } : { bin: false, folder }
    const place: HomePlace = {
      at: () => at,
      loaded: () => loaded,
      showing: () => libraryLine(now.current.library, bin, folder, now.current.query, now.current.sort),
      search: (text) => own.current.searchFor(text),
      sort: (date, first) => own.current.sortBy(date, first),
      newNote: (into) => own.current.newNote(into),
      newFolder: (into, name, by) => own.current.newFolder(into, name, by),
      openFile: (by) => own.current.openFile(by),
      rename: (item, name) => own.current.renameItem(item, name),
      move: (item, to) => own.current.move(item, to),
      remove: (item) => own.current.remove(item),
      restore: (item) => own.current.restore(item),
      deleteForever: (item, by) => own.current.deleteForever(item, by),
      emptyBin: (by) => own.current.emptyBin(by),
      openSettings: () => setSettings(true),
    }
    return commands.provide('home', place)
  }, [bin, folder, loaded])

  const open = (item: CardItem): void => {
    if (bin) return
    if (item.kind === 'note') commands.tap('note.open', { note: item.entry.id })
    else commands.tap('library.open', { folder: item.entry.id })
  }
  /** This folder, as the buttons give it: the commands' "left out" is the top. */
  const here = folder === null ? {} : { into: folder }
  const startRename = (item: CardItem): void => {
    if (item.kind === 'note' && busyElsewhere(ref(item))) return
    renamingNow.current = ref(item)
    setRenaming(renamingNow.current)
  }
  const finishRename = (item: CardItem, name: string | null): void => {
    // Enter, then the field's blur, both finish: only the first counts.
    if (renamingNow.current?.id !== item.entry.id) return
    renamingNow.current = null
    setRenaming(null)
    const wanted = name?.trim() ?? ''
    if (wanted === '' || wanted === nameOf(item)) return
    commands.tap(item.kind === 'note' ? 'note.rename' : 'folder.rename', item.kind === 'note' ? { note: item.entry.id, name: wanted } : { folder: item.entry.id, name: wanted })
  }
  const removeCard = (item: CardItem): void => commands.tap(item.kind === 'note' ? 'note.delete' : 'folder.delete', item.kind === 'note' ? { note: item.entry.id } : { folder: item.entry.id })

  const menuFor = (item: CardItem): MenuItem[] =>
    bin
      ? [
          { label: 'Restore', icon: <RotateCcw size={16} aria-hidden />, command: 'bin.restore', onSelect: () => commands.tap('bin.restore', { item: item.entry.id }) },
          { label: 'Delete for good', icon: <Trash2 size={16} aria-hidden />, danger: true, command: 'bin.deleteForever', onSelect: () => commands.tap('bin.deleteForever', { item: item.entry.id }) },
        ]
      : [
          { label: 'Open', icon: item.kind === 'note' ? <SquarePen size={16} aria-hidden /> : <FolderOpen size={16} aria-hidden />, command: item.kind === 'note' ? 'note.open' : 'library.open', onSelect: () => open(item) },
          // Rename and Move to… open the name field and the folder list; what is chosen there calls the command.
          { label: 'Rename', icon: <PenLine size={16} aria-hidden />, onSelect: () => startRename(item) },
          { label: 'Move to…', icon: <FolderInput size={16} aria-hidden />, onSelect: () => setMoving(item) },
          { label: 'Delete', icon: <Trash2 size={16} aria-hidden />, danger: true, command: item.kind === 'note' ? 'note.delete' : 'folder.delete', onSelect: () => removeCard(item) },
        ]

  /** Arrow keys, Home and End move between cards; F2 renames; Delete deletes. */
  const onCardKey = (index: number, item: CardItem, event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'F2' && !bin) {
      event.preventDefault()
      startRename(item)
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      if (bin) commands.tap('bin.deleteForever', { item: item.entry.id })
      else removeCard(item)
      return
    }
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('.card-open') ?? [])]
    let to: number | undefined
    if (event.key === 'ArrowRight') to = index + 1
    else if (event.key === 'ArrowLeft') to = index - 1
    else if (event.key === 'Home') to = 0
    else if (event.key === 'End') to = buttons.length - 1
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // The card in the next row up or down, nearest across.
      const here = buttons[index]!.getBoundingClientRect()
      const down = event.key === 'ArrowDown'
      const rows = buttons.map((button, i) => ({ i, rect: button.getBoundingClientRect() })).filter(({ rect }) => (down ? rect.top > here.top + 4 : rect.top < here.top - 4))
      if (rows.length > 0) {
        const top = down ? Math.min(...rows.map(({ rect }) => rect.top)) : Math.max(...rows.map(({ rect }) => rect.top))
        to = rows.filter(({ rect }) => Math.abs(rect.top - top) < 4).reduce((best, next) => (Math.abs(next.rect.left - here.left) < Math.abs(best.rect.left - here.left) ? next : best)).i
      }
    }
    if (to === undefined) return
    event.preventDefault()
    to = Math.max(0, Math.min(buttons.length - 1, to))
    setActive(to)
    buttons[to]?.focus()
  }

  const metaFor = (item: CardItem): string => {
    if (!library) return ''
    if (bin) {
      const deleted = item.entry.deleted ?? Date.now()
      const left = daysLeft(deleted, Date.now())
      return `Deleted ${ago(deleted)} · ${left === 1 ? '1 day' : `${left} days`} left`
    }
    if (searching) {
      const parent = item.kind === 'note' ? item.entry.folder : item.entry.parent
      const path = folderPath(library, parent).map((f) => f.name)
      return `In ${['Notes', ...path].join(' › ')}`
    }
    if (item.kind === 'folder') {
      const { folders, notes } = counts(library, item.entry.id)
      const parts = [notes > 0 ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : '', folders > 0 ? `${folders} ${folders === 1 ? 'folder' : 'folders'}` : ''].filter(Boolean)
      return parts.length > 0 ? parts.join(' · ') : 'Empty'
    }
    return `Edited ${ago((item.entry as NoteEntry).edited)}`
  }

  const path = library ? folderPath(library, folder) : []
  const missing = !bin && library !== undefined && !isOpenFolder(library, folder)
  const libraryEmpty = library !== undefined && !bin && folder === null && !searching && items.length === 0

  return (
    <div className="home">
      <main className="home-main">
        <header className="home-head" data-tauri-drag-region="deep">
          {bin ? (
            <h1 className="home-title">Recently deleted</h1>
          ) : (
            <nav className="crumbs" aria-label="Folder path">
              <a href="#/" data-command="library.open" aria-current={folder === null && !searching ? 'page' : undefined}>
                Notes
              </a>
              {path.map((step) => (
                <span key={step.id} className="crumb">
                  <ChevronRight size={16} aria-hidden />
                  <a href={href(step.id)} data-command="library.open" aria-current={step.id === folder && !searching ? 'page' : undefined}>
                    {step.name}
                  </a>
                </span>
              ))}
              {searching ? (
                <span className="crumb">
                  <ChevronRight size={16} aria-hidden />
                  <span aria-current="page">Search</span>
                </span>
              ) : null}
            </nav>
          )}
          {!bin ? (
            <label className="search">
              <Search size={16} aria-hidden />
              <input
                ref={searchBox}
                type="search"
                aria-label="Search notes by title"
                placeholder="Search notes"
                maxLength={200}
                data-command="library.search"
                value={query}
                onChange={(event) => commands.tap('library.search', { text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query !== '') {
                    event.preventDefault()
                    commands.tap('library.search', { text: '' })
                  }
                }}
              />
              {query !== '' ? (
                <button type="button" className="icon-button search-clear" aria-label="Clear search" data-command="library.search" onClick={() => commands.tap('library.search', { text: '' })}>
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </label>
          ) : null}
        </header>

        {problem ? (
          <div className="notice" data-tone="warn" role="alert">
            <TriangleAlert size={16} aria-hidden />
            <span>{problem}</span>
          </div>
        ) : null}

        <div className="home-actions">
          {bin ? (
            <>
              <p className="home-hint">Deleted notes and folders stay here for 30 days, then go for good.</p>
              <button type="button" className="button danger-quiet" disabled={items.length === 0} data-command="bin.empty" onClick={() => commands.tap('bin.empty')}>
                <Trash2 size={16} aria-hidden />
                Empty Recently deleted
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button primary" data-command="note.new" onClick={() => commands.tap('note.new', here)}>
                <FilePlus size={17} aria-hidden />
                New note
              </button>
              <button type="button" className="button" data-command="folder.new" onClick={() => commands.tap('folder.new', here)}>
                <FolderPlus size={17} aria-hidden />
                New folder
              </button>
              <button type="button" className="button" title="Open a .shellnote file into this folder" data-command="file.open" onClick={() => commands.press('file.open')}>
                <FolderOpen size={17} aria-hidden />
                Open file
              </button>
              <label className="sort">
                <ArrowUpDown size={15} aria-hidden />
                <select
                  aria-label="Sort"
                  data-command="library.sort"
                  value={sort}
                  onChange={(event) => {
                    const [, , by, first] = SORTS.find(([id]) => id === event.target.value) ?? SORTS[0]!
                    commands.tap('library.sort', { by, order: first })
                  }}
                >
                  {SORTS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {missing ? (
          <div className="empty">
            <FolderOpen size={36} strokeWidth={1.25} aria-hidden />
            <h2>This folder is not in the library any more</h2>
            <p>
              It may have been deleted. <a href="#/">Back to Notes</a>
            </p>
          </div>
        ) : library === undefined ? (
          <p className="home-hint">Opening your library…</p>
        ) : items.length === 0 ? (
          <div className="empty">
            {libraryEmpty ? (
              <>
                <span className="empty-art" aria-hidden>
                  <NotebookPen size={34} strokeWidth={1.4} />
                </span>
                <h2>Your library is empty</h2>
                <p>Make your first note, or open a .shellnote file.</p>
                <button type="button" className="button primary" data-command="note.new" onClick={() => commands.tap('note.new', here)}>
                  <FilePlus size={17} aria-hidden />
                  New note
                </button>
              </>
            ) : bin ? (
              <>
                <Trash2 size={34} strokeWidth={1.25} aria-hidden />
                <h2>Recently deleted is empty</h2>
                <p>Notes and folders you delete wait here for 30 days.</p>
              </>
            ) : searching ? (
              <>
                <Search size={34} strokeWidth={1.25} aria-hidden />
                <h2>Nothing matches “{query.trim()}”</h2>
                <p>Check the spelling, or search for fewer words.</p>
              </>
            ) : (
              <>
                <FolderOpen size={34} strokeWidth={1.25} aria-hidden />
                <h2>This folder is empty</h2>
                <p>Add a note or a folder with the buttons above.</p>
              </>
            )}
          </div>
        ) : (
          <div ref={list} className="cards" role="list" aria-label={bin ? 'Recently deleted' : searching ? 'Search results' : 'Folders and notes'}>
            {items.map((item, index) => (
              <Card
                key={`${item.kind}:${item.entry.id}`}
                item={item}
                {...(bin ? {} : { command: item.kind === 'note' ? 'note.open' : 'library.open' })}
                meta={metaFor(item)}
                {...(item.kind === 'note' && thumbs[item.entry.id] ? { thumbnail: thumbs[item.entry.id] } : {})}
                active={index === active}
                renaming={renaming?.id === item.entry.id}
                elsewhere={item.kind === 'note' && elsewhere.has(item.entry.id)}
                onOpen={() => (bin ? setMenu({ item, x: 0, y: 0 }) : open(item))}
                onMenu={(x, y) => setMenu({ item, x, y })}
                onRename={(name) => finishRename(item, name)}
                onKey={(event) => onCardKey(index, item, event)}
                onFocus={() => setActive(index)}
              />
            ))}
          </div>
        )}

        <p className="keep-note">
          <Info size={15} aria-hidden />
          {inDesktopApp() ? 'Notes are kept by the app, on this computer.' : 'Notes are kept in this browser, which can clear them.'} A dot on a card means changes not yet in a .shellnote file: open the note and choose Save to keep a copy that lasts.
        </p>
      </main>

      {menu ? <Menu x={menu.x || window.innerWidth / 2} y={menu.y || window.innerHeight / 2} label={`Actions for ${nameOf(menu.item)}`} items={menuFor(menu.item)} onClose={() => setMenu(null)} /> : null}
      {moving && library ? (
        <MoveDialog
          library={library}
          item={ref(moving)}
          name={nameOf(moving)}
          from={moving.kind === 'note' ? moving.entry.folder : moving.entry.parent}
          onClose={() => setMoving(null)}
          onMove={(to) => {
            const item = moving
            setMoving(null)
            const into = to === null ? {} : { into: to }
            commands.tap(item.kind === 'note' ? 'note.move' : 'folder.move', item.kind === 'note' ? { note: item.entry.id, ...into } : { folder: item.entry.id, ...into })
          }}
        />
      ) : null}
      {confirm ? (
        <Dialog
          title={confirm.title}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  const now = confirm
                  setConfirm(null)
                  void now.run()
                }}
              >
                {confirm.action}
              </button>
            </>
          }
        >
          <p>{confirm.text}</p>
        </Dialog>
      ) : null}
      {settings ? <Settings onClose={() => setSettings(false)} /> : null}
      {toast ? (
        <div className="toast" role={toast.tone === 'error' ? 'alert' : 'status'} data-tone={toast.tone}>
          <span>{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              className="toast-action"
              data-command={toast.command}
              onClick={() => {
                const undo = toast.undo!
                setToast(null)
                undo()
              }}
            >
              Undo
            </button>
          ) : null}
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setToast(null)}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  )
}
