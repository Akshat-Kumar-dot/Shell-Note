// The command box (Ctrl+P, or "Open or run…" at the top of the library's column): type to find a note or a folder by
// its name, or a command by its name in the box (boxCommands.ts) or the everyday words the app knows for it
// (the terminal's own lists: no model, nothing sent anywhere). Up and Down to move, Enter to open or run, Escape to
// close. Empty, the notes opened last. A command that needs a choice asks for it here, as a second step; what cannot
// be undone, the app asks about itself.
import { asksOf, COMMANDS, Finder, valuesOf, VERBS, type CommandSpec, type InputAsk } from '@shellnote/core'
import { commands, KEYS } from '@shellnote/editor'
import type { FolderEntry, Library, LibraryStore, NoteEntry } from '@shellnote/library'
import { folderPath, hidden, search } from '@shellnote/library/tree'
import { ChevronRight, Folder, Search, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { KIND_ICON, kindOf } from '../library/kinds.js'
import { BOX, linesOf } from './boxCommands.js'
import { commandBox, openNotes } from './state.js'

const split = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean)

/** The keys that run a command, from the app's one list of them. */
const KEY_OF: ReadonlyMap<string, string> = new Map(KEYS.flatMap((group) => group.keys.flatMap((line) => (line.command ? [[line.command, line.keys] as const] : []))))

/** A line the box offers: a command, its name and icon, the choice it has made, what it still asks for, the words it is found by, its keys. */
interface Offer {
  spec: CommandSpec
  label: string
  icon: LucideIcon
  labelWords: string[]
  words: string[]
  preset: Record<string, unknown>
  asks: InputAsk[]
  keys?: string
}

let offers: Offer[] | undefined
/** Every line the box offers, in its list's order (boxCommands.ts): each input it cannot do without asked for, or made. */
function offered(): Offer[] {
  if (offers) return offers
  const specs = new Map(COMMANDS.map((spec) => [spec.name, spec]))
  offers = Object.keys(BOX).flatMap((name) => {
    const spec = specs.get(name)
    const asks = spec ? asksOf(spec) : undefined
    if (!spec || !asks) return []
    const shape = spec.input.shape as Record<string, Parameters<typeof valuesOf>[0]>
    const said = [name.replace(/\./gu, ' ').replace(/([a-z])([A-Z])/gu, '$1 $2'), ...spec.says, ...(VERBS[name] ?? [])]
    const keys = KEY_OF.get(name)
    return linesOf(name).map((line) => {
      const preset = line.input ?? {}
      // A choice the line has made is not asked, and finds the line by its own word alone (Zoom in is not found by
      // "out"); a narrower list of choices is the line's own.
      const values = Object.entries(shape).flatMap(([field, schema]) => (field in preset ? [String(preset[field])] : (line.values?.[field] ?? valuesOf(schema) ?? [])))
      const left = asks
        .filter((ask) => !(ask.field in preset))
        .map((ask): InputAsk => (ask.kind === 'choice' && line.values?.[ask.field] ? { ...ask, values: line.values[ask.field]! } : ask))
      const labelWords = split(line.title)
      const words = [...new Set([...labelWords, ...[...said, ...values].flatMap(split)])]
      return { spec, label: line.title, icon: line.icon, labelWords, words, preset, asks: left, ...(keys ? { keys } : {}) }
    })
  })
  return offers
}

let finderMade: Finder | undefined
const finder = (): Finder => (finderMade ??= new Finder(COMMANDS))

/** Whether a line's own choice agrees with what the words read: each choice it made unread, or read the same. */
const agrees = (offer: Offer, read: Record<string, unknown>): boolean => Object.entries(offer.preset).every(([key, value]) => !(key in read) || read[key] === value)

/** What the list holds: a note, a folder, a line of a command with the inputs the words gave it, or a choice for the step. */
type Item = { kind: 'note'; entry: NoteEntry; where: string } | { kind: 'folder'; entry: FolderEntry; where: string } | { kind: 'command'; offer: Offer; read: Record<string, unknown> } | { kind: 'choice'; value: unknown; label: string }

