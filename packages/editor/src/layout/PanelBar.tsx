// A panel's bar: dragged, it docks the panel elsewhere; the full view button fills the workspace with it
//; × closes it. 32 pixels tall, so what is under it starts on a whole screen pixel (app.css).
import { Maximize2, Minimize2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useFullView, usePanel } from './DockArea.js'

export function PanelBar({ title, children, onClose, closeCommand }: { title: string; children?: ReactNode; onClose?: (() => void) | undefined; closeCommand?: string }) {
  const panel = usePanel()
  const full = useFullView()
  return (
    <header className="nw-dock-bar" onPointerDown={panel?.grab} title="Drag to move this panel">
      <span className="nw-dock-title">{title}</span>
      {children}
      {full ? (
        <button type="button" className="nw-ibtn" aria-label={full.full ? 'Leave full view' : `Full view: the ${title.toLowerCase()} alone`} aria-pressed={full.full} title={full.full ? 'Leave full view (Esc)' : 'Full view'} data-command="panel.full" onClick={full.toggle}>
          {full.full ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
        </button>
      ) : null}
      {onClose ? (
        <button type="button" className="nw-ibtn" aria-label={`Close the ${title.toLowerCase()}`} title="Close" data-command={closeCommand} onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      ) : null}
    </header>
  )
}
