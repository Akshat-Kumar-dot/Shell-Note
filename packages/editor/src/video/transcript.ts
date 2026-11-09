// A pasted transcript read into timed lines: as YouTube's own "Show
// transcript" copies it (a time on a line of its own, then the words), a time and words on one line, or a subtitle
// file (SRT or WebVTT: "00:00:01,000 --> 00:00:04,000", then the words).
import type { Media } from '@shellnote/core'
import { Shared } from './state.js'

export interface TranscriptLine {
  /** Tenths of a second. */
  t: number
  text: string
}

const TIME = /^\[?(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?\]?$/
const TIME_AND_WORDS = /^\[?((?:\d{1,2}:)?\d{1,3}:\d{2}(?:[.,]\d{1,3})?)\]?\s+(.+)$/
const CUE = /^((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->/

/** A time as written, in tenths of a second; none when it is not one. */
function tenths(written: string): number | undefined {
  const m = TIME.exec(written.trim())
  if (!m) return undefined
  const [h, mins, secs, part] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3]), m[4] ?? '']
  if (secs >= 60) return undefined
  const fraction = part ? Number(`0.${part}`) : 0
  return Math.round((h * 3600 + mins * 60 + secs + fraction) * 10)
}

/** The lines of a pasted transcript, in time order; none when nothing in it is timed. */
export function transcriptOf(pasted: string): TranscriptLine[] {
  const lines = pasted.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim())
  const out: TranscriptLine[] = []
  let current: TranscriptLine | undefined
  const finish = (): void => {
    if (current && current.text) out.push(current)
    current = undefined
  }
  for (const line of lines) {
    if (line === '' || line === 'WEBVTT' || /^\d+$/.test(line) || /^(NOTE|STYLE|Kind:|Language:)/.test(line)) {
      // A blank line ends a subtitle cue; a cue's number and a file's header say nothing.
      if (line === '' && current) finish()
      continue
    }
    const cue = CUE.exec(line)
    const alone = cue ? undefined : tenths(line)
    const both = cue || alone !== undefined ? undefined : TIME_AND_WORDS.exec(line)
    if (cue || alone !== undefined) {
      finish()
      current = { t: cue ? tenths(cue[1]!)! : alone!, text: '' }
    } else if (both && tenths(both[1]!) !== undefined) {
      finish()
      out.push({ t: tenths(both[1]!)!, text: both[2]!.trim() })
    } else if (current) {
      // Subtitle markup out: <i>, <c.colour>, timestamps inside a cue.
      const words = line.replace(/<[^>]*>/g, '').trim()
      if (words) current.text = current.text ? `${current.text} ${words}` : words
    }
  }
  finish()
  out.sort((a, b) => a.t - b.t)
  // The same words again at once (subtitles rolling on) said once.
  return out.filter((line, i) => i === 0 || line.text !== out[i - 1]!.text)
}

/** The note's videos with one's transcript set, or taken out. */
export function withTranscript(media: readonly Media[], id: string, lines: TranscriptLine[] | undefined): Media[] {
  return media.map((m) => {
    if (m.id !== id) return m
    const kept = { ...m }
    delete kept.transcript
    return lines ? { ...kept, transcript: lines } : kept
  })
}

/** The words looked for in the transcript (transcript.find, its box), shared: kept while another tab is open. */
export const transcriptFind = new Shared('')
