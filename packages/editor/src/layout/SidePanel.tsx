// The side panel: a bar of tabs beside the notes: the video's description and
// chapters, a transcript, a web page, a timer, an output section, and an AI section. Docked or floating like the other
// panels; the tab open is each person's own, kept in their browser.
import { useSyncExternalStore, type ReactNode } from 'react'
import { commands } from '../commands/index.js'
import type { EditorStore } from '../store.js'
import { PanelBar } from './PanelBar.js'
import type { AiHost } from '../ai/AiLayer.js'
import { AiTab } from './side/AiTab.js'
import { DescriptionTab } from './side/DescriptionTab.js'
import { MadeList } from './side/made.js'
import { OutputTab } from './side/OutputTab.js'
import { TimerTab } from './side/TimerTab.js'
import { ProgramWords } from '../program/ProgramWords.js'
import { TranscriptTab } from './side/TranscriptTab.js'
import { WebTab } from './side/WebTab.js'
import { sideTab, type SideTab } from './sideTab.js'

const TABS: [SideTab, string][] = [
  ['description', 'Description'],
  ['transcript', 'Transcript'],
  ['web', 'Web page'],
  ['timer', 'Timer'],
  ['output', 'Output'],
  ['ai', 'AI'],
]
/** What the app gives the side panel: its AI's answers and log, for Output, and the AI itself, for the AI tab. */
export interface SideParts {
  answers?: ReactNode
  host?: AiHost
}

export function SidePanel({ store, parts }: { store: EditorStore; parts?: SideParts | undefined }) {
  const tab = useSyncExternalStore(sideTab.subscribe, sideTab.snapshot)
  const body =
    tab === 'timer' ? (
      <TimerTab />
    ) : tab === 'web' ? (
      <WebTab />
    ) : tab === 'transcript' ? (
      <>
        <TranscriptTab store={store} />
        <ProgramWords store={store} />
      </>
    ) : tab === 'description' ? (
      <DescriptionTab store={store} />
    ) : tab === 'output' ? (
      <OutputTab answers={parts?.answers ?? <p className="nw-video-note">No AI answers yet.</p>} made={<MadeList store={store} />} />
    ) : (
      <AiTab store={store} host={parts?.host} />
    )
  return (
    <section className="nw-side-panel" aria-label="Side panel">
      <PanelBar title="Side panel" closeCommand="panel.hide" onClose={() => void commands.do('panel.hide')} />
      <div className="nw-side-tabs" role="tablist" aria-label="Side panel tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="nw-side-tab" data-command="panel.show" onClick={() => void commands.do('panel.show', { panel: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="nw-side-body" role="tabpanel" aria-label={TABS.find(([id]) => id === tab)![1]}>
        {body}
      </div>
    </section>
  )
}
