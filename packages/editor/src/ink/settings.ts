// The pen's switches and the pen in hand. The switches: each
// person's defaults are kept in this browser, and a note may set any of them
// for itself (Doc.pen), which wins. The pen in hand (its kind, colour and
// width, and the eraser's) is the person's, not the note's: kept in this
// browser, as the recent colours are.
import { ALL_TIDY_RULES, AnyColor, Learner, PenKind, PenOverrides, StrokeWidth, withUndone, type Doc, type PenExample, type PenProfile, type PenSettings, type Pt, type TidyRules } from '@shellnote/core'

/** The plan's defaults: lines straightened on hold and on their own, shapes on hold, a little smoothing. */
export const PEN_DEFAULTS: PenSettings = {
  penOnly: 'auto',
  lines: 'auto',
  shapes: 'hold',
  smoothing: 1,
  neaten: 'line',
  anchor: 'first',
  wordGap: 'usual',
  toText: 'demand',
  scratch: true,
  circleLasso: false,
  symbols: ['paren', 'bracket', 'brace', 'comma', 'at'],
  pressure: 'normal',
}

const SETTINGS_KEY = 'shellnote:pen-settings'
const CHOICE_KEY = 'shellnote:pen-choice'

/**
 * Set once a person chooses how handwriting is tidied. Before tidying was
 * built (17 October 2026) the switch was not shown, yet every save kept its
 * old default, 'demand'; such a saved value was never chosen, so the new
 * default stands in for it.
 */
const NEATEN_CHOSEN_KEY = 'shellnote:pen-neaten-chosen'

/** This person's own pen switches: the defaults, with what they changed. */
export function myPenSettings(): PenSettings {
  try {
    const saved = PenOverrides.safeParse(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'))
    const mine = saved.success ? stripUndefined(saved.data) : {}
    if (mine.neaten !== undefined && localStorage.getItem(NEATEN_CHOSEN_KEY) === null) delete mine.neaten
    return { ...PEN_DEFAULTS, ...mine }
  } catch {
    return { ...PEN_DEFAULTS }
  }
}

/** Keep this person's own pen switches. */
export function saveMyPenSettings(settings: PenSettings): void {
  try {
    if (settings.neaten !== myPenSettings().neaten) localStorage.setItem(NEATEN_CHOSEN_KEY, '1')
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage is off, as in a private window: the switches last until the page closes.
  }
  // A new count, so what shows the switches draws again.
  penSettings.set(penSettings.value + 1)
}

/** The switches that hold in a note: this person's own, with the note's overrides on top. */
export function penSettingsFor(doc: Doc): PenSettings {
  return { ...myPenSettings(), ...stripUndefined(doc.pen ?? {}) }
}

/** The fields that hold a value: a note's overrides leave the rest to this person's own. */
function stripUndefined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> }
}

// ----- the pen in hand ------------------------------------------------------------------------------

/** The eraser takes whole strokes, or only the part of a stroke it passes over. */
export type EraserMode = 'stroke' | 'part'

/** The eraser's sizes: its radius, in document units (1, 2.5 and 5 mm). */
export const ERASER_RADIUS = { s: 100, m: 250, l: 500 } as const
export type EraserSize = keyof typeof ERASER_RADIUS

export interface PenChoice {
  /** The pen tool's kind; 'pen' is the plain pen. */
  kind: 'pen' | Exclude<PenKind, 'highlighter'>
  color: AnyColor
  width: StrokeWidth
  highlighterColor: AnyColor
  highlighterWidth: StrokeWidth
  eraser: EraserMode
  eraserSize: EraserSize
}

export const CHOICE_DEFAULTS: PenChoice = {
  kind: 'pen',
  color: 'ink',
  width: 's',
  highlighterColor: 'yellow',
  highlighterWidth: 'm',
  eraser: 'stroke',
  eraserSize: 'm',
}

