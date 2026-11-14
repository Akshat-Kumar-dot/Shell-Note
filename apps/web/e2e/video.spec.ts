// The video beside a note: a YouTube link, in a stand-in for YouTube's player (youtube.ts) so
// the test needs no network, or a video file of one's own; beside the note, above or below it with the note moved
// aside, or floating over it; one player throughout; Play and the pause key; an edge dragged, its size kept.
import { readFileSync } from 'node:fs'
import { expect, inApp, test, type Page } from './fixtures.js'
import { player, standInForYouTube } from './youtube.js'
import { chooseTool, expectVideoAt, openPart, openVideoMenu, videoPlace } from './shell.js'

test.use({ viewport: { width: 1280, height: 900 } })

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number }

test.beforeEach(async ({ page }) => {
  await standInForYouTube(page)
})

function box(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).first().evaluate((element) => {
    const r = element.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
  })
}

/** YouTube's player, under the panel's bar, is never smaller than 200 by 200 (its terms). */
async function bigEnough(page: Page): Promise<void> {
  const player = await box(page, '.nw-video-body')
  expect(player.width).toBeGreaterThanOrEqual(200)
  expect(player.height).toBeGreaterThanOrEqual(200)
}

/** A short word written with the pen, as a hand writes: three strokes like a w, 24 pixels tall. */
async function writeWord(page: Page, x: number, y: number): Promise<void> {
  for (let k = 0; k < 3; k++) {
    const x0 = x + k * 26
    await page.mouse.move(x0, y)
    await page.mouse.down()
    for (const [dx, dy] of [[4, 24], [8, 0], [12, 24], [16, 0]] as const) await page.mouse.move(x0 + dx, y + dy, { steps: 4 })
    await page.mouse.up()
  }
}

function media(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__shellnote!.doc.media)
}

async function openNote(page: Page): Promise<void> {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
}

/** A three-second WebM video, 160 by 90, a square moving across (made with OpenCV; headless Edge records no canvas). */
const WEBM = readFileSync(new URL('./fixtures/moving-square.webm', import.meta.url))

test('a YouTube link shows inside Beside; taken out it goes left, right, above or below the note, or floats over it, and back inside; one player throughout', async ({ page }) => {
  await openNote(page)
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('https://youtu.be/aircAruvnKk?t=30')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.poll(() => media(page)).toEqual([{ id: expect.stringMatching(/^[A-Za-z0-9]{8}$/), kind: 'youtube', video: 'aircAruvnKk' }])

  // YouTube's own player, at its privacy-enhanced host; nothing of ours over it.
  const frame = page.locator('.nw-video iframe')
  await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/aircAruvnKk\?/u)
  await frame.evaluate((element) => (element.dataset.mark = 'the same player'))

  // Inside Beside, as the design has it: in the panel right of the note, under its head, over its parts.
  const inside = async (): Promise<void> => {
    const side = await box(page, '.nw-dock-panel[data-panel="side"]')
    const video = await box(page, '.nw-video')
    expect(video.left).toBeGreaterThanOrEqual(side.left)
    expect(video.right).toBeLessThanOrEqual(side.right)
    expect(video.top).toBeGreaterThan(side.top)
    expect((await box(page, '.pages-area')).right).toBeLessThanOrEqual(side.left + 1)
    await bigEnough(page)
  }
  await inside()
  await expectVideoAt(page, 'Video inside the Beside panel')

  // Taken out on the left: the notes start where the video ends.
  await videoPlace(page, 'Video on the left')
  let video = await box(page, '.nw-video')
  let note = await box(page, '.pages-area')
  expect(video.right).toBeLessThanOrEqual(note.left + 1)
  await bigEnough(page)

  // On the right: the note ends where the video starts.
  await videoPlace(page, 'Video on the right')
  video = await box(page, '.nw-video')
  note = await box(page, '.pages-area')
  expect(note.right).toBeLessThanOrEqual(video.left + 1)
  await bigEnough(page)

  await videoPlace(page, 'Video above')
  video = await box(page, '.nw-video')
  note = await box(page, '.pages-area')
  await bigEnough(page)
  expect(video.bottom).toBeLessThanOrEqual(note.top + 1)

  await videoPlace(page, 'Video below')
  video = await box(page, '.nw-video')
  note = await box(page, '.pages-area')
  expect(video.top).toBeGreaterThanOrEqual(note.bottom - 1)
  await bigEnough(page)

  await videoPlace(page, 'Video floating over the note')
  video = await box(page, '.nw-video')
  note = await box(page, '.pages-area')
  expect(video.left).toBeGreaterThan(note.left)
  expect(video.right).toBeLessThan(note.right)
  await bigEnough(page)
  // Over the note, and nothing over the player.
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.nw-video') !== null, [video.left + video.width / 2, video.top + video.height / 2])
  expect(top).toBe(true)
  await expectVideoAt(page, 'Video floating over the note')

  // Back inside Beside, the notes as wide as before it came out.
  const before = (await box(page, '.pages-area')).width
  await videoPlace(page, 'Video inside the Beside panel')
  await inside()
  expect((await box(page, '.pages-area')).width).toBeGreaterThanOrEqual(before - 1)

  // Moved about, the player was never made again: a playing video plays on.
  await expect(frame).toHaveAttribute('data-mark', 'the same player')
  // Kept for the next time.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shellnote:workspace-2')!).beside.video)).toBe(true)
})

