// Customise: the look, the buttons of the two rows of tools (the bar for typing's and the pen's row's), where the bars,
// the panels and the library's column sit, and the way back to how each started, all of it or each part. Every
// control calls its command, as every button does, so a line typed in the terminal does what a click does; a change
// shows at once, and is kept on this device only.
import type { Color } from '@shellnote/core'
import { appLook, commands, panelSide, PEN_LOOK, penRow, TYPING_LOOK, typingBar, underMore, underPenMore, workspace, type AppLook, type ToolRow } from '@shellnote/editor'
import { Ellipsis, GripVertical, Minus, Plus, Undo2, type LucideIcon } from 'lucide-react'
import { useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { libraryLook } from '../library/look.js'
import { treeAt, treeShown } from '../shell/state.js'
import { SettingsPage, SettingsPart } from './Page.js'

/** A small picture of a look: the rail, the column, the note, and in the hue where its tools sit. */
function Mini({ look }: { look: AppLook }) {
  return (
    <svg viewBox="0 0 140 80" aria-hidden>
      {look === 'flat' ? (
        <>
          <rect x="2" y="2" width="12" height="76" rx="2" />
          <rect x="16" y="2" width="30" height="76" rx="2" />
          <rect x="48" y="2" width="90" height="76" rx="2" />
          <rect className="hot" x="52" y="12" width="56" height="7" rx="2" />
        </>
      ) : look === 'islands' ? (
        <>
          <rect x="2" y="2" width="10" height="76" rx="2" opacity=".35" />
          <rect x="15" y="4" width="30" height="72" rx="6" />
          <rect x="49" y="4" width="88" height="72" rx="6" />
          <rect className="hot" x="66" y="12" width="54" height="9" rx="4.5" />
        </>
      ) : (
        <>
          <rect x="2" y="2" width="38" height="76" rx="2" />
          <rect x="42" y="2" width="96" height="76" rx="2" />
          <rect className="hot" x="62" y="62" width="56" height="10" rx="5" />
        </>
      )}
    </svg>
  )
}

const LOOKS: [AppLook, string, string][] = [
  ['flat', 'Flat', 'One row of tools, thin lines'],
  ['islands', 'Islands', 'Rounded panels, floating tools'],
  ['dock', 'Dock', 'Tools at the bottom, no rail'],
]

/** A row of choices, one of them on: each a button that calls its command. */
function Choices<T extends string>({ label, value, choices, command, onChoose }: { label: string; value: T; choices: readonly (readonly [T, string, boolean?])[]; command: string | ((value: T) => string); onChoose: (value: T) => void }) {
  return (
    <div className="set-seg" role="radiogroup" aria-label={label}>
      {choices.map(([id, words, later]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} disabled={later === true} title={later ? `${words}: later` : undefined} data-command={later ? undefined : typeof command === 'string' ? command : command(id)} onClick={() => onChoose(id)}>
          {words}
          {later ? <em>later</em> : null}
        </button>
      ))}
    </div>
  )
}

/** A part's own way back to how it started. */
function Reset({ part, what }: { part: 'look' | 'tools' | 'pen' | 'places'; what: string }) {
  return (
    <button type="button" className="set-reset" title={`${what} as it started`} data-command="layout.reset" onClick={() => commands.tap('layout.reset', { part })}>
      Reset
    </button>
  )
}

/** How a row's button is shown here: its name, and its icon, or its colour's dot for a colour in reach. */
interface ButtonLook {
  label: string
  icon: LucideIcon
  colour?: Color | undefined
  kept?: true | undefined
}

/**
 * A row of tools as it shows, then what is in it (drag, or Alt with Up or Down, to put in order; minus to take out)
 * and what waits under its More (plus to put in). A button kept in the row has no minus.
 */
