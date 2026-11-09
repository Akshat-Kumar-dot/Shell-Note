// The side panel's tabs as commands (app control, step 3c, part 2): a video's
// transcript, the web page and Output's two views; each does what its button
// did, and the buttons call them. Left to the person: the YouTube key, typed or
// forgotten in Description (the agent never handles a key), and the links that
// open YouTube or a page in the browser.
import { workspace as layout } from '../layout/state.js'
import { outputViewNow, showOutputView } from '../layout/side/OutputTab.js'
import { showSideTab, sideTab } from '../layout/sideTab.js'
import { NOT_WEB, showWebPage, webAddress, webPage } from '../layout/side/web.js'
import type { EditorStore } from '../store.js'
import { videoShown } from '../video/state.js'
import { transcriptFind, transcriptOf, withTranscript } from '../video/transcript.js'
import type { By, Commands } from './run.js'
import { videoName } from './video.js'

export const NO_TIMES = 'No times found. Paste the transcript with its times, as YouTube shows it, or a subtitle file.'
const READ_ONLY = 'This note is read-only here: it is being edited in another window.'

/** The video shown, which the transcript belongs to. */
function shownVideo(store: EditorStore) {
  const media = (store.doc.media ?? []).find((item) => item.id === videoShown.value)
  if (!media) throw new Error('No video is shown: its transcript goes with the video shown (video.show).')
  return media
}

const origin = (by: By): 'terminal' | 'toolbar' => (by === 'agent' ? 'terminal' : 'toolbar')

export function defineSide(commands: Commands): void {
  commands.define('transcript.paste', ['note', 'workspace'], ({ transcript }, { note: { store }, workspace }, by) => {
    if (!workspace.editing()) throw new Error(READ_ONLY)
    const media = shownVideo(store)
    const lines = transcriptOf(String(transcript))
    if (lines.length === 0) throw new Error(NO_TIMES)
    store.apply([{ op: 'update', id: store.doc.id, set: { media: withTranscript(store.doc.media ?? [], media.id, lines) } }], { origin: origin(by) })
    if (by === 'agent') showSideTab('transcript')
    return `a transcript of ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} kept with "${videoName(media)}"`
  })
  commands.define('transcript.find', ['note', 'workspace'], ({ text }, { note: { store } }, by) => {
    const words = String(text)
    transcriptFind.set(words)
    if (by === 'agent') showSideTab('transcript')
    const lines = (store.doc.media ?? []).find((item) => item.id === videoShown.value)?.transcript
    if (words.trim() === '') return 'finding nothing: the whole transcript is listed'
    if (!lines) return `finding "${words.trim()}"; the video shown has no transcript yet`
    const wanted = words.trim().toLowerCase()
    const found = lines.filter((line) => line.text.toLowerCase().includes(wanted)).length
    return `finding "${words.trim()}": ${found} ${found === 1 ? 'line' : 'lines'}`
  })
  commands.define('transcript.remove', ['note', 'workspace'], (_, { note: { store }, workspace }, by) => {
    if (!workspace.editing()) throw new Error(READ_ONLY)
    const media = shownVideo(store)
    if (!media.transcript) return `"${videoName(media)}" has no transcript`
    store.apply([{ op: 'update', id: store.doc.id, set: { media: withTranscript(store.doc.media ?? [], media.id, undefined) } }], { origin: origin(by) })
    return `the transcript of "${videoName(media)}" taken out; edit.undo brings it back`
  })
  commands.define('web.open', ['workspace'], ({ link }, _, by) => {
    const address = webAddress(String(link))
    if (!address) throw new Error(NOT_WEB)
    showWebPage(address)
    if (by === 'agent') showSideTab('web')
    return `${address} shown in the side panel; a site that refuses to be shown inside another page stays blank`
  })
  commands.define('output.answers', ['workspace'], () => {
    showOutputView('answers')
    showSideTab('output')
    return "Output: the AI's answers and its log"
  })
  commands.define('output.made', ['workspace'], () => {
    showOutputView('made')
    showSideTab('output')
    return 'Output: what the AI made, on the scratch pad'
  })
}

/** The side panel's line of the app-state map, while it is open: what its tab shows. */
export function sideLine(store: EditorStore | undefined): string | undefined {
  if (!layout.value.side) return undefined
  const tab = sideTab.value
  if (tab === 'web') return `side panel, web page: ${webPage.value ?? 'none yet'}`
  if (tab === 'output') return `side panel, Output: ${outputViewNow() === 'made' ? 'what the AI made' : "the AI's answers and log"}`
  if (tab === 'transcript') {
    const media = (store?.doc.media ?? []).find((item) => item.id === videoShown.value)
    if (!media) return 'side panel, transcript: no video shown'
    const lines = media.transcript?.length
    const finding = transcriptFind.value.trim() === '' ? '' : `, finding "${transcriptFind.value.trim()}"`
    return `side panel, transcript of "${videoName(media)}": ${lines === undefined ? 'none yet' : `${lines} lines`}${finding}`
  }
  return undefined
}
