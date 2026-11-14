// The app: the rail of its places on every screen (shell/Rail.tsx), and beside it
// the library's home page first, then a note. The address says where:
// #/ is the top level, #/folder/<id> a folder, #/deleted Recently deleted,
// #/note/<id> a note, and #/new a new note at the top level (#/new/<folder> in
// a folder). ?sample=mixed, physics or long opens a sample note, which is never
// kept; ?record=strokes the stroke recorder (record/Recorder.tsx). On start,
// the note storage version 1 kept moves into the library once, safely, items
// past their 30 days in Recently deleted go, and the pen profile is read
// (library/penProfile.ts). In the desktop app the library may be a folder the
// person chose (library/chosen.ts): then what another device writes into it
// shows on the screens as it arrives.
import { commands } from '@shellnote/editor'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Home } from './library/Home.js'
import { library } from './library/chosen.js'
import { loadPenProfile } from './library/penProfile.js'
import { Tabs } from './library/tabs.js'
import { Recorder } from './record/Recorder.js'
import { sampleDoc } from './samples.js'
import { Rail } from './shell/Rail.js'
import { rememberShown, shownLast, tabsPlace } from './shell/state.js'
import { Tabs as TabRow } from './shell/Tabs.js'
import { Tree } from './shell/Tree.js'
import { askToKeep } from './storage/cache.js'
import { sessionFor, Workspace, type Session } from './Workspace.js'

export { library }
const tabs = new Tabs()

type Route = { to: 'home'; folder: string | null } | { to: 'bin' } | { to: 'note'; id: string } | { to: 'new'; folder: string | null }

