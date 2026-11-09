// Closing a small panel the way menus close: a press anywhere outside it, or
// Escape. Escape closes only the panel: it is taken first, so a Select box or
// a selection under the panel stays.
import { useEffect, type RefObject } from 'react'

/** How a panel was closed: a press outside it lands where it was made, so the panel leaves the focus alone. */
export type Dismissal = 'outside' | 'escape'

export function useDismiss(open: boolean, inside: RefObject<HTMLElement | null>, close: (how: Dismissal) => void): void {
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent): void => {
      if (!inside.current?.contains(event.target as Node)) close('outside')
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close('escape')
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open, inside, close])
}
