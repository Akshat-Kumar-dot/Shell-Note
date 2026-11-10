// Tabs of ShellNote in the same browser tell each other which note they
// edit, over a BroadcastChannel, so two tabs never write the same note
// without knowing. A tab that opens a note
// another tab edits shows it read-only and says so; "Edit here" asks the
// other tab to save and step back. Home pages hear when notes change, and
// refresh.

/** What tabs say to each other. */
export type TabMessage =
  | { t: 'who'; from: string }
  | { t: 'editing'; from: string; note: string }
  | { t: 'closed'; from: string; note: string }
  | { t: 'take'; from: string; note: string }
  | { t: 'released'; from: string; note: string }
  | { t: 'saved'; from: string; note: string }
  | { t: 'library'; from: string }

const CHANNEL = 'shellnote'

export class Tabs {
  /** This tab's own name, random for each page load. */
  readonly id = Math.random().toString(36).slice(2, 10)
  readonly #channel: BroadcastChannel | undefined
  /** The note this tab edits. */
  #editing: string | undefined
  /** The note each other tab edits, by tab. */
  readonly #others = new Map<string, string>()
  readonly #listeners = new Set<(message: TabMessage) => void>()

  constructor() {
    if (typeof BroadcastChannel === 'undefined') return
    this.#channel = new BroadcastChannel(CHANNEL)
    this.#channel.onmessage = (event: MessageEvent<TabMessage>) => this.#receive(event.data)
  }

  /** The notes other tabs edit now. */
  editedElsewhere(): Set<string> {
    return new Set(this.#others.values())
  }

  /** Ask the other tabs which notes they edit, and wait a moment for them to answer. */
  async survey(wait = 200): Promise<Set<string>> {
    this.#post({ t: 'who', from: this.id })
    await new Promise((done) => setTimeout(done, wait))
    return this.editedElsewhere()
  }

  /** Tell the others this tab edits a note now, or none (undefined). */
  editing(note: string | undefined): void {
    if (this.#editing !== undefined && this.#editing !== note) this.#post({ t: 'closed', from: this.id, note: this.#editing })
    this.#editing = note
    if (note !== undefined) this.#post({ t: 'editing', from: this.id, note })
  }

  /** Ask the tab that edits a note to save it and step back, so this one can edit it. */
  take(note: string): void {
    this.#post({ t: 'take', from: this.id, note })
  }

  /** Tell the others this tab has saved a note and stepped back from it. */
  released(note: string): void {
    if (this.#editing === note) this.#editing = undefined
    this.#post({ t: 'released', from: this.id, note })
  }

  /** Tell the others a note was just saved, so a tab showing it read-only can show the new version. */
  saved(note: string): void {
    this.#post({ t: 'saved', from: this.id, note })
  }

  /** Tell the others something in the library changed: a new, moved, renamed or deleted item. */
  libraryChanged(): void {
    this.#post({ t: 'library', from: this.id })
  }

  /**
   * Tell this tab's own screens what a tab would: for a change that came from outside the app altogether, such as
   * another device writing into the library's folder.
   */
  told(message: TabMessage): void {
    for (const listener of [...this.#listeners]) listener(message)
  }

  /** Listen to what the other tabs say. Returns the function that stops listening. */
  subscribe(listener: (message: TabMessage) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #post(message: TabMessage): void {
    try {
      this.#channel?.postMessage(message)
    } catch {
      // The channel was closed with the page.
    }
  }

  #receive(message: TabMessage): void {
    if (!message || typeof message !== 'object' || message.from === this.id) return
    switch (message.t) {
      case 'who':
        if (this.#editing !== undefined) this.#post({ t: 'editing', from: this.id, note: this.#editing })
        break
      case 'editing':
      case 'take':
        this.#others.set(message.from, message.note)
        break
      case 'closed':
      case 'released':
        if (this.#others.get(message.from) === message.note) this.#others.delete(message.from)
        break
    }
    for (const listener of [...this.#listeners]) listener(message)
  }
}