/** Each saved value, kept only when it is still one the app knows. */
const CHECKS: { [K in keyof PenChoice]: (value: unknown) => boolean } = {
  kind: (value) => value === 'pen' || (PenKind.safeParse(value).success && value !== 'highlighter'),
  color: (value) => AnyColor.safeParse(value).success,
  width: (value) => StrokeWidth.safeParse(value).success,
  highlighterColor: (value) => AnyColor.safeParse(value).success,
  highlighterWidth: (value) => StrokeWidth.safeParse(value).success,
  eraser: (value) => value === 'stroke' || value === 'part',
  eraserSize: (value) => typeof value === 'string' && value in ERASER_RADIUS,
}

function readChoice(): PenChoice {
  const choice = { ...CHOICE_DEFAULTS }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '{}')
    if (typeof saved !== 'object' || saved === null) return choice
    for (const key of Object.keys(CHECKS) as (keyof PenChoice)[]) {
      const value = (saved as Record<string, unknown>)[key]
      if (CHECKS[key](value)) (choice as Record<string, unknown>)[key] = value
    }
  } catch {
    // Storage is off, or holds something else: the defaults.
  }
  return choice
}

/** A small store for React (useSyncExternalStore): the pen in hand, and a signal when the switches change. */
class Listened<T> {
  #listeners = new Set<() => void>()
  constructor(public value: T) {}
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  snapshot = (): T => this.value
  set(value: T): void {
    this.value = value
    this.changed()
  }
  changed(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}

/** The pen in hand. */
export const penChoice = new Listened<PenChoice>(readChoice())

/** Change the pen in hand, and keep it. */
export function choosePen(change: Partial<PenChoice>): void {
  const next = { ...penChoice.value, ...change }
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(next))
  } catch {
    // Storage is off: the pen lasts until the page closes.
  }
  penChoice.set(next)
}

/** Counts each change to this person's own switches, so what shows them hears of it; a note's own come with the note. */
export const penSettings = new Listened<number>(0)

// ----- this person's pressure -----------------------------------

const PRESSURE_KEY = 'shellnote:pen-pressure'
/** Until a pen has written, its usual pressure is taken to be half. */
const FIRST_GUESS = 0.5

interface Learned {
  /** How hard this person usually presses, 0 to 1, as this device's pen reports it. */
  typical: number
  /** How many strokes it was learned from. */
  strokes: number
}

function readLearned(): Learned {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PRESSURE_KEY) ?? 'null')
    if (typeof saved === 'object' && saved !== null) {
      const { typical, strokes } = saved as Record<string, unknown>
      if (typeof typical === 'number' && typical > 0 && typical <= 1 && typeof strokes === 'number' && strokes >= 0) return { typical, strokes }
    }
  } catch {
    // Storage is off: learned afresh each time the page opens.
  }
  return { typical: FIRST_GUESS, strokes: 0 }
}

let learned = readLearned()

/** How hard this person usually presses, on this device's pen. */
export const typicalPressure = (): number => learned.typical

/**
 * Learn from a stroke's usual pressure (its middle's median): an average of
 * the first few strokes, then slowly following any change, so one heavy
 * stroke does not change the next.
 */
export function learnPressure(median: number): void {
  if (!(median > 0.01 && median <= 1)) return
  const weight = learned.strokes < 5 ? 1 / (learned.strokes + 1) : 0.15
  learned = { typical: learned.typical + weight * (median - learned.typical), strokes: learned.strokes + 1 }
  try {
    localStorage.setItem(PRESSURE_KEY, JSON.stringify(learned))
  } catch {
    // Storage is off: learned until the page closes.
  }
}

/** What the last stroke came from, for the pen check in the Pen settings: the pointer's type, and its pressure's range when it had one. */
export interface LastInput {
  type: string
  pressure?: [number, number]
}

export const lastInput = new Listened<LastInput | undefined>(undefined)

/** The wand is up: the next drag on the page is a box, and the writing in it is tidied. */
export const tidyBox = new Listened<boolean>(false)

const DEVELOPER_KEY = 'shellnote:developer-mode'
const RULES_KEY = 'shellnote:tidy-rules'

