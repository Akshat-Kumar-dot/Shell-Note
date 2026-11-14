// The editing workspace: the notes, the panel beside them (the AI, or Beside), and the video and a program, shown
// inside Beside or in panels of their own, docked like Obsidian's panes. The notes are what the app gives; the rest
// are the editor's.
import { lazy, memo, Suspense, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { programHost } from '../program/host.js'
import { ProgramPanel } from '../program/ProgramPanel.js'
import { programShown } from '../program/state.js'
import type { EditorStore } from '../store.js'
import { videoShown } from '../video/state.js'
import { VideoPanel } from '../video/VideoPanel.js'
import { DockArea } from './DockArea.js'
import { FullScreenButton } from './FullScreen.js'
// Showing a video opens Beside on it, and playing one shows it (beside.ts).
import './beside.js'
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
  // The notes have no bar of their own: the other panels are moved round them, and the note's menu gives its full view.
  return (
    <DockArea
      panels={{
        notes: (
          <section className="nw-notes-panel" aria-label="Notes">
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
