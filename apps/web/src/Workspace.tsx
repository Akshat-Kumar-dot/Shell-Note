// One note on screen: the app bar (back to the library, the title and how safe
// the note is; the tools; zoom and the file buttons), the floating format bar,
// and the pages. The note is kept in the library a moment after every change,
// through the storage interface, and a thumbnail of its first page is drawn
// once edits settle and when leaving. If another tab edits the same note, this
// tab shows it read-only and says so, with a button to edit it here instead. A
// sample note (?sample=…) is never kept. The AI works on what is chosen,
// through the ✨ button or Ctrl+K; its answers and its log show in a panel
// beside the pages, and the log is kept beside the note in the library, never
// in its file.
import { ValidationError, type Doc, type LogEntry, type Selection } from '@shellnote/core'
import { aiEdit, AiLayer, AskPanel, AssetStore, CHANGED_SINCE, checkDiagram, commands, EditorStore, undoEdit, type By, type NewNote, FormatBar, LogPanel, PageView, ToolStrip, useUndoKeys, BarStrip, EditorArea, MovableBar, ProgramButton, programHost, showSideTab, SidePanelButton, sideTab, tabWord, VideoButton, workspace, inDesktopApp, type AiHost, type AskAnswer, type LogItem } from '@shellnote/editor'
import { openAICompatible } from '@shellnote/providers'
import { ChevronLeft, FilePlus, FolderOpen, Minus, Plus, Save, ScrollText, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { loadLog, saveLog } from './ai/log.js'
import { loadSettings, missing, modelFrom, savedKey } from './ai/settings.js'
import { keepWhenClosing } from './desktop.js'
import { importNote } from './library/importing.js'
import { LibrarySide, useLibrarySideAt } from './library/LibrarySide.js'
import { libraryPictures } from './library/pictures.js'
import { Settings } from './library/Settings.js'
import type { LibraryStore } from './library/store.js'
import type { Tabs } from './library/tabs.js'
import { drawThumbnail } from './library/thumbnail.js'
import { unsaved } from './library/tree.js'
import { type FileState } from './storage/cache.js'
import { noteBytes, saveFile } from './storage/files.js'

declare global {
  interface Window {
    /** For the end-to-end tests: the store, the note as it is now, and the rev last kept in the library. Development builds only. */
    __shellnote?: {
      store: EditorStore
      /** The app's commands: the agent's door, for the browser tests (app control). */
      commands: typeof commands
      /** The program panel's host: a browser test gives a stand-in (the panel is the app's on Windows only). */
      programHost: typeof programHost
      readonly doc: Doc
      readonly keptRev: number | undefined
      /**
       * One benchmark case through the app's own AI path, on a note of its own,
       * as the benchmark ran it: tier 0 off, and the model by its id at the
       * address the AI settings give, so its operation set is guessed alike.
       * With `mermaid` false, diagrams are not checked, as in the benchmark.
       */
      replay: (model: string, doc: Doc, selection: Selection, instruction: string, recent?: string[], mermaid?: boolean) => Promise<Pick<LogEntry, 'ops' | 'result'>>
    }
  }
}

/** For the replay test: an edit as the app makes it. */
async function replay(model: string, doc: Doc, selection: Selection, instruction: string, recent?: string[], mermaid = true): Promise<Pick<LogEntry, 'ops' | 'result'>> {
  const own = new EditorStore(doc)
  own.select(selection, 'objects')
  const chosen = openAICompatible({ baseUrl: loadSettings().baseUrl, model, label: 'lmstudio' })
  const edit = await aiEdit(own, { instruction, model: chosen, tier0: false, ...(recent ? { recent } : {}), ...(mermaid ? { checks: { mermaid: checkDiagram } } : {}) })
  return { ops: edit.entry.ops, result: edit.entry.result }
}

/** A note open on screen: its store, where it lives in the library (undefined for a sample), and the file it belongs to. */
export interface Session {
  key: number
  store: EditorStore
  note: string | undefined
  folder: string | null
  file: FileState | undefined
}

/** Each session's number: a new one makes the page view and the AI start afresh (their React `key`). */
let sessions = 0

/** A session for a document, its pictures' bytes loaded into the editor's store. */
export async function sessionFor(doc: Doc, assets: ReadonlyMap<string, Blob>, place: { note: string | undefined; folder: string | null; file: FileState | undefined }): Promise<Session> {
  const store = new AssetStore()
  for (const [hash, blob] of assets) {
    const asset = doc.asset[hash]
    if (asset) await store.put(hash, blob, asset.mime)
  }
  return { key: ++sessions, store: new EditorStore(doc, store), ...place }
}

/** A hint a person can act on, from an error. */
function hintOf(error: unknown): string {
  return error instanceof ValidationError || error instanceof Error ? error.message : String(error)
}

/**
 * After two frames are drawn, when the layout has settled after the last
 * change: its own frame callback was asked for first, and text it pushed onto
 * a new page settles in the frame after. A hidden tab draws no frames, so 150
 * ms at most.
 */
function nextFrame(): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, 150)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer)
        done()
      }),
    )
  })
}

