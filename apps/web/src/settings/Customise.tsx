// Customise: the look, the bar for typing's buttons, where the bars, the panels and the library's column sit, and the
// way back to how each started, all of it or each part. Every control calls its command, as every button does, so a
// line typed in the terminal does what a click does; a change shows at once, and is kept on this device only.
import type { TypingButton } from '@shellnote/core'
import { appLook, commands, panelSide, TYPING_LOOK, typingBar, underMore, workspace, type AppLook } from '@shellnote/editor'
import { Ellipsis, GripVertical, Minus, Plus, Undo2 } from 'lucide-react'
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
function Reset({ part, what }: { part: 'look' | 'tools' | 'places'; what: string }) {
  return (
    <button type="button" className="set-reset" title={`${what} as it started`} data-command="layout.reset" onClick={() => commands.tap('layout.reset', { part })}>
      Reset
    </button>
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
  const space = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const shown = useSyncExternalStore(treeShown.subscribe, treeShown.snapshot)
  const at = useSyncExternalStore(treeAt.subscribe, treeAt.snapshot)
  const view = useSyncExternalStore(libraryLook.subscribe, libraryLook.snapshot)
  const [dragged, setDragged] = useState<TypingButton>()
  const [over, setOver] = useState<number>()
  const more = underMore(bar)
  // The panel's side is read from the layout, which the workspace above has subscribed to.
  const side = space.layout ? panelSide() : 'right'

  /** A button put in the bar, at a place counted from 1 or at its end, or taken out to More (bar.button). */
  const put = (button: TypingButton, on: boolean, position?: number): void => commands.tap('bar.button', { button, on, ...(position === undefined ? {} : { position }) })
  /** Alt with an arrow moves the button one place, for whoever does not drag. */
  const moveByKey = (event: KeyboardEvent, button: TypingButton, index: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const to = event.key === 'ArrowUp' ? index : index + 2
    if (to >= 1 && to <= bar.length) put(button, true, to)
  }
  const icon = (button: TypingButton, size: number): ReactNode => {
    const Icon = TYPING_LOOK[button].icon
    return <Icon size={size} strokeWidth={1.75} aria-hidden />
  }

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
        <div className="set-bar" aria-label="The bar as it shows" role="img">
          {bar.map((button) => (
            <span key={button} className="set-bar-b" title={TYPING_LOOK[button].label}>
              {icon(button, 18)}
            </span>
          ))}
          <span className="set-bar-b" title="More">
            <Ellipsis size={18} strokeWidth={1.75} aria-hidden />
          </span>
        </div>
        <div className="set-cols">
          <div>
            <h3>
              In the bar<small>drag to put in order</small>
            </h3>
            <ol className="set-tools" aria-label="In the bar">
              {bar.map((button, index) => (
                <li
                  key={button}
                  className="set-tool"
                  draggable
                  tabIndex={0}
                  data-dragged={dragged === button ? '' : undefined}
                  data-over={over === index && dragged !== button ? '' : undefined}
                  aria-label={`${TYPING_LOOK[button].label}, ${index + 1} of ${bar.length} in the bar: drag it, or Alt with Up or Down, to move it`}
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
                  {icon(button, 16)}
                  <span>{TYPING_LOOK[button].label}</span>
                  <button type="button" className="sh-b" aria-label={`Take ${TYPING_LOOK[button].label} out of the bar`} title="Take out of the bar: it waits under More" data-command="bar.button" onClick={() => put(button, false)}>
                    <Minus size={15} aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3>
              Under “More”<small>still one click away</small>
            </h3>
            {more.length === 0 ? (
              <p className="set-quiet">Every button is in the bar.</p>
            ) : (
              <ul className="set-tools" aria-label="Under More">
                {more.map((button) => (
                  <li key={button} className="set-tool">
                    {icon(button, 16)}
                    <span>{TYPING_LOOK[button].label}</span>
                    <button type="button" className="sh-b" aria-label={`Put ${TYPING_LOOK[button].label} in the bar`} title="Put in the bar, at its end" data-command="bar.button" onClick={() => put(button, true)}>
                      <Plus size={15} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
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
              ['home', 'Home', true],
            ]}
            command="library.look"
            onChoose={(id) => {
              if (id !== 'home') commands.tap('library.look', { view: id })
            }}
          />
        </div>
      </SettingsPart>
    </SettingsPage>
  )
}
