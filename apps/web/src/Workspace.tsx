// One note on screen, inside the shell: its row of tools, the pages, and its status line (how safe the note is,
// where it is kept, its pages and words, the zoom); at the tabs' end, its own menu. The note is kept in the library a
// moment after every change, through the storage interface, and a thumbnail of its first page is drawn once edits
// settle and when leaving. If another tab edits the same note, this tab shows it read-only and says so, with a
// button to edit it here instead. A sample note (?sample=…) is never kept. The AI works on what is chosen, through
// the ✨ button or Ctrl+K; its answers and its log show in a panel beside the pages, and the log is kept beside the
// note in the library, never in its file.
import { textOf, ValidationError, type Doc, type LogEntry, type Selection } from '@shellnote/core'
import { aiEdit, AiLayer, AskPanel, AssetStore, BarMenu, BarStrip, CHANGED_SINCE, checkDiagram, commands, EditorStore, MenuItem, MovableBar, NoteBar, undoEdit, type By, type NewNote, LogPanel, PageView, useUndoKeys, EditorArea, programHost, showSideTab, tabWord, inDesktopApp, workspace, type AiHost, type AskAnswer, type LogItem } from '@shellnote/editor'
import { openAICompatible } from '@shellnote/providers'
import { Check, CircleAlert, CloudCheck, Ellipsis, FileDown, FilePlus2, FolderOpen, HardDrive, Maximize2, ScrollText, TriangleAlert } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { assistantLog, withAssistants } from './ai/assistants.js'
import { loadLog, saveLog } from './ai/log.js'
import { loadSettings, missing, modelFrom, savedKey } from './ai/settings.js'
import { keepWhenClosing } from './desktop.js'
import { importNote } from './library/importing.js'
import { libraryPictures } from './library/pictures.js'
import { Settings } from './library/Settings.js'
import { noteScreen, tabsAt, tabsEnd } from './shell/state.js'
import type { LibraryStore } from '@shellnote/library'
import type { Tabs } from './library/tabs.js'
import { drawThumbnail } from './library/thumbnail.js'
import { unsaved } from '@shellnote/library/tree'
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
  // The shell's rail: its buttons for the panel beside the note work while the note is edited here.
  useEffect(() => {
    noteScreen.set({ mode: editing ? 'edit' : 'read', id: note, folder, title: doc.title })
  }, [editing, note, folder, doc.title])
  useEffect(() => () => noteScreen.set(undefined), [])
  // The AI's answers and its log, shown in the side panel's Output, and Settings opened from the prompt box.
  const [answer, setAnswer] = useState<{ n: number; answer: AskAnswer }>()
  const [log, setLog] = useState<LogItem[]>([])
  const logRef = useRef(log)
  logRef.current = log
  const noteRef = useRef(note)
  noteRef.current = note
  const takeAssistants = useRef<() => void>(() => undefined)
  const [settings, setSettings] = useState(false)

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
  /** Each open note as this screen and the library last agreed on it: what a change from another device is merged over. */
  const agreed = useRef(new WeakMap<EditorStore, Doc>())
  if (!agreed.current.has(store)) agreed.current.set(store, store.doc)
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
        .then(async () => {
          const blob = (hash: string): Blob | undefined => store.assets.blob(hash)
          if (!library.exchange) {
            await library.save({ doc: now, blob, file })
            return
          }
          // Where other devices write too, keeping hands back what arrived from them: it joins what is on screen,
          // the caret and the undo steps as they are (the editor's store, absorb).
          const kept = await library.exchange({ doc: now, since: agreed.current.get(store) ?? now, blob, file })
          if (kept.merged) {
            for (const [hash, bytes] of kept.merged.assets) {
              const asset = kept.merged.doc.asset[hash]
              if (asset && !store.assets.blob(hash)) await store.assets.put(hash, bytes, asset.mime)
            }
            store.absorb(now, kept.merged.doc)
            agreed.current.set(store, kept.merged.doc)
          } else agreed.current.set(store, now)
          // Kept in a folder, the note is a file already: the status line says so.
          if (library.place?.() !== undefined && kept.entry.file) {
            const next: FileState = { name: kept.entry.file.name, rev: now.rev, savedAt: Date.now() }
            fileRef.current = next
            setFile(next)
            setNow(Date.now())
          }
        })
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

  // A change to this note from another device, arriving in the library's folder: taken in at once while it is edited
  // here (keeping the note hands it back), or shown as it now is while it is read-only.
  useEffect(() => {
    if (note === undefined || !library.watch) return
    return library.watch((change) => {
      if (!change.notes.has(note)) return
      const taken = modeRef.current === 'edit' ? keepNow.current() : modeRef.current === 'view' ? reload() : Promise.resolve()
      // The change may be an assistant's (docs/mcp.md): once it is in the note, what it wrote of it joins the note's
      // log. Looked for again a moment later, as the server writes its log just after the note.
      void taken.then(() => takeAssistants.current())
      setTimeout(() => takeAssistants.current(), 1500)
    })
  }, [library, note, reload])

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
      (items) => {
        if (!live) return
        logRef.current = items
        setLog(items)
        takeAssistants.current()
      },
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
  // What assistants did to this note through the MCP server, read from the server's own log on this computer: only
  // in the desktop app, with the library kept in a folder, where a server can be.
  takeAssistants.current = (): void => {
    if (note === undefined || !inDesktopApp() || library.place?.() === undefined) return
    const [of, on] = [note, store]
    void assistantLog(of).then((kept) => {
      // The person may have opened another note meanwhile.
      if (noteRef.current !== of) return
      const next = withAssistants(logRef.current, kept, on.doc)
      if (next) keepLog(next)
    })
  }
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
      // What an assistant outside the app did is shown to the person, never to the app's own model: its words are another program's.
      recent: () => logRef.current.map((item) => item.entry).filter((entry) => entry.source !== 'mcp'),
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
  // The note's tool bar, where its person keeps it: under the tabs, down a side, along the bottom, or floating. Made
  // once a note: a key typed redraws the rows inside it (they follow the note), never the bar.
  const at = useSyncExternalStore(workspace.subscribe, workspace.snapshot).bars.tools.at
  const toolsBar = useMemo(
    () =>
      editing ? (
        <MovableBar key="tools" id="tools" label="tool bar">
          <NoteBar store={store} />
        </MovableBar>
      ) : null,
    [editing, store],
  )
  // The status line has its place at the notes' foot, filled from here (a portal): what it says changes as the note
  // is kept and its words are counted, and the panels round the notes are not drawn again for it. So has a notice, under
  // the tabs and the tool bar.
  const [statusPlace, setStatusPlace] = useState<HTMLElement | null>(null)
  const [noticePlace, setNoticePlace] = useState<HTMLElement | null>(null)
  // The notes being edited, made once a note, zoom and the bar's place: the page view follows the note itself, key by
  // key (with a store, PageView shows the store's own note), so the workspace round it is not drawn again for each key.
  const notes = useMemo(
    () => (
      <>
        <div className="sh-tabs-place" ref={tabsAt} />
        {at === 'top' ? toolsBar : null}
        <div className="sh-notice-place" ref={setNoticePlace} />
        <div className="sh-notes-row">
          {at === 'left' ? <BarStrip side="left">{[toolsBar]}</BarStrip> : null}
          <div className="pages-area">
            <PageView key={session.key} doc={store.doc} zoom={zoom} onZoom={setZoom} store={store} />
          </div>
          {at === 'right' ? <BarStrip side="right">{[toolsBar]}</BarStrip> : null}
        </div>
        {at === 'bottom' ? <BarStrip side="bottom">{[toolsBar]}</BarStrip> : null}
        <div className="sh-status-place" ref={setStatusPlace} />
      </>
    ),
    [at, toolsBar, session.key, store, zoom],
  )

  const rename = (title: string): void => {
    // `key`: keys typed in quick succession make one undo step.
    if (editing && title !== store.doc.title) store.apply([{ op: 'update', id: store.doc.id, set: { title } }], { key: `title:${store.doc.id}` })
  }
  const status = statusOf(doc, file, note === undefined, now, openedAt)
  // Kept in a folder, the note is a file as it stands; Save then puts a copy elsewhere.
  const place = note === undefined ? undefined : library.place?.()
  const keptWords = place !== undefined ? IN_FOLDER : status.kept
  // The words of the note, counted a moment after the typing, never with each key; each block counted once.
  const settled = useDeferredValue(doc)
  const words = useMemo(() => Object.values(settled.block).reduce((sum, block) => sum + wordsIn(block), 0), [settled])
  const pages = doc.pages.length
  const end = useSyncExternalStore(tabsEnd.subscribe, tabsEnd.snapshot)
  const full = useSyncExternalStore(workspace.subscribe, workspace.snapshot).layout.full === 'notes'
  // Why the note is read-only here, or a problem keeping it: under the tabs and the tool bar.
  const noticeBar =
    notice || problem ? (
      <div className="notice" data-tone={problem ? 'error' : 'info'} role={problem ? 'alert' : 'status'}>
        <TriangleAlert size={16} aria-hidden />
        <span>{problem ?? notice}</span>
        {!editing && mode === 'view' ? (
          <button type="button" className="button" data-command="note.editHere" onClick={() => commands.tap('note.editHere')}>
            Edit here instead
          </button>
        ) : null}
      </div>
    ) : null
  const statusLine = (
    <footer className="sh-status">
      <span className={`file-status${status.changed ? '' : ' sh-good'}`} role="status" data-kept-rev={keptRev} data-unsaved={status.changed ? '' : undefined} data-late={status.late ? '' : undefined} title={keptWords}>
        {status.changed ? <CircleAlert size={13} aria-hidden /> : <Check size={13} aria-hidden />}
        {status.text}
      </span>
      <button type="button" title={`${keptWords} (opens Settings)`} data-command="settings.open" onClick={() => commands.tap('settings.open')}>
        {place !== undefined ? <CloudCheck size={14} aria-hidden /> : <HardDrive size={14} aria-hidden />}
        {note === undefined ? 'Not kept' : place !== undefined ? 'Kept in your folder' : inDesktopApp() ? 'Kept on this computer' : 'Kept in this browser'}
      </button>
      <span className="sh-grow" />
      <span>
        {pages} {pages === 1 ? 'page' : 'pages'}
      </span>
      <span>
        {words} {words === 1 ? 'word' : 'words'}
      </span>
      <BarMenu label="Zoom" title="Zoom (Ctrl and the wheel, too)" className="sh-zoom" button={`${Math.round(zoom * 100)}%`}>
        {(close) =>
          (
            [
              ['in', 'Zoom in', 'Zoom in'],
              ['out', 'Zoom out', 'Zoom out'],
              ['actual', 'Actual size', 'Actual size, 100%'],
            ] as const
          ).map(([step, label, words]) => (
            <MenuItem
              key={step}
              label={label}
              command="screen.zoom"
              onChoose={() => {
                close()
                commands.press('screen.zoom', { step })
              }}
            >
              {words}
            </MenuItem>
          ))
        }
      </BarMenu>
    </footer>
  )

  return (
    <div className="app">
      <main className="main">
        {editing ? (
          <div className="main-middle">
            <EditorArea store={store} parts={parts}>
              {notes}
            </EditorArea>
          </div>
        ) : (
          <div className="sh-notes-alone">
            <div className="sh-tabs-place" ref={tabsAt} />
            {noticeBar}
            <div className="pages-area">
              {mode === 'view' || mode === 'checking' ? <PageView doc={doc} zoom={zoom} onZoom={setZoom} assets={store.assets.snapshot()} /> : <PageView key={session.key} doc={doc} zoom={zoom} onZoom={setZoom} store={store} />}
            </div>
            {statusLine}
          </div>
        )}
        {editing && at === 'float' ? toolsBar : null}
      </main>
      {editing && statusPlace ? createPortal(statusLine, statusPlace) : null}
      {editing && noticePlace && noticeBar ? createPortal(noticeBar, noticePlace) : null}
      {end
        ? createPortal(
            <>
              <BarMenu label="This note" title="This note: save a copy, open a file, what the AI changed" button={<Ellipsis size={18} aria-hidden />}>
                {(close) => (
                  <>
                    <div className="sh-menu-head">This note</div>
                    <MenuItem
                      label="Save"
                      title={`${status.text}. Save the note to a .shellnote file, the copy that lasts. ${keptWords}`}
                      command="file.save"
                      onChoose={() => {
                        close()
                        commands.press('file.save')
                      }}
                    >
                      <FileDown size={18} aria-hidden />
                      Save a copy as a file
                      <kbd>Ctrl+S</kbd>
                    </MenuItem>
                    <MenuItem
                      label="Save as"
                      command="file.saveAs"
                      onChoose={() => {
                        close()
                        commands.press('file.saveAs')
                      }}
                    >
                      <FilePlus2 size={18} aria-hidden />
                      Save as a new file
                      <kbd>Ctrl+Shift+S</kbd>
                    </MenuItem>
                    <MenuItem
                      label="Open file"
                      title="Open a .shellnote file into this folder"
                      command="file.open"
                      onChoose={() => {
                        close()
                        commands.press('file.open')
                      }}
                    >
                      <FolderOpen size={18} aria-hidden />
                      Open a file…
                      <kbd>Ctrl+O</kbd>
                    </MenuItem>
                    {editing ? (
                      <>
                        <hr />
                        <MenuItem
                          label={full ? 'Leave full view' : 'Full view: the notes alone'}
                          title={full ? 'Leave full view (Esc)' : 'Full view: the notes alone, the panels beside them out of sight'}
                          checked={full}
                          kind="checkbox"
                          command="panel.full"
                          onChoose={() => {
                            close()
                            commands.tap('panel.full', full ? { on: false } : { pane: 'notes' })
                          }}
                        >
                          <Maximize2 size={18} aria-hidden />
                          The notes alone
                        </MenuItem>
                        <MenuItem
                          label="AI log"
                          title="The AI log: every request on this note, with Undo"
                          command="output.answers"
                          onChoose={() => {
                            close()
                            commands.tap('output.answers')
                          }}
                        >
                          <ScrollText size={18} aria-hidden />
                          What the AI changed
                        </MenuItem>
                      </>
                    ) : null}
                  </>
                )}
              </BarMenu>
            </>,
            end,
          )
        : null}
      {editing ? <AiLayer key={session.key} store={store} host={host} enabled={editing} /> : null}
      {settings ? <Settings onClose={() => setSettings(false)} beforeChange={flush} /> : null}
    </div>
  )
}

/** After this long with changes not in a file, the status line asks for a save. */
const LATE = 10 * 60_000
const KEPT = inDesktopApp()
  ? 'The app keeps the note in your library on this computer as you work. The file you save is the copy that lasts.'
  : 'This browser keeps the note in your library as you work, but a browser can clear what it keeps. The file you save is the copy that lasts.'
const NOT_KEPT = 'A sample note is not kept. Save it to a file to keep it.'
const IN_FOLDER = "The app keeps the note as a file in your library's folder as you work. Save puts a copy of it wherever you choose."


/** Each block's words, counted once for each version of it: a block not changed keeps its count (blocks are never changed in place). */
const counted = new WeakMap<object, number>()
function wordsIn(block: Parameters<typeof textOf>[0]): number {
  if (!block) return 0
  let count = counted.get(block)
  if (count === undefined) {
    count = textOf(block).match(/\S+/gu)?.length ?? 0
    counted.set(block, count)
  }
  return count
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
