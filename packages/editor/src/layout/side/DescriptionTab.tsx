// The side panel's description: what a YouTube video's creator wrote under
// it, and its chapters, from YouTube's own Data API with the person's own key, typed here and kept in their browser,
// never in a note. Held for this session only: YouTube's policies limit how long its data may be kept. A chapter's
// time, tapped, plays the video from there.
import { ExternalLink } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { commands } from '../../commands/index.js'
import type { EditorStore } from '../../store.js'
import { videoShown } from '../../video/state.js'
import { timeText } from '../../video/VideoMarks.js'

const KEY = 'shellnote:youtube-key'

function savedKey(): string | undefined {
  try {
    return localStorage.getItem(KEY) || undefined
  } catch {
    return undefined
  }
}

interface About {
  title: string
  channel: string
  description: string
}
/** What YouTube said of each video this session. */
const known = new Map<string, About>()

/** A chapter line of a description: its time, in tenths of a second, and its words. */
export function chapterOf(line: string): { t: number; text: string } | undefined {
  const m = /^\s*\(?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\)?\s*[-–—:|]?\s*(.*)$/.exec(line)
  if (!m || Number(m[3]) >= 60) return undefined
  return { t: (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 10, text: m[4]!.trim() }
}

async function fetchAbout(video: string, key: string): Promise<About> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(video)}`
  let response: Response
  try {
    // The key as a header, as Google's service takes it, never in the address: an address is what gets written
    // down on the way (a history, a log, a proxy).
    response = await fetch(url, { headers: { 'X-Goog-Api-Key': key } })
  } catch {
    throw new Error('YouTube could not be reached. Check the internet connection.')
  }
  const body = (await response.json().catch(() => ({}))) as { items?: { snippet?: { title?: string; channelTitle?: string; description?: string } }[]; error?: { errors?: { reason?: string }[] } }
  if (!response.ok) {
    const reason = body.error?.errors?.[0]?.reason ?? ''
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new Error('This key’s daily allowance from YouTube is used up. It renews tomorrow.')
    if (reason === 'keyInvalid' || response.status === 400 || response.status === 403) throw new Error('YouTube did not accept the key. Check it is a YouTube Data API v3 key.')
    throw new Error(`YouTube answered with an error (${response.status}).`)
  }
  const snippet = body.items?.[0]?.snippet
  if (!snippet) throw new Error('YouTube found no such video, or it is private.')
  return { title: snippet.title ?? '', channel: snippet.channelTitle ?? '', description: snippet.description ?? '' }
}

export function DescriptionTab({ store }: { store: EditorStore }) {
  // The note's videos alone: a key typed changes nothing here.
  const list = useSyncExternalStore(store.subscribe, () => store.doc.media)
  const shown = useSyncExternalStore(videoShown.subscribe, videoShown.snapshot)
  const media = shown === undefined ? undefined : list?.find((m) => m.id === shown)
  const video = media?.kind === 'youtube' ? media.video : undefined
  const [key, setKey] = useState(savedKey)
  const [typed, setTyped] = useState('')
  const [about, setAbout] = useState<About | undefined>(() => (video ? known.get(video) : undefined))
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setProblem(undefined)
    if (!video || !key) return setAbout(undefined)
    const kept = known.get(video)
    if (kept) return setAbout(kept)
    let gone = false
    setBusy(true)
    fetchAbout(video, key)
      .then((found) => {
        known.set(video, found)
        if (!gone) setAbout(found)
      })
      .catch((error: unknown) => {
        if (!gone) setProblem(error instanceof Error ? error.message : 'The description could not be had.')
      })
      .finally(() => {
        if (!gone) setBusy(false)
      })
    return () => {
      gone = true
    }
  }, [video, key])

  if (!media) return <p className="nw-video-note">Show a video beside the note (the Video button), and its description goes here.</p>
  if (!video) return <p className="nw-video-note">A video file of your own has no description from YouTube.</p>

  const keepKey = (): void => {
    const value = typed.trim()
    if (!value) return
    try {
      localStorage.setItem(KEY, value)
    } catch {
      // Not kept, as in a private window: it holds until the page closes.
    }
    setTyped('')
    setKey(value)
  }
  const forget = (): void => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // Nothing was kept.
    }
    setKey(undefined)
    setAbout(undefined)
  }

  if (!key) {
    return (
      <form
        className="nw-transcript-paste"
        onSubmit={(event) => {
          event.preventDefault()
          keepKey()
        }}
      >
        <p className="nw-video-note">
          The description comes from YouTube’s Data API, with a key of your own: free, from the Google Cloud console (APIs &amp; Services, YouTube Data API v3, Credentials). It is kept in this browser only.
        </p>
        <input className="nw-transcript-find" type="password" autoComplete="off" aria-label="YouTube Data API key" placeholder="Your YouTube Data API key" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <div className="nw-timer-buttons">
          <button type="submit" className="nw-video-add" disabled={typed.trim() === ''}>
            Keep the key
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="nw-description">
      {busy ? <p className="nw-video-note">Asking YouTube…</p> : null}
      {problem ? (
        <p className="nw-video-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {about ? (
        <>
          <h3 className="nw-description-title">{about.title}</h3>
          <p className="nw-video-note">
            {about.channel} ·{' '}
            <a href={`https://www.youtube.com/watch?v=${video}`} target="_blank" rel="noopener noreferrer">
              On YouTube <ExternalLink size={12} aria-hidden />
            </a>
          </p>
          <div className="nw-description-text">
            {about.description.split('\n').map((line, i) => {
              const chapter = chapterOf(line)
              return chapter ? (
                <button key={i} type="button" className="nw-description-chapter" data-command="video.playFrom" onClick={() => commands.tap('video.playFrom', { seconds: chapter.t / 10, video: media.id })}>
                  <span className="nw-transcript-time">{timeText(chapter.t)}</span> {chapter.text}
                </button>
              ) : (
                <p key={i}>{line || ' '}</p>
              )
            })}
          </div>
        </>
      ) : null}
      <button type="button" className="nw-video-add nw-description-forget" onClick={forget}>
        Forget the key
      </button>
    </div>
  )
}
