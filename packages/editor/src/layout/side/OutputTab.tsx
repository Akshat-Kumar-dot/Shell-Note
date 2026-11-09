// The side panel's Output: two views, switched between: the AI's answers and
// its log, and the things the AI made, waiting on a scratch pad to be put into the note.
import { useSyncExternalStore, type ReactNode } from 'react'
import { commands } from '../../commands/index.js'
import { Shared } from '../../video/state.js'

export type OutputView = 'answers' | 'made'

/** The view shown, shared: a thing made onto the scratch pad shows Made. */
const outputView = new Shared<OutputView>('answers')
export function showOutputView(view: OutputView): void {
  outputView.set(view)
}
export const outputViewNow = (): OutputView => outputView.value

export function OutputTab({ answers, made }: { answers: ReactNode; made: ReactNode }) {
  const view = useSyncExternalStore(outputView.subscribe, outputView.snapshot)
  return (
    <div className="nw-output">
      <div className="nw-timer-modes" role="radiogroup" aria-label="Output">
        <button type="button" role="radio" aria-checked={view === 'answers'} className="nw-side-tab" data-command="output.answers" onClick={() => commands.tap('output.answers')}>
          Answers and log
        </button>
        <button type="button" role="radio" aria-checked={view === 'made'} className="nw-side-tab" data-command="output.made" onClick={() => commands.tap('output.made')}>
          Made
        </button>
      </div>
      <div className="nw-output-view">{view === 'answers' ? answers : made}</div>
    </div>
  )
}