test('Play plays the video and Ctrl+Shift+Space pauses it while the pen writes; Close closes the panel, the video stays in the note', async ({ page }) => {
  await openNote(page)
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('aircAruvnKk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Play the video' }).click()
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
  // The pen is in the note, not the panel: the key works from anywhere.
  await page.locator('.nw-desk').click({ position: { x: 30, y: 300 } })
  await page.keyboard.press('Control+Shift+Space')
  await expect(page.getByRole('button', { name: 'Play the video' })).toBeVisible()
  await page.keyboard.press('Control+Shift+Space')
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()

  await page.getByRole('button', { name: 'Close the video' }).click()
  await expect(page.locator('.nw-video')).toHaveCount(0)
  expect(await media(page)).toHaveLength(1)
  // Shown again from the Video menu.
  await openVideoMenu(page)
  await page.getByRole('button', { name: 'YouTube aircAruvnKk', exact: true }).click()
  await expect(page.locator('.nw-video iframe')).toBeVisible()
})

test('a menu opened over the YouTube player makes it step aside, paused and hidden, and it plays on when the menu closes (YouTube terms)', async ({ page }) => {
  await openNote(page)
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('aircAruvnKk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Play the video' }).click()
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()

  // The Video menu, at Beside's head, drops down over the player inside it.
  await openVideoMenu(page)
  const menu = await box(page, '.nw-video-menu')
  const player = await box(page, '.nw-video-body')
  expect(menu.bottom > player.top && menu.left < player.right && menu.right > player.left).toBe(true)
  await expect(page.locator('.nw-video-player')).toHaveCSS('visibility', 'hidden')
  await expect(page.locator('.nw-video-aside')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play the video' })).toBeDisabled()
  // The pause key does not start a hidden player.
  await page.keyboard.press('Control+Shift+Space')
  await expect(page.getByRole('button', { name: 'Play the video' })).toBeDisabled()

  await page.keyboard.press('Escape')
  await expect(page.locator('.nw-video-menu')).toHaveCount(0)
  await expect(page.locator('.nw-video-player')).toHaveCSS('visibility', 'visible')
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
})

test('a link that is not YouTube says so and adds nothing', async ({ page }) => {
  await openNote(page)
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('https://example.com/watch?v=aircAruvnKk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not a YouTube link')
  expect(await media(page)).toBeUndefined()
})

