// YouTube beside a note, through YouTube's own embedded player, as its terms ask: nothing is drawn over the player,
// it is never smaller than 200 by 200, and no video is stored. Its privacy-enhanced host, youtube-nocookie.com, keeps
// cookies off until the video plays.
//
// The player is a frame of YouTube's, and ShellNote talks to it through the frame alone: messages posted to it, and
// its answers heard (the same words YouTube's own IFrame Player API script exchanges with it). No script of YouTube's
// is loaded into ShellNote's page: one would run with all the page's rights, the notes, the keys, and in the desktop
// app every command, and it could change at any time. What comes from the frame is taken as numbers and nothing else.

/** A YouTube video's id from a link or an id as pasted: watch?v=, youtu.be/, shorts/, embed/, live/. */
export function youTubeId(text: string): string | undefined {
  const value = text.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value
  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    return undefined
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  let id: string | undefined
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1]
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined
}

/** The few parts of YouTube's player ShellNote uses. */
export interface YouTubePlayer {
  getCurrentTime(): number
  /** How long the video is, in seconds; 0 until it knows. */
  getDuration?(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  /** Sets where the video will start, when it is started. */
  cueVideoById(options: { videoId: string; startSeconds: number }): void
  playVideo(): void
  pauseVideo(): void
  getPlayerState(): number
  destroy(): void
}

/** YouTube's playing state, and its buffering one: a video loading more to play on. */
export const PLAYING = 1
export const BUFFERING = 3

/**
 * Whether YouTube's player must be started by a tap on its own button, the first time: Apple's rule on an iPad and an iPhone,
 * where a page may not start a video, and a call to play it can leave the player black (YouTube's own documents say as
 * much of mobile browsers). Elsewhere the press on a ⏱ allows it. An iPad's Safari calls itself a Mac; a Mac has no touch.
 */
export const mustTapToStart = (): boolean => /\b(iPad|iPhone|iPod)\b/u.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 0)

/** Where the player's frame comes from: the only site its messages are sent to, and the only one heard. */
export const PLAYER_HOST = 'https://www.youtube-nocookie.com'

/** How often the frame is asked whether it is listening, until it answers (YouTube's own script does the same). */
const ASK_EVERY_MS = 250
/** How far the clock is carried on from the player's last word of it while the video plays, at most, in seconds. */
const CARRY_ON_S = 1

/**
 * The player's own iframe, in place of `element`. It always tells YouTube which site it is on: YouTube's players
 * refuse to play with no referrer ("error 153"), and a page reached some other way (forwarded through a tunnel to a
 * phone, a test iPad, 6 November 2026) may ask for none. `enablejsapi` and `origin` are what YouTube's own documents
 * ask of a player the page talks to: the player answers that origin's messages, and no other's.
 */
function playerFrame(element: HTMLElement, video: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.src = `${PLAYER_HOST}/embed/${encodeURIComponent(video)}?${new URLSearchParams({ enablejsapi: '1', playsinline: '1', rel: '0', origin: location.origin, widgetid: '1' }).toString()}`
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
  frame.allowFullscreen = true
  frame.title = 'YouTube video player'
  frame.width = '100%'
  frame.height = '100%'
  element.replaceWith(frame)
  return frame
}

/** What the player said of itself in one message, as far as ShellNote listens: each part only when it was there. */
export interface PlayerSaid {
  /** Its clock, in seconds. */
  time?: number
  /** How fast it plays: 1 as usual. */
  rate?: number
  /** Its state, as YouTube numbers them: -1 not started, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  state?: number
  /** A fault, by YouTube's number for it. */
  error?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
/** A number within bounds, or nothing. */
const within = (value: unknown, least: number, most: number): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= least && value <= most ? value : undefined)
const stateOf = (value: unknown): number | undefined => (Number.isInteger(value) ? within(value, -1, 5) : undefined)

/**
 * A message from the player's frame, read: what it said, or nothing when it is not one of the player's messages.
 * The frame is another site's, so its words are taken as a few numbers within bounds and nothing else: never as text
 * to show, an address, or anything to act on beyond the clock and the state.
 */
export function playerSaid(data: unknown): PlayerSaid | undefined {
  // The player's first message tells all it knows of the video, some tens of thousands of characters: no more is read.
  if (typeof data !== 'string' || data.length > 1_000_000) return undefined
  let message: unknown
  try {
    message = JSON.parse(data)
  } catch {
    return undefined
  }
  if (!isRecord(message)) return undefined
  const info = message.info
  const said: PlayerSaid = {}
  switch (message.event) {
    case 'onReady':
      return said
    case 'initialDelivery':
    case 'infoDelivery': {
      if (!isRecord(info)) return said
      const [time, rate, state] = [within(info.currentTime, 0, 1e7), within(info.playbackRate, 0, 16), stateOf(info.playerState)]
      if (time !== undefined) said.time = time
      if (rate !== undefined) said.rate = rate
      if (state !== undefined) said.state = state
      return said
    }
    case 'onStateChange': {
      const state = stateOf(info)
      return state === undefined ? undefined : { state }
    }
    case 'onError': {
      const error = within(info, 0, 1000)
      return error === undefined ? undefined : { error }
    }
    default:
      return undefined
  }
}

