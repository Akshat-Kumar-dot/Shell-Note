// The panel beside the notes, one of two sections at a time. AI: the chat, what the AI changed (its answers and its
// log, each change with Undo), and the scratch pad, where what it made waits to be put into the note. Beside: what is
// watched or read beside the writing, one at a time: a video (shown inside, with its description, its transcript and
// a timer), a web page, or, in the app on Windows, another program's window. The video and a program are drawn over
// the place this panel keeps for them (beside.ts) unless the person took them out into panels of their own. Docked or
// floating like the other panels; the part open is each person's own, kept in their browser. A program's part is the
// person's alone: its buttons call no command.
import { AppWindow, MonitorPlay, Play, Sparkles, Timer } from 'lucide-react'
import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { commands } from '../commands/index.js'
import { programHost } from '../program/host.js'
import { ProgramWords } from '../program/ProgramWords.js'
import { programShown } from '../program/state.js'
import type { EditorStore } from '../store.js'
import { videoShown } from '../video/state.js'
import { VideoButton } from '../video/VideoButton.js'
import type { AiHost } from '../ai/AiLayer.js'
import { besideSlot } from './beside.js'
import { PanelBar } from './PanelBar.js'
import { AiTab } from './side/AiTab.js'
import { DescriptionTab } from './side/DescriptionTab.js'
import { MadeList } from './side/made.js'
import { OutputTab, outputView } from './side/OutputTab.js'
import { TimerTab } from './side/TimerTab.js'
import { TranscriptTab } from './side/TranscriptTab.js'
import { WebTab } from './side/WebTab.js'
import { AI_TABS, showSideTab, sideTab, videoTab, type SideTab } from './sideTab.js'
import { putInside, workspace, type Inside } from './state.js'

/** A tab of a section: its name, whether it is open, the command its press calls, and the press. */
interface Part {
  label: string
  on: boolean
  command: string | undefined
  open: () => void
  icon?: ReactNode
}

/** What the app gives the panel: its AI's answers and log, for what the AI changed, and the AI itself, for the chat. */
export interface SideParts {
  answers?: ReactNode
  host?: AiHost
}

/** What a video's name is, in the list of the note's videos. */
const nameOf = (media: { kind: string; title?: string | undefined; name?: string | undefined }): string => (media.kind === 'youtube' ? (media.title ?? 'YouTube video') : (media.name ?? 'Video'))

