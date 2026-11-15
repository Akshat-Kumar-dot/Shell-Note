// The app's own commands (app control, step 3): what only the app can do, its
// library, files and notes, given their code here. Each wraps what its button
// did, and the buttons call them. The editor's commands (tools, view, panels)
// are in packages/editor/src/commands.
//
// A note or a folder is named by its id or its exact name, never guessed: a
// name two share, or one nothing has, is said, with the ids or the closest
// names. For the agent, a command goes where a person would first (the open
// note closed and kept, then the library), and waits for that screen, so its
// next line finds it there.
import type { NoteKind, SettingsSection } from '@shellnote/core'
import { commands, inDesktopApp, placesReset, Shared, type AppPlace, type By, type HomePlace, type ItemRef, type LibraryAt, type Places } from '@shellnote/editor'
import type { Library, LibraryStore } from '@shellnote/library'
import { deletedItems, folderPath, hidden } from '@shellnote/library/tree'
import { loadSettings, modelsNow, saveSettings, withModel } from './ai/settings.js'
import { setLibraryLook, type LibraryLook } from './library/look.js'
import { found, foundLine, searchAll } from './library/searchAll.js'
import { lastSection, moveTree, openSearch, resetTree, searchAsked, showTree } from './shell/state.js'
import { applyAccent, applyAppearance, applyDarkPaper, type Accent, type Appearance } from './theme.js'

/** Each section of Settings, as a sentence names it. */
export const SECTION_WORDS: Readonly<Record<SettingsSection, string>> = {
  general: 'General',
  appearance: 'Appearance',
  customise: 'Customise',
  pen: 'Pen',
  ai: 'AI',
  assistants: 'Assistants',
  storage: 'Sync and storage',
  about: 'About',
}

/** Told each time the assistants' switch changes, so Settings shows it as it now is. */
export const assistantsChanged = new Shared(0)

// The library's column and the library's look go back with the panels and the bars (layout.reset).
placesReset.add(() => {
  resetTree()
  setLibraryLook('cards')
})

type Kind = ItemRef['kind']
type Here = Places & { app: AppPlace }

/** A note or folder found, with its name and where it is. */
interface Found extends ItemRef {
  name: string
  parent: string | null
}

const RELOADS = 'This screen (a sample note, or the stroke recorder) is outside the library: going elsewhere reloads the page, which would end this run. The person can leave it.'

/** The words for the top of the library, when no folder is called so. */
const TOP = new Set(['top', 'the top', 'top level', 'the top level', 'notes'])

const refOf = (found: Found): ItemRef => ({ kind: found.kind, id: found.id })

/** Where an item is, in words: at the top, or in Physics › Unit 2. */
function placeOf(list: Library, parent: string | null): string {
  const path = folderPath(list, parent)
  return path.length === 0 ? 'at the top' : `in ${path.map((f) => f.name).join(' › ')}`
}

/** The notes and folders in sight in the library, or those in Recently deleted. */
function entries(list: Library, bin: boolean): Found[] {
  const gone = bin ? deletedItems(list) : undefined
  const folders = gone ? gone.folders : list.folders.filter((f) => !hidden(list, f))
  const notes = gone ? gone.notes : list.notes.filter((n) => !hidden(list, n))
  return [...folders.map((f): Found => ({ kind: 'folder', id: f.id, name: f.name, parent: f.parent })), ...notes.map((n): Found => ({ kind: 'note', id: n.id, name: n.title, parent: n.folder }))]
}

/** A note or folder by its id, or its exact name in any case. */
function find(list: Library, written: string, kinds: readonly Kind[], bin: boolean): Found {
  const all = entries(list, bin).filter((e) => kinds.includes(e.kind))
  const byId = all.find((e) => e.id === written)
  if (byId) return byId
  const wanted = written.trim().toLowerCase()
  const named = all.filter((e) => e.name.trim().toLowerCase() === wanted)
  if (named.length === 1) return named[0]!
  if (named.length > 1) throw new Error(`${named.length} are called "${written}": ${named.map((e) => `${e.kind} ${e.id} ${placeOf(list, e.parent)}`).join('; ')}. Name one by its id.`)
  const words = wanted.split(/\s+/u).filter((word) => word.length >= 3)
  const close = all.filter((e) => words.some((word) => e.name.toLowerCase().includes(word))).slice(0, 3)
  const what = kinds.length === 1 ? kinds[0]! : 'note or folder'
  throw new Error(`No ${what} called "${written}" in ${bin ? 'Recently deleted' : 'the library'}.${close.length > 0 ? ` The closest: ${close.map((e) => `"${e.name}" (${e.id})`).join(', ')}.` : ''}`)
}

