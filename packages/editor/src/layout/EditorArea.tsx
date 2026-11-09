// The editing workspace: the notes, the video shown beside them, and the side
// panel, docked like Obsidian's panes. The notes are what the app gives; the video and the side panel are the editor's.
import { lazy, memo, Suspense, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { programHost } from '../program/host.js'
import { ProgramPanel } from '../program/ProgramPanel.js'
import { programShown } from '../program/state.js'
import type { EditorStore } from '../store.js'
import { videoShown } from '../video/state.js'
import { VideoPanel } from '../video/VideoPanel.js'
import { DockArea } from './DockArea.js'
import { FullScreenButton } from './FullScreen.js'
import { PanelBar } from './PanelBar.js'
import type { SideParts } from './SidePanel.js'
// The countdown's clock runs from the start; the side panel's own code loads when it is first opened.
import './side/timer.js'

const SidePanel = lazy(() => import('./SidePanel.js').then((m) => ({ default: m.SidePanel })))
import { workspace } from './state.js'

/** Drawn again only when what it holds changes: the notes inside follow the note themselves, key by key. */
export const EditorArea = memo(function EditorArea({ store, parts, children }: { store: EditorStore; parts?: SideParts; children: ReactNode }) {
  // The note's videos alone: a key typed does not draw the workspace again.
  const list = useSyncExternalStore(store.subscribe, () => store.doc.media)
  const shown = useSyncExternalStore(videoShown.subscribe, videoShown.snapshot)
  const saved = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const host = useSyncExternalStore(programHost.subscribe, programHost.snapshot)
  const program = useSyncExternalStore(programShown.subscribe, programShown.snapshot) && host !== undefined
  const media = shown === undefined ? undefined : list?.find((m) => m.id === shown)
  // A video taken out of the note closes its panel.
  useEffect(() => {
    if (shown !== undefined && !media) videoShown.set(undefined)
  }, [shown, media])
  // With another panel beside them, the notes have a bar of their own to be moved by; alone, they need none.
  const alone = !media && !saved.side && !program
  return (
    <DockArea
      panels={{
        notes: (
          <section className="nw-notes-panel" aria-label="Notes">
            {alone ? null : <PanelBar title="Notes" />}
            {children}
            <FullScreenButton />
          </section>
        ),
        video: media ? <VideoPanel key={media.id} store={store} media={media} /> : null,
        side: saved.side ? (
          <Suspense fallback={<section className="nw-side-panel" aria-label="Side panel" aria-busy />}>
            <SidePanel store={store} parts={parts} />
          </Suspense>
        ) : null,
        program: program && host ? <ProgramPanel host={host} /> : null,
      }}
    />
  )
})
