// The door for app commands (app control, step 2; the person's plan of 19
// October 2026): one way to do each thing, whoever asks. A person's click calls
// `do`, the agent calls `run`; both reach the same code. `run` checks the
// command and its input, says plainly when it cannot run now, asks the person
// first for what cannot be undone, and reports the app's state before and
// after, so the model sees what changed instead of guessing.
import { checkInput, COMMANDS, type CommandSpec, type PictureSource } from '@shellnote/core'
import type { EditorStore } from '../store.js'

/** The open note's screen, as the workspace gives it: what its own buttons do. */
export interface WorkspacePlace {
  zoom(): number
  setZoom(zoom: number): void
  /** Keep the note, then go back to the library (its Back button). */
  close(): Promise<void>
 /** Save to the note's file, or with `as` to a new one the person picks; says where, or that it was not saved. */
  save(as: boolean, by: By): Promise<string>
 /** Open a.shellnote file the person picks, into the library, and show it. */
  openFile(by: By): Promise<string>
  /** A new note in a folder (null: the top of the library), and show it. */
  newNote(into: string | null): Promise<NewNote>
  /** The note's title, as typed into its name. */
  rename(title: string): void
  /** Whether this window edits the note (another window may). */
  editing(): boolean
  /** The open note's id in the library; undefined for a sample note, which is not kept. */
  entry(): string | undefined
  /** False for a moment after the note opens, while the other windows are asked whether one edits it. */
  ready(): boolean
  /** Open Settings over this screen. */
  openSettings(): void
  /** Undo the AI's last change still in its log (ai.undo); says which, or throws why it cannot. */
  undoAi(): string
  /** Edit the note here when another window edits it (note.editHere): that one keeps its work and steps back. */
  editHere(): string
}

/** The AI box on the open note, while the note is shown: what its own buttons do. */
export interface AiPlace {
  /** Open the box, to edit or to ask; left out, as it was. Says what it did, or throws why it cannot. */
  open(mode: 'edit' | 'ask' | undefined): string
  close(): string
  stop(): string
  /** Send a request, shown in the box as it goes; says how it ended (the answer, for ask), or throws why it did not. */
  send(request: string, mode: 'edit' | 'ask' | undefined): Promise<string>
  /** Do a request with no model, as the ⚡ line offers; throws when code cannot read it. */
  instant(request: string): Promise<string>
  /** True when the AI settings name a paid model (OpenRouter). */
  paid(): boolean
  /** The box as the agent reads it, while it is open. */
  line(): string | undefined
}

/** What the side panel's AI chat does. */
export type ChatMake = 'ask' | 'table' | 'flowchart' | 'summary'

/** The side panel's AI chat, while its tab shows: what its own buttons do. */
export interface ChatPlace {
  /** Send what is typed, or `request`, as `make` says (left out: as chosen); says how it ended, or throws why not. */
  send(request: string | undefined, make: ChatMake | undefined, put: 'note' | 'pad' | undefined): Promise<string>
  choose(make: ChatMake | undefined, put: 'note' | 'pad' | undefined): string
  stop(): string
  frame(): string
  clearPicture(): string
  putAnswer(): string
  paid(): boolean
  line(): string | undefined
}

/** A note just made. */
export interface NewNote {
  id: string
  title: string
}

/** A note or a folder of the library. */
export interface ItemRef {
  kind: 'note' | 'folder'
  id: string
}

/** What a library screen shows: a folder (null: the top), or Recently deleted. */
export type LibraryAt = { bin: false; folder: string | null } | { bin: true }

/**
 * The library's screen, while it shows: what its own buttons do. Each tells
 * the person on screen as the button always did (a toast, a dialog asking
 * first), then says what it did, or throws what went wrong.
 */