/** Room above the first page for the floating format bar, in screen pixels. */
const FORMAT_BAR_SPACE = 64

/** How long after the last change the thumbnail is drawn again. */
const THUMB_AFTER = 2000

export interface WorkspaceProps {
  library: LibraryStore
  tabs: Tabs
  session: Session
  /** Back to the library, in the folder the note is in. */
  onHome: (folder: string | null) => void
  /** Open another note of the library. */
  onOpen: (id: string) => void
}

export function Workspace({ library, tabs, session: first, onHome, onOpen }: WorkspaceProps) {
  const [session, setSession] = useState(first)
  const { store, note, folder } = session
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  const [zoom, setZoom] = useState(1)
  const [file, setFile] = useState(session.file)
  const fileRef = useRef(file)
  fileRef.current = file
  const [keptRev, setKeptRev] = useState<number>()
  const kept = useRef<number | undefined>(undefined)
  // A library note is checked against other tabs before it can be edited; a sample is edited at once, and never kept.
  const [mode, setMode] = useState<'checking' | 'edit' | 'view'>(note === undefined ? 'edit' : 'checking')
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [notice, setNotice] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const [now, setNow] = useState(Date.now)
  const [openedAt] = useState(Date.now)
  const editing = mode === 'edit'
  useUndoKeys(store, editing)
  // The AI's answers and its log, shown in the side panel's Output, and Settings opened from the prompt box.
  const [answer, setAnswer] = useState<{ n: number; answer: AskAnswer }>()
  const [log, setLog] = useState<LogItem[]>([])
  const logRef = useRef(log)
  logRef.current = log
  const [settings, setSettings] = useState(false)
  // The library beside the note, on the side the person keeps it.
  const [sideAt, moveSide] = useLibrarySideAt()


  useEffect(() => {
    document.title = `${doc.title} – ShellNote`
    return () => {
      document.title = 'ShellNote'
    }
  }, [doc.title])

  // Keeping the note in the library a moment after each change, at once when the page is hidden, and when leaving.
  const keepNow = useRef<() => Promise<void>>(async () => {})
  const drawNow = useRef<() => Promise<void>>(async () => {})
  /** Set when this tab steps back because another tab saved the same note: then it must not save its own copy over that one. */
  const steppingBack = useRef(false)
  useEffect(() => {
    if (note === undefined || !editing) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let drawTimer: ReturnType<typeof setTimeout> | undefined
    let queue = Promise.resolve()
    let drawn = store.doc.rev
    const write = (): Promise<void> => {
      clearTimeout(timer)
      const now = store.doc
      const file = fileRef.current
      // One write at a time, in order, and a failed one, told here, does not stop the next.
      queue = queue
        .then(() => library.save({ doc: now, blob: (hash) => store.assets.blob(hash), file }))
        .then(
          () => {
            kept.current = now.rev
            setKeptRev(now.rev)
            setProblem(undefined)
            tabs.saved(note)
          },
          (error: unknown) => setProblem(`${inDesktopApp() ? 'The app' : 'This browser'} could not keep the latest changes: ${hintOf(error)} Save the note to a file to keep them.`),
        )
      return queue
    }
    // The thumbnail is a small picture of page 1, drawn from the note's blocks once edits have settled.
    const draw = async (): Promise<void> => {
      clearTimeout(drawTimer)
      const now = store.doc
      if (now.rev === drawn) return
      drawn = now.rev
      try {
        const picture = await drawThumbnail(now, (hash) => store.assets.blob(hash))
        if (picture) await library.setPreview(note, picture)
      } catch (error) {
        console.warn('shellnote: the thumbnail was not drawn', error)
      }
    }
    keepNow.current = write
    drawNow.current = draw
    // In the desktop app, the note is kept before its window goes (desktop.ts).
    const unkeep = keepWhenClosing(async () => {
      await write()
      await draw()
    })
    const later = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => void write(), 400)
      clearTimeout(drawTimer)
      drawTimer = setTimeout(() => void draw(), THUMB_AFTER)
    }
    const stop = store.subscribe(later)
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') {
        void write()
        void draw()
      }
    }
    document.addEventListener('visibilitychange', hidden)
    void write()
    return () => {
      stop()
      clearTimeout(timer)
      clearTimeout(drawTimer)
      document.removeEventListener('visibilitychange', hidden)
      unkeep()
      // Anything not kept yet is kept now, on the way out; not when stepping back for another tab's copy.
      if (steppingBack.current) return
      void write()
      void draw()
    }
  }, [store, note, editing, library, tabs])

  /** Keep the note and its thumbnail now, before leaving it or handing it to another tab. */
  const flush = useCallback(async (): Promise<void> => {
    if (modeRef.current !== 'edit') return
    await keepNow.current()
    await drawNow.current()
  }, [])

  /** The note as the library has it now, in a fresh session: after another tab saved it. */
  const reload = useCallback(async (): Promise<void> => {
    if (note === undefined) return
    try {
      const opened = await library.open(note)
      const next = await sessionFor(opened.doc, opened.assets, { note, folder: opened.entry.folder, file: opened.file })
      setSession(next)
      setFile(opened.file)
    } catch (error) {
      setProblem(`The note could not be read again: ${hintOf(error)}`)
    }
  }, [library, note])

  // Two tabs on one note: the second shows it read-only; "Edit here" asks the first to save and step back.
  const taking = useRef(false)
  useEffect(() => {
    if (note === undefined) return
    let live = true
    // Asks the other tabs which notes they edit: until they answer (or do not), the note stays `checking`.
    void tabs.survey(150).then((others) => {
      if (!live) return
      if (others.has(note)) {
        setMode('view')
        setNotice(`This note is open in another ${tabWord()}, so it is read-only here and the ${tabWord()}s never overwrite each other.`)
      } else {
        tabs.editing(note)
        steppingBack.current = false
        setMode('edit')
      }
    })
    // `take`: another tab wants the note: keep everything, then step back. `saved`: another tab wrote it. `released`:
    // the tab this one asked has stepped back, so this one takes over.
    const stop = tabs.subscribe((message) => {
      if (!('note' in message) || message.note !== note) return
      if (message.t === 'take' && modeRef.current === 'edit') {
        void flush().then(() => {
          // Everything is kept; from here on this tab must not save over the one taking the note.
          steppingBack.current = true
          tabs.released(note)
          setMode('view')
          setNotice(`This note is being edited in another ${tabWord()} now, so it is read-only here.`)
        })
      } else if (message.t === 'saved' && modeRef.current === 'view') {
        void reload()
      } else if (message.t === 'saved' && modeRef.current === 'edit') {
        // Both tabs were editing it: this one steps back and shows what the other kept.
        steppingBack.current = true
        setMode('view')
        setNotice(`This note was also changed in another ${tabWord()}. It is read-only here, showing what the other ${tabWord()} kept.`)
        void reload()
      } else if (message.t === 'released' && taking.current) {
        taking.current = false
        void reload().then(() => {
          tabs.editing(note)
          steppingBack.current = false
          setMode('edit')
          setNotice(undefined)
        })
      }
    })
    const bye = (): void => tabs.editing(undefined)
    window.addEventListener('pagehide', bye)
    return () => {
      live = false
      stop()
      window.removeEventListener('pagehide', bye)
      tabs.editing(undefined)
    }
  }, [note, tabs, flush, reload])

  const editHere = (): void => {
    if (note === undefined) return
    taking.current = true
    tabs.take(note)
    // A tab that has closed meanwhile never answers: edit here after a moment anyway.
    setTimeout(() => {
      if (!taking.current) return
      taking.current = false
      void reload().then(() => {
        tabs.editing(note)
        steppingBack.current = false
        setMode('edit')
        setNotice(undefined)
      })
    }, 1500)
  }

  // The note's AI log, read from the library; a sample's lasts while it is open.
  useEffect(() => {
    setLog([])
    if (note === undefined) return
    let live = true
    loadLog(note).then(
      (items) => live && setLog(items),
      (error: unknown) => console.warn('shellnote: the AI log could not be read', error),
    )
    return () => {
      live = false
    }
  }, [note])
  const keepLog = useCallback(
    (items: LogItem[]): void => {
      logRef.current = items
      setLog(items)
      if (note !== undefined) saveLog(note, items).catch((error: unknown) => console.warn('shellnote: the AI log could not be kept', error))
    },
    [note],
  )
  const host = useMemo<AiHost>(
    () => ({
      model: () => {
        const chosen = loadSettings()
        const key = savedKey()
        return modelFrom(chosen, key) ?? missing(chosen, key)!
      },
      openSettings: () => setSettings(true),
      logged: (entry, undo) => keepLog([...logRef.current, { entry, ...(undo ? { undo } : {}) }]),
      answered: (asked) => {
        setAnswer((now) => ({ n: (now?.n ?? 0) + 1, answer: asked }))
        showSideTab('output')
      },
      recent: () => logRef.current.map((item) => item.entry),
      paid: () => loadSettings().provider === 'openrouter',
    }),
    [keepLog],
  )

  // The open note, at the commands' disposal while it is open (app control): its buttons and the agent reach it alike.
  useEffect(() => commands.provide('note', { store }), [store])
  // The library's other notes' pictures, for the agent to place in this one (note control, step 3).
  useEffect(() => commands.provide('pictures', libraryPictures(library, note)), [library, note])

  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__shellnote = {
        store,
        commands,
        programHost,
        get doc() {
          return store.doc
        },
        get keptRev() {
          return kept.current
        },
        replay,
      }
    }
  }, [store])

  // The status line says how long ago the file was saved.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(tick)
  }, [])

  const leave = async (): Promise<void> => {
    await flush()
    onHome(folder)
  }

  /** Save (file.save, file.saveAs): says where it went; a failure is thrown, its words ready for an alert or the agent. */
  const save = async (saveAs: boolean): Promise<string> => {
    try {
      // The layout settles on the next frame after a change (a frame's height, text pushed onto a new
      // page): saved before it, the file would miss it, and opening the file again would make a copy
      // of the note (found in testing on a busy laptop).
      await nextFrame()
      const current = store.doc
      const saved = await saveFile(await noteBytes(current, store.assets), current.title, fileRef.current?.handle, saveAs)
      if (!saved) return 'not saved: the file picker was closed'
      const next: FileState = { name: saved.name, rev: current.rev, savedAt: Date.now(), ...(saved.handle ? { handle: saved.handle } : {}) }
      fileRef.current = next
      setFile(next)
      setNow(Date.now())
      if (editing) await keepNow.current()
      return `saved to ${saved.name}`
    } catch (error) {
      throw new Error(`The note could not be saved. ${hintOf(error)}`, { cause: error })
    }
  }

  /** Open a file into the library (file.open), and show it; a damaged picture told as an alert to a person, in words to the agent. */
  const openFile = async (by: By): Promise<string> => {
    await flush()
    try {
      const imported = await importNote(library, folder)
      if (!imported) return 'not opened: the file picker was closed'
      tabs.libraryChanged()
      const damaged = imported.damaged > 0 ? `${imported.damaged === 1 ? 'One picture' : `${imported.damaged} pictures`} in this file did not match ${imported.damaged === 1 ? 'its' : 'their'} key, so the file was damaged; ${imported.damaged === 1 ? 'it shows' : 'they show'} as a grey box.` : ''
      if (damaged && by === 'person') window.alert(damaged)
      onOpen(imported.id)
      return `opened the file as note ${imported.id}${damaged ? `. ${damaged}` : ''}`
    } catch (error) {
      throw new Error(`This file could not be opened. ${hintOf(error)}`, { cause: error })
    }
  }

  /** A new note (note.new) in a folder, this one's for its button, and show it. */
  const newNote = async (into: string | null): Promise<NewNote> => {
    await flush()
    try {
      const entry = await library.newNote(into)
      tabs.libraryChanged()
      onOpen(entry.id)
      return { id: entry.id, title: entry.title }
    } catch (error) {
      throw new Error(`A new note could not be made. ${hintOf(error)}`, { cause: error })
    }
  }

  // This screen at the commands' disposal while it is open (app control): its buttons and the agent reach it alike.
  const zoomNow = useRef(zoom)
  zoomNow.current = zoom
  const editingNow = useRef(editing)
  editingNow.current = editing
  /** The AI's last change still in its log, undone (ai.undo), as the log's Undo does. */
  const undoAi = (): string => {
    const items = logRef.current
    const index = items.findLastIndex((item) => item.undo !== undefined && !item.undone)
    if (index < 0) throw new Error('The AI has made no change to undo in this note.')
    if (!editing) throw new Error('This note is read-only here: it is being edited in another window.')
    const item = items[index]!
    if (!undoEdit(store, item.undo!)) throw new Error(CHANGED_SINCE)
    keepLog(items.map((it, i) => (i === index ? { ...it, undone: true } : it)))
    return `undone: the AI's change "${item.entry.instruction}"`
  }
  /** Edit here instead (note.editHere): the other window keeps its work and steps back. */
  const takeOver = (): string => {
    if (note === undefined) return 'a sample note is edited here already'
    if (modeRef.current === 'edit') return 'this window edits the note already'
    if (modeRef.current === 'checking') throw new Error('The note is still asking the other windows whether one edits it: try again in a moment.')
    editHere()
    return 'taking over: the other window keeps its work and becomes read-only; the note is editable here in a moment (look)'
  }
  // A ref, given anew with each draw: the commands below are provided once, and reach this draw's functions through it.
  const own = useRef({ save, openFile, newNote, leave, rename: (title: string): void => void title, undoAi, takeOver })
  own.current = { save, openFile, newNote, leave, rename: (title: string) => rename(title), undoAi, takeOver }
  useEffect(
    () =>
      commands.provide('workspace', {
        zoom: () => zoomNow.current,
        setZoom,
        close: () => own.current.leave(),
        save: (as) => own.current.save(as),
        openFile: (by) => own.current.openFile(by),
        newNote: (into) => own.current.newNote(into),
        rename: (title) => own.current.rename(title),
        editing: () => editingNow.current,
        entry: () => note,
        ready: () => modeRef.current !== 'checking',
        openSettings: () => setSettings(true),
        undoAi: () => own.current.undoAi(),
        editHere: () => own.current.takeOver(),
      }),
    // Given again once the other windows have answered, so a command waiting for this screen hears it is ready.
    [mode === 'checking'],
  )

  // Ctrl+S saves (with Shift: to a new file), and Ctrl+O opens; ⌘ on a Mac.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A key the text or a Select box has already used is theirs.
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        commands.press(event.shiftKey ? 'file.saveAs' : 'file.save')
      } else if (key === 'o' && !event.shiftKey) {
        event.preventDefault()
        commands.press('file.open')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The side panel's Output: the latest answer over the AI log.
  // Made again only when an answer or the log changes, not with each key typed.
  const parts = useMemo(
    () => ({
      answers: (
        <>
          {answer ? <AskPanel key={answer.n} answer={answer.answer} store={store} onClose={() => setAnswer(undefined)} /> : null}
          <LogPanel items={log} store={store} onUndone={(index) => keepLog(log.map((item, i) => (i === index ? { ...item, undone: true } : item)))} />
        </>
      ),
      host,
    }),
    [answer, log, store, keepLog, host],
  )
  const saved = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const tabOpen = useSyncExternalStore(sideTab.subscribe, sideTab.snapshot)
  const logShown = saved.side && tabOpen === 'output'
  // The Program panel's button, in the app on Windows: the bar's end is a button wider, so the tools take a row of their
  // own sooner (app.css).
  const programs = useSyncExternalStore(programHost.subscribe, programHost.snapshot) !== undefined
  const appbar = useOneRow()

  // The bars, each where its person left it: along the top, a side, the bottom, or floating.
  const bars = useSyncExternalStore(workspace.subscribe, workspace.snapshot).bars
  // Made once a note: a key typed redraws the tools and the format bar themselves (they follow the note), never these.
  const toolsBar = useMemo(
    () =>
      editing ? (
        <MovableBar key="tools" id="tools" label="tools bar">
          <ToolStrip store={store} />
        </MovableBar>
      ) : null,
    [editing, store],
  )
  const formatBar = useMemo(
    () =>
      editing ? (
        <MovableBar key="format" id="format" label="format bar">
          <FormatBar store={store} />
        </MovableBar>
      ) : null,
    [editing, store],
  )
  const formatOnTop = bars.format.at === 'top'
  // The notes being edited, made once a note and zoom: the page view follows the note itself, key by key (with a
  // store, PageView shows the store's own note), so the workspace round it is not drawn again for each key.
  const notes = useMemo(
    () => (
      <div className="pages-area">
        {/* The format bar floats over the desk, so a change in its size never moves the pages; over the pages only, never a video beside them. */}
        {formatOnTop ? <div className="format-row">{formatBar}</div> : null}
        <PageView key={session.key} doc={store.doc} zoom={zoom} onZoom={setZoom} store={store} topSpace={formatOnTop ? FORMAT_BAR_SPACE : 0} />
      </div>
    ),
    [formatOnTop, formatBar, session.key, store, zoom],
  )
  const hasBars = (at: 'left' | 'right' | 'bottom'): boolean => bars.tools.at === at || bars.format.at === at
  const barsAt = (at: 'left' | 'right' | 'bottom' | 'float') => [bars.tools.at === at ? toolsBar : null, bars.format.at === at ? formatBar : null]

  const rename = (title: string): void => {
    // `key`: keys typed in quick succession make one undo step.
    if (editing && title !== store.doc.title) store.apply([{ op: 'update', id: store.doc.id, set: { title } }], { key: `title:${store.doc.id}` })
  }
  const status = statusOf(doc, file, note === undefined, now, openedAt)
  const librarySide = <LibrarySide store={library} tabs={tabs} note={note} folder={folder} title={doc.title} at={sideAt} onMove={moveSide} />

  return (
    <div className="app">
      <header ref={appbar} className="appbar" data-tauri-drag-region="deep" data-tools-away={editing && bars.tools.at !== 'top' ? '' : undefined} data-program={editing && programs ? '' : undefined}>
        <div className="appbar-side">
          <button type="button" className="icon-button" aria-label="Back to notes" title="Back to notes" data-command="note.close" onClick={() => commands.press('note.close')}>
            <ChevronLeft size={20} aria-hidden />
          </button>
          <input
            className="title"
            aria-label="Title"
            data-command="note.rename"
            spellCheck={false}
            value={doc.title}
            readOnly={!editing}
            onChange={(event) => rename(event.target.value)}
            onBlur={(event) => {
              if (event.target.value.trim() === '') rename('Untitled')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
 {/* The save words are the Save button's: kept here unseen, for screen readers to read as they change. */}
          <span className="file-status" role="status" data-kept-rev={keptRev}>
            {status.text}
          </span>
        </div>
        <div className="appbar-middle">{bars.tools.at === 'top' ? toolsBar : null}</div>
        <div className="appbar-side appbar-end">
          {editing ? <VideoButton store={store} /> : null}
          {editing ? <SidePanelButton /> : null}
          {editing ? <ProgramButton /> : null}
          {editing ? (
            <button
              type="button"
              className="icon-button"
              aria-label="AI log"
              aria-pressed={logShown}
              title="The AI log: every request on this note, with Undo"
              data-command="output.answers"
              onClick={() => commands.tap('output.answers')}
            >
              <ScrollText size={18} aria-hidden />
            </button>
          ) : null}
          <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" data-command="screen.zoom" onClick={() => commands.press('screen.zoom', { step: 'out' })}>
              <Minus size={16} aria-hidden />
            </button>
            <button type="button" className="zoom-level" aria-label="Actual size" title="Actual size" data-command="screen.zoom" onClick={() => commands.press('screen.zoom', { step: 'actual' })}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" data-command="screen.zoom" onClick={() => commands.press('screen.zoom', { step: 'in' })}>
              <Plus size={16} aria-hidden />
            </button>
          </div>
          <div className="file" role="group" aria-label="File">
            <button type="button" className="icon-button" aria-label="New note" title="A new note in this folder" data-command="note.new" onClick={() => commands.press('note.new', folder === null ? {} : { into: folder })}>
              <FilePlus size={18} aria-hidden />
            </button>
            <button type="button" className="icon-button" aria-label="Open file" title="Open a .shellnote file (Ctrl+O)" data-command="file.open" onClick={() => commands.press('file.open')}>
              <FolderOpen size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="button primary save"
              aria-label="Save"
              title={`${status.text}. Save the note to a .shellnote file, the copy that lasts (Ctrl+S; Ctrl+Shift+S for a new file). ${status.kept}`}
              data-unsaved={status.changed ? '' : undefined}
              data-late={status.late ? '' : undefined}
              data-command="file.save"
              onClick={() => commands.press('file.save')}
            >
              <Save size={16} aria-hidden />
              <span>Save</span>
            </button>
          </div>
        </div>
      </header>

      {notice || problem ? (
        <div className="notice" data-tone={problem ? 'error' : 'info'} role={problem ? 'alert' : 'status'}>
          <TriangleAlert size={16} aria-hidden />
          <span>{problem ?? notice}</span>
          {!editing && mode === 'view' ? (
            <button type="button" className="button" data-command="note.editHere" onClick={() => commands.tap('note.editHere')}>
              Edit here instead
            </button>
          ) : null}
        </div>
      ) : null}
      <main className="main">
        {sideAt === 'left' ? librarySide : null}
        {editing && hasBars('left') ? <BarStrip side="left">{barsAt('left')}</BarStrip> : null}
        {editing ? (
          <div className="main-middle">
            <EditorArea store={store} parts={parts}>
              {notes}
            </EditorArea>
            {hasBars('bottom') ? <BarStrip side="bottom">{barsAt('bottom')}</BarStrip> : null}
          </div>
        ) : (
          <div className="pages-area">
            {mode === 'view' || mode === 'checking' ? (
              <PageView doc={doc} zoom={zoom} onZoom={setZoom} assets={store.assets.snapshot()} />
            ) : (
              <PageView key={session.key} doc={doc} zoom={zoom} onZoom={setZoom} store={store} topSpace={FORMAT_BAR_SPACE} />
            )}
          </div>
        )}
        {editing && hasBars('right') ? <BarStrip side="right">{barsAt('right')}</BarStrip> : null}
        {editing ? barsAt('float') : null}
        {sideAt === 'right' ? librarySide : null}
      </main>
      {editing ? <AiLayer key={session.key} store={store} host={host} enabled={editing} /> : null}
      {settings ? <Settings onClose={() => setSettings(false)} /> : null}
    </div>
  )
}

/** After this long with changes not in a file, the status line asks for a save. */
const LATE = 10 * 60_000
const KEPT = inDesktopApp()
  ? 'The app keeps the note in your library on this computer as you work. The file you save is the copy that lasts.'
  : 'This browser keeps the note in your library as you work, but a browser can clear what it keeps. The file you save is the copy that lasts.'
const NOT_KEPT = 'A sample note is not kept. Save it to a file to keep it.'

/** The tightest step of the app bar in one row (app.css, data-tight), and the one used over two rows, for a finger on a phone. */
const TIGHTEST = 4
const TWO_ROWS_STEP = 3

/**
 * The app bar in one row with every icon in it: the first of
 * its steps, loosest first, at which nothing overflows (the tools fit the room between the sides, the sides fit the
 * bar); two rows, at the tightest step, only when even that does not fit one. Measured, not set by widths, so a button
 * added, a font of another system or the app's own window buttons change nothing to do.
 */
function useOneRow(): (header: HTMLElement | null) => void {
  const stop = useRef<() => void>(undefined)
  // A ref of the bar's own, so the watching starts when the bar is drawn (after the note opens) and stops when it goes.
  return useCallback((header: HTMLElement | null) => {
    stop.current?.()
    stop.current = undefined
    if (!header) return
    // Nothing runs past the bar's end, and nothing wraps to make it taller than its one row.
    const fits = (): boolean => header.scrollWidth <= header.clientWidth + 0.5 && header.offsetHeight <= parseFloat(getComputedStyle(header).minHeight) + 0.5
    const fit = (): void => {
      delete header.dataset.rows
      for (let tight = 0; tight <= TIGHTEST; tight++) {
        if (tight === 0) delete header.dataset.tight
        else header.dataset.tight = String(tight)
        if (fits()) return
      }
      // Two rows, at the tightest still: at full size the first row alone ran over the tools below it in the app at
      // 760 px (its own window buttons too, 2 November 2026).
      header.dataset.rows = '2'
      header.dataset.tight = String(TWO_ROWS_STEP)
      // Narrower still, as a phone is: the title and the buttons after it no longer fit side by side, and would lie over
      // one another (found 6 November 2026, at 360 pixels: Back under Video). They run on as words do (app.css).
      const title = header.querySelector('.title')?.getBoundingClientRect()
      const buttons = header.querySelector('.appbar-end')?.getBoundingClientRect()
      if (title && buttons && title.right > buttons.left) header.dataset.rows = '3'
    }
    fit()
    // Again, at once, when the window or the bar's buttons change: both come before the next frame is drawn, so the
    // page below never jumps (a timer let the bar be two rows high for a moment after a note opened, and tests that had
    // just measured the page clicked beside it, 26 October 2026).
    let width = header.clientWidth
    const resized = (): void => {
      if (header.clientWidth === width) return
      width = header.clientWidth
      fit()
    }
    window.addEventListener('resize', resized)
    const changed = new MutationObserver(fit)
    changed.observe(header, { childList: true, subtree: true })
    stop.current = () => {
      window.removeEventListener('resize', resized)
      changed.disconnect()
    }
  }, [])
}

/** How safe the note is: whether its changes are in a file, and since when. */
function statusOf(doc: Doc, file: FileState | undefined, sample: boolean, now: number, since: number): { text: string; changed: boolean; late: boolean; kept: string } {
  const changed = unsaved(doc, file)
  const text = file
    ? `${changed ? 'Changed since saved to' : 'Saved to'} ${file.name}, ${ago(file.savedAt, now)}`
    : sample
      ? 'Sample note, not kept'
      : changed
        ? 'Not saved to a file yet'
        : 'New note'
  return { text, changed, late: changed && now - (file?.savedAt ?? since) > LATE, kept: sample ? NOT_KEPT : KEPT }
}

/** How long ago, in words. */
function ago(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  return new Date(time).toLocaleDateString()
}