/**
 * YouTube's player in a frame, spoken to by messages. The frame is asked whether it is listening until it answers;
 * from then on it tells its state and its clock as they change, and takes commands by name. Every message heard is
 * checked: from the player's own site, and from this player's own frame.
 */
class FramePlayer implements YouTubePlayer {
  readonly #frame: HTMLIFrameElement
  readonly #onReady: () => void
  readonly #onError: (code: number) => void
  readonly #onState: (state: number) => void
  #asking: ReturnType<typeof setInterval> | undefined
  #ready = false
  #state = -1
  #time = 0
  #rate = 1
  /** When the player last told its clock, in the page's own milliseconds. */
  #told = 0

  constructor(frame: HTMLIFrameElement, onReady: () => void, onError: (code: number) => void, onState: (state: number) => void) {
    this.#frame = frame
    this.#onReady = onReady
    this.#onError = onError
    this.#onState = onState
    window.addEventListener('message', this.#heard)
    // Asked from the start, and again as the frame's page loads: it answers once its player is there.
    this.#asking = setInterval(() => this.#post({ event: 'listening' }), ASK_EVERY_MS)
    frame.addEventListener('load', () => this.#post({ event: 'listening' }))
  }

  #post(message: Record<string, unknown>): void {
    // To the player's own site only: should the frame have gone elsewhere, the browser delivers nothing.
    this.#frame.contentWindow?.postMessage(JSON.stringify({ ...message, id: 1, channel: 'widget' }), PLAYER_HOST)
  }

  #command(func: string, args: unknown[]): void {
    this.#post({ event: 'command', func, args })
  }

  readonly #heard = (event: MessageEvent): void => {
    // Only the player's own site, and only this player's own frame: any page can post a message to any other.
    if (event.origin !== PLAYER_HOST || event.source !== this.#frame.contentWindow) return
    const said = playerSaid(event.data)
    if (!said) return
    this.#begin()
    if (said.time !== undefined) {
      this.#time = said.time
      this.#told = performance.now()
    }
    if (said.rate !== undefined) this.#rate = said.rate
    if (said.state !== undefined) this.#stateIs(said.state)
    if (said.error !== undefined) this.#onError(said.error)
  }

  /** The player answered: no more asking; its changes of state and its faults are asked for by name. */
  #begin(): void {
    if (this.#ready) return
    this.#ready = true
    clearInterval(this.#asking)
    this.#asking = undefined
    for (const name of ['onStateChange', 'onError']) this.#command('addEventListener', [name])
    this.#onReady()
  }

  #stateIs(state: number): void {
    if (state === this.#state) return
    // The clock carried on while it played stands where it was when it stops.
    this.#time = this.getCurrentTime()
    this.#told = performance.now()
    this.#state = state
    this.#onState(state)
  }

  /** The player's clock: its last word of it, carried on while it plays (it tells it a few times a second). */
  getCurrentTime(): number {
    if (this.#state !== PLAYING) return this.#time
    return this.#time + Math.min(CARRY_ON_S, Math.max(0, (performance.now() - this.#told) / 1000) * this.#rate)
  }

  seekTo(seconds: number, allowSeekAhead: boolean): void {
    // Known at once, as YouTube's own script has it only once the player answers: a line written the next moment
    // keeps the time asked for.
    this.#time = Math.max(0, seconds)
    this.#told = performance.now()
    this.#command('seekTo', [seconds, allowSeekAhead])
  }

  cueVideoById(options: { videoId: string; startSeconds: number }): void {
    this.#time = Math.max(0, options.startSeconds)
    this.#told = performance.now()
    this.#command('cueVideoById', [options])
  }

  playVideo(): void {
    this.#command('playVideo', [])
  }

  pauseVideo(): void {
    this.#command('pauseVideo', [])
  }

  getPlayerState(): number {
    return this.#state
  }

  destroy(): void {
    clearInterval(this.#asking)
    this.#asking = undefined
    window.removeEventListener('message', this.#heard)
    this.#frame.remove()
  }
}

/** A player in place of `element`, at the privacy-enhanced host. */
export async function youTubePlayer(element: HTMLElement, video: string, onReady: (player: YouTubePlayer) => void, onError: (message: string) => void, onState: (state: number) => void): Promise<YouTubePlayer> {
  const player: YouTubePlayer = new FramePlayer(
    playerFrame(element, video),
    () => onReady(player),
    (code) => onError(code === 101 || code === 150 ? 'This video’s owner does not let it play outside YouTube.' : 'This video could not be played.'),
    onState,
  )
  return player
}