function ToolLists<T extends string>({ tools, row, more, lookOf }: { tools: ToolRow; row: readonly T[]; more: readonly T[]; lookOf: (button: T) => ButtonLook }) {
  const [dragged, setDragged] = useState<T>()
  const [over, setOver] = useState<number>()
  const name = tools === 'pen' ? 'the row' : 'the bar'
  /** A button put in the row, at a place counted from 1 or at its end, or taken out to More (bar.button). */
  const put = (button: T, on: boolean, position?: number): void => commands.tap('bar.button', { button, on, ...(position === undefined ? {} : { position }), ...(tools === 'pen' ? { tools: 'pen' } : {}) })
  /** Alt with an arrow moves the button one place, for whoever does not drag. */
  const moveByKey = (event: KeyboardEvent, button: T, index: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const to = event.key === 'ArrowUp' ? index : index + 2
    if (to >= 1 && to <= row.length) put(button, true, to)
  }
  /** Where a button put in goes: a colour joins the colours in reach, after the last of them; any other, the row's end. */
  const joinAt = (button: T): number | undefined => {
    if (!lookOf(button).colour) return undefined
    const last = row.reduce((at, one, index) => (lookOf(one).colour ? index : at), -1)
    return last < 0 ? undefined : last + 2
  }
  const mark = (button: T, size: number): ReactNode => {
    const look = lookOf(button)
    if (look.colour) return <span className="set-dot" style={{ background: `var(--nw-${look.colour})` }} aria-hidden />
    const Icon = look.icon
    return <Icon size={size} strokeWidth={1.75} aria-hidden />
  }
  return (
    <>
      <div className="set-bar" aria-label={tools === 'pen' ? "The pen's row as it shows" : 'The bar as it shows'} role="img">
        {row.map((button) => (
          <span key={button} className="set-bar-b" title={lookOf(button).label}>
            {mark(button, 18)}
          </span>
        ))}
        {more.length > 0 ? (
          <span className="set-bar-b" title="More">
            <Ellipsis size={18} strokeWidth={1.75} aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="set-cols">
        <div>
          <h3>
            {tools === 'pen' ? 'In the row' : 'In the bar'}
            <small>drag to put in order</small>
          </h3>
          <ol className="set-tools" aria-label={tools === 'pen' ? "In the pen's row" : 'In the bar'}>
            {row.map((button, index) => {
              const look = lookOf(button)
              return (
                <li
                  key={button}
                  className="set-tool"
                  draggable
                  tabIndex={0}
                  data-dragged={dragged === button ? '' : undefined}
                  data-over={over === index && dragged !== button ? '' : undefined}
                  aria-label={`${look.label}, ${index + 1} of ${row.length} in ${name}: drag it, or Alt with Up or Down, to move it`}
                  onKeyDown={(event) => moveByKey(event, button, index)}
                  onDragStart={(event) => {
                    setDragged(button)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', button)
                  }}
                  onDragOver={(event) => {
                    if (dragged === undefined) return
                    event.preventDefault()
                    setOver(index)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (dragged !== undefined && dragged !== button) put(dragged, true, index + 1)
                    setDragged(undefined)
                    setOver(undefined)
                  }}
                  onDragEnd={() => {
                    setDragged(undefined)
                    setOver(undefined)
                  }}
                >
                  <GripVertical className="set-grip" size={14} aria-hidden />
                  {mark(button, 16)}
                  <span>{look.label}</span>
                  {look.kept ? (
                    <em className="set-kept" title={button === 'pen' ? 'Always in the row: the pen is how it starts' : 'Always in the row: the way back to the row for words'}>
                      always here
                    </em>
                  ) : (
                    <button type="button" className="sh-b" aria-label={`Take ${look.label} out of ${name}`} title="Take out: it waits under More" data-command="bar.button" onClick={() => put(button, false)}>
                      <Minus size={15} aria-hidden />
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
        <div>
          <h3>
            Under “More”<small>still one click away</small>
          </h3>
          {more.length === 0 ? (
            <p className="set-quiet">Every button is in {name}.</p>
          ) : (
            <ul className="set-tools" aria-label={tools === 'pen' ? "Under the pen's row's More" : 'Under More'}>
              {more.map((button) => {
                const look = lookOf(button)
                return (
                  <li key={button} className="set-tool">
                    {mark(button, 16)}
                    <span>{look.label}</span>
                    <button type="button" className="sh-b" aria-label={`Put ${look.label} in ${name}`} title={look.colour ? `Put in ${name}, with the colours in reach` : `Put in ${name}, at its end`} data-command="bar.button" onClick={() => put(button, true, joinAt(button))}>
                      <Plus size={15} aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}

type BarAt = 'top' | 'float' | 'bottom' | 'left' | 'right'
const BAR_PLACES: readonly (readonly [BarAt, string])[] = [
  ['top', 'Under the tabs'],
  ['float', 'Floating'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
  ['right', 'Right'],
]

export function Customise() {
  const look = useSyncExternalStore(appLook.subscribe, appLook.snapshot)
  const bar = useSyncExternalStore(typingBar.subscribe, typingBar.snapshot)
  const pens = useSyncExternalStore(penRow.subscribe, penRow.snapshot)
  const space = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const shown = useSyncExternalStore(treeShown.subscribe, treeShown.snapshot)
  const at = useSyncExternalStore(treeAt.subscribe, treeAt.snapshot)
  const view = useSyncExternalStore(libraryLook.subscribe, libraryLook.snapshot)
  // The panel's side is read from the layout, which the workspace above has subscribed to.
  const side = space.layout ? panelSide() : 'right'

  return (
    <SettingsPage
      title="Customise"
      lead="Make ShellNote sit the way you work. Every change shows at once, and nothing here can lose a note."
      action={
        <button type="button" className="set-pill" data-command="layout.reset" onClick={() => commands.tap('layout.reset', { part: 'all' })}>
          <Undo2 size={14} aria-hidden />
          Reset to default
        </button>
      }
    >
      <SettingsPart title="Look" reset={<Reset part="look" what="The look" />}>
        <div className="set-looks" role="radiogroup" aria-label="Look">
          {LOOKS.map(([id, name, hint]) => (
            <button key={id} type="button" role="radio" className="set-look" aria-checked={look === id} data-command="layout.look" onClick={() => commands.tap('layout.look', { shell: id })}>
              <Mini look={id} />
              <b>{name}</b>
              <small>{hint}</small>
            </button>
          ))}
        </div>
      </SettingsPart>

      <SettingsPart title="Tool bar" hint="for typing" reset={<Reset part="tools" what="The bar for typing" />}>
        <ToolLists tools="typing" row={bar} more={underMore(bar)} lookOf={(button) => TYPING_LOOK[button]} />
      </SettingsPart>

      <SettingsPart title="Pen's row" hint="while the pen, the highlighter or the eraser is in hand" reset={<Reset part="pen" what="The pen's row" />}>
        <ToolLists tools="pen" row={pens} more={underPenMore(pens)} lookOf={(button) => PEN_LOOK[button]} />
      </SettingsPart>

      <SettingsPart title="Where things sit" hint="or drag any bar or panel by its grip" reset={<Reset part="places" what="Where things sit" />}>
        <div className="set-places">
          <span>The tool bar</span>
          <Choices<BarAt>
            label="The tool bar"
            value={space.bars.tools.at}
            choices={BAR_PLACES}
            command={(id) => (id === 'float' ? 'bar.float' : 'bar.place')}
            onChoose={(id) => (id === 'float' ? commands.tap('bar.float', { bar: 'tools' }) : commands.tap('bar.place', { bar: 'tools', place: id }))}
          />
          <span>The library column</span>
          <Choices<'left' | 'right' | 'hidden'>
            label="The library column"
            value={shown ? at : 'hidden'}
            choices={[
              ['left', 'Left'],
              ['right', 'Right'],
              ['hidden', 'Hidden'],
            ]}
            command="library.column"
            onChoose={(id) => commands.tap('library.column', { side: id })}
          />
          <span>AI and Beside</span>
          <Choices<'right' | 'left'>
            label="AI and Beside"
            value={side}
            choices={[
              ['right', 'Right'],
              ['left', 'Left'],
            ]}
            command="panel.dock"
            onChoose={(id) => commands.tap('panel.dock', { side: id })}
          />
          <span>The library opens as</span>
          <Choices<'list' | 'cards' | 'home'>
            label="The library opens as"
            value={view}
            choices={[
              ['list', 'List'],
              ['cards', 'Cards'],
              ['home', 'Home'],
            ]}
            command="library.look"
            onChoose={(id) => commands.tap('library.look', { view: id })}
          />
        </div>
      </SettingsPart>
    </SettingsPage>
  )
}