function readDeveloper(): boolean {
  try {
    return localStorage.getItem(DEVELOPER_KEY) === '1'
  } catch {
    return false
  }
}

function readRules(): TidyRules {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RULES_KEY) ?? '{}')
    const rules = { ...ALL_TIDY_RULES }
    if (typeof saved === 'object' && saved !== null) {
      for (const key of Object.keys(ALL_TIDY_RULES) as (keyof TidyRules)[]) {
        const value = (saved as Record<string, unknown>)[key]
        if (typeof value === 'boolean') rules[key] = value
      }
    }
    return rules
  } catch {
    return { ...ALL_TIDY_RULES }
  }
}

/**
 * Developer mode: each tidy rule switched on or off by itself, to try them one by one.
 * Kept in the person's own browser, never in a note; off, every rule is on, as built.
 */
export const developerMode = new Listened<boolean>(readDeveloper())
export const tidyRules = new Listened<TidyRules>(readRules())

export function setDeveloperMode(on: boolean): void {
  try {
    localStorage.setItem(DEVELOPER_KEY, on ? '1' : '0')
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  developerMode.set(on)
}

export function setTidyRule(key: keyof TidyRules, on: boolean): void {
  const next = { ...tidyRules.value, [key]: on }
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(next))
  } catch {
    // Storage is off: they last until the page closes.
  }
  tidyRules.set(next)
}

/** The tidy rules in force: the person's own in developer mode; else all, as built. */
export function rulesInForce(): TidyRules {
  return developerMode.value ? tidyRules.value : ALL_TIDY_RULES
}

// ----- this person's own strokes -----------------------------------

/**
 * This person's pen profile: the strokes they recorded ("Teach my pen") and
 * the corrections they undid, from which the pen learns their hand (core's
 * learn.ts). The app loads it from the library and keeps it there whenever
 * it changes; undefined until they record, and the general rules decide.
 */
export const penProfile = new Listened<PenProfile | undefined>(undefined)

let made: { profile: PenProfile; learner: Learner } | undefined

/** The learner for the profile now, made once for each profile (some tens of milliseconds for a whole recording). */
export function penLearner(): Learner | undefined {
  const profile = penProfile.value
  if (!profile || profile.examples.length === 0) return undefined
  if (made?.profile !== profile) made = { profile, learner: Learner.of(profile) }
  return made.learner
}

// Made while the page is idle, so the first stroke after the profile arrives does not wait for it.
penProfile.subscribe(() => {
  const idle = (globalThis as { requestIdleCallback?: (run: () => void) => number }).requestIdleCallback ?? ((run: () => void) => setTimeout(run, 50))
  idle(() => penLearner())
})

/**
 * A correction the person undid at once: the stroke, as drawn on the screen,
 * kept as plain ink, so the pen leaves strokes like it alone from now on.
 */
export function teachUndone(points: readonly Pt[]): PenExample | undefined {
  const before = penProfile.value
  const profile = withUndone(before, points, new Date())
  const added = profile.examples.at(-1)
  changeProfile(profile)
  return added && !before?.examples.includes(added) ? added : undefined
}

/** The undo that taught the pen `example` was redone: the correction stands, so the lesson goes. */
export function forgetUndone(example: PenExample): void {
  const profile = penProfile.value
  if (!profile?.examples.includes(example)) return
  changeProfile({ ...profile, updated: new Date().toISOString(), examples: profile.examples.filter((e) => e !== example) })
}

/**
 * A changed profile: its learner follows, the examples gone taken away and
 * the new ones added, without describing the rest again (the pen review's R6).
 */
function changeProfile(next: PenProfile): void {
  const was = made
  if (was && was.profile === penProfile.value) {
    const kept = new Set(next.examples)
    const old = new Set(was.profile.examples)
    made = { profile: next, learner: was.learner.edited((known) => known.from !== undefined && kept.has(known.from), next.examples.filter((e) => !old.has(e))) }
  }
  penProfile.set(next)
}