test('a video file of ones own is kept with the note and plays in the panel; its edge drags, kept; taken out, its bytes go, and undo brings both back', async ({ page }) => {
  await openNote(page)
  const bytes = WEBM
  await openVideoMenu(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add a video file (MP4, WebM)' }).click()
  await (await chooser).setFiles({ name: 'my lecture.webm', mimeType: 'video/webm', buffer: bytes })
  await expect.poll(() => media(page)).toEqual([{ id: expect.any(String), kind: 'file', asset: expect.stringMatching(/^[0-9a-f]{64}$/), name: 'my lecture.webm' }])
  const [item] = (await media(page)) as { asset: string }[]
  expect(await page.evaluate((hash) => window.__shellnote!.doc.asset[hash], item!.asset)).toEqual({ mime: 'video/webm', bytes: bytes.length })

  // The browser plays it.
  const player = page.locator('.nw-video-file video')
  await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1)
  await page.getByRole('button', { name: 'Play the video' }).click()
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
  await page.keyboard.press('Control+Shift+Space')
  await expect(page.getByRole('button', { name: 'Play the video' })).toBeVisible()
  expect(await player.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)

  // The edge between the notes and Beside, dragged 150 pixels toward the notes: the video inside it wider by as much, and kept.
  const before = await box(page, '.nw-video')
  const edge = await box(page, '.nw-dock-splitter[data-dir="row"]')
  await page.mouse.move(edge.left + edge.width / 2, edge.top + 200)
  await page.mouse.down()
  await page.mouse.move(edge.left + edge.width / 2 - 75, edge.top + 200, { steps: 4 })
  await page.mouse.move(edge.left + edge.width / 2 - 150, edge.top + 200, { steps: 4 })
  await page.mouse.up()
  const after = await box(page, '.nw-video')
  expect(after.width - before.width).toBeGreaterThan(144)
  expect(after.width - before.width).toBeLessThan(156)
  expect((await box(page, '.pages-area')).right).toBeLessThanOrEqual(after.left)
  // Kept for the next time: the notes' share against the panel's is no longer the start's 0.69 (the root also keeps the
  // program panel's share, shown in the app on Windows only).
  const kept = await page.evaluate(() => {
    const [notes, side] = JSON.parse(localStorage.getItem('shellnote:workspace-2')!).layout.root.sizes as number[]
    return notes! / (notes! + side!)
  })
  expect(kept).not.toBeCloseTo(0.69, 2)

  // Dragged as far as it goes, the notes keep room to write in.
  await page.mouse.move(after.right, edge.top + 200)
  await page.mouse.down()
  await page.mouse.move(1275, edge.top + 200, { steps: 6 })
  await page.mouse.up()
  expect((await box(page, '.pages-area')).width).toBeGreaterThanOrEqual(236)

  await openVideoMenu(page)
  await page.getByRole('button', { name: 'Take my lecture.webm out of the note' }).click()
  await expect(page.locator('.nw-video')).toHaveCount(0)
  expect(await media(page)).toBeUndefined()
  expect(await page.evaluate(() => Object.keys(window.__shellnote!.doc.asset))).toEqual([])
  await page.locator('.nw-desk').click({ position: { x: 30, y: 300 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => media(page)).toHaveLength(1)
  expect(await page.evaluate(() => Object.keys(window.__shellnote!.doc.asset))).toEqual([item!.asset])
})

test('ones own video is cropped by a box moved and sized over it: the part kept shows in its own shape, with a seek bar; Whole video takes it off, one undo step each', async ({ page }) => {
  await openNote(page)
  await openVideoMenu(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add a video file (MP4, WebM)' }).click()
  await (await chooser).setFiles({ name: 'square.webm', mimeType: 'video/webm', buffer: WEBM })
  await expect.poll(() => page.locator('.nw-video-file video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1)
  // YouTube's videos have no crop; one's own files do.
  await page.getByRole('button', { name: 'Crop the video' }).click()
  const whole = await box(page, '.nw-crop-box')
  // The corner grips show whole, inside the panel.
  const grip = await box(page, '.nw-crop-grip[data-corner="se"]')
  expect(grip.right).toBeLessThanOrEqual((await box(page, '.nw-video-body')).right)

  // The bottom-right corner to the middle: half the video each way. Then the box a quarter across and down.
  await page.mouse.move(grip.left + grip.width / 2, grip.top + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(whole.left + whole.width / 2, whole.top + whole.height / 2, { steps: 5 })
  await page.mouse.up()
  const half = await box(page, '.nw-crop-box')
  await page.mouse.move(half.left + half.width / 2, half.top + half.height / 2)
  await page.mouse.down()
  await page.mouse.move(half.left + half.width / 2 + whole.width / 4, half.top + half.height / 2 + whole.height / 4, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Done', exact: true }).click()

  const crop = await page.evaluate(() => (window.__shellnote!.doc.media![0] as { crop?: { x: number; y: number; w: number; h: number } }).crop)
  for (const [key, value] of Object.entries({ x: 250, y: 250, w: 500, h: 500 })) expect(Math.abs(crop![key as 'x'] - value), key).toBeLessThanOrEqual(10)
  // The part kept in its own shape (the video is 160 by 90), the video made twice as big behind it, and a seek bar.
  const frame = await box(page, '.nw-video-frame')
  expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1)
  expect(await page.locator('.nw-video-file video').evaluate((video: HTMLVideoElement) => video.controls)).toBe(false)
  expect(Math.round((await box(page, '.nw-video-file video')).width / frame.width)).toBe(2)
  await expect(page.getByLabel('Where in the video')).toBeVisible()

  await page.getByRole('button', { name: 'Crop the video' }).click()
  await page.getByRole('button', { name: 'Whole video', exact: true }).click()
  await expect.poll(() => page.evaluate(() => 'crop' in window.__shellnote!.doc.media![0]!)).toBe(false)
  await expect(page.getByLabel('Where in the video')).toHaveCount(0)
  await page.locator('.nw-desk').click({ position: { x: 30, y: 300 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => 'crop' in window.__shellnote!.doc.media![0]!)).toBe(true)
})

test('a stroke written beside a playing video keeps its time; the ⏱ beside the line plays the video from there, opening the panel if it is closed', async ({ page }) => {
  await openNote(page)
  // The Pen first: its panel closed before the video is beside the note.
  await chooseTool(page, 'pen')
  await page.keyboard.press('Escape')
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('aircAruvnKk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Play the video' }).click()
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
  await player(page, (p) => p.seekTo(83))

  // A word written 1 minute 23 seconds in.
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  const [x, y] = [sheet.x + 120, sheet.y + 220]
  await writeWord(page, x, y)
  const id = await page.evaluate(() => window.__shellnote!.doc.media![0]!.id)
  await expect.poll(() => page.evaluate(() => Object.values(window.__shellnote!.doc.block).flatMap((b) => (b.type === 'ink' ? b.strokes.map((s) => s.vt) : [])))).toEqual([1, 2, 3].map(() => ({ m: id, t: 830 })))

  // Beside the line, its time; tapped with the video elsewhere and paused, it plays from there.
  const mark = page.getByRole('button', { name: 'Play the video from 1:23' })
  await expect(mark).toBeVisible()
  expect((await mark.boundingBox())!.x + (await mark.boundingBox())!.width).toBeLessThan(x)
  await player(page, (p) => {
    p.pauseVideo()
    p.seekTo(5)
  })
  await mark.click()
  await expect.poll(() => player(page, (p) => p.getCurrentTime())).toBe(83)
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
  // The ⏱ was pressed, not written on.
  expect(await page.evaluate(() => Object.values(window.__shellnote!.doc.block).flatMap((b) => (b.type === 'ink' ? b.strokes : [])).length)).toBe(3)

  // With the panel closed, a tap opens it, and the new player starts from there once ready.
  await page.getByRole('button', { name: 'Close the video' }).click()
  await mark.click()
  await expect(page.locator('.nw-video iframe')).toBeVisible()
  await expect.poll(() => player(page, (p) => p.getCurrentTime())).toBe(83)
  await expect.poll(() => player(page, (p) => p.getPlayerState())).toBe(1)
})

test('a hard part marked from the panel becomes a ▶ right of the writing: a tap plays it and pauses at its end; dragged, it moves; × takes it out; one undo step each', async ({ page }) => {
  await openNote(page)
  await chooseTool(page, 'pen')
  await page.keyboard.press('Escape')
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('aircAruvnKk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Play the video' }).click()
  await player(page, (p) => p.seekTo(60))
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  const [x, y] = [sheet.x + 120, sheet.y + 220]
  await writeWord(page, x, y)

  // Marked from 1:05 to 1:20: the first press its start, the second its end.
  await player(page, (p) => p.seekTo(65))
  await page.getByRole('button', { name: 'Mark a hard part' }).click()
  await player(page, (p) => p.seekTo(80))
  await page.getByRole('button', { name: 'End the hard part begun at 1:05' }).click()
  const [id, pageId] = await page.evaluate(() => [window.__shellnote!.doc.media![0]!.id, window.__shellnote!.doc.pages[0]!])
  const clips = () => page.evaluate(() => window.__shellnote!.doc.clips)
  await expect.poll(clips).toEqual([{ id: expect.any(String), media: id, from: 650, to: 800, page: pageId, x: expect.any(Number), y: expect.any(Number) }])
  const mark = page.getByRole('button', { name: 'Play the hard part, 1:05 to 1:20' })
  const at = (await mark.boundingBox())!
  // Right of the line written, level with it.
  expect(at.x).toBeGreaterThan(x + 60)
  expect(Math.abs(at.y + at.height / 2 - y)).toBeLessThan(20)

  // Tapped with the video elsewhere and paused: it plays the part, and pauses at its end.
  await player(page, (p) => {
    p.pauseVideo()
    p.seekTo(5)
  })
  await mark.click()
  await expect.poll(() => player(page, (p) => p.getCurrentTime())).toBe(65)
  await expect.poll(() => player(page, (p) => p.getPlayerState())).toBe(1)
  await player(page, (p) => p.seekTo(80.5))
  await expect.poll(() => player(page, (p) => p.getPlayerState())).toBe(2)

  // Dragged 100 pixels down: moved, not played, and nothing written.
  const before = ((await clips()) as { y: number }[])[0]!.y
  await page.mouse.move(at.x + at.width / 3, at.y + at.height / 2)
  await page.mouse.down()
  await page.mouse.move(at.x + at.width / 3, at.y + at.height / 2 + 50, { steps: 4 })
  await page.mouse.move(at.x + at.width / 3, at.y + at.height / 2 + 100, { steps: 4 })
  await page.mouse.up()
  const per = await page.evaluate(() => {
    const doc = window.__shellnote!.doc
    return doc.page[doc.pages[0]!]!.w / document.querySelector('.nw-page')!.getBoundingClientRect().width
  })
  await expect.poll(async () => ((await clips()) as { y: number }[])[0]!.y - before).toBeGreaterThan(100 * per - 30)
  expect(((await clips()) as { y: number }[])[0]!.y - before).toBeLessThan(100 * per + 30)
  await expect.poll(() => player(page, (p) => p.getPlayerState())).toBe(2)
  expect(await page.evaluate(() => Object.values(window.__shellnote!.doc.block).flatMap((b) => (b.type === 'ink' ? b.strokes : [])).length)).toBe(3)

  await mark.hover()
  await page.getByRole('button', { name: 'Take out the mark at 1:05' }).click()
  await expect.poll(clips).toBeUndefined()
  await page.keyboard.press('Control+z')
  await expect.poll(async () => ((await clips()) as unknown[] | undefined)?.length).toBe(1)
})

/** Sharing the screen and recording it, stood in for: headless Edge can share no tab. The recording is the test video. */
const FAKE_CAPTURE = `(() => {
  const bytes = Uint8Array.from(atob('${WEBM.toString('base64')}'), (c) => c.charCodeAt(0))
  window.__capture = {}
  window.RestrictionTarget = { fromElement: async (element) => ({ element }) }
  navigator.mediaDevices.getDisplayMedia = async (options) => {
    window.__capture.options = options
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const stream = canvas.captureStream(1)
    const track = stream.getVideoTracks()[0]
    track.restrictTo = async (target) => { window.__capture.element = target.element }
    window.__capture.track = track
    return stream
  }
  window.MediaRecorder = class {
    constructor(stream, options) { this.state = 'inactive'; window.__capture.type = options.mimeType }
    static isTypeSupported(type) { return type.startsWith('video/webm') }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob([bytes], { type: 'video/webm' }) })
      setTimeout(() => this.onstop?.(), 0)
    }
  }
})()`

test.describe('recording the note as it is written', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(FAKE_CAPTURE)
  })

  test('only the desk is recorded, with no sound, never a video beside it; Stop, or the browser ending the sharing, keeps the recording in the note and leaves the panel be', async ({ page }) => {
    await openNote(page)
    await openVideoMenu(page)
    await page.getByLabel('YouTube link').fill('aircAruvnKk')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await videoPlace(page, 'Video floating over the note')

    await openVideoMenu(page)
    await page.getByRole('button', { name: 'Record this note as you write' }).click()
    const stop = page.getByRole('button', { name: /^Stop recording/ })
    await expect(stop).toBeVisible()
    const asked = await page.evaluate(() => {
      const capture = (window as unknown as { __capture: { options: { audio: boolean; preferCurrentTab: boolean }; element: Element } }).__capture
      return { audio: capture.options.audio, thisTab: capture.options.preferCurrentTab, desk: capture.element.classList.contains('nw-desk'), panelOutside: !capture.element.contains(document.querySelector('.nw-video')), isolated: getComputedStyle(capture.element).isolation }
    })
    expect(asked).toEqual({ audio: false, thisTab: true, desk: true, panelOutside: true, isolated: 'isolate' })

    await stop.click()
    const files = () => page.evaluate(() => (window.__shellnote!.doc.media ?? []).filter((m) => m.kind === 'file') as { name: string; asset: string }[])
    await expect.poll(async () => (await files()).length).toBe(1)
    const [kept] = await files()
    expect(kept!.name).toMatch(/^Recording .+\.webm$/)
    expect(await page.evaluate((hash) => window.__shellnote!.doc.asset[hash], kept!.asset)).toEqual({ mime: 'video/webm', bytes: WEBM.length })
    // The YouTube video still shown; the desk as it was.
    await expect(page.locator('.nw-video iframe')).toBeVisible()
    await expect(page.locator('.nw-desk[data-recording]')).toHaveCount(0)
    await expect(stop).toHaveCount(0)

    // The browser's own Stop sharing ends it too.
    await openVideoMenu(page)
    await page.getByRole('button', { name: 'Record this note as you write' }).click()
    await expect(stop).toBeVisible()
    await page.evaluate(() => (window as unknown as { __capture: { track: MediaStreamTrack } }).__capture.track.dispatchEvent(new Event('ended')))
    await expect(stop).toHaveCount(0)
    await expect.poll(async () => (await files()).length).toBe(2)
  })

  test('a browser that cannot record the note alone says so, and the button is off', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { RestrictionTarget?: unknown }).RestrictionTarget
    })
    await openNote(page)
    await openVideoMenu(page)
    await expect(page.getByRole('button', { name: 'Record this note as you write' })).toBeDisabled()
    await expect(page.getByText('Recording only the note needs Edge or Chrome 132 or later')).toBeVisible()
  })
})

