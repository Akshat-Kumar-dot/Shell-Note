// The colour of the selected words or blocks, as in Word: one button showing
// the colour in use, and a panel with Automatic, the eight note colours (the
// ones the AI also uses) with lighter and darker shades of each, Word's ten
// standard colours, the colours used last, and More colours for any colour at
// all. The note colours stay names in the file; every other colour is a code.
// Each colour is a 40 px target, for a finger or a pen. The panel closes with
// its ✕, Escape, or a press outside it; a colour chosen closes it too.
import { Color, type AnyColor } from '@shellnote/core'
import { ChevronDown, Palette, Plus, X } from 'lucide-react'
import { useCallback, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { isColourCode, recentColours, rememberColour } from './colours.js'
import { useDismiss, type Dismissal } from './dismiss.js'
import { MoreColours } from './MoreColours.js'
import { placeMenu } from './popover.js'
import { NAMED_HEX, shadesOf, STANDARD } from './palette.js'

/** A press on a button must not move the focus out of the text. */
const keepFocus = (event: MouseEvent): void => event.preventDefault()

/** A colour as CSS: a named colour through its token (a highlighter's own, lighter ones), a code as it is. */
const css = (color: AnyColor | undefined, highlighter = false): string => {
  const token = (name: string): string => `var(--nw-${highlighter ? 'hl-' : ''}${name})`
  return color === undefined ? token('ink') : isColourCode(color) ? color : token(color)
}

const title = (color: Color): string => (color === 'ink' ? 'Ink' : color[0]!.toUpperCase() + color.slice(1))

export interface ColourMenuProps {
  /** The colour of what a change goes to, a name or a code; undefined when the selected words have several. */
  current: AnyColor | undefined
  /** Use a note colour, which stays a name. */
  onNamed: (color: Color) => void
  /** Use a colour code. */
  onCode: (code: string) => void
  /** The panel closed by a choice, its ✕ or Escape: the text takes the focus back. */
  onDone?: () => void
  /** For the highlighter: the note colours show as it draws them, lighter. */
  highlighter?: boolean
  /**
   * What the button shows: the colour in use as a dot; a letter A over a line in the colour in use, for words; or a
   * plus, for every colour besides those already in reach.
   */
  look?: 'dot' | 'letter' | 'more'
}

export function ColourMenu({ current, onNamed, onCode, onDone, highlighter = false, look = 'dot' }: ColourMenuProps) {
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  const close = useCallback((how?: Dismissal) => {
    setOpen(false)
    setMore(false)
    // A press outside lands where it was made; anything else gives the text its focus back.
    if (how !== 'outside') done.current?.()
  }, [])
  useDismiss(open, root, close)
  const [recent, setRecent] = useState(recentColours)

  const named = (color: Color): void => {
    onNamed(color)
    close()
  }
  const coded = (code: string, remember: boolean): void => {
    onCode(code)
    if (remember) setRecent(rememberColour(code))
    close()
  }
  const swatch = (label: string, value: AnyColor, choose: () => void, name?: Color) => (
    <button
      key={label}
      type="button"
      className="nw-swatch"
      aria-label={label}
      title={name ? title(name) : label}
      aria-pressed={current === value}
      {...(name ? { 'data-swatch': name } : { style: { '--swatch': value } as CSSProperties })}
      onMouseDown={keepFocus}
      onClick={choose}
    />
  )

  return (
    <span className="nw-popover-anchor" ref={root} data-tones={highlighter ? 'highlighter' : undefined}>
      <button
        type="button"
        className="nw-ibtn nw-colour-button"
        aria-label={look === 'more' ? 'More colours' : 'Colour'}
        aria-expanded={open}
        title={look === 'more' ? 'More colours' : 'Colour'}
        data-look={look}
        onMouseDown={keepFocus}
        onClick={() => {
          if (open) return close()
          // Read again: another tab may have used a colour since.
          setRecent(recentColours())
          setOpen(true)
        }}
      >
        {look === 'more' ? (
          <Plus size={15} aria-hidden />
        ) : look === 'letter' ? (
          <>
            <svg className="nw-colour-letter" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m6 16 6-12 6 12" />
              <path d="M8 12h8" />
              <path d="M4 20h16" strokeWidth={3} style={{ stroke: css(current, highlighter) }} />
            </svg>
            <ChevronDown size={14} aria-hidden />
          </>
        ) : (
          <>
            <span className="nw-colour-dot" style={{ '--swatch': css(current, highlighter) } as CSSProperties} aria-hidden />
            <ChevronDown size={14} aria-hidden />
          </>
        )}
      </button>
      {open && !more ? (
        <div ref={placeMenu} className="nw-popover nw-colour-panel" role="group" aria-label="Colours">
          <div className="nw-panel-head">
            <span>Colours</span>
            <button type="button" className="nw-ibtn" aria-label="Close colours" title="Close (Esc)" onMouseDown={keepFocus} onClick={() => close()}>
              <X size={16} aria-hidden />
            </button>
          </div>
          <button type="button" className="nw-wide-choice" aria-pressed={current === 'ink'} onMouseDown={keepFocus} onClick={() => named('ink')}>
            <span className="nw-colour-dot" style={{ '--swatch': css('ink', highlighter) } as CSSProperties} aria-hidden />
            Automatic
          </button>
          <div className="nw-panel-label">Note colours, which the AI uses too</div>
          <div className="nw-colour-grid nw-note-colours">
            {Color.options.map((color) => swatch(color, color, () => named(color), color))}
            {[0, 1, 2, 3].flatMap((row) => Color.options.map((color) => shadesOf(color)[row]!).map((shade) => swatch(shade.label, shade.code as AnyColor, () => coded(shade.code, false))))}
          </div>
          <div className="nw-panel-label">Standard colours</div>
          <div className="nw-colour-grid nw-standard-colours">{STANDARD.map(([name, code]) => swatch(`${name}, ${code}`, code as AnyColor, () => coded(code, false)))}</div>
          {recent.length > 0 ? (
            <>
              <div className="nw-panel-label">Recent colours</div>
              <div className="nw-colour-grid nw-standard-colours">{recent.map((code) => swatch(`Colour ${code}`, code as AnyColor, () => coded(code, true)))}</div>
            </>
          ) : null}
          <button type="button" className="nw-wide-choice" onMouseDown={keepFocus} onClick={() => setMore(true)}>
            <Palette size={18} aria-hidden />
            More colours…
          </button>
        </div>
      ) : null}
      {open && more ? (
        <div ref={placeMenu} className="nw-popover nw-colour-panel">
          <MoreColours
            start={current === undefined ? NAMED_HEX.blue : isColourCode(current) ? current : NAMED_HEX[current as Color]}
            onUse={(code) => coded(code, true)}
            onCancel={() => setMore(false)}
            onClose={() => close()}
          />
        </div>
      ) : null}
    </span>
  )
}
