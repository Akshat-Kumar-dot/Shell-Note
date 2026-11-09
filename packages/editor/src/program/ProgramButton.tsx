// The Program button on the app's bar (stage 2 of other programs inside ShellNote, 25 October 2026): opens and closes
// the program panel. Shown only where the app gave a host for it: the app on Windows.
import { AppWindow } from 'lucide-react'
import { useSyncExternalStore, type MouseEvent } from 'react'
import { programHost } from './host.js'
import { programShown } from './state.js'

const keepFocus = (event: MouseEvent): void => event.preventDefault()

export function ProgramButton() {
  const host = useSyncExternalStore(programHost.subscribe, programHost.snapshot)
  const shown = useSyncExternalStore(programShown.subscribe, programShown.snapshot)
  if (!host) return null
  return (
    <button type="button" className="icon-button" aria-label="Program panel" aria-pressed={shown} title="Another program's own window on a panel beside the notes" onMouseDown={keepFocus} onClick={() => programShown.set(!shown)}>
      <AppWindow size={18} aria-hidden />
    </button>
  )
}