test('floating, the video is sized from each of its four edges and four corners', async ({ page }) => {
  await openNote(page)
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('aircAruvnKk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await videoPlace(page, 'Video floating over the note')
  // Grab a grip's middle and move it; the panel as it then is.
  const pull = async (grip: string, dx: number, dy: number): Promise<Box> => {
    const g = await box(page, `.nw-video-grip[data-grip="${grip}"]`)
    await page.mouse.move(g.left + g.width / 2, g.top + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.left + g.width / 2 + dx, g.top + g.height / 2 + dy, { steps: 4 })
    await page.mouse.up()
    return box(page, '.nw-video')
  }
  let before = await box(page, '.nw-video')
  // The top-left corner up and to the left: the panel grows that way, its bottom-right corner where it was.
  let after = await pull('nw', -30, -20)
  expect([after.left - before.left, after.top - before.top, after.right - before.right, after.bottom - before.bottom].map(Math.round)).toEqual([-30, -20, 0, 0])
  before = after
  after = await pull('e', 40, 0)
  expect([after.left - before.left, after.right - before.right, after.height - before.height].map(Math.round)).toEqual([0, 40, 0])
  before = after
  after = await pull('n', 0, 25)
  expect([after.top - before.top, after.bottom - before.bottom].map(Math.round)).toEqual([25, 0])
  before = after
  after = await pull('sw', 20, 30)
  expect([after.left - before.left, after.bottom - before.bottom, after.right - before.right].map(Math.round)).toEqual([20, 30, 0])
  // Never smaller than YouTube's 200 by 200 for the player.
  await pull('se', -1000, -1000)
  await bigEnough(page)
})

test.describe('on an iPad', () => {
  test.skip(inApp, 'only a browser can be an iPad: the app’s web view keeps its own user agent')
  // An iPad's Safari calls itself a Mac; it is known by its touch.
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', hasTouch: true, viewport: { width: 1180, height: 820 } })

  // A test iPad, 6 November 2026: a ⏱ did not play. A page may not start a video there: only a tap on the player's own button.
  test('a ⏱ sets where the tap on YouTube’s button will start, and says so; once it has played, a ⏱ plays', async ({ page }) => {
    await openNote(page)
    await chooseTool(page, 'pen')
    await page.keyboard.press('Escape')
    await openVideoMenu(page)
    await page.getByLabel('YouTube link').fill('aircAruvnKk')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const facts = () => player(page, (p) => ({ cued: p.cued, played: p.played, time: p.getCurrentTime() }))
    // Asked to play before any tap: told to tap, never played.
    await page.getByRole('button', { name: 'Play the video' }).click()
    await expect(page.locator('.nw-video-tap')).toContainText('Tap ▶ on the video')
    expect((await facts()).played).toEqual([])
    // Started by its own button, as a person does: from here on it obeys.
    await player(page, (p) => p.tapped())
    await expect(page.locator('.nw-video-tap')).toHaveCount(0)
    await player(page, (p) => p.seekTo(83))
    const sheet = (await page.locator('.nw-page').first().boundingBox())!
    await writeWord(page, sheet.x + 110, sheet.y + 160)
    const mark = page.getByRole('button', { name: /^Play the video from 1:23/u })
    await expect(mark).toBeVisible()
    await player(page, (p) => p.seekTo(10))
    await mark.click()
    await expect.poll(async () => (await facts()).time).toBe(83)
    expect((await facts()).played.length).toBeGreaterThan(0)

    // Closed and opened again by the ⏱: a new player, which again only a tap can start, set to begin at the mark.
    await page.getByRole('button', { name: 'Close the video' }).click()
    await expect(page.locator('.nw-video')).toHaveCount(0)
    await mark.click()
    await expect(page.locator('.nw-video-tap')).toContainText('from 1:23')
    await expect.poll(async () => (await facts()).cued).toEqual([83])
    expect((await facts()).played).toEqual([])
  })
})

test.describe('on a phone upright', () => {
  test.skip(inApp, 'only a browser can be a phone: the app’s window is at least 480 pixels across')

  test.use({ viewport: { width: 390, height: 800 } })

  // A test phone, 6 November 2026: a ⏱ tapped "does not automatically open". Beside the notes the video's share was 156
  // pixels, too small for YouTube's player, which plays at no less than 200.
  test('the video shows inside Beside under the note, the whole width, big enough to play, and a ⏱ opens it with the panel closed', async ({ page }) => {
    await openNote(page)
    await chooseTool(page, 'pen')
    await page.keyboard.press('Escape')
    await openVideoMenu(page)
    await page.getByLabel('YouTube link').fill('aircAruvnKk')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: 'Play the video' }).click()
    await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
    await bigEnough(page)
    const panel = await box(page, '.nw-video')
    expect(panel.width).toBeGreaterThanOrEqual(380)
    // At this width the buttons keep their size, that of where it sits too.
    expect(await page.getByRole('button', { name: 'Where the video sits' }).evaluate((button) => button.getBoundingClientRect().width)).toBeGreaterThanOrEqual(30)
    // Its buttons all inside it, none out of reach (found 6 November 2026: Close lay past the panel's edge).
    expect(await page.locator('.nw-video-caption').evaluate((bar) => {
      const edge = bar.getBoundingClientRect()
      return [...bar.querySelectorAll('button')].filter((button) => button.getBoundingClientRect().right > edge.right + 0.5 || button.getBoundingClientRect().left < edge.left - 0.5).map((button) => button.getAttribute('aria-label'))
    })).toEqual([])
    await player(page, (p) => p.seekTo(83))

    // On the note, above Beside: the panel under the note on a phone.
    const pages = await box(page, '.sh-notes-row .pages-area')
    await writeWord(page, 170, pages.bottom - 50)
    await expect.poll(() => page.evaluate(() => Object.values(window.__shellnote!.doc.block).flatMap((b) => (b.type === 'ink' ? b.strokes : [])).length)).toBe(3)
    const mark = page.getByRole('button', { name: /^Play the video from 1:23/u })
    await expect(mark).toBeVisible()

    await page.getByRole('button', { name: 'Close the video' }).click()
    await expect(page.locator('.nw-video')).toHaveCount(0)
    await mark.click()
    await expect(page.locator('.nw-video')).toBeVisible()
    await bigEnough(page)
    await expect.poll(() => player(page, (p) => p.getCurrentTime())).toBe(83)
  })
})

