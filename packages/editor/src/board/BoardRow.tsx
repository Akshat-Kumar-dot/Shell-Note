// A board's row of tools, where a note of pages has its row for words: the buttons the person keeps in it, in their
// order (layout/custom.ts; as it starts: Select and the Hand; the Step tool, the fourteen shapes on its menu, and the
// Text tool; the pen and the eraser, which come to a board later; undo and redo; Tidy, the flowchart laid out again;
// the whole board in view), and More, which holds the rest. After them, what is chosen can do: a step its shape, its
// colour, a step added after it and its removal; a link how it runs, its arrow, its line, its words and its removal.
// They show once a click has chosen the step or the link, never by pointing (the patents check, rule 1). Each control
// runs its command, as every control does, and none takes the focus.
import { shapePath, type BoardButton, type Color, type Link, type NodeBlock, type NodeShape } from '@shellnote/core'
import { ArrowRight, ChevronDown, CornerDownRight, Ellipsis, Spline, SquarePlus, Trash2, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { BarMenu, keepFocus, MenuItem } from '../BarMenu.js'
import { RedoButton, UndoButton } from '../BarParts.js'
import { commands } from '../commands/index.js'
import { REDO_KEY, UNDO_KEY } from '../keys.js'
import { boardRow, underBoardMore } from '../layout/custom.js'
import type { EditorStore, Tool } from '../store.js'
import { BOARD_LOOK } from '../typingButtons.js'
import { chosenLink, linkWordsAsked } from './active.js'
import { addStepAfter } from './next.js'

const ICON = 18
const ARROW = 14

/** The fourteen shapes a step takes, as the Step tool's menu and a chosen step's Shape list them. */
export const SHAPES: readonly (readonly [NodeShape, string])[] = [
  ['box', 'Box'],
  ['round', 'Rounded box'],
  ['pill', 'Pill: a start or an end'],
  ['diamond', 'Diamond: a decision'],
  ['circle', 'Circle'],
  ['double-circle', 'Double circle'],
  ['hexagon', 'Hexagon'],
  ['slant', 'Slant: an input or output'],
  ['slant-back', 'Slant back'],
  ['trapezoid', 'Trapezoid'],
  ['trapezoid-down', 'Trapezoid, upside down'],
  ['cylinder', 'Cylinder: stored data'],
  ['subroutine', 'Subroutine'],
  ['flag', 'Flag'],
]

/** The note's colours a step takes; Automatic is none, a dark outline on a light ground. */
const COLOURS: readonly (readonly [Color, string])[] = [
  ['ink', 'Automatic'],
  ['gray', 'Grey'],
  ['red', 'Red'],
  ['orange', 'Orange'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['blue', 'Blue'],
  ['purple', 'Purple'],
]

/** How a link runs, its line, as its buttons name them. */
const ROUTES: readonly (readonly ['angled' | 'straight' | 'curved', string, LucideIcon])[] = [
  ['angled', 'Right angles', CornerDownRight],
  ['straight', 'Straight', ArrowRight],
  ['curved', 'Curved', Spline],
]
const LINES: readonly (readonly ['plain' | 'dotted' | 'thick', string])[] = [
  ['plain', 'Plain'],
  ['dotted', 'Dotted'],
  ['thick', 'Thick'],
]

/** A shape drawn small, by core's outline: the same shape a step of it takes on the board. */
export function ShapeIcon({ shape, size = ICON }: { shape: NodeShape; size?: number }) {
  return (
    <svg className="nw-shape-icon" width={size + 6} height={size} viewBox="-120 -120 3240 2240" aria-hidden>
      <path d={shapePath(shape, 3000, 2000)} />
    </svg>
  )
}

/** A link's line drawn small: plain, dotted or thick. */
function LineIcon({ line }: { line: 'plain' | 'dotted' | 'thick' }) {
  return (
    <svg className="nw-line-icon" width={ICON + 4} height={ICON} viewBox="0 0 22 18" aria-hidden>
      <line x1="2" y1="9" x2="20" y2="9" strokeWidth={line === 'thick' ? 4 : 1.75} strokeDasharray={line === 'dotted' ? '2.5 3' : undefined} />
    </svg>
  )
}

export function BoardRow({ store }: { store: EditorStore }) {
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  const shape = useSyncExternalStore(store.subscribeTool, store.stepShapeSnapshot)
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  const selection = useSyncExternalStore(store.subscribeSelection, store.selectionSnapshot)
  const link = useSyncExternalStore(chosenLink.subscribe, chosenLink.snapshot)
  const row = useSyncExternalStore(boardRow.subscribe, boardRow.snapshot)
  const choose = (next: Tool, input: Record<string, unknown> = {}): void => void commands.do('tool.choose', { tool: next, ...input })

  // The one step chosen, and the link chosen, for their own buttons.
  const one = store.selectionKind === 'objects' && selection.blocks.length === 1 ? doc.block[selection.blocks[0]!] : undefined
  const step = one?.type === 'node' ? one : undefined
  const from = link ? doc.block[link.from] : undefined
  const chosen = link && from?.type === 'node' ? from.to?.find((each) => each.node === link.to) : undefined

  /** A press on the Step tool's button: it takes the tool up; in hand already, it opens its shapes. */
  const stepPress = (): boolean => {
    if (tool === 'step') return true
    choose('step')
    return false
  }
  const shapeChoices = (close: () => void): ReactNode =>
    SHAPES.map(([value, label]) => (
      <MenuItem
        key={value}
        checked={shape === value}
        label={label}
        command="tool.choose"
        onChoose={() => {
          choose('step', { shape: value })
          close()
        }}
      >
        <ShapeIcon shape={value} />
        {label}
      </MenuItem>
    ))

  /** A tool of the pen's that comes to a board later: shown greyed, saying so. */
  const later = (button: BoardButton): ReactNode => {
    const look = BOARD_LOOK[button]
    const Icon = look.icon
    return (
      <button type="button" className="sh-b" aria-label={look.label} title={`${look.label} on a board: later`} disabled data-command={button === 'picture' ? undefined : 'tool.choose'} onMouseDown={keepFocus}>
        <Icon size={ICON} aria-hidden />
      </button>
    )
  }

  const inRow = (button: BoardButton): ReactNode => {
    switch (button) {
      case 'select':
        return (
          <button type="button" className="sh-b" aria-label="Select" aria-pressed={tool === 'select'} title="Select: choose, move and size what is on the board; a drag on the bare board chooses what lies inside" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('select')}>
            {icon('select')}
          </button>
        )
      case 'hand':
        return (
          <button type="button" className="sh-b" aria-label="Move the board" aria-pressed={tool === 'hand'} title="Move the board: drag it to look round it (Space held, or the wheel, with any tool)" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('hand')}>
            {icon('hand')}
          </button>
        )
      case 'step':
        return (
          <BarMenu
            label="Step"
            title="Step: a drag on the bare board draws a step, a click makes one; a drag from a step draws a link. Pressed again: its shapes"
            pressed={tool === 'step'}
            command="tool.choose"
            onPress={stepPress}
            button={
              <>
                <ShapeIcon shape={shape} />
                <ChevronDown size={ARROW} aria-hidden />
              </>
            }
          >
            {(close) => shapeChoices(close)}
          </BarMenu>
        )
      case 'text':
        return (
          <button type="button" className="sh-b" aria-label="Text" aria-pressed={tool === 'free'} title="Text: a click on the bare board puts a text box there; a click on a box or a step types in it" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('free')}>
            {icon('text')}
          </button>
        )
      case 'undo':
        return <UndoButton store={store} />
      case 'redo':
        return <RedoButton store={store} />
      case 'tidy':
        return (
          <button type="button" className="sh-b" aria-label="Tidy the flowchart" title="Tidy: lay the flowchart out again, each step keeping its size" data-command="board.tidy" onMouseDown={keepFocus} onClick={() => commands.press('board.tidy')}>
            {icon('tidy')}
          </button>
        )
      case 'fit':
        return (
          <button type="button" className="sh-b" aria-label="The whole board" title="The whole board in view" data-command="screen.zoom" onMouseDown={keepFocus} onClick={() => commands.press('screen.zoom', { step: 'fit' })}>
            {icon('fit')}
          </button>
        )
      default:
        return later(button)
    }
  }

  const inMore = (button: BoardButton, close: () => void): ReactNode => {
    const look = BOARD_LOOK[button]
    const item = (checked: boolean | undefined, command: string, run: () => void): ReactNode => (
      <MenuItem
        label={look.label}
        {...(checked === undefined ? {} : { checked })}
        command={command}
        onChoose={() => {
          run()
          close()
        }}
      >
        {icon(button)}
        {look.label}
      </MenuItem>
    )
    switch (button) {
      case 'select':
        return item(tool === 'select', 'tool.choose', () => choose('select'))
      case 'hand':
        return item(tool === 'hand', 'tool.choose', () => choose('hand'))
      case 'text':
        return item(tool === 'free', 'tool.choose', () => choose('free'))
      case 'step':
        return (
          <>
            <div className="sh-menu-head">Step</div>
            {shapeChoices(close)}
          </>
        )
      case 'undo':
        return (
          <MenuItem label="Undo" disabled={!store.canUndo} command="edit.undo" onChoose={() => void commands.do('edit.undo')}>
            {icon('undo')}
            Undo<kbd>{UNDO_KEY}</kbd>
          </MenuItem>
        )
      case 'redo':
        return (
          <MenuItem label="Redo" disabled={!store.canRedo} command="edit.redo" onChoose={() => void commands.do('edit.redo')}>
            {icon('redo')}
            Redo<kbd>{REDO_KEY}</kbd>
          </MenuItem>
        )
      case 'tidy':
        return item(undefined, 'board.tidy', () => commands.press('board.tidy'))
      case 'fit':
        return item(undefined, 'screen.zoom', () => commands.press('screen.zoom', { step: 'fit' }))
      default:
        return (
          <MenuItem label={look.label} title={`${look.label} on a board: later`} disabled {...(button === 'picture' ? {} : { command: 'tool.choose' })} onChoose={() => undefined}>
            {icon(button)}
            {look.label}
            <em className="sh-later">later</em>
          </MenuItem>
        )
    }
  }

  // The row: a thin line where one group meets another.
  const inTheMore = underBoardMore(row)
  const pieces = row.map((button, i) => (
    <Fragment key={button}>
      {i > 0 && BOARD_LOOK[button].group !== BOARD_LOOK[row[i - 1]!].group ? <span className="sh-sep" /> : null}
      {inRow(button)}
    </Fragment>
  ))

  return (
    <div className="sh-tools nw-boardbar" role="toolbar" aria-label="Board">
      {pieces}
      {inTheMore.length > 0 ? (
        <BarMenu label="More" title="The board's row's other buttons" button={<Ellipsis size={ICON} aria-hidden />}>
          {(close) => (
            <>
              {inTheMore.map((button) => (
                <Fragment key={button}>{inMore(button, close)}</Fragment>
              ))}
            </>
          )}
        </BarMenu>
      ) : null}
      {step ? <StepTools store={store} step={step} /> : null}
      {link && chosen ? <LinkTools from={link.from} link={chosen} /> : null}
    </div>
  )
}

