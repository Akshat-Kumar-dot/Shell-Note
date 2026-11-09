// A dialog over the page, and a small menu at a point. Both close with their
// ✕ or Escape, and with a press outside them, and give the keyboard focus
// back to where it was. A dialog keeps Tab inside itself while it is open.
import { X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Close on Escape, taken before anything else so only the topmost panel closes. */
function useEscape(close: () => void): void {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Give the focus back to what had it before, when this closes. */
function useFocusReturn(): void {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    return () => before?.focus?.()
  }, [])
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const label = useId()
  useEscape(onClose)
  useFocusReturn()
  useEffect(() => {
    // The first field, or else the first button after the ✕, takes the focus.
    const inside = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    ;(inside.find((element) => element.matches('input, select')) ?? inside[1] ?? inside[0])?.focus()
  }, [])
  const keepTabInside = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const inside = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (inside.length === 0) return
    const first = inside[0]!
    const last = inside.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  return (
    <div className="dialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} className="dialog" data-wide={wide ? '' : undefined} role="dialog" aria-modal="true" aria-labelledby={label} onKeyDown={keepTabInside}>
        <header className="dialog-head">
          <h2 id={label}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  /** The command it calls (app control), when it calls one. */
  command?: string
}

/** A menu at a point on the screen, such as where a card was right-clicked or long-pressed. Arrow keys move through it. */
export function Menu({ x, y, items, label, onClose }: { x: number; y: number; items: MenuItem[]; label: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: x, top: y })
  useEscape(onClose)
  useFocusReturn()
  // Kept inside the window.
  useLayoutEffect(() => {
    const rect = box.current!.getBoundingClientRect()
    setAt({ left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) })
    box.current!.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [x, y])
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      if (!box.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [onClose])
  const move = (event: React.KeyboardEvent): void => {
    const entries = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const now = entries.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? now + 1 : event.key === 'ArrowUp' ? now - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    entries[(next + entries.length) % entries.length]?.focus()
  }
  return (
    <div ref={box} className="menu" role="menu" aria-label={label} style={at} onKeyDown={move}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="menu-item"
          data-command={item.command}
          data-danger={item.danger ? '' : undefined}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