/** A folder to go to or put something in; left out, the top. */
function folderOf(list: Library, written: unknown): Found | null {
  if (written === undefined) return null
  try {
    return find(list, String(written), ['folder'], false)
  } catch (error) {
    if (TOP.has(String(written).trim().toLowerCase())) return null
    throw error
  }
}

/** A note named, or left out: the one open now. */
function noteOf(list: Library, written: unknown, places: Places): Found {
  if (written !== undefined) return find(list, String(written), ['note'], false)
  const open = places.workspace?.entry()
  const found = open === undefined ? undefined : entries(list, false).find((e) => e.kind === 'note' && e.id === open)
  if (!found) throw new Error('Name the note (note=…): no note of the library is open.')
  return found
}

function fits(at: LibraryAt, want: LibraryAt): boolean {
  if (at.bin || want.bin) return at.bin === want.bin
  return at.folder === want.folder
}

const hashOf = (want: LibraryAt): string => (want.bin ? '#/deleted' : want.folder === null ? '#/' : `#/folder/${want.folder}`)

/** Leave the open note as its Back button does, kept first. The agent never leaves a screen whose leaving reloads the page. */
async function leaveNote(places: Here, by: By): Promise<void> {
  if (by === 'agent' && places.app.reloads()) throw new Error(RELOADS)
  await places.workspace?.close()
}

/** Show a library screen: a person's click goes there; the agent goes as a person would, and waits until it shows. */
async function show(places: Here, by: By, want: LibraryAt): Promise<void> {
  if (places.home && fits(places.home.at(), want)) return
  await leaveNote(places, by)
  places.app.go(hashOf(want))
  if (by === 'agent') await commands.until('home', (home) => fits(home.at(), want) && home.loaded())
}

/**
 * The library's screen, any folder of it (and with `bin` left out, Recently
 * deleted too). A person's click is on it already; the agent is taken there,
 * the open note closed and kept first.
 */
async function libraryScreen(places: Here, by: By, bin?: false): Promise<HomePlace> {
  const home = places.home
  if (home && (bin === undefined || !home.at().bin)) return home
  if (by === 'person') throw new Error('shellnote: the library is not showing')
  if (places.workspace) {
    await leaveNote(places, by)
    return commands.until('home', (next) => next.loaded())
  }
  await show(places, by, { bin: false, folder: null })
  return places.home!
}

let defined = false

/** The browser's last answer to settings.keepStorage, for Settings to show. */
let keptAnswer = false
export const lastKeepAnswer = (): boolean => keptAnswer