export function SidePanel({ store, parts }: { store: EditorStore; parts?: SideParts | undefined }) {
  const tab = useSyncExternalStore(sideTab.subscribe, sideTab.snapshot)
  const view = useSyncExternalStore(outputView.subscribe, outputView.snapshot)
  const saved = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const shown = useSyncExternalStore(videoShown.subscribe, videoShown.snapshot)
  const host = useSyncExternalStore(programHost.subscribe, programHost.snapshot)
  const program = useSyncExternalStore(programShown.subscribe, programShown.snapshot) && host !== undefined
  // The note's videos alone: a key typed does not draw the panel again.
  const media = useSyncExternalStore(store.subscribe, () => store.doc.media) ?? []
  const ai = AI_TABS.includes(tab)
  const part: 'video' | 'web' | 'program' = tab === 'web' ? 'web' : tab === 'program' && host ? 'program' : 'video'
  // The place kept for what is shown inside: the video, or a program's window.
  const slotFor: Inside | undefined = ai ? undefined : part === 'video' && shown !== undefined && saved.beside.video ? 'video' : part === 'program' && program && saved.beside.program ? 'program' : undefined
  const section = useRef<HTMLElement>(null)
  const slot = useRef<HTMLDivElement>(null)

  // Where that place is, from the panel's top left, told to the workspace whenever the panel or the place changes size.
  useLayoutEffect(() => {
    const box = section.current
    const place = slot.current
    if (!box || !place || !slotFor) return
    const measure = (): void => {
      const outer = box.getBoundingClientRect()
      const inner = place.getBoundingClientRect()
      const next = { for: slotFor, x: Math.round(inner.left - outer.left), y: Math.round(inner.top - outer.top), w: Math.round(inner.width), h: Math.round(inner.height) }
      const now = besideSlot.value
      if (!now || now.for !== next.for || now.x !== next.x || now.y !== next.y || now.w !== next.w || now.h !== next.h) besideSlot.set(next)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(box)
    watch.observe(place)
    return () => {
      watch.disconnect()
      besideSlot.set(undefined)
    }
  }, [slotFor])

  const show = (panel: SideTab, label: string, icon?: ReactNode): Part => ({ label, on: tab === panel, command: 'panel.show', open: () => void commands.do('panel.show', { panel }), ...(icon ? { icon } : {}) })
  const tabs: Part[] = ai
    ? [
        show('ai', 'Chat'),
        { label: 'Changes', on: tab === 'output' && view === 'answers', command: 'output.answers', open: () => commands.tap('output.answers') },
        { label: 'Scratch pad', on: tab === 'output' && view === 'made', command: 'output.made', open: () => commands.tap('output.made') },
      ]
    : part === 'video'
      ? [show('description', 'Description'), show('transcript', 'Transcript'), show('timer', 'Timer', <Timer size={14} strokeWidth={1.75} aria-hidden />)]
      : []
  const body =
    tab === 'ai' ? (
      <AiTab store={store} host={parts?.host} />
    ) : tab === 'output' ? (
      <OutputTab answers={parts?.answers ?? <p className="nw-video-note">No AI answers yet.</p>} made={<MadeList store={store} />} />
    ) : part === 'web' ? (
      <WebTab />
    ) : part === 'program' ? (
      <ProgramPart shown={program} inside={saved.beside.program} />
    ) : tab === 'timer' ? (
      <TimerTab />
    ) : tab === 'transcript' ? (
      <>
        <TranscriptTab store={store} />
        <ProgramWords store={store} />
      </>
    ) : (
      <DescriptionTab store={store} />
    )
  const Icon = ai ? Sparkles : MonitorPlay
  const name = ai ? 'AI' : 'Beside'
  return (
    <section ref={section} className="nw-side-panel sh-panel" aria-label="Side panel" data-section={ai ? 'ai' : 'beside'}>
      <PanelBar title="Side panel" closeCommand="panel.hide" onClose={() => void commands.do('panel.hide')}>
        <span className="sh-panel-name">
          <Icon size={16} strokeWidth={1.75} aria-hidden />
          <b>{name}</b>
        </span>
        {!ai && part === 'video' ? <VideoButton store={store} /> : null}
      </PanelBar>
      {ai ? null : (
        <div className="sh-seg sh-panel-seg" role="radiogroup" aria-label="Beside the note">
          <button type="button" role="radio" aria-checked={part === 'video'} data-command="panel.show" onClick={() => void commands.do('panel.show', { panel: videoTab() })}>
            Video
          </button>
          <button type="button" role="radio" aria-checked={part === 'web'} data-command="panel.show" onClick={() => void commands.do('panel.show', { panel: 'web' })}>
            Web page
          </button>
          {host ? (
            <button type="button" role="radio" aria-checked={part === 'program'} aria-label="Program panel: a program beside the note" onClick={() => showSideTab('program')}>
              Program
            </button>
          ) : null}
        </div>
      )}
      {slotFor === 'video' ? <div ref={slot} className="sh-slot" data-for="video" aria-hidden /> : null}
      {!ai && part === 'video' && shown !== undefined && !saved.beside.video ? (
        <p className="sh-panel-note">
          The video is in a panel of its own.{' '}
          <button type="button" className="sh-link" data-command="video.inside" onClick={() => commands.tap('video.inside')}>
            Put it back here
          </button>
        </p>
      ) : null}
      {!ai && part === 'video' && shown === undefined ? (
        <div className="sh-panel-note" role="group" aria-label="The note's videos">
          {media.length === 0 ? (
            <p>No video yet. Add one with the video button above: a YouTube link, or a video file of your own.</p>
          ) : (
            <>
              <p>None is shown. This note's videos:</p>
              {media.map((item) => (
                <button key={item.id} type="button" className="sh-item" data-command="video.show" onClick={() => commands.tap('video.show', { video: item.id })}>
                  <Play size={15} strokeWidth={1.75} aria-hidden />
                  {nameOf(item)}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
      {tabs.length > 0 ? (
        <div className="sh-panel-tabs" role="tablist" aria-label={`${name}: its parts`}>
          {tabs.map((one) => (
            <button key={one.label} type="button" role="tab" aria-selected={one.on} aria-label={one.icon ? one.label : undefined} title={one.icon ? one.label : undefined} data-command={one.command} onClick={one.open}>
              {one.icon ?? one.label}
            </button>
          ))}
        </div>
      ) : null}
      {slotFor === 'program' ? <div ref={slot} className="sh-slot" data-for="program" aria-hidden /> : null}
      <div className="nw-side-body" role="tabpanel" aria-label={tabs.find((one) => one.on)?.label ?? (part === 'web' ? 'Web page' : part === 'program' ? 'Program' : name)}>
        {body}
      </div>
    </section>
  )
}

/** A program's part: one shown inside, or taken out, or none yet. Its buttons are the person's own: no command. */
function ProgramPart({ shown, inside }: { shown: boolean; inside: boolean }) {
  if (shown && inside) return null
  if (shown) {
    return (
      <p className="sh-panel-note">
        The program is in a panel of its own.{' '}
        <button type="button" className="sh-link" aria-label="Program panel: put it back here" onClick={() => putInside('program')}>
          Put it back here
        </button>
      </p>
    )
  }
  return (
    <div className="sh-panel-note">
      <p>Another program's own window, kept here beside the note: a browser, a PDF, slides, your code.</p>
      <button type="button" className="sh-b sh-word" aria-label="Program panel: choose a program" onClick={() => programShown.set(true)}>
        <AppWindow size={16} strokeWidth={1.75} aria-hidden />
        Choose a program
      </button>
    </div>
  )
}