/** A board button's icon. */
function icon(button: BoardButton): ReactNode {
  const Icon = BOARD_LOOK[button].icon
  return <Icon size={ICON} aria-hidden />
}

/** The chosen step's buttons: its shape, its colour, a step after it, and its removal with its links and its ink. */
function StepTools({ store, step }: { store: EditorStore; step: NodeBlock }) {
  const look = (input: { shape?: NodeShape; colour?: Color }): void => commands.press('board.look', { block: step.id, ...input })
  const colour = step.color ?? 'ink'
  return (
    <>
      <span className="sh-sep" />
      <BarMenu
        label="Shape"
        title="The step's shape: its words fit it again"
        button={
          <>
            <ShapeIcon shape={step.shape} />
            <ChevronDown size={ARROW} aria-hidden />
          </>
        }
      >
        {(close) =>
          SHAPES.map(([value, label]) => (
            <MenuItem
              key={value}
              checked={step.shape === value}
              label={label}
              command="board.look"
              onChoose={() => {
                look({ shape: value })
                close()
              }}
            >
              <ShapeIcon shape={value} />
              {label}
            </MenuItem>
          ))
        }
      </BarMenu>
      <BarMenu
        label="Colour"
        title="The step's colour"
        button={
          <>
            <span className="nw-colour-dot" style={{ '--swatch': colour === 'ink' ? 'var(--nw-ink)' : `var(--nw-${colour})` } as CSSProperties} aria-hidden />
            <ChevronDown size={ARROW} aria-hidden />
          </>
        }
      >
        {(close) => (
          <div className="sh-swatches" role="radiogroup" aria-label="The step's colour">
            {COLOURS.map(([name, label]) => (
              <button
                key={name}
                type="button"
                role="radio"
                className="sh-swatch"
                aria-label={label}
                title={label}
                aria-checked={colour === name}
                style={{ '--swatch': name === 'ink' ? 'var(--sh-text)' : `var(--nw-${name})` } as CSSProperties}
                data-command="board.look"
                onMouseDown={keepFocus}
                onClick={() => {
                  look({ colour: name })
                  close()
                }}
              />
            ))}
          </div>
        )}
      </BarMenu>
      <button type="button" className="sh-b" aria-label="Add a step after" title="Add a step after this one (Tab): between it and its next, or one more branch" data-command="board.add" onMouseDown={keepFocus} onClick={() => void addStepAfter(store)}>
        <SquarePlus size={ICON} aria-hidden />
      </button>
      <button type="button" className="sh-b" aria-label="Remove the step" title="Remove the step, with its links and the ink on it (Delete)" data-command="block.remove" onMouseDown={keepFocus} onClick={() => commands.press('block.remove', { block: step.id })}>
        <Trash2 size={ICON} aria-hidden />
      </button>
    </>
  )
}