/** Give the app's commands their code, once. */
export function defineAppCommands(store: LibraryStore): void {
  if (defined) return
  defined = true
  const list = (): Promise<Library> => store.list()

  // ----- the library -----
  commands.define('library.open', ['app'], async ({ folder }, places, by) => {
    const found = folderOf(await list(), folder)
    await show(places, by, { bin: false, folder: found?.id ?? null })
    return found ? `the library, folder "${found.name}" (${found.id})` : 'the library, at the top'
  })
  commands.define('library.search', ['app'], ({ text }, places, by) => {
    // Typing in the search box: done at once, so the box keeps each letter as it is typed.
    if (places.home && !places.home.at().bin) return places.home.search(String(text))
    return libraryScreen(places, by, false).then((home) => home.search(String(text)))
  })
  commands.define('library.sort', ['app'], async ({ by: date, order }, places, by) => (await libraryScreen(places, by, false)).sort(date as 'edited' | 'created' | undefined, order as 'newest' | 'oldest' | undefined))
  commands.define('library.filter', ['app'], async ({ show }, places, by) => (await libraryScreen(places, by, false)).filter(show as NoteKind | 'all'))
  commands.define('bin.open', ['app'], async (_, places, by) => {
    await show(places, by, { bin: true })
    return 'Recently deleted'
  })
  commands.define('bin.restore', ['app'], async ({ item }, places, by) => {
    const found = find(await list(), String(item), ['note', 'folder'], true)
    return (await libraryScreen(places, by)).restore(refOf(found))
  })
  commands.define('bin.deleteForever', ['app'], async ({ item }, places, by) => {
    const found = find(await list(), String(item), ['note', 'folder'], true)
    return (await libraryScreen(places, by)).deleteForever(refOf(found), by)
  })
  commands.define('bin.empty', ['app'], async (_, places, by) => (await libraryScreen(places, by)).emptyBin(by))

  // ----- notes -----
  commands.define('note.new', ['app'], async ({ name, into, type }, places, by) => {
    const all = await list()
    const folder = folderOf(all, into)
    if (by === 'agent' && places.app.reloads()) throw new Error(RELOADS)
    const from = places.workspace ?? (await libraryScreen(places, by))
    const made = await from.newNote(folder?.id ?? null, type as NoteKind | undefined)
    // Named as it is made (a model asks for "a new note called Waves" in one go): renamed once it is open.
    if (by === 'agent' || name !== undefined) await commands.until('workspace', (workspace) => workspace.entry() === made.id && workspace.ready())
    if (name !== undefined) commands.places.workspace!.rename(String(name))
    const title = name === undefined ? made.title : String(name)
    return `new note "${title}" (${made.id}) open, ${placeOf(all, folder?.id ?? null)}`
  })
  commands.define('note.open', ['app'], async ({ note }, places, by) => {
    const found = find(await list(), String(note), ['note'], false)
    const said = `note "${found.name}" (${found.id}) open`
    if (places.workspace?.entry() === found.id) return said
    await leaveNote(places, by)
    places.app.go(`#/note/${found.id}`)
    if (by === 'agent') await commands.until('workspace', (workspace) => workspace.entry() === found.id && workspace.ready())
    return said
  })
  commands.define('note.editHere', ['workspace'], (_, { workspace }) => workspace.editHere())
  commands.define('note.close', ['workspace', 'app'], async (_, places, by) => {
    await leaveNote(places, by)
    if (by === 'agent') await commands.until('home', (home) => home.loaded())
    return 'note closed and kept; the library is open'
  })
  commands.define('note.rename', ['app'], async ({ name, note }, places, by) => {
    const title = String(name)
    const { workspace } = places
    const open = places.note?.store.doc
    const named = note === undefined ? undefined : String(note)
    if (workspace && (named === undefined || named === workspace.entry() || named === open?.id || named.trim().toLowerCase() === open?.title.trim().toLowerCase())) {
      if (!workspace.editing()) throw new Error('This note is read-only here: it is being edited in another window.')
      workspace.rename(title)
      return `note renamed "${title}"`
    }
    const found = noteOf(await list(), named, places)
    return (await libraryScreen(places, by, false)).rename(refOf(found), title)
  })
  commands.define('note.move', ['app'], async ({ note, into }, places, by) => {
    const all = await list()
    const found = noteOf(all, note, places)
    const to = folderOf(all, into)
    return (await libraryScreen(places, by, false)).move(refOf(found), to?.id ?? null)
  })
  commands.define('note.delete', ['app'], async ({ note }, places, by) => {
    const found = noteOf(await list(), note, places)
    return (await libraryScreen(places, by, false)).remove(refOf(found))
  })

  // ----- folders -----
  commands.define('folder.new', ['app'], async ({ name, into }, places, by) => {
    const to = folderOf(await list(), into)
    return (await libraryScreen(places, by, false)).newFolder(to?.id ?? null, name === undefined ? undefined : String(name), by)
  })
  commands.define('folder.rename', ['app'], async ({ folder, name }, places, by) => {
    const found = find(await list(), String(folder), ['folder'], false)
    return (await libraryScreen(places, by, false)).rename(refOf(found), String(name))
  })
  commands.define('folder.move', ['app'], async ({ folder, into }, places, by) => {
    const all = await list()
    const found = find(all, String(folder), ['folder'], false)
    const to = folderOf(all, into)
    return (await libraryScreen(places, by, false)).move(refOf(found), to?.id ?? null)
  })
  commands.define('folder.delete', ['app'], async ({ folder }, places, by) => {
    const found = find(await list(), String(folder), ['folder'], false)
    return (await libraryScreen(places, by, false)).remove(refOf(found))
  })
  commands.define('folder.cover', ['app'], async ({ folder, on }, places, by) => {
    const found = refOf(find(await list(), String(folder), ['folder'], false))
    const home = await libraryScreen(places, by, false)
    if (on === false) return home.folderCover(found.id, undefined)
    if (by === 'agent') throw new Error("A cover is a picture the person chooses: the folder's menu, Cover picture.")
    const file = await pickPicture()
    if (!file) return 'no picture chosen'
    return home.folderCover(found.id, file)
  })

  // ----- files -----
  // ----- the note's cover and printing -----
  commands.define('note.cover', ['note'], async ({ on }, { note }, by) => {
    const store = note.store
    if (on === false) {
      if (store.doc.cover === undefined) return 'the note has no cover'
      store.apply([{ op: 'update', id: store.doc.id, set: { cover: null } }], { origin: 'toolbar' })
      return "the cover is off: the library shows the note's kind"
    }
    if (by === 'agent') throw new Error("A cover is a picture the person chooses: the note's menu, Cover picture.")
    const file = await pickPicture()
    if (!file) return 'no picture chosen'
    const picture = await store.assets.add(file)
    store.apply(
      [
        { op: 'asset', hash: picture.hash, meta: picture.meta },
        { op: 'update', id: store.doc.id, set: { cover: picture.hash } },
      ],
      { origin: 'toolbar' },
    )
    return 'the note has a cover picture, kept in its file'
  })
  commands.define('note.print', ['workspace'], (_, { workspace }) => workspace.print())

  commands.define('file.save', ['workspace'], (_, { workspace }, by) => workspace.save(false, by))
  commands.define('file.saveAs', ['workspace'], (_, { workspace }, by) => workspace.save(true, by))
  commands.define('file.open', ['app', ['workspace', 'home']], (_, places, by) => {
    if (by === 'agent' && places.app.reloads()) throw new Error(RELOADS)
    return (places.workspace ?? places.home)!.openFile(by)
  })

  // ----- the AI's model: one from those the settings' server lists; the server and its key stay the person's
  // -----
  commands.define('ai.useModel', [], async ({ model }) => {
    const settings = loadSettings()
    const server = settings.provider === 'lmstudio' ? 'LM Studio' : 'OpenRouter'
    let models
    try {
      models = await modelsNow(settings)
    } catch {
      throw new Error(settings.provider === 'lmstudio' ? `LM Studio did not answer at ${settings.baseUrl}: is its server running, with CORS on?` : "OpenRouter's list of models could not be read: check the connection.")
    }
    const wanted = String(model)
    const found = models.find((m) => m.id === wanted) ?? models.find((m) => m.id.toLowerCase() === wanted.trim().toLowerCase())
    if (!found) {
      const words = wanted.toLowerCase().split(/[\s/:_-]+/u).filter((word) => word.length >= 3)
      const close = models.filter((m) => words.some((word) => m.id.toLowerCase().includes(word))).slice(0, 5)
      throw new Error(`${server} has no model "${wanted}".${close.length > 0 ? ` The closest: ${close.map((m) => m.id).join(', ')}.` : ` It has: ${models.slice(0, 8).map((m) => m.id).join(', ')}${models.length > 8 ? ', …' : ''}.`}`)
    }
    saveSettings(withModel(settings, found.id, found))
    return `the AI's model is ${found.id}, on ${server}${settings.provider === 'openrouter' ? ' (paid: each request costs money)' : ''}`
  })

  // ----- settings, the recorder -----
  commands.define('settings.open', ['app'], async ({ section }, places, by) => {
    // Settings is a tab of its own: the note on screen is kept first, as opening another note keeps it.
    const to = (section as SettingsSection | undefined) ?? lastSection()
    await leaveNote(places, by)
    places.app.go(`#/settings/${to}`)
    return `Settings open, at ${SECTION_WORDS[to]}`
  })
  commands.define('settings.assistants', [], async ({ on }, _, by) => {
    const allow = on !== false
    // Letting other programs reach the notes is the person's own choice; the agent may only stop them.
    if (allow && by === 'agent') throw new Error('Letting assistants reach the notes is the person\'s own choice: Settings, Assistants.')
    if (!store.setAssistants) throw new Error('Assistants work on a library kept in a folder, in the desktop app: choose a folder in Settings, Sync and storage.')
    await store.setAssistants(allow)
    assistantsChanged.set(assistantsChanged.value + 1)
    return allow ? 'assistants may read and change the notes; each change shows in its note\'s AI log, with Undo' : 'assistants are switched off: the server reads and changes nothing'
  })
  commands.define('library.column', [], ({ side }) => {
    if (side === 'hidden') {
      showTree(false)
      return "the library's column is hidden"
    }
    moveTree(side as 'left' | 'right')
    showTree(true)
    return `the library's column on the ${String(side)}`
  })
  commands.define('library.findWords', [], async ({ text }) => {
    const words = String(text).trim()
    // In the column, for the person to see; the caret stays where it is (the column's own box, or the terminal).
    openSearch(false, words)
    found.set({ words, hits: found.value?.words === words ? found.value.hits : [], more: 0, busy: true })
    const result = await searchAll(store, await store.list(), words)
    // A later search may have begun meanwhile: only the latest is shown.
    if (searchAsked.value.words.trim() === words) found.set({ ...result, busy: false })
    return foundLine(result)
  })
  commands.define('library.look', [], ({ view }) => {
    setLibraryLook(view as LibraryLook)
    return view === 'list' ? 'the library shows a list' : 'the library shows cards'
  })
  commands.define('settings.theme', [], ({ look }) => {
    applyAppearance(look as Appearance)
    return look === 'system' ? 'the appearance follows Windows' : `the appearance is ${String(look)}`
  })
  commands.define('settings.accent', [], ({ accent }) => {
    applyAccent(accent as Accent)
    return `the app's colour is ${String(accent)}`
  })
  commands.define('settings.paper', [], ({ on }) => {
    applyDarkPaper(on !== false)
    return on !== false ? 'in the dark theme the paper is dark, its ink in colours that read on it; printing stays white' : 'the paper is white in the dark theme too'
  })
  commands.define('settings.keepStorage', [], async () => {
    const keeper = inDesktopApp() ? 'WebView2' : 'The browser'
    if (typeof navigator.storage?.persist !== 'function') throw new Error(`${keeper} cannot be asked to keep the notes here.`)
    const kept = await navigator.storage.persist().catch(() => false)
    keptAnswer = kept
    return kept ? `${keeper} has agreed not to clear the notes by itself` : `${keeper} said no, for now: it decides by itself and never asks the person. The copy that lasts is a saved .shellnote file`
  })
  commands.define('recorder.open', ['app'], (_, __, by) => {
    // The recorder is a page of its own: opening it reloads the app.
    if (by === 'agent') throw new Error('Opening the stroke recorder reloads the page, which would end this run. The person can open it from the library (Stroke recorder); it records their own hand, with their pen.')
    location.assign('?record=strokes')
    return 'the stroke recorder'
  })

  commands.describe('note', () => {
    const open = commands.places.note?.store.doc
    return open ? `note "${open.title}" (${open.id}) · ${open.pages.length} ${open.pages.length === 1 ? 'page' : 'pages'}` : undefined
  })
}

/** A picture the person picks from their files; none when they close the window without one. */
function pickPicture(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif'
    input.addEventListener('change', () => resolve(input.files?.[0]), { once: true })
    input.addEventListener('cancel', () => resolve(undefined), { once: true })
    input.click()
  })
}
