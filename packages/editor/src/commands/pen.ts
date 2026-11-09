// The pen bar's settings (⚙) and the wand's Whole note as commands (app
// control, step 3): each does what its control did, and the controls call them.
// Dragging the wand's box over some writing stays the person's.
import { tidyNoteOps, type Doc, type PenOverrides, type PenSettings, type SymbolKind, type TidyRules } from '@shellnote/core'
import { developerMode, myPenSettings, penProfile, penSettingsFor, rulesInForce, saveMyPenSettings, setDeveloperMode, setTidyRule, tidyBox } from '../ink/settings.js'
import type { EditorStore } from '../store.js'
import type { By, Commands, Places } from './run.js'

export type PenOption = 'fingers' | 'lines' | 'shapes' | 'smoothing' | 'pressure' | 'scratch' | 'tidy' | 'anchor' | 'gap'

/** Each switch of the pen panel: its setting, and its values with the words that say them (the first, the usual one). */
const SWITCHES: Record<PenOption, { key: keyof PenSettings; values: [PenSettings[keyof PenSettings], string[]][] }> = {
  fingers: { key: 'penOnly', values: [['auto', ['auto']], ['always', ['always']], ['off', ['off', 'draw']]] },
  lines: { key: 'lines', values: [['off', ['off']], ['hold', ['hold', 'held']], ['auto', ['auto']]] },
  shapes: { key: 'shapes', values: [['off', ['off']], ['hold', ['hold', 'held', 'on']]] },
  smoothing: { key: 'smoothing', values: [[0, ['off', '0']], [1, ['light', '1']], [2, ['medium', '2']], [3, ['strong', '3']]] },
  pressure: { key: 'pressure', values: [['off', ['off']], ['soft', ['soft']], ['normal', ['normal']], ['firm', ['firm']]] },
  scratch: { key: 'scratch', values: [[true, ['on', 'true']], [false, ['off', 'false']]] },
  tidy: { key: 'neaten', values: [['line', ['line', 'lines']], ['word', ['word', 'words']], ['demand', ['button', 'demand']], ['off', ['off']]] },
  anchor: { key: 'anchor', values: [['first', ['first']], ['most', ['most']], ['last', ['last']]] },
  gap: { key: 'wordGap', values: [['usual', ['usual']], ['first', ['first']], ['tighter', ['tighter']], ['wider', ['wider']], ['written', ['written']]] },
}
const SYMBOLS: SymbolKind[] = ['paren', 'bracket', 'brace', 'comma', 'at']

/** The option a setting is changed by, for the pen panel's own controls. */
export function optionOf(key: keyof PenSettings): PenOption | 'symbols' | undefined {
  if (key === 'symbols') return 'symbols'
  return (Object.keys(SWITCHES) as PenOption[]).find((option) => SWITCHES[option].key === key)
}

/** A setting's value as the commands write it: the first of its words. */
export function valueWord(option: PenOption, value: unknown): string {
  return SWITCHES[option].values.find(([v]) => v === value)?.[1][0] ?? String(value)
}

/** A note's own pen settings, set or taken off, as one undo step. */
function noteOverrides(store: EditorStore, pen: PenOverrides | undefined, by: By): void {
  const doc: Doc = store.doc
  store.apply([{ op: 'update', id: doc.id, set: { pen: pen === undefined || Object.keys(pen).length === 0 ? null : pen } }], { origin: by === 'agent' ? 'terminal' : 'toolbar' })
}

/** The note whose own settings change, when it may change. */
function noteToChange(places: Places): EditorStore {
  const store = places.note?.store
  if (!store) throw new Error('No note is open: a note\'s own pen settings need it open (note.open), or leave scope out for yours.')
  if (places.workspace && !places.workspace.editing()) throw new Error('This note is read-only here: it is being edited in another window.')
  return store
}

export function definePen(commands: Commands): void {
  commands.define('settings.pen', [], ({ option, value, scope }, places, by) => {
    const words = String(value).trim().toLowerCase()
    let changed: { key: keyof PenSettings; value: PenSettings[keyof PenSettings]; said: string }
    if (option === 'symbols') {
      const listed = words === 'all' ? SYMBOLS : words === 'none' ? [] : words.split(/[\s,]+/u).filter(Boolean)
      const wrong = listed.filter((kind) => !SYMBOLS.includes(kind as SymbolKind))
      if (wrong.length > 0) throw new Error(`No symbol ${wrong.join(', ')}: symbols are ${SYMBOLS.join(', ')}, all or none, as a list (symbols value=paren,brace).`)
      changed = { key: 'symbols', value: listed as SymbolKind[], said: listed.length === 0 ? 'none' : listed.join(', ') }
    } else {
      const sw = SWITCHES[option as PenOption]
      const found = sw.values.find(([, said]) => said.includes(words))
      if (!found) throw new Error(`${String(option)} takes ${sw.values.map(([, said]) => said[0]).join(', ')}.`)
      changed = { key: sw.key, value: found[0], said: found[1][0]! }
    }
    if (scope === 'note') {
      const store = noteToChange(places)
      noteOverrides(store, { ...(store.doc.pen ?? {}), [changed.key]: changed.value }, by)
      return `pen setting ${String(option)}: ${changed.said}, for this note`
    }
    saveMyPenSettings({ ...myPenSettings(), [changed.key]: changed.value })
    return `pen setting ${String(option)}: ${changed.said}, yours`
  })
  commands.define('settings.penReset', ['note'], (_, places, by) => {
    const store = noteToChange(places)
    if (!store.doc.pen) return 'this note has no pen settings of its own: yours are in use'
    noteOverrides(store, undefined, by)
    return "this note's own pen settings taken off: yours are in use"
  })
  commands.define('settings.developer', [], ({ on }) => {
    setDeveloperMode(on === true)
    return on === true ? 'developer mode on: each tidy rule can be switched by itself (settings.tidyRule)' : 'developer mode off: every tidy rule is on, as built'
  })
  commands.define('settings.tidyRule', [], ({ rule, on }) => {
    if (!developerMode.value) throw new Error('Developer mode is off, so every tidy rule is on: settings.developer on=true first.')
    setTidyRule(rule as keyof TidyRules, on === true)
    return `tidy rule ${String(rule)} ${on === true ? 'on' : 'off'}`
  })
  commands.define('tidy.note', ['note', 'workspace'], (_, { note: { store }, workspace }, by) => {
    if (!workspace.editing()) throw new Error('This note is read-only here: it is being edited in another window.')
    tidyBox.set(false)
    const settings = penSettingsFor(store.doc)
    if (settings.neaten === 'off') throw new Error('Tidy handwriting is off in the pen settings: settings.pen option=tidy value=button turns on the tidy button alone.')
    const ops = tidyNoteOps(store.doc, { ...settings, rules: rulesInForce() })
    if (ops.length === 0) return 'nothing to tidy: the handwriting is tidy already'
    store.apply(ops, { origin: by === 'agent' ? 'terminal' : 'toolbar' })
    return 'the handwriting tidied, each line levelled, one undo step'
  })
  commands.define('pen.forget', [], () => {
    if (!penProfile.value) return 'the pen has learned nothing of your hand yet'
    penProfile.set(undefined)
    return 'everything the pen learned of your hand is forgotten: it goes by general rules again'
  }, { asksWhen: () => penProfile.value !== undefined })
}