/** A command chosen that still needs an input: the one asked for now. */
interface Step {
  offer: Offer
  input: Record<string, unknown>
  ask: InputAsk
}

/** An input, as the step asking for it names it. */
const FIELD_WORD: Readonly<Record<string, string>> = {
  shell: 'look',
  look: 'appearance',
  accent: 'colour',
  sheet: 'page size',
  turn: 'way up',
  type: 'kind of note',
  show: 'notes to show',
  view: 'way to show the library',
  side: 'side',
  place: 'place',
  part: 'part to reset',
  section: 'section',
  panel: 'part',
  paper: 'paper',
  tool: 'tool',
  on: 'choice',
  percent: 'zoom, in percent',
  page: 'page number',
  minutes: 'minutes',
  seconds: 'time, in seconds',
  name: 'name',
  text: 'words',
}
const fieldWord = (field: string): string => FIELD_WORD[field] ?? field

const placeOf = (library: Library, folder: string | null): string => (folder === null ? 'Library' : folderPath(library, folder).map((one) => one.name).join(' › '))
const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * The lines the words find: each typed word the start of one of a line's words, its own name first, then in the list's
 * order; a sentence, the finder's nearest too. A line whose own choice the words gainsay ("zoom out" is not Zoom in) is
 * left out.
 */
function commandsFor(query: string): Item[] {
  const typed = split(query)
  if (typed.length === 0) return []
  const reads = new Map<string, Record<string, unknown>>()
  const readOf = (name: string): Record<string, unknown> => {
    let read = reads.get(name)
    if (!read) reads.set(name, (read = finder().inputsOf(query, name)))
    return read
  }
  const scored: { offer: Offer; score: number }[] = []
  for (const offer of offered()) {
    if (commands.unavailable(offer.spec.name) !== undefined) continue
    let score = 0
    for (const word of typed) {
      if (offer.labelWords.some((one) => one.startsWith(word))) score += 2
      else if (offer.words.some((one) => one.startsWith(word))) score += 1
      else {
        score = 0
        break
      }
    }
    if (score === 0) continue
    if (Object.keys(offer.preset).length > 0 && !agrees(offer, readOf(offer.spec.name))) continue
    // A line that leads with the first word ("Page: …" for "page"), or names it plainly with no area before it ("Ask
    // the AI about what is selected" for "ai"), before one that only mentions it.
    const lead = typed[0]!
    if (offer.labelWords[0]?.startsWith(lead) || (!offer.label.includes(': ') && offer.labelWords.some((one) => one.startsWith(lead)))) score += 1
    scored.push({ offer, score })
  }
  const list = scored.sort((a, b) => b.score - a.score).map(({ offer }) => offer)
  // A sentence ("make the paper dark"): what the finder finds near it, when the words alone found little; of a command
  // of several lines, the line whose own choice the words name, else the first that agrees with them.
  if (list.length < 3 && typed.length >= 3) {
    for (const near of finder().nearest(query, 6)) {
      if (commands.unavailable(near.command) !== undefined) continue
      const read = readOf(near.command)
      const lines = offered().filter((one) => one.spec.name === near.command && agrees(one, read))
      const offer = lines.find((one) => Object.keys(one.preset).some((key) => key in read)) ?? lines[0]
      if (offer && !list.includes(offer)) list.push(offer)
    }
  }
  return list.slice(0, 6).map((offer) => ({ kind: 'command', offer, read: readOf(offer.spec.name) }))
}

/** The choices of the input asked for now, those the typed words begin. */
function choicesFor(step: Step, query: string): Item[] {
  const typed = query.trim().toLowerCase()
  if (step.ask.kind === 'choice') return step.ask.values.filter((value) => typed === '' || value.toLowerCase().includes(typed)).map((value) => ({ kind: 'choice', value, label: capital(value) }))
  if (step.ask.kind === 'switch')
    return [
      { kind: 'choice', value: true, label: 'On' },
      { kind: 'choice', value: false, label: 'Off' },
    ].filter((item) => typed === '' || item.label.toLowerCase().startsWith(typed)) as Item[]
  if (step.ask.kind === 'number') {
    const value = Number(typed)
    return typed !== '' && Number.isFinite(value) ? [{ kind: 'choice', value, label: typed }] : []
  }
  return query.trim() !== '' ? [{ kind: 'choice', value: query.trim(), label: `“${query.trim()}”` }] : []
}

