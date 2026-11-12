// YouTube's player is a frame of another site, spoken to by messages: what it says is read as a few numbers within
// bounds and nothing else, and anything that is not one of its messages is passed over.
import { describe, expect, it } from 'vitest'
import { PLAYER_HOST, playerSaid, youTubeId } from '../src/video/youtube.js'

const message = (event: string, info?: unknown): string => JSON.stringify({ event, info, id: 1, channel: 'widget' })

describe("what YouTube's player says through its frame", () => {
  it('its clock, its speed and its state, as the real player sends them', () => {
    // As the real player answered on 11 November 2026: all it knows at first, then its clock four times a second.
    expect(playerSaid(message('initialDelivery', { currentTime: 0, playerState: 5, playbackRate: 1, videoData: { title: 'A video' }, volume: 100 }))).toEqual({ time: 0, state: 5, rate: 1 })
    expect(playerSaid(message('onReady', null))).toEqual({})
    expect(playerSaid(message('infoDelivery', { currentTime: 83.22 }))).toEqual({ time: 83.22 })
    expect(playerSaid(message('infoDelivery', { playerState: 1, currentTime: 83 }))).toEqual({ time: 83, state: 1 })
    expect(playerSaid(message('onStateChange', 2))).toEqual({ state: 2 })
    expect(playerSaid(message('onStateChange', -1))).toEqual({ state: -1 })
    expect(playerSaid(message('onError', 150))).toEqual({ error: 150 })
  })

  it('passes over what is not one of its messages', () => {
    for (const other of [message('alreadyInitialized', null), message('apiInfoDelivery', { a: 1 }), message('somethingNew', 1), '', 'not json', '[]', 'null', '42', '"onReady"', JSON.stringify({ info: { currentTime: 5 } })]) {
      expect(playerSaid(other), other).toBeUndefined()
    }
    // Only words are read: never an object another page hands over as it is.
    for (const other of [undefined, null, 5, { event: 'onReady' }, ['onReady']]) expect(playerSaid(other)).toBeUndefined()
    expect(playerSaid(`${' '.repeat(1_000_001)}${message('onReady')}`)).toBeUndefined()
  })

  it('takes numbers within bounds and nothing else', () => {
    // A clock that is no time, a state YouTube has none of, words where a number belongs: each is left out.
    for (const info of [{ currentTime: -1 }, { currentTime: 1e12 }, { currentTime: '83' }, { currentTime: null }, { playerState: 9 }, { playerState: 1.5 }, { playerState: '1' }, { playbackRate: -2 }, { playbackRate: 99 }, { currentTime: { valueOf: 1 } }]) {
      expect(playerSaid(message('infoDelivery', info)), JSON.stringify(info)).toEqual({})
    }
    expect(playerSaid('{"event":"infoDelivery","info":{"currentTime":1e400}}')).toEqual({})
    for (const info of ['<img src=x onerror=alert(1)>', { code: 150 }, 7.5, 99, null]) expect(playerSaid(message('onStateChange', info))).toBeUndefined()
    for (const info of ['150', -1, 1e9, { toString: 1 }]) expect(playerSaid(message('onError', info))).toBeUndefined()
    // Nothing but those numbers comes out, whatever else the message carries.
    const said = playerSaid(message('infoDelivery', { currentTime: 1, playerState: 1, playbackRate: 1, videoUrl: 'https://example.com/', __proto__: { polluted: true }, constructor: 'x' }))
    expect(said).toEqual({ time: 1, state: 1, rate: 1 })
    expect(Object.keys(said!).sort()).toEqual(['rate', 'state', 'time'])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('a clock that stands still is told by a speed of nothing', () => {
    expect(playerSaid(message('infoDelivery', { currentTime: 83, playbackRate: 0 }))).toEqual({ time: 83, rate: 0 })
  })
})

describe("the player's address", () => {
  it('is the privacy-enhanced host, and a video is named by eleven plain characters only', () => {
    expect(PLAYER_HOST).toBe('https://www.youtube-nocookie.com')
    expect(youTubeId('https://youtu.be/aircAruvnKk?t=30')).toBe('aircAruvnKk')
    for (const other of ['aircAruvnK', 'aircAruvnKk/../x', 'https://example.com/watch?v=aircAruvnKk', 'https://youtube.com.example.com/watch?v=aircAruvnKk', 'javascript:alert(1)', '"><script>']) expect(youTubeId(other), other).toBeUndefined()
  })
})