/** Where the address points. */
function route(hash = location.hash): Route {
  const [kind, id] = hash.replace(/^#\/?/u, '').split('/')
  if (kind === 'note' && id) return { to: 'note', id }
  if (kind === 'folder' && id) return { to: 'home', folder: id }
  if (kind === 'deleted') return { to: 'bin' }
  if (kind === 'new') return { to: 'new', folder: id || null }
  return { to: 'home', folder: null }
}

/** Where the app is, as the app-state map says it. */
function whereLine(at: Route, sample: boolean, recording: boolean): string {
  if (recording) return 'screen: the stroke recorder'
  if (sample) return 'screen: a sample note, not kept'
  if (at.to === 'note') return `screen: note ${at.id}`
  if (at.to === 'bin') return 'screen: Recently deleted'
  if (at.to === 'new') return 'screen: a new note'
  return at.folder === null ? 'screen: the library, at the top' : `screen: the library, folder ${at.folder}`
}

/** Go to a place in the app, leaving a sample's address behind. */
function go(hash: string): void {
  if (location.search) location.assign(`${location.pathname}${hash}`)
  else location.hash = hash
}

let starting: Promise<string | undefined> | undefined

/** Once per page load: move the old note into the library, let go of items past their time, and ask the browser to keep what it stores. Resolves to a problem to show, if any. */
function startOnce(): Promise<string | undefined> {
  starting ??= (async () => {
    let problem: string | undefined
    // Where the library is kept, before anything is read from it.
    await library.start()
    // What changes in the library's folder from outside the app reaches the screens as another tab's changes do.
    library.watch((change) => {
      if (change.library) tabs.told({ t: 'library', from: 'folder' })
    })
    try {
      await library.app.migrate(Date.now())
    } catch (error) {
      problem = (error as Error).message
    }
    try {
      await library.purgeExpired(Date.now())
    } catch (error) {
      console.warn('shellnote: Recently deleted could not be tidied', error)
    }
    await loadPenProfile(library)
    void askToKeep()
    return problem ?? library.problem()
  })()
  return starting
}

export function App() {
  const sample = useMemo(() => sampleDoc(location.search), [])
  const recording = useMemo(() => new URLSearchParams(location.search).get('record') === 'strokes', [])
  const [where, setWhere] = useState(route)
  const [ready, setReady] = useState(false)
  const [problem, setProblem] = useState<string>()

  useEffect(() => {
    const onHash = (): void => setWhere(route())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // The desktop app has no address to type: it starts again on the note it was last on, its tab still open.
  useEffect(() => {
    const last = location.hash === '' && location.search === '' ? shownLast() : undefined
    if (last !== undefined) location.replace(`#/note/${last}`)
  }, [])
  useEffect(() => {
    if (where.to === 'note') rememberShown(where.id)
    else if (where.to !== 'new') rememberShown(undefined)
  }, [where])

  // The app at the commands' disposal on every screen (app control): where it is, and the way elsewhere.
  useEffect(() => commands.provide('app', { where: () => whereLine(route(), sample !== undefined, recording), go, reloads: () => location.search !== '' }), [sample, recording])

  useEffect(() => {
    let live = true
    void startOnce().then((found) => {
      if (!live) return
      setProblem(found)
      setReady(true)
    })
    return () => {
      live = false
    }
  }, [])

  // The stroke recorder is a page of its own, outside the shell.
  if (recording) return <Recorder />
  const shown = (): ReactNode => {
    if (sample) return <SampleNote key="sample" doc={sample} />
    if (!ready) return <div className="opening">Opening your library…</div>
    switch (where.to) {
      case 'home':
        return <Home key={`folder:${where.folder}`} store={library} tabs={tabs} place={{ folder: where.folder }} {...(problem ? { problem } : {})} onOpen={(id) => go(`#/note/${id}`)} />
      case 'bin':
        return <Home key="bin" store={library} tabs={tabs} place="bin" {...(problem ? { problem } : {})} onOpen={(id) => go(`#/note/${id}`)} />
      case 'new':
        return <NewNote folder={where.folder} />
      case 'note':
        return <OpenNote key={where.id} id={where.id} />
    }
  }
  // Where the tab row goes: over the note alone while one is on screen (its column's top), else over the whole screen.
  const place = useSyncExternalStore(tabsPlace.subscribe, tabsPlace.snapshot)
  // The shell: the rail of the app's places, the library's tree, then the tabs over the screen the address names.
  const at = sample || !ready ? 'other' : where.to === 'home' ? 'library' : where.to === 'bin' ? 'bin' : 'other'
  return (
    <div className="shell">
      <Rail store={library} screen={at} />
      {/* Drawn from the start, so nothing beside it moves when the library has started (a sample note shows first). */}
      <Tree store={library} tabs={tabs} bin={at === 'bin'} ready={ready} />
      <section className="shell-main">
        {place ? createPortal(<TabRow library={at !== 'other'} />, place) : <TabRow library={at !== 'other'} />}
        <div className="shell-screen">{shown()}</div>
      </section>
    </div>
  )
}

/** Make a new note, then open it in place of this address, so Back does not make another. */
function NewNote({ folder }: { folder: string | null }) {
  const started = useRef(false)
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    // React may run this twice while developing; one note is made.
    if (started.current) return
    started.current = true
    library.newNote(folder).then(
      (entry) => {
        tabs.libraryChanged()
        location.replace(`#/note/${entry.id}`)
      },
      (error: unknown) => setProblem((error as Error).message),
    )
  }, [folder])
  return <div className="opening">{problem ? `A new note could not be made: ${problem}` : 'Making a new note…'}</div>
}

/** Open a note of the library, then show it. */
function OpenNote({ id }: { id: string }) {
  const [session, setSession] = useState<Session>()
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    let live = true
    library
      .open(id)
      .then((opened) => sessionFor(opened.doc, opened.assets, { note: id, folder: opened.entry.folder, file: opened.file }))
      .then(
        (made) => live && setSession(made),
        (error: unknown) => live && setProblem((error as Error).message),
      )
    return () => {
      live = false
    }
  }, [id])
  if (problem) {
    return (
      <div className="opening">
        <p>
          This note could not be opened: {problem} <a href="#/">Back to Notes</a>
        </p>
      </div>
    )
  }
  if (!session) return <div className="opening">Opening the note…</div>
  return <Workspace library={library} tabs={tabs} session={session} onHome={(folder) => go(folder === null ? '#/' : `#/folder/${folder}`)} onOpen={(next) => go(`#/note/${next}`)} />
}

/** A sample note, opened from the address and never kept. */
function SampleNote({ doc }: { doc: Parameters<typeof sessionFor>[0] }) {
  const [session, setSession] = useState<Session>()
  useEffect(() => {
    let live = true
    void sessionFor(doc, new Map(), { note: undefined, folder: null, file: undefined }).then((made) => live && setSession(made))
    return () => {
      live = false
    }
  }, [doc])
  if (!session) return <div className="opening">Opening the sample…</div>
  return <Workspace library={library} tabs={tabs} session={session} onHome={() => go('#/')} onOpen={(next) => go(`#/note/${next}`)} />
}
