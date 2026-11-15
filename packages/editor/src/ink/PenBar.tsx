// The pen's row of tools, while an ink tool is in hand, its buttons in the person's order (layout/custom.ts; as it
// starts: Select and Move the sheet; the pen, its four kinds in a menu with the pen's settings, the highlighter, and
// the eraser, its way and its size in a menu; four colours in reach and every other under More colours; one Width
// button; undo and redo; the wand that tidies handwriting; Type, back to the row for words; and a picture), and More,
// which holds the rest, one click away. The pen and Type never leave it. The Pen switches are for this person or for
// this note, with what the pen has learned of this person's hand. Like every button in the rows, none takes the focus.
import { StrokeWidth, type AnyColor, type Color, type Doc, type PenButton, type PenSettings, type SymbolKind, type TidyRules } from '@shellnote/core'
import { Brush, ChevronDown, Ellipsis, Eraser, Hand, Highlighter, Image, Lasso, Pen, Pencil, PenLine, PenTool, Redo2, SlidersHorizontal, Type, Undo2, WandSparkles, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { BarMenu, keepFocus, MenuItem } from '../BarMenu.js'
import { RedoButton, UndoButton, usePictures } from '../BarParts.js'
import { ColourMenu } from '../ColourMenu.js'
import { commands } from '../commands/index.js'
import { optionOf, valueWord } from '../commands/pen.js'
import { eraserWord, widthWord } from '../commands/tools.js'
import { useDismiss } from '../dismiss.js'
import { REDO_KEY, UNDO_KEY } from '../keys.js'
import { penRow, underPenMore } from '../layout/custom.js'
import { placeMenu } from '../popover.js'
import type { EditorStore, Tool } from '../store.js'
import { PEN_LOOK } from '../typingButtons.js'
import { ERASER_RADIUS, lastInput, myPenSettings, penChoice, penProfile, penSettings, penSettingsFor, tidyBox, tidyRules, developerMode, typicalPressure, type EraserSize, type LastInput, type PenChoice } from './settings.js'

const ICON = 18
const ARROW = 14

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
/** A width as a dot that grows with it, so the choice reads at a glance. */
const dot = (width: StrokeWidth): CSSProperties => {
  const size = 3 + StrokeWidth.options.indexOf(width) * 2.5
  return { width: size, height: size }
}

/** The colours in reach: each a button of its own, drawn as its dot. */
const DOTS: ReadonlySet<PenButton> = new Set(['black', 'blue', 'red', 'green', 'grey', 'orange', 'yellow', 'purple'])
/** The note's colours, as More shows them when a colour, or More colours, is not in the row. */
const NAMED: [Color, string][] = [
  ['ink', 'Black'],
  ['gray', 'Grey'],
  ['red', 'Red'],
  ['orange', 'Orange'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['blue', 'Blue'],
  ['purple', 'Purple'],
]

export function PenBar({ store }: { store: EditorStore }) {
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  const choice = useSyncExternalStore(penChoice.subscribe, penChoice.snapshot)
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  useSyncExternalStore(penSettings.subscribe, penSettings.snapshot)
  const row = useSyncExternalStore(penRow.subscribe, penRow.snapshot)
  const pictures = usePictures(store)
  const [settings, setSettings] = useState(false)
  const highlighter = tool === 'highlighter'
  const eraser = tool === 'eraser'
  const colour = highlighter ? choice.highlighterColor : choice.color
  const width = highlighter ? choice.highlighterWidth : choice.width
  const command = highlighter ? 'highlighter.set' : 'pen.set'
  const paint = (next: AnyColor): void => void commands.do(command, { colour: next })
  const choose = (next: Tool): void => void commands.do('tool.choose', { tool: next })
  const KindNow = KINDS.find(([kind]) => kind === choice.kind)?.[2] ?? PenLine
  const tidyOff = penSettingsFor(doc).neaten === 'off'
  // What applies now: no colours and no width while erasing; no wand with the highlighter or the eraser.
  const applies = (button: PenButton): boolean => !(eraser && PEN_LOOK[button].group === 'colour') && !((highlighter || eraser) && button === 'tidy')
  // The buttons the person keeps in the row, in their order; More holds the rest.
  const inTheRow = row.filter(applies)
  const inTheMore = underPenMore(row).filter(applies)
  // A colour not in reach, or More colours under More: the note's colours there, once.
  const coloursUnderMore = inTheMore.some((button) => DOTS.has(button) || button === 'colour')

  /** A colour in reach: its dot. */
  const dotOf = (button: PenButton): ReactNode => {
    const named = PEN_LOOK[button].colour!
    const label = PEN_LOOK[button].label
    return (
      <button
        key={button}
        type="button"
        role="radio"
        className="sh-dot"
        aria-label={label}
        title={label}
        aria-checked={colour === named}
        style={{ '--c': `var(--nw-${highlighter ? 'hl-' : ''}${named})` } as CSSProperties}
        data-command={command}
        onMouseDown={keepFocus}
        onClick={() => paint(named)}
      >
        <i />
      </button>
    )
  }

  /** The pen's kinds, and its settings. */
  function penChoices(close: () => void): ReactNode {
    return (
      <>
        {KINDS.map(([kind, label, Icon]) => (
          <MenuItem key={kind} checked={choice.kind === kind} command="pen.set" onChoose={() => void commands.do('pen.set', { kind })}>
            <Icon size={ICON} aria-hidden />
            {label}
          </MenuItem>
        ))}
        <hr />
        <MenuItem
          label="Pen settings"
          title="Pen settings: fingers, lines, shapes, smoothing"
          onChoose={() => {
            close()
            setSettings(true)
          }}
        >
          <SlidersHorizontal size={ICON} aria-hidden />
          Pen settings…
        </MenuItem>
      </>
    )
  }

  /** The eraser's way and its size, in its menu or under More. */
  function eraserChoices(): ReactNode {
    return (
      <>
        <div className="sh-menu-head">Eraser takes</div>
        <MenuItem checked={choice.eraser === 'stroke'} title="Whole strokes: a touch takes the whole stroke" command="eraser.set" onChoose={() => void commands.do('eraser.set', { erase: 'whole' })}>
          Whole strokes
        </MenuItem>
        <MenuItem checked={choice.eraser === 'part'} title="Part of a stroke: only what the eraser passes over" command="eraser.set" onChoose={() => void commands.do('eraser.set', { erase: 'part' })}>
          Part of a stroke
        </MenuItem>
        <div className="sh-menu-head">Size</div>
        {ERASER_SIZES.map(([size, label]) => (
          <MenuItem key={size} checked={choice.eraserSize === size} command="eraser.set" onChoose={() => void commands.do('eraser.set', { size: eraserWord(size) })}>
            <span className="sh-weight" aria-hidden>
              <i style={{ width: 4 + ERASER_RADIUS[size] / 40, height: 4 + ERASER_RADIUS[size] / 40 }} />
            </span>
            {label}
          </MenuItem>
        ))}
      </>
    )
  }

  /** The widths, in their menu or under More. */
  function widthChoices(): ReactNode {
    return StrokeWidth.options.map((value) => (
      <MenuItem key={value} checked={width === value} command={command} onChoose={() => void commands.do(command, { width: widthWord(value) })}>
        <span className="sh-weight" aria-hidden>
          <i style={dot(value)} />
        </span>
        {WIDTH_NAMES[value]}
      </MenuItem>
    ))
  }

  /** A button in the row. */
  const inRow = (button: PenButton): ReactNode => {
    switch (button) {
      case 'select':
        return (
          <button type="button" className="sh-b" aria-label="Select" aria-pressed={tool === 'select'} title="Select: draw a box to take only what is inside it" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('select')}>
            <Lasso size={ICON} aria-hidden />
          </button>
        )
      case 'hand':
        return (
          <button type="button" className="sh-b" aria-label="Move the sheet" aria-pressed={tool === 'hand'} title="Move the sheet: drag it to look along it, writing nothing" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('hand')}>
            <Hand size={ICON} aria-hidden />
          </button>
        )
      case 'pen':
        return (
          <BarMenu
            label="Pen"
            title="Pen: write and draw; hold still at the end for a straight line or a shape. Pressed again: its kinds and settings"
            pressed={tool === 'pen'}
            onPress={() => {
              // In hand already, the press opens its kinds; else it takes the pen up.
              if (tool === 'pen') return true
              choose('pen')
              return false
            }}
            button={
              <>
                <KindNow size={ICON} aria-hidden />
                <ChevronDown size={ARROW} aria-hidden />
              </>
            }
          >
            {(close) => penChoices(close)}
          </BarMenu>
        )
      case 'highlighter':
        return (
          <button type="button" className="sh-b" aria-label="Highlighter" aria-pressed={highlighter} title="Highlighter: mark over words and ink" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('highlighter')}>
            <Highlighter size={ICON} aria-hidden />
          </button>
        )
      case 'eraser':
        return (
          <BarMenu
            label="Eraser"
            title="Eraser: whole strokes, or the part of a stroke it passes over. Pressed again: its way and size"
            pressed={eraser}
            onPress={() => {
              if (eraser) return true
              choose('eraser')
              return false
            }}
            button={
              <>
                <Eraser size={ICON} aria-hidden />
                <ChevronDown size={ARROW} aria-hidden />
              </>
            }
          >
            {() => eraserChoices()}
          </BarMenu>
        )
      case 'colour':
        return <ColourMenu current={colour} onNamed={paint} onCode={(code) => paint(code as AnyColor)} highlighter={highlighter} look="more" />
      case 'width':
        return (
          <BarMenu
            label="Width"
            title="Width: fine to broad"
            button={
              <>
                <span className="sh-weight" aria-hidden>
                  <i style={dot(width)} />
                </span>
                <ChevronDown size={ARROW} aria-hidden />
              </>
            }
          >
            {() => widthChoices()}
          </BarMenu>
        )
      case 'undo':
        return <UndoButton store={store} />
      case 'redo':
        return <RedoButton store={store} />
      case 'tidy':
        return <TidyButton off={tidyOff} />
      case 'type':
        return (
          <button type="button" className="sh-b" aria-label="Type" title="Type: back to writing words, and their row" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('type')}>
            <Type size={ICON} aria-hidden />
          </button>
        )
      case 'picture':
        return (
          <button type="button" className="sh-b" aria-label="Picture" title="Add a picture: at the caret, or on the page" onMouseDown={keepFocus} onClick={pictures.choose}>
            <Image size={ICON} aria-hidden />
          </button>
        )
      default:
        return dotOf(button)
    }
  }

  /** A button under More: a line to choose, or a menu's choices under its name. The colours are drawn once, after. */
  const inMore = (button: PenButton, close: () => void): ReactNode => {
    switch (button) {
      case 'select':
        return (
          <MenuItem
            label="Select"
            checked={tool === 'select'}
            command="tool.choose"
            onChoose={() => {
              choose('select')
              close()
            }}
          >
            <Lasso size={ICON} aria-hidden />
            Select
          </MenuItem>
        )
      case 'hand':
        return (
          <MenuItem
            label="Move the sheet"
            checked={tool === 'hand'}
            command="tool.choose"
            onChoose={() => {
              choose('hand')
              close()
            }}
          >
            <Hand size={ICON} aria-hidden />
            Move the sheet
          </MenuItem>
        )
      case 'highlighter':
        return (
          <MenuItem
            label="Highlighter"
            checked={highlighter}
            command="tool.choose"
            onChoose={() => {
              choose('highlighter')
              close()
            }}
          >
            <Highlighter size={ICON} aria-hidden />
            Highlighter
          </MenuItem>
        )
      case 'eraser':
        return (
          <>
            <MenuItem
              label="Eraser"
              checked={eraser}
              command="tool.choose"
              onChoose={() => {
                choose('eraser')
                close()
              }}
            >
              <Eraser size={ICON} aria-hidden />
              Eraser
            </MenuItem>
            {eraserChoices()}
          </>
        )
      case 'width':
        return (
          <>
            <div className="sh-menu-head">Width</div>
            {widthChoices()}
          </>
        )
      case 'undo':
        return (
          <MenuItem label="Undo" disabled={!store.canUndo} command="edit.undo" onChoose={() => void commands.do('edit.undo')}>
            <Undo2 size={ICON} aria-hidden />
            Undo<kbd>{UNDO_KEY}</kbd>
          </MenuItem>
        )
      case 'redo':
        return (
          <MenuItem label="Redo" disabled={!store.canRedo} command="edit.redo" onChoose={() => void commands.do('edit.redo')}>
            <Redo2 size={ICON} aria-hidden />
            Redo<kbd>{REDO_KEY}</kbd>
          </MenuItem>
        )
      case 'tidy':
        return (
          <MenuItem
            label="Tidy handwriting"
            title={tidyOff ? 'Tidy handwriting is off in Pen settings' : 'Tidy handwriting: drag a box over the writing to tidy it and level each line (one undo)'}
            disabled={tidyOff}
            onChoose={() => {
              tidyBox.set(true)
              close()
            }}
          >
            <WandSparkles size={ICON} aria-hidden />
            Tidy handwriting
          </MenuItem>
        )
      case 'picture':
        return (
          <MenuItem
            label="Picture"
            title="Add a picture: at the caret, or on the page"
            onChoose={() => {
              close()
              pictures.choose()
            }}
          >
            <Image size={ICON} aria-hidden />
            Picture…
          </MenuItem>
        )
      default:
        return null
    }
  }

  // The row: a thin line where one group meets another; the colours in reach side by side, one group of choices.
  const pieces: ReactNode[] = []
  let dots: ReactNode[] = []
  const endDots = (): void => {
    if (dots.length === 0) return
    pieces.push(
      <span key={`dots-${pieces.length}`} role="radiogroup" aria-label="Colours in reach" style={{ display: 'contents' }}>
        {dots}
      </span>,
    )
    dots = []
  }
  inTheRow.forEach((button, i) => {
    const before = inTheRow[i - 1]
    if (before !== undefined && PEN_LOOK[button].group !== PEN_LOOK[before].group) {
      endDots()
      pieces.push(<span key={`line-${i}`} className="sh-sep" />)
    }
    if (DOTS.has(button)) dots.push(dotOf(button))
    else {
      endDots()
      pieces.push(<Fragment key={button}>{inRow(button)}</Fragment>)
    }
  })
  endDots()

  return (
    <div className="sh-tools nw-penbar" role="toolbar" aria-label={eraser ? 'Eraser' : highlighter ? 'Highlighter' : 'Pen'}>
      {pieces}
      {settings ? <PenPanel store={store} onClose={() => setSettings(false)} /> : null}
      {pictures.input}
      <TidyStatus off={tidyOff} />
      {inTheMore.length > 0 ? (
        <BarMenu label="More" title="The pen's row's other buttons" button={<Ellipsis size={ICON} aria-hidden />}>
          {(close) => (
            <>
              {inTheMore.map((button) => (
                <Fragment key={button}>{inMore(button, close)}</Fragment>
              ))}
              {coloursUnderMore ? (
                <>
                  <div className="sh-menu-head">Colour</div>
                  <div className="sh-swatches" role="radiogroup" aria-label="Colour">
                    {NAMED.map(([named, label]) => (
                      <button
                        key={named}
                        type="button"
                        role="radio"
                        className="sh-swatch"
                        aria-label={label}
                        title={label}
                        aria-checked={colour === named}
                        style={{ '--swatch': `var(--nw-${highlighter ? 'hl-' : ''}${named})` } as CSSProperties}
                        data-command={command}
                        onMouseDown={keepFocus}
                        onClick={() => {
                          paint(named)
                          close()
                        }}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </BarMenu>
      ) : null}
    </div>
  )
}

/** The wand: tapped, the next drag on the page is a box, and the handwriting in it is tidied (TidyStatus says so). */
function TidyButton({ off }: { off: boolean }) {
  const boxing = useSyncExternalStore(tidyBox.subscribe, tidyBox.snapshot)
  return (
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
  )
}

/**
 * While the wand is out, wherever its button is (in the row or under More): the handwriting in the next box dragged
 * on the page is tidied, each row levelled, as one undo step (the pen layer draws the box); "Whole note" does every
 * page instead. Escape, another tool, or Tidy handwriting switched off, and it is put away.
 */
function TidyStatus({ off }: { off: boolean }) {
  const boxing = useSyncExternalStore(tidyBox.subscribe, tidyBox.snapshot)
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
  if (!boxing) return null
  return (
    <span className="nw-tidy-box" role="status">
      <span>Drag over the writing</span>
      <button type="button" className="nw-tidy-whole" data-command="tidy.note" onMouseDown={keepFocus} onClick={() => commands.tap('tidy.note')}>
        Whole note
      </button>
    </span>
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

/** The Pen switches, opened from the pen's menu: this person's own, or this note's, which travel with it and win. */
function PenPanel({ store, onClose }: { store: EditorStore; onClose: () => void }) {
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  const [forNote, setForNote] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useDismiss(true, root, onClose)
  return (
    <span className="nw-popover-anchor" ref={root}>
      <div ref={placeMenu} className="nw-popover nw-pen-panel" role="group" aria-label="Pen settings">
        <div className="nw-segmented" role="radiogroup" aria-label="Settings for">
          <button type="button" role="radio" aria-checked={!forNote} onMouseDown={keepFocus} onClick={() => setForNote(false)}>
            My defaults
          </button>
          <button type="button" role="radio" aria-checked={forNote} onMouseDown={keepFocus} onClick={() => setForNote(true)}>
            This note
          </button>
        </div>
        <PenSwitches doc={forNote ? doc : undefined} />
        {forNote && doc.pen ? (
          <button type="button" className="nw-pen-reset" data-command="settings.penReset" onMouseDown={keepFocus} onClick={() => commands.tap('settings.penReset')}>
            Use my defaults in this note
          </button>
        ) : null}
      </div>
    </span>
  )
}

/** The person's own pen settings, as Settings shows them (Pen): every switch, the pen check, their hand and developer mode. */
export function PenSettingsPart() {
  return (
    <div className="nw-pen-panel nw-pen-settings" role="group" aria-label="Pen settings">
      <PenSwitches doc={undefined} />
    </div>
  )
}

/**
 * The switches, the symbols, the pen check, what the pen learned of the person's hand, and developer mode. With a
 * note, its own settings, which travel with it and win; without, the person's own.
 */
function PenSwitches({ doc }: { doc: Doc | undefined }) {
  useSyncExternalStore(penSettings.subscribe, penSettings.snapshot)
  const forNote = doc !== undefined
  const shown = doc ? penSettingsFor(doc) : myPenSettings()
  /** A setting changed (settings.pen), the person's own or this note's. */
  const set = (key: keyof PenSettings, value: PenSettings[keyof PenSettings]): void => {
    const option = optionOf(key)
    if (!option) return
    const words = option === 'symbols' ? ((value as SymbolKind[]).length === 0 ? 'none' : (value as SymbolKind[]).join(',')) : valueWord(option, value)
    commands.tap('settings.pen', { option, value: words, scope: forNote ? 'note' : 'mine' })
  }
  return (
    <>
          {SWITCHES.map(({ key, label, choices }) => (
            <label key={key} className="nw-pen-switch">
              <span>
                {label}
                {doc?.pen?.[key] !== undefined ? <em> (this note)</em> : null}
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
            <legend>Symbols, neatened as you lift{doc?.pen?.symbols !== undefined ? <em> (this note)</em> : null}</legend>
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
    </>
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
  const [about, setAbout] = useState(false)
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
          <button type="button" aria-expanded={about} onMouseDown={keepFocus} onClick={() => setAbout(!about)}>
            What is the stroke recorder?
          </button>
        </span>
      )}
      {about ? (
        <div className="nw-pen-about" role="note">
          <p>
            <strong>Teach the pen your hand.</strong> The recorder asks you to draw one thing at a time with your own pen: lines, circles, rectangles and other shapes, the brackets ( ) [ ] {'{ }'}, the comma and @, the letters that must stay letters (c, l, 3, a, e, o), a
            few words and some scratch-outs. It keeps exactly what the pen sends: where it went, how hard you pressed, how it leant and when.
          </p>
          <p>
            Then press <strong>Teach my pen</strong>. From then on the pen goes by your own strokes, not rules made for someone else: it neatens a symbol or snaps a held shape only when it is clearly yours, and leaves your letters alone. Undo a
            correction straight after it, and the pen learns to leave strokes like that one alone. What it learned is kept with your notes; Pen settings shows it, and can forget it.
          </p>
          <p>About 30 to 40 minutes, in as many sittings as you like; teach it as you go. Nothing leaves this computer unless you download the file and send it.</p>
        </div>
      ) : null}
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

