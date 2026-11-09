// YouTube beside a note, through YouTube's own embedded player and its
// IFrame Player API, as its terms ask: nothing is drawn over the player, it is never smaller than 200 by 200, and no
// video is stored. Its privacy-enhanced host, youtube-nocookie.com, keeps cookies off until the video plays.

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
  seekTo(seconds: number, allowSeekAhead: boolean): void
  /** Sets where the video will start, when it is started. */
  cueVideoById(options: { videoId: string; startSeconds: number }): void
  playVideo(): void
  pauseVideo(): void
  getPlayerState(): number
  destroy(): void
}
interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: { host: string; videoId: string; width: string; height: string; playerVars: Record<string, number>; events: { onReady: () => void; onError: (event: { data: number }) => void; onStateChange: (event: { data: number }) => void } },
  ) => YouTubePlayer
}
declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
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

let loading: Promise<YouTubeApi> | undefined

/** YouTube's player API, loaded once, from YouTube. */
export function youTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  loading ??= new Promise<YouTubeApi>((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      before?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      loading = undefined
      script.remove()
      reject(new Error('YouTube could not be reached. Check the internet connection.'))
    }
    document.head.append(script)
  })
  return loading
}

/**
 * The player's own iframe, in place of `element`. Made here rather than by YouTube's API so that it always tells YouTube
 * which site it is on: YouTube's players refuse to play with no referrer ("error 153"), and a page reached some other way
 * (forwarded through a tunnel to a phone, a test iPad, 6 November 2026) may ask for none. `origin` is what YouTube's own
 * documents ask of a player the page talks to.
 */
function playerFrame(element: HTMLElement, video: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video)}?${new URLSearchParams({ enablejsapi: '1', playsinline: '1', rel: '0', origin: location.origin }).toString()}`
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
  frame.allowFullscreen = true
  frame.title = 'YouTube video player'
  frame.width = '100%'
  frame.height = '100%'
  element.replaceWith(frame)
  return frame
}

/** A player in place of `element`, at the privacy-enhanced host. */
export async function youTubePlayer(element: HTMLElement, video: string, onReady: (player: YouTubePlayer) => void, onError: (message: string) => void, onState: (state: number) => void): Promise<YouTubePlayer> {
  const api = await youTubeApi()
  const player: YouTubePlayer = new api.Player(playerFrame(element, video), {
    host: 'https://www.youtube-nocookie.com',
    videoId: video,
    width: '100%',
    height: '100%',
    playerVars: { playsinline: 1, rel: 0 },
    events: {
      onReady: () => onReady(player),
      onStateChange: (event) => onState(event.data),
      onError: (event) => onError(event.data === 101 || event.data === 150 ? 'This video’s owner does not let it play outside YouTube.' : 'This video could not be played.'),
    },
  })
  return player
}