export interface HomePlace {
  at(): LibraryAt
  /** True once the library has been read. */
  loaded(): boolean
  /** What it shows now, for the state map. */
  showing(): string
  search(text: string): string
  /** Left out: as it is. */
  sort(by: 'edited' | 'created' | undefined, order: 'newest' | 'oldest' | undefined): string
  newNote(into: string | null): Promise<NewNote>
  /** A person's new folder waits for its name, typed on its card; the agent's is named at once, or keeps its first name. */
  newFolder(into: string | null, name: string | undefined, by: By): Promise<string>
  openFile(by: By): Promise<string>
  rename(item: ItemRef, name: string): Promise<string>
  move(item: ItemRef, to: string | null): Promise<string>
  remove(item: ItemRef): Promise<string>
  restore(item: ItemRef): Promise<string>
  /** A person is asked on screen; the agent's call was asked already. */
  deleteForever(item: ItemRef, by: By): Promise<string>
  emptyBin(by: By): Promise<string>
  /** Open Settings over this screen. */
  openSettings(): void
}

/** The app as a whole, always there: where it is, how to go elsewhere, and the library. */
export interface AppPlace {
  /** Where the app is, for the state map: the library, a folder, the bin, or a note. */
  where(): string
  /** Go to an address of the app (#/, #/folder/<id>, #/deleted, #/note/<id>). */
  go(hash: string): void
  /** True on a screen that going elsewhere reloads (a sample note, the stroke recorder): a reload would end the agent's run. */
  reloads(): boolean
}

/** What the app gives the commands now: each part provided while it is on screen. */
export interface Places {
  /** The open note. */
  note?: { store: EditorStore }
  /** The open note's screen. */
  workspace?: WorkspacePlace
  /** The library's screen. */
  home?: HomePlace
  /** The AI box on the open note. */
  ai?: AiPlace
  /** The side panel's AI chat. */
  chat?: ChatPlace
  /** The app, on every screen. */
  app?: AppPlace
  /** The pictures of the library's other notes, while a note is open (note control, step 3). */
  pictures?: PicturesPlace
}

/** The pictures of the person's other notes, from the library, for the agent to place. */
export interface PicturesPlace {
  /** Every picture of the library's notes but the open one, Recently deleted left out: its hash, metadata, words and note. */
  list(): Promise<PictureSource[]>
  /** A picture's bytes, by hash. */
  bytes(hash: string): Promise<Blob | undefined>
}

/** A part the command needs, or a list of parts any one of which will do. */
export type Need = keyof Places | readonly (keyof Places)[]

/**
 * Who asked: a person's click (told as the app always told them, an alert
 * included) or the agent (told in words only: an alert would stop the page).
 */
export type By = 'person' | 'agent'

/** A command's code: changes the app, and says what it did in a few words; waits when the change takes a moment. */
export type Doer<P extends Places = Places> = (input: Record<string, unknown>, places: P, by: By) => string | Promise<string>

/** How a command's code is given: when it asks only in some cases, the case (a paid model's money spent). */
export interface DoerOptions {
  asksWhen?: (places: Places) => boolean
}

/** What needs to be on screen for a command, and what to tell the model when it is not. */
const WHY_NOT: Record<keyof Places, string> = {
  note: 'No note is open: open one first (note.open, or note.new).',
  workspace: 'No note is open: open one first (note.open, or note.new).',
  home: 'The library is not showing: open it first (library.open, or bin.open for Recently deleted).',
  ai: 'No note is open: the AI box works on the open note (note.open, or note.new).',
  chat: "The side panel's AI chat is not showing: panel.show ai.",
  app: 'The app is still starting: try again in a moment.',
  pictures: "No note is open: a picture of another note goes into the open one (note.open, or note.new).",
}

/** Each part in a few words, for "open … first" and "… did not come up". */
const PART: Record<keyof Places, string> = { note: 'a note (note.open)', workspace: 'a note (note.open)', home: 'the library (library.open)', ai: 'a note (note.open)', chat: 'the AI chat (panel.show ai)', app: 'the app', pictures: 'a note (note.open)' }
const SCREEN: Record<keyof Places, string> = { note: 'note', workspace: "note's screen", home: 'library', ai: 'AI box', chat: 'AI chat', app: 'app', pictures: 'note' }

