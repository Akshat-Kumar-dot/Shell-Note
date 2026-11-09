// The Side panel button on the app's bar: opens and closes the side panel beside the notes.
import { PanelRightOpen } from 'lucide-react'
import { useSyncExternalStore, type MouseEvent } from 'react'
import { commands } from '../commands/index.js'
import { workspace } from './state.js'

const keepFocus = (event: MouseEvent): void => event.preventDefault()

export function SidePanelButton() {
  const saved = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  return (
    <button type="button" className="icon-button" aria-label="Side panel" aria-pressed={saved.side} title="The side panel: the video's description, a transcript, a web page, a timer, output and AI" data-command={saved.side ? 'panel.hide' : 'panel.show'} onMouseDown={keepFocus} onClick={() => void (saved.side ? commands.do('panel.hide') : commands.do('panel.show', { panel: 'side' }))}>
      <PanelRightOpen size={18} aria-hidden />
    </button>
  )
}
