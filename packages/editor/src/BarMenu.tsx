// A button of a bar that opens a menu under it, and the menu's lines. The menu is placed against the window
// (popover.ts), closes with a press outside it or Escape (dismiss.ts), and like every button of the bars it never
// takes the focus, so the caret and what is selected stay as they were.
import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useDismiss, type Dismissal } from './dismiss.js'
import { placeMenu } from './popover.js'

/** A press on a button must not move the focus out of the text. */
export const keepFocus = (event: MouseEvent): void => event.preventDefault()

export interface BarMenuProps {
  /** The button's name, and the menu's. */
  label: string
  title?: string
  /** What the button shows: an icon, a word, and its arrow. */
  button: ReactNode
  /** The button's classes, in place of a plain button's. */
  className?: string
  /** The button shown as in use, as a tool chosen is. */
  pressed?: boolean
  /** Called before the menu opens: false leaves it closed (the press did something else). */
  onPress?: () => boolean
  /** The menu closed by a choice or Escape: the text takes the focus back. */
  onDone?: () => void
  width?: number
  disabled?: boolean
  /** The menu's lines, given the function that closes it. */
  children: (close: () => void) => ReactNode
}

export function BarMenu({ label, title, button, className = 'sh-b', pressed, onPress, onDone, width, disabled, children }: BarMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  const close = useCallback((how?: Dismissal) => {
    setOpen(false)
    // A press outside lands where it was made; anything else gives the text its focus back.
    if (how !== 'outside') done.current?.()
  }, [])
  useDismiss(open, root, close)
  return (
    <span className="sh-anchor nw-popover-anchor" ref={root}>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={pressed}
        title={title ?? label}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => {
          if (open) return close()
          if (onPress && !onPress()) return
          setOpen(true)
        }}
      >
        {button}
      </button>
      {open ? (
        <div ref={placeMenu} className="sh-menu" role="menu" aria-label={label} style={width === undefined ? undefined : { minWidth: width }}>
          {children(() => close())}
        </div>
      ) : null}
    </span>
  )
}

export interface MenuItemProps {
  /** One of several, the one in use marked; or a switch, on or off. Left out, a plain line. */
  checked?: boolean
  kind?: 'radio' | 'checkbox'
  label?: string
  title?: string
  command?: string
  disabled?: boolean
  onChoose: () => void
  children: ReactNode
}

/** A line of a menu. */
export function MenuItem({ checked, kind = 'radio', label, title, command, disabled, onChoose, children }: MenuItemProps) {
  return (
    <button
      type="button"
      className="sh-item"
      role={checked === undefined ? 'menuitem' : kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      data-command={command}
      onMouseDown={keepFocus}
      onClick={onChoose}
    >
      {children}
    </button>
  )
}