test('a line’s times come off with its ×, one undo step, and the ⏱ can all be hidden', async ({ page }) => {
  await openNote(page)
  await chooseTool(page, 'pen')
  await page.keyboard.press('Escape')
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('aircAruvnKk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Play the video' }).click()
  await player(page, (p) => p.seekTo(83))
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  const [x, y] = [sheet.x + 120, sheet.y + 220]
  await writeWord(page, x, y)
  const times = () => page.evaluate(() => Object.values(window.__shellnote!.doc.block).flatMap((b) => (b.type === 'ink' ? b.strokes.map((s) => s.vt) : [])))
  const mark = page.getByRole('button', { name: /^Play the video from 1:23/ })
  await expect(mark).toBeVisible()

  // Hidden by the switch, shown again.
  await openVideoMenu(page)
  await page.getByLabel('Show when each line was written (⏱)').uncheck()
  await expect(mark).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('shellnote:video-times'))).toBe('off')
  await page.getByLabel('Show when each line was written (⏱)').check()
  await page.keyboard.press('Escape')
  await expect(mark).toBeVisible()

  // Taken off the line: its strokes keep no time, and undo puts it back.
  await mark.hover()
  await page.getByRole('button', { name: 'Take the times off this line' }).click()
  await expect.poll(times).toEqual([undefined, undefined, undefined])
  await expect(mark).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await times())[0]?.t).toBe(830)
  await expect(mark).toBeVisible()
})

