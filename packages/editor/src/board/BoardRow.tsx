// A board's row of tools, where a note of pages has its row for words: Select, the Hand, undo and redo, Tidy (the
// flowchart laid out again) and the whole board in view. Each button runs its command, as every control does.
import { Hand, Maximize, MousePointer2, Workflow } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { keepFocus } from '../BarMenu.js'
import { RedoButton, UndoButton } from '../BarParts.js'
import { commands } from '../commands/index.js'
import type { EditorStore, Tool } from '../store.js'

const ICON = 18

export function BoardRow({ store }: { store: EditorStore }) {
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  const choose = (next: Tool): void => void commands.do('tool.choose', { tool: next })
  return (
    <div className="sh-tools nw-boardbar" role="toolbar" aria-label="Board">
      <button type="button" className="sh-b" aria-label="Select" aria-pressed={tool !== 'hand'} title="Select: choose, move and size what is on the board; a drag on the bare board chooses what lies inside" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('select')}>
        <MousePointer2 size={ICON} aria-hidden />
      </button>
      <button type="button" className="sh-b" aria-label="Move the board" aria-pressed={tool === 'hand'} title="Move the board: drag it to look round it (Space held, or the wheel, with any tool)" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => choose('hand')}>
        <Hand size={ICON} aria-hidden />
      </button>
      <span className="sh-sep" />
      <UndoButton store={store} />
      <RedoButton store={store} />
      <span className="sh-sep" />
      <button type="button" className="sh-b" aria-label="Tidy the flowchart" title="Tidy: lay the flowchart out again, each step keeping its size" data-command="board.tidy" onMouseDown={keepFocus} onClick={() => commands.press('board.tidy')}>
        <Workflow size={ICON} aria-hidden />
      </button>
      <button type="button" className="sh-b" aria-label="The whole board" title="The whole board in view" data-command="screen.zoom" onMouseDown={keepFocus} onClick={() => commands.press('screen.zoom', { step: 'fit' })}>
        <Maximize size={ICON} aria-hidden />
      </button>
    </div>
  )
}