/** The chosen link's buttons: how it runs, its arrow, its line, its words, and its removal. */
function LinkTools({ from, link }: { from: string; link: Link }) {
  const to = link.node
  const change = (input: Record<string, unknown>): void => commands.press('board.link', { from, to, ...input })
  const route = link.path ?? 'angled'
  const line = link.line ?? 'plain'
  const arrow = link.head !== 'none'
  const [words, setWords] = useState(link.label ?? '')
  const field = useRef<HTMLInputElement>(null)
  // Escape puts the words back as they were: the blur that follows keeps nothing.
  const dropped = useRef(false)
  // The words as they are, once the link or its words change elsewhere (undo, the terminal).
  useEffect(() => setWords(link.label ?? ''), [from, to, link.label])
  // Enter or a double-click on the chosen link: the caret in its words.
  useEffect(
    () =>
      linkWordsAsked.subscribe(() => {
        field.current?.focus()
        field.current?.select()
      }),
    [],
  )
  /** The words typed, kept once they are done: one line, at most 200 letters; none takes the words away. */
  const keep = (): void => {
    if (dropped.current) {
      dropped.current = false
      return
    }
    const next = words.replace(/\s+/gu, ' ').trim()
    if (next !== (link.label ?? '')) change({ label: next })
  }
  return (
    <>
      <span className="sh-sep" />
      <span role="radiogroup" aria-label="How the link runs" style={{ display: 'contents' }}>
        {ROUTES.map(([value, label, Icon]) => (
          <button key={value} type="button" role="radio" className="sh-b" aria-label={label} title={`${label}: how the link runs between its steps`} aria-checked={route === value} data-command="board.link" onMouseDown={keepFocus} onClick={() => change({ route: value })}>
            <Icon size={ICON} aria-hidden />
          </button>
        ))}
      </span>
      <button type="button" className="sh-b" aria-label="Arrow" aria-pressed={arrow} title={arrow ? 'An arrow at its end: a press takes it off' : 'No arrow: a press puts one at its end'} data-command="board.link" onMouseDown={keepFocus} onClick={() => change({ arrow: !arrow })}>
        <ArrowRight size={ICON} aria-hidden />
      </button>
      <span role="radiogroup" aria-label="The link's line" style={{ display: 'contents' }}>
        {LINES.map(([value, label]) => (
          <button key={value} type="button" role="radio" className="sh-b" aria-label={label} title={`A ${label.toLowerCase()} line`} aria-checked={line === value} data-command="board.link" onMouseDown={keepFocus} onClick={() => change({ line: value })}>
            <LineIcon line={value} />
          </button>
        ))}
      </span>
      <label className="nw-describe nw-link-words-field">
        <span>Words</span>
        <input
          ref={field}
          type="text"
          aria-label="Words"
          placeholder="On the link (Enter keeps them)"
          maxLength={200}
          value={words}
          data-command="board.link"
          onChange={(event) => setWords(event.target.value)}
          onBlur={keep}
          onKeyDown={(event) => {
            // Enter keeps the words (as the blur does); Escape puts them back as they were.
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              dropped.current = true
              setWords(link.label ?? '')
              event.currentTarget.blur()
            }
          }}
        />
      </label>
      <button type="button" className="sh-b" aria-label="Remove the link" title="Remove the link (Delete)" data-command="board.unlink" onMouseDown={keepFocus} onClick={() => commands.press('board.unlink', { from, to })}>
        <Trash2 size={ICON} aria-hidden />
      </button>
    </>
  )
}
