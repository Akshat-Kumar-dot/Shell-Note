// What the AI changed, and what it made: two views of the panel's AI section, each a part of its own there
// (Changes, Scratch pad): the AI's answers and its log, and the things the AI made, waiting on a scratch pad to be
// put into the note.
import { useSyncExternalStore, type ReactNode } from 'react'
import { Shared } from '../../video/state.js'

export type OutputView = 'answers' | 'made'

/** The view shown, shared: a thing made onto the scratch pad shows the scratch pad. */
export const outputView = new Shared<OutputView>('answers')
export function showOutputView(view: OutputView): void {
  outputView.set(view)
}
export const outputViewNow = (): OutputView => outputView.value

export function OutputTab({ answers, made }: { answers: ReactNode; made: ReactNode }) {
  const view = useSyncExternalStore(outputView.subscribe, outputView.snapshot)
  return (
    <div className="nw-output">
      <div className="nw-output-view">{view === 'answers' ? answers : made}</div>
    </div>
  )
}