test('the side panel’s description: a key of one’s own typed in, the creator’s words from YouTube’s API, a chapter tapped plays from there', async ({ page }) => {
  let asked = ''
  let key: string | null = null
  await page.route('https://www.googleapis.com/youtube/v3/videos**', (route) => {
    asked = route.request().url()
    key = route.request().headers()['x-goog-api-key'] ?? null
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ snippet: { title: 'But what is a neural network?', channelTitle: '3Blue1Brown', description: 'A first look.\n0:00 Introduction\n1:05 The structure' } }] }) })
  })
  await openNote(page)
  await openVideoMenu(page)
  await page.getByLabel('YouTube link').fill('aircAruvnKk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await openPart(page, 'Description')
  await page.getByLabel('YouTube Data API key').fill('test-key-not-real')
  await page.getByRole('button', { name: 'Keep the key' }).click()

  await expect(page.getByRole('heading', { name: 'But what is a neural network?' })).toBeVisible()
  expect(asked).toContain('id=aircAruvnKk')
  // The key goes as a header, never in the address.
  expect(key).toBe('test-key-not-real')
  expect(asked).not.toContain('test-key-not-real')
  await expect(page.getByText('A first look.')).toBeVisible()
  await page.getByRole('button', { name: /The structure/ }).click()
  await expect.poll(() => player(page, (p) => p.getCurrentTime())).toBe(65)

  await page.getByRole('button', { name: 'Forget the key' }).click()
  await expect(page.getByLabel('YouTube Data API key')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('shellnote:youtube-key'))).toBeNull()
})