/** A command's keys, a cap for each. */
const Caps = ({ keys }: { keys: string }) => (
  <span className="cmd-keys">
    {keys
      .split(' or ')[0]!
      .split('+')
      .map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
  </span>
)

export function CommandBox({ store }: { store: LibraryStore }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [library, setLibrary] = useState<Library>()
  const [step, setStep] = useState<Step>()
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    store.list().then(
      (read) => live && setLibrary(read),
      () => undefined,
    )
    field.current?.focus()
    return () => {
      live = false
    }
  }, [store])

  const close = (): void => commandBox.set(false)

  // The list: the step's choices; or notes and folders, then commands; or, empty, the notes opened last.
  const items = useMemo((): Item[] => {
    if (step) return choicesFor(step, query)
    if (!library) return []
    const words = query.trim()
    if (words === '') {
      const open = [...openNotes.value].reverse().map((one) => one.id)
      const recent = [...library.notes].filter((entry) => !hidden(library, entry)).sort((a, b) => b.edited - a.edited)
      const byId = new Map(recent.map((entry) => [entry.id, entry]))
      const ids = [...new Set([...open.filter((id) => byId.has(id)), ...recent.map((entry) => entry.id)])].slice(0, 7)
      return ids.map((id) => ({ kind: 'note', entry: byId.get(id)!, where: placeOf(library, byId.get(id)!.folder) }))
    }
    const named = search(library, words)
    const lower = words.toLowerCase()
    const first = (name: string): number => (name.toLowerCase().startsWith(lower) ? 0 : 1)
    const notes: Item[] = [...named.notes]
      .sort((a, b) => first(a.title) - first(b.title) || b.edited - a.edited)
      .slice(0, 6)
      .map((entry) => ({ kind: 'note', entry, where: placeOf(library, entry.folder) }))
    const folders: Item[] = [...named.folders]
      .sort((a, b) => first(a.name) - first(b.name))
      .slice(0, 3)
      .map((entry) => ({ kind: 'folder', entry, where: placeOf(library, entry.parent) }))
    return [...notes, ...folders, ...commandsFor(words)]
  }, [step, query, library])

  useEffect(() => setActive(0), [query, step])

  /** A command run, as a click runs it; what fails is told as a button's failure is. */
  const run = (offer: Offer, input: Record<string, unknown>): void => {
    close()
    commands.press(offer.spec.name, input)
  }
  /** A line chosen: run, or its next input asked for. The line's own choice wins over a word read. */
  const go = (offer: Offer, input: Record<string, unknown>): void => {
    const missing = offer.asks.find((ask) => !(ask.field in input))
    if (missing) {
      setStep({ offer, input, ask: missing })
      setQuery('')
      field.current?.focus()
    } else run(offer, input)
  }
  const choose = (item: Item | undefined): void => {
    if (!item) return
    if (item.kind === 'note') {
      close()
      commands.press('note.open', { note: item.entry.id })
    } else if (item.kind === 'folder') {
      close()
      commands.press('library.open', { folder: item.entry.id })
    } else if (item.kind === 'command') go(item.offer, { ...item.read, ...item.offer.preset })
    else if (step) go(step.offer, { ...step.input, [step.ask.field]: item.value })
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length > 0) setActive((now) => (now + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(items[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (step) {
        setStep(undefined)
        setQuery('')
      } else close()
    }
  }

  const asking = step ? (step.ask.kind === 'words' ? `Type the ${fieldWord(step.ask.field)}, then Enter` : step.ask.kind === 'number' ? `Type the ${fieldWord(step.ask.field)}, a number` : step.ask.kind === 'switch' ? 'On or off?' : `Choose the ${fieldWord(step.ask.field)}`) : undefined
  /** The chosen line's Enter key, where the line has no keys of its own. */
  const enter = <kbd className="cmd-enter">Enter</kbd>
  const row = (item: Item, index: number): ReactNode => {
    const on = index === active
    const common = { id: `cmd-${index}`, role: 'option', 'aria-selected': on, className: 'cmd-item', onMouseEnter: () => setActive(index), onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(), onClick: () => choose(item) } as const
    if (item.kind === 'note') {
      const Kind = KIND_ICON[kindOf(item.entry)]
      return (
        <div key={`n:${item.entry.id}`} {...common}>
          <Kind size={17} strokeWidth={1.75} aria-hidden />
          <span className="cmd-name">{item.entry.title || 'Untitled'}</span>
          <small>{item.where}</small>
          {on ? enter : null}
        </div>
      )
    }
    if (item.kind === 'folder')
      return (
        <div key={`f:${item.entry.id}`} {...common}>
          <Folder size={17} strokeWidth={1.75} aria-hidden />
          <span className="cmd-name">{item.entry.name}</span>
          <small>{item.where}</small>
          {on ? enter : null}
        </div>
      )
    if (item.kind === 'command') {
      const Icon = item.offer.icon
      // The choices the typed words made, beside the name: those the line has not made itself.
      const given = Object.entries(item.read)
        .filter(([key, value]) => !(key in item.offer.preset) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
        .map(([, value]) => (typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)))
      return (
        <div key={`c:${item.offer.label}`} {...common}>
          <Icon size={17} strokeWidth={1.75} aria-hidden />
          <span className="cmd-name">{item.offer.label}</span>
          {given.length > 0 ? <small>{given.join(', ')}</small> : null}
          {item.offer.keys ? <Caps keys={item.offer.keys} /> : on ? enter : null}
        </div>
      )
    }
    return (
      <div key={`v:${String(item.value)}`} {...common}>
        <ChevronRight size={17} strokeWidth={1.75} aria-hidden />
        <span className="cmd-name">{item.label}</span>
        {on ? enter : null}
      </div>
    )
  }

  // The list in its parts: notes and folders, then commands; a step's choices alone.
  const places = items.filter((item) => item.kind === 'note' || item.kind === 'folder')
  const found = items.filter((item) => item.kind === 'command')
  return (
    <div
      className="cmd"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="cmd-box" role="dialog" aria-modal="true" aria-label="Open or run">
        <div className="cmd-in">
          <Search size={18} strokeWidth={1.75} aria-hidden />
          <input
            ref={field}
            role="combobox"
            aria-expanded
            aria-controls="cmd-list"
            aria-activedescendant={items.length > 0 ? `cmd-${active}` : undefined}
            aria-label={step ? step.offer.label : 'Open a note, or run a command'}
            placeholder={asking ?? 'A note, a folder, or a command…'}
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKey}
          />
        </div>
        {step ? (
          <div className="cmd-step">
            {step.offer.label}
            <small>{asking}</small>
          </div>
        ) : null}
        <div className="cmd-list" id="cmd-list" role="listbox" aria-label={step ? 'Choices' : 'Notes, folders and commands'}>
          {step ? (
            items.length > 0 ? (
              items.map(row)
            ) : (
              <p className="cmd-quiet">{step.ask.kind === 'choice' ? 'No such choice.' : asking}</p>
            )
          ) : !library ? (
            <p className="cmd-quiet">Reading the library…</p>
          ) : items.length === 0 ? (
            <p className="cmd-quiet">{query.trim() === '' ? 'No notes yet.' : `Nothing is called “${query.trim()}”, and no command says so.`}</p>
          ) : (
            <>
              {places.length > 0 ? <div className="cmd-head">{query.trim() === '' ? 'Opened last' : 'Notes'}</div> : null}
              {places.map((item) => row(item, items.indexOf(item)))}
              {found.length > 0 ? <div className="cmd-head">Commands</div> : null}
              {found.map((item) => row(item, items.indexOf(item)))}
            </>
          )}
        </div>
        <div className="cmd-foot">
          <span>↑↓ to move</span>
          <span>Enter to {step ? 'choose' : 'open'}</span>
          <span>Esc to {step ? 'go back' : 'close'}</span>
        </div>
      </div>
    </div>
  )
}