/** How long a command that changes screens waits for the next one, a big note being opened included. */
const ARRIVAL_MS = 20_000

/** How an agent's call went; `review` when the command is under high review, saying why it is watched. */
export type Ran = { ok: true; command: string; done: string; before: string; after: string; review?: string } | { ok: false; command: string; why: string }

export class Commands {
  readonly #specs: ReadonlyMap<string, CommandSpec>
  readonly #doers = new Map<string, { needs: readonly Need[]; doer: Doer; options: DoerOptions }>()
  readonly #places: Places = {}
  readonly #state = new Map<string, () => string | undefined>()
  readonly #arrivals = new Set<() => void>()

  constructor(specs: readonly CommandSpec[] = COMMANDS) {
    this.#specs = new Map(specs.map((spec) => [spec.name, spec]))
  }

  /**
   * Give a command its code; `needs` is what must be on screen for it (a list
   * inside it: any one of those), and the code is given those parts. Once per
   * command, and only for a known one.
   */
  define<N extends keyof Places = never>(name: string, needs: readonly (N | readonly (keyof Places)[])[], doer: Doer<Places & Required<Pick<Places, N>>>, options: DoerOptions = {}): void {
    if (!this.#specs.has(name)) throw new Error(`shellnote: no command ${name} in the table`)
    if (this.#doers.has(name)) throw new Error(`shellnote: ${name} has its code already`)
    // The door gives the code only what `needs` promised, checked by `unavailable` before each call.
    this.#doers.set(name, { needs, doer: doer as Doer, options })
  }

  /** What is on screen now, for the app-state map. */
  get places(): Readonly<Places> {
    return this.#places
  }

  /** Put a part of the app at the commands' disposal while it is on screen. Returns the function that takes it away. */
  provide<K extends keyof Places>(key: K, value: NonNullable<Places[K]>): () => void {
    this.#places[key] = value
    for (const heard of [...this.#arrivals]) heard()
    return () => {
      if (this.#places[key] === value) delete this.#places[key]
    }
  }

  /**
   * Wait for a part of the app to come on screen, and be `ready`: a command
   * that changes screens waits so, and the agent's next line finds the new
   * screen. Gives up after `ms`.
   */
  until<K extends keyof Places>(key: K, ready: (part: NonNullable<Places[K]>) => boolean = () => true, ms = ARRIVAL_MS): Promise<NonNullable<Places[K]>> {
    return new Promise((resolve, reject) => {
      const heard = (): void => {
        const part = this.#places[key]
        if (part === undefined || !ready(part as NonNullable<Places[K]>)) return
        this.#arrivals.delete(heard)
        clearTimeout(timer)
        resolve(part as NonNullable<Places[K]>)
      }
      const timer = setTimeout(() => {
        this.#arrivals.delete(heard)
        reject(new Error(`The ${SCREEN[key]} did not come up within ${ms / 1000} s.`))
      }, ms)
      this.#arrivals.add(heard)
      heard()
    })
  }

  /** Add a line to the app-state map, read when asked; undefined leaves it out. */
  describe(part: string, read: () => string | undefined): void {
    this.#state.set(part, read)
  }

  /**
   * The app as the agent reads it: one short line per part, never a picture. A part holds names from notes and files
   * (a title, a video's, a folder's), which are data, never instructions: each part is kept on one line,
   * its backticks made plain, so no name can pose as a line of the terminal or open or close a block. Only line
   * breaks change: the small models' page reads the spacing as written ("zoom 90 %").
   */
  state(): string {
    return [...this.#state.values()]
      .map((read) => read())
      .filter((line): line is string => line !== undefined)
      .map((line) => line.replace(/`+/gu, "'").replace(/[\r\n\u2028\u2029\v\f]+/gu, ' '))
      .join('\n')
  }

  /** Why a command cannot run now, or undefined when it can. */
  unavailable(name: string): string | undefined {
    const known = this.#doers.get(name)
    if (!known) return this.#specs.has(name) ? `${name} is not built yet.` : `There is no command ${name}: use find.`
    const missing = known.needs.find((need) => (typeof need === 'string' ? this.#places[need] === undefined : need.every((one) => this.#places[one] === undefined)))
    if (missing === undefined) return undefined
    return typeof missing === 'string' ? WHY_NOT[missing] : `Nothing to do it on here: open ${[...new Set(missing.map((one) => PART[one]))].join(' or ')} first.`
  }

  /**
   * A person's click on a button whose command waits: done, and a failure told
   * as the button always told it (an alert), never left unseen.
   */
  press(name: string, input: Record<string, unknown> = {}): void {
    const told = (error: unknown): void => window.alert(error instanceof Error ? error.message : String(error))
    // Done inside the click, as the button did itself: what it changes is drawn with the click (React draws a
    // click's changes before the next event), not a moment later. A zoom drawn late moved where the page sat on
    // the screen's pixels, and the pen's line changed as it lifted at 125 % (found 19 October 2026).
    try {
      const done = this.do(name, input)
      if (typeof done !== 'string') done.catch(told)
    } catch (error) {
      told(error)
    }
  }

  /**
   * A person's click whose failure the screen shows itself (a toast, a line in
   * a menu) or that cannot fail: done, and anything thrown only logged.
   */
  tap(name: string, input: Record<string, unknown> = {}): void {
    // Only a mistake in the app is logged ("shellnote: …"); what the screen has told the person already is not.
    const log = (error: unknown): void => {
      if (error instanceof Error && error.message.startsWith('shellnote:')) console.warn(error)
    }
    try {
      const done = this.do(name, input)
      if (typeof done !== 'string') done.catch(log)
    } catch (error) {
      log(error)
    }
  }

  /** The commands with code. */
  defined(): string[] {
    return [...this.#doers.keys()]
  }

  /**
   * A person's click: done at once, with no asking (where something cannot be
   * undone, the app asks the person itself). A bad input or a missing part is a
   * mistake in the app, so it throws.
   */
  do(name: string, input: Record<string, unknown> = {}): string | Promise<string> {
    const why = this.unavailable(name)
    if (why !== undefined) throw new Error(`shellnote: ${why}`)
    const checked = checkInput(this.#specs.get(name)!, input)
    if (!checked.ok) throw new Error(`shellnote: ${name}: ${checked.why}`)
    return this.#doers.get(name)!.doer(checked.input, this.#places, 'person')
  }

  /**
   * The agent's call: checked, run when it can, asking the person first for
   * what cannot be undone, and reported with the app's state before and after.
   * Never throws: a refusal is an answer the model can act on.
   */
  async run(name: string, input: unknown, ask: (question: string) => Promise<boolean>): Promise<Ran> {
    const spec = this.#specs.get(name)
    const why = this.unavailable(name)
    if (!spec || why !== undefined) return { ok: false, command: name, why: why ?? `There is no command ${name}: use find.` }
    const checked = checkInput(spec, input)
    if (!checked.ok) return { ok: false, command: name, why: `The input does not fit ${name}:\n${checked.why}` }
    const { doer, options } = this.#doers.get(name)!
    const asking = spec.asks !== undefined && (options.asksWhen?.(this.#places) ?? true)
    if (asking && !(await ask(`The AI wants to: ${spec.does.toLowerCase()} (${JSON.stringify(checked.input)}). ${spec.asks} Allow it?`))) {
      return { ok: false, command: name, why: 'You said no.' }
    }
    const before = this.state()
    try {
      const done = await doer(checked.input, this.#places, 'agent')
      return { ok: true, command: name, done, before, after: this.state(), ...(spec.review ? { review: spec.review } : {}) }
    } catch (error) {
      return { ok: false, command: name, why: `It failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
