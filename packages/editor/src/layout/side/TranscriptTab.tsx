// The side panel's transcript: the shown video's lines, each with its time; a
// tap plays the video from there, and the line playing is marked. Pasted by the person, from YouTube's own "Show
// transcript" or a subtitle file (YouTube's API gives captions only to a video's owner), and kept with the note.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { commands, NO_TIMES } from '../../commands/index.js'
import type { EditorStore } from '../../store.js'
import { videoClock, videoShown } from '../../video/state.js'
import { transcriptFind, transcriptOf } from '../../video/transcript.js'
import { timeText } from '../../video/VideoMarks.js'

/**
 * A transcript pasted and not yet kept, for each video: the side panel draws only the tab open, so it waits here while
 * another tab is looked at.
 */
const drafts = new Map<string, string>()

export function TranscriptTab({ store }: { store: EditorStore }) {
  // The note's videos alone: a key typed changes nothing here.
  const videos = useSyncExternalStore(store.subscribe, () => store.doc.media)
  const shown = useSyncExternalStore(videoShown.subscribe, videoShown.snapshot)
  const clock = useSyncExternalStore(videoClock.subscribe, videoClock.snapshot)
  const media = shown === undefined ? undefined : videos?.find((m) => m.id === shown)
  const [pasting, setPasting] = useState(false)
  const [text, setTyped] = useState(() => (shown === undefined ? '' : (drafts.get(shown) ?? '')))
  const [problem, setProblem] = useState<string>()
  const find = useSyncExternalStore(transcriptFind.subscribe, transcriptFind.snapshot)
  const [, tick] = useState(0)
  const list = useRef<HTMLOListElement>(null)
  const lines = media?.transcript
  // The line playing follows the video.
  useEffect(() => {
    if (!lines) return
    const every = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(every)
  }, [lines])
  const now = clock && media && clock.media === media.id ? clock.time() * 10 : undefined
  let playing = -1
  if (lines && now !== undefined) for (let i = 0; i < lines.length && lines[i]!.t <= now; i++) playing = i
  useEffect(() => {
    if (find || playing < 0) return
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [playing, find])

  if (!media) return <p className="nw-video-note">Show a video beside the note (the Video button), and its transcript goes here.</p>

  const setText = (to: string): void => {
    setTyped(to)
    if (to) drafts.set(media.id, to)
    else drafts.delete(media.id)
  }


  if (!lines || pasting) {
    return (
      <form
        className="nw-transcript-paste"
        onSubmit={(event) => {
          event.preventDefault()
          if (transcriptOf(text).length === 0) {
            setProblem(NO_TIMES)
            return
          }
          try {
            commands.do('transcript.paste', { transcript: text })
          } catch (error) {
            setProblem(error instanceof Error ? error.message : NO_TIMES)
            return
          }
          setText('')
          setProblem(undefined)
          setPasting(false)
        }}
      >
        {media.kind === 'youtube' ? (
          <p className="nw-video-note">On the video’s YouTube page, under the description: Show transcript. Select all of it, copy, and paste it here.</p>
        ) : (
          <p className="nw-video-note">Paste a transcript or a subtitle file (SRT, WebVTT). One written on this laptop from the video’s sound comes later.</p>
        )}
        <textarea aria-label="Transcript to paste" data-command="transcript.paste" rows={8} value={text} placeholder={'0:00\nWelcome to the course\n0:05\nToday…'} onChange={(event) => setText(event.target.value)} />
        {problem ? (
          <p className="nw-video-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="nw-timer-buttons">
          <button type="submit" className="nw-video-add" data-command="transcript.paste">
            Keep it with the note
          </button>
          {lines ? (
            <button type="button" className="nw-video-add" onClick={() => setPasting(false)}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    )
  }

  const wanted = find.trim().toLowerCase()
  return (
    <div className="nw-transcript">
      <input className="nw-transcript-find" type="search" aria-label="Find in the transcript" placeholder="Find in the transcript" maxLength={200} data-command="transcript.find" value={find} onChange={(event) => commands.tap('transcript.find', { text: event.target.value })} />
      <ol className="nw-transcript-lines" ref={list}>
        {lines.map((line, i) =>
          wanted && !line.text.toLowerCase().includes(wanted) ? null : (
            <li key={`${line.t}:${i}`}>
              <button type="button" aria-current={i === playing} title={`Play from ${timeText(line.t)}`} data-command="video.playFrom" onClick={() => commands.tap('video.playFrom', { seconds: line.t / 10, video: media.id })}>
                <span className="nw-transcript-time">{timeText(line.t)}</span> {line.text}
              </button>
            </li>
          ),
        )}
      </ol>
      <div className="nw-timer-buttons">
        <button type="button" className="nw-video-add" onClick={() => setPasting(true)}>
          Paste again
        </button>
        <button type="button" className="nw-video-add" data-command="transcript.remove" onClick={() => commands.tap('transcript.remove')}>
          Take it out
        </button>
      </div>
    </div>
  )
}
