// The floating bar while an ink tool is chosen: the pen in hand (its kind,
// width and colour), the highlighter's width and colour, or the eraser's way
// and size; and the Pen switches, for this person or for this note,
// with what the pen has learned of this person's hand. Like every button in
// the bars, none takes the focus.
import { StrokeWidth, type AnyColor, type PenSettings, type SymbolKind, type TidyRules } from '@shellnote/core'
import { Brush, Pen, Pencil, PenTool, SlidersHorizontal, WandSparkles, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { ColourMenu } from '../ColourMenu.js'
import { commands } from '../commands/index.js'
import { optionOf, valueWord } from '../commands/pen.js'
import { eraserWord, widthWord } from '../commands/tools.js'
import { useDismiss } from '../dismiss.js'
import { placeMenu } from '../popover.js'
import type { EditorStore } from '../store.js'
import { ERASER_RADIUS, lastInput, myPenSettings, penChoice, penProfile, penSettings, penSettingsFor, tidyBox, tidyRules, developerMode, typicalPressure, type EraserSize, type LastInput, type PenChoice } from './settings.js'

const keepFocus = (event: MouseEvent): void => event.preventDefault()
const ICON = 18

const KINDS: [PenChoice['kind'], string, LucideIcon][] = [
  ['pen', 'Plain pen', Pen],
  ['pencil', 'Pencil', Pencil],
  ['fountain', 'Fountain pen', PenTool],
  ['marker', 'Marker', Brush],
]
const WIDTH_NAMES: Readonly<Record<StrokeWidth, string>> = { xs: 'Extra fine', s: 'Fine', m: 'Medium', l: 'Broad', xl: 'Extra broad' }
const ERASER_SIZES: [EraserSize, string][] = [
  ['s', 'Small eraser'],
  ['m', 'Medium eraser'],
  ['l', 'Large eraser'],
]

/** Widths as dots that grow, so the choice reads at a glance. */
function Widths({ value, command, onChange }: { value: StrokeWidth; command: string; onChange: (width: StrokeWidth) => void }) {
  return (
    <span className="nw-group nw-segment" role="radiogroup" aria-label="Width">
      {StrokeWidth.options.map((width, i) => (
        <button key={width} type="button" role="radio" className="nw-ibtn" aria-label={WIDTH_NAMES[width]} title={WIDTH_NAMES[width]} aria-checked={value === width} data-command={command} onMouseDown={keepFocus} onClick={() => onChange(width)}>
          <span className="nw-width-dot" style={{ width: 3 + i * 2.5, height: 3 + i * 2.5 }} aria-hidden />
        </button>
      ))}
    </span>
  )
}

export function PenBar({ store }: { store: EditorStore }) {
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  const choice = useSyncExternalStore(penChoice.subscribe, penChoice.snapshot)
  if (tool === 'eraser') {
    return (
      <div className="nw-formatbar nw-penbar" role="toolbar" aria-label="Eraser">
        <span className="nw-segmented" role="radiogroup" aria-label="Eraser takes">
          <button type="button" role="radio" aria-checked={choice.eraser === 'stroke'} title="Whole strokes: a touch takes the whole stroke" data-command="eraser.set" onMouseDown={keepFocus} onClick={() => commands.do('eraser.set', { erase: 'whole' })}>
            Whole strokes
          </button>
          <button type="button" role="radio" aria-checked={choice.eraser === 'part'} title="Part of a stroke: only what the eraser passes over" data-command="eraser.set" onMouseDown={keepFocus} onClick={() => commands.do('eraser.set', { erase: 'part' })}>
            Part of a stroke
          </button>
        </span>
        <span className="nw-sep" />
        <span className="nw-group nw-segment" role="radiogroup" aria-label="Eraser size">
          {ERASER_SIZES.map(([size, label]) => (
            <button key={size} type="button" role="radio" className="nw-ibtn" aria-label={label} title={label} aria-checked={choice.eraserSize === size} data-command="eraser.set" onMouseDown={keepFocus} onClick={() => commands.do('eraser.set', { size: eraserWord(size) })}>
              <span className="nw-eraser-dot" style={{ width: 4 + ERASER_RADIUS[size] / 40, height: 4 + ERASER_RADIUS[size] / 40 }} aria-hidden />
            </button>
          ))}
        </span>
        <span className="nw-sep" />
        <PenPanel store={store} />
      </div>
    )
  }
  const highlighter = tool === 'highlighter'
  const colour = highlighter ? choice.highlighterColor : choice.color
  const command = highlighter ? 'highlighter.set' : 'pen.set'
  const paint = (colour: AnyColor): void => void commands.do(command, { colour })
  return (
    <div className="nw-formatbar nw-penbar" role="toolbar" aria-label={highlighter ? 'Highlighter' : 'Pen'}>
      {highlighter ? null : (
        <>
          <span className="nw-group nw-segment" role="radiogroup" aria-label="Pen">
            {KINDS.map(([kind, label, Icon]) => (
              <button key={kind} type="button" role="radio" className="nw-ibtn" aria-label={label} title={label} aria-checked={choice.kind === kind} data-command="pen.set" onMouseDown={keepFocus} onClick={() => commands.do('pen.set', { kind })}>
                <Icon size={ICON} aria-hidden />
              </button>
            ))}
          </span>
          <span className="nw-sep" />
        </>
      )}
      <Widths value={highlighter ? choice.highlighterWidth : choice.width} command={command} onChange={(width) => void commands.do(command, { width: widthWord(width) })} />
      <span className="nw-sep" />
      <ColourMenu current={colour} onNamed={paint} onCode={(code) => paint(code as AnyColor)} highlighter={highlighter} />
      <span className="nw-sep" />
      {highlighter ? null : <TidyButton store={store} />}
      <PenPanel store={store} />
    </div>
  )
}

/**
 * The wand: tapped, the next drag on the page is a box, and the
 * handwriting in it is tidied, each row levelled, as one undo step (the pen
 * layer draws the box); "Whole note" does every page instead. Tapped again,
 * or Escape, and it is put away. Off when Tidy handwriting is switched off.
 */
function TidyButton({ store }: { store: EditorStore }) {
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  useSyncExternalStore(penSettings.subscribe, penSettings.snapshot)
  const boxing = useSyncExternalStore(tidyBox.subscribe, tidyBox.snapshot)
  const off = penSettingsFor(doc).neaten === 'off'
  useEffect(() => {
    if (off) tidyBox.set(false)
  }, [off])
  // Put away with the pen bar (another tool chosen), and by Escape.
  useEffect(() => () => tidyBox.set(false), [])
  useEffect(() => {
    if (!boxing) return
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') tidyBox.set(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [boxing])
  /** Every page's handwriting tidied, one undo step (tidy.note). */
  const whole = (): void => commands.tap('tidy.note')
  return (
    <>
      <button
        type="button"
        className="nw-ibtn"
        aria-label="Tidy handwriting"
        aria-pressed={boxing}
        disabled={off}
        title={off ? 'Tidy handwriting is off in Pen settings' : boxing ? 'Put the wand away (Escape)' : 'Tidy handwriting: drag a box over the writing to tidy it and level each line (one undo)'}
        onMouseDown={keepFocus}
        onClick={() => tidyBox.set(!boxing)}
      >
        <WandSparkles size={ICON} aria-hidden />
      </button>
      {boxing ? (
        <span className="nw-tidy-box" role="status">
          <span>Drag over the writing</span>
          <button type="button" className="nw-tidy-whole" data-command="tidy.note" onMouseDown={keepFocus} onClick={whole}>
            Whole note
          </button>
        </span>
      ) : null}
    </>
  )
}

/** Each tidy rule, as developer mode lists it. */
const RULES: [keyof TidyRules, string][] = [
  ['ends', 'Cut tails and overshoots'],
  ['letters', "Letters onto their word's line"],
  ['level', 'Words onto the line'],
  ['gaps', 'Even gaps between words'],
  ['margin', 'Keep lines off the right margin'],
  ['marks', 'Dots and bars stay with their word'],
  ['once', 'Each letter counted once (joins, dots)'],
  ['ties', 'Ties settled by the line (a 5)'],
  ['base', 'Digits on their base'],
  ['waist', "A z's waist only after a drop (a 7)"],
  ['rest', 'Level the line after a 1.5 s rest'],
]

/** Developer mode: each tidy rule on or off by itself, for this person, to try them one by one. */
function DeveloperRules() {
  const on = useSyncExternalStore(developerMode.subscribe, developerMode.snapshot)
  const rules = useSyncExternalStore(tidyRules.subscribe, tidyRules.snapshot)
  return (
    <fieldset className="nw-pen-symbols nw-pen-rules">
      <legend>
        <label>
          <input type="checkbox" checked={on} data-command="settings.developer" onChange={(event) => commands.tap('settings.developer', { on: event.target.checked })} />
          Developer mode
        </label>
      </legend>
      {on ? (
        RULES.map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={rules[key]} data-command="settings.tidyRule" onChange={(event) => commands.tap('settings.tidyRule', { rule: key, on: event.target.checked })} />
            {label}
          </label>
        ))
      ) : (
        <em>Try each tidy rule on and off. Off, every rule is on, as built.</em>
      )}
    </fieldset>
  )
}

/** The symbols that can be neatened as the pen lifts, each switched on or off by itself. */
const SYMBOLS: [SymbolKind, string][] = [
  ['paren', '( )'],
  ['bracket', '[ ]'],
  ['brace', '{ }'],
  ['comma', ','],
  ['at', '@'],
]

/** The switches the panel shows: the ones the pen has today. */
const SWITCHES: { key: keyof PenSettings; label: string; choices: [string | number | boolean, string][] }[] = [
  { key: 'penOnly', label: 'Fingers', choices: [['auto', 'Scroll once a pen is used'], ['always', 'Always scroll'], ['off', 'Draw too']] },
  { key: 'lines', label: 'Lines and arrows', choices: [['off', 'Off'], ['hold', 'When held'], ['auto', 'Held, or as the pen lifts']] },
  { key: 'shapes', label: 'Shapes', choices: [['off', 'Off'], ['hold', 'When held']] },
  { key: 'smoothing', label: 'Smoothing', choices: [[0, 'Off'], [1, 'Light'], [2, 'Medium'], [3, 'Strong']] },
  { key: 'pressure', label: 'Pressure', choices: [['off', 'Off (even width)'], ['soft', 'Soft'], ['normal', 'Normal'], ['firm', 'Firm']] },
  { key: 'scratch', label: 'Scratch out to delete', choices: [[true, 'On'], [false, 'Off']] },
  {
    key: 'neaten',
    label: 'Tidy handwriting',
    choices: [
      ['line', 'Words and lines'],
      ['word', 'Words only'],
      ['demand', 'Tidy button only'],
      ['off', 'Off'],
    ],
  },
  { key: 'anchor', label: 'Line up words on', choices: [['first', 'First word'], ['most', 'Most words'], ['last', 'Last word']] },
  { key: 'wordGap', label: 'Gap between words', choices: [['usual', 'Usual'], ['first', 'First gap'], ['tighter', 'Tighter'], ['wider', 'Wider'], ['written', 'As written']] },
]

/** The Pen switches: this person's own, or this note's, which travel with it and win. */
function PenPanel({ store }: { store: EditorStore }) {
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  useSyncExternalStore(penSettings.subscribe, penSettings.snapshot)
  const [open, setOpen] = useState(false)
  const [forNote, setForNote] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, root, close)
  const shown = forNote ? penSettingsFor(doc) : myPenSettings()
  /** A setting changed (settings.pen), the person's own or this note's. */
  const set = (key: keyof PenSettings, value: PenSettings[keyof PenSettings]): void => {
    const option = optionOf(key)
    if (!option) return
    const words = option === 'symbols' ? ((value as SymbolKind[]).length === 0 ? 'none' : (value as SymbolKind[]).join(',')) : valueWord(option, value)
    commands.tap('settings.pen', { option, value: words, scope: forNote ? 'note' : 'mine' })
  }
  return (
    <span className="nw-popover-anchor" ref={root}>
      <button type="button" className="nw-ibtn" aria-label="Pen settings" aria-expanded={open} title="Pen settings: fingers, lines, shapes, smoothing" onMouseDown={keepFocus} onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={ICON} aria-hidden />
      </button>
      {open ? (
        <div ref={placeMenu} className="nw-popover nw-pen-panel" role="group" aria-label="Pen settings">
          <div className="nw-segmented" role="radiogroup" aria-label="Settings for">
            <button type="button" role="radio" aria-checked={!forNote} onMouseDown={keepFocus} onClick={() => setForNote(false)}>
              My defaults
            </button>
            <button type="button" role="radio" aria-checked={forNote} onMouseDown={keepFocus} onClick={() => setForNote(true)}>
              This note
            </button>
          </div>
          {SWITCHES.map(({ key, label, choices }) => (
            <label key={key} className="nw-pen-switch">
              <span>
                {label}
                {forNote && doc.pen?.[key] !== undefined ? <em> (this note)</em> : null}
              </span>
              <select aria-label={label} value={String(shown[key])} data-command="settings.pen" onChange={(event) => set(key, choices.find(([value]) => String(value) === event.target.value)![0] as PenSettings[keyof PenSettings])}>
                {choices.map(([value, text]) => (
                  <option key={String(value)} value={String(value)}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <fieldset className="nw-pen-symbols">
            <legend>Symbols, neatened as you lift{forNote && doc.pen?.symbols !== undefined ? <em> (this note)</em> : null}</legend>
            {SYMBOLS.map(([kind, label]) => (
              <label key={kind}>
                <input type="checkbox" checked={shown.symbols.includes(kind)} data-command="settings.pen" onChange={(event) => set('symbols', event.target.checked ? [...shown.symbols, kind] : shown.symbols.filter((k) => k !== kind))} />
                {label}
              </label>
            ))}
          </fieldset>
          <PenCheck />
          <YourHand />
          <DeveloperRules />
          {forNote && doc.pen ? (
            <button type="button" className="nw-pen-reset" data-command="settings.penReset" onMouseDown={keepFocus} onClick={() => commands.tap('settings.penReset')}>
              Use my defaults in this note
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}

/**
 * What the pen has learned of this person's hand (core's learn.ts): from how
 * many recorded strokes and undone corrections, a way to record more, and to
 * forget it all, which asks first, as it cannot be undone.
 */
function YourHand() {
  const profile = useSyncExternalStore(penProfile.subscribe, penProfile.snapshot)
  const [forgetting, setForgetting] = useState(false)
  const recorded = profile?.examples.filter((e) => e.from === 'recorder').length ?? 0
  const undone = (profile?.examples.length ?? 0) - recorded
  const many = (count: number, one: string, more: string): string => `${count} ${count === 1 ? one : more}`
  const from = [recorded > 0 ? many(recorded, 'recorded stroke', 'recorded strokes') : '', undone > 0 ? many(undone, 'correction you undid', 'corrections you undid') : ''].filter(Boolean).join(' and ')
  const text = !profile || profile.examples.length === 0 ? 'Your hand: the pen goes by general rules. Record your own strokes to teach it yours.' : `Your hand: learned from ${from}, ${new Date(profile.updated).toLocaleDateString()}.`
  return (
    <div className="nw-pen-hand" role="group" aria-label="Your hand">
      <p>{text}</p>
      {forgetting ? (
        <span className="nw-pen-hand-actions">
          <span>Forget everything the pen learned?</span>
          <button
            type="button"
            data-command="pen.forget"
            onMouseDown={keepFocus}
            onClick={() => {
              commands.tap('pen.forget')
              setForgetting(false)
            }}
          >
            Forget
          </button>
          <button type="button" onMouseDown={keepFocus} onClick={() => setForgetting(false)}>
            Keep it
          </button>
        </span>
      ) : (
        <span className="nw-pen-hand-actions">
          <a href="?record=strokes" data-command="recorder.open">
            {recorded > 0 ? 'Record more' : 'Teach the pen your hand'}
          </a>
          {profile ? (
            <button type="button" onMouseDown={keepFocus} onClick={() => setForgetting(true)}>
              Forget…
            </button>
          ) : null}
        </span>
      )}
    </div>
  )
}

/** What the last stroke came from: whether the pen sends its pressure, and how hard this person usually presses. */
function PenCheck() {
  const input = useSyncExternalStore(lastInput.subscribe, lastInput.snapshot)
  return (
    <p className="nw-pen-check" role="status">
      {checkText(input)}
    </p>
  )
}

function checkText(input: LastInput | undefined): string {
  if (!input) return 'Pen check: write a stroke to see what the pen sends.'
  if (input.pressure) {
    const [low, high] = input.pressure
    return `Pen check: pressure works (last stroke ${low.toFixed(2)} to ${high.toFixed(2)}; your usual ${typicalPressure().toFixed(2)}).`
  }
  if (input.type === 'pen') return 'Pen check: the pen sends no pressure, so lines are even.'
  if (input.type === 'mouse') return 'Pen check: this came as a mouse, with no pressure. With a Wacom, turn on "Use Windows Ink" in its settings.'
  return 'Pen check: a finger draws at an even width.'
}

