// A stand-in for YouTube's player, so the tests need no network: the page YouTube's frame would hold, speaking the
// words ShellNote exchanges with the real one through the frame (packages/editor/src/video/youtube.ts). Its clock
// stands still, moved by the test alone (it tells a playback rate of 0), so a time read back is exact.
import type { Frame, Page } from '@playwright/test'

/** What a test may ask of the stand-in shown last: its clock and state, moved as a person at the player would. */
export interface StandIn {
  seekTo(seconds: number): void
  pauseVideo(): void
  getCurrentTime(): number
  getPlayerState(): number
  /** Started by its own button, as a person does. */
  tapped(): void
  /** Each time it was cued to start somewhere, and each time it was asked to play, with its clock then. */
  cued: number[]
  played: number[]
}

const STAND_IN = `<!doctype html>
<meta charset="utf-8" />
<title>YouTube video player (stand-in)</title>
<script>
  let state = -1
  let time = 0
  const cued = []
  const played = []
  const tell = (message) => parent.postMessage(JSON.stringify({ ...message, id: 1, channel: 'widget' }), '*')
  const info = () => tell({ event: 'infoDelivery', info: { currentTime: time, playerState: state, playbackRate: 0 } })
  const is = (next) => {
    state = next
    tell({ event: 'onStateChange', info: next })
    info()
  }
  window.player = {
    seekTo: (seconds) => { time = seconds; info() },
    pauseVideo: () => is(2),
    getCurrentTime: () => time,
    getPlayerState: () => state,
    tapped: () => is(1),
    cued,
    played,
  }
  addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (message.event === 'listening') {
      tell({ event: 'initialDelivery', info: { currentTime: time, playerState: state, playbackRate: 0 } })
      tell({ event: 'onReady', info: null })
      return
    }
    if (message.event !== 'command') return
    const [first] = message.args ?? []
    if (message.func === 'seekTo') { time = first; info() }
    if (message.func === 'cueVideoById') { time = first.startSeconds; cued.push(time); is(5) }
    if (message.func === 'playVideo') { played.push(time); is(1) }
    if (message.func === 'pauseVideo') is(2)
  })
</script>
`

/** Where YouTube's player comes from. */
export const PLAYER_HOST = 'https://www.youtube-nocookie.com'

/** Every player's frame holds the stand-in, and nothing is asked of YouTube. */
export async function standInForYouTube(page: Page): Promise<void> {
  await page.route(`${PLAYER_HOST}/embed/**`, (route) => route.fulfill({ contentType: 'text/html', body: STAND_IN }))
}

/** The frame of the player shown last, once its stand-in is there. */
async function playerFrame(page: Page): Promise<Frame> {
  const handle = await page.locator('.nw-video iframe').last().elementHandle()
  const frame = await handle?.contentFrame()
  if (!frame) throw new Error('No player is shown.')
  await frame.waitForFunction(() => 'player' in window)
  return frame
}

/** Something done to, or read from, the stand-in player shown last. */
export async function player<T>(page: Page, act: (player: StandIn) => T): Promise<T> {
  const frame = await playerFrame(page)
  // The function goes as its text, as Playwright sends no function; the stand-in's page has no policy against it.
  return frame.evaluate((code) => new Function('p', `return (${code})(p)`)((window as unknown as { player: StandIn }).player) as T, act.toString())
}
