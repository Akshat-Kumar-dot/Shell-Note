// The workspace: the notes, the video and the side panel docked like
// Obsidian's panes, dragged by their bars to any side; a full view; the side panel's tabs.
import { readFileSync } from 'node:fs'
import { expect, inApp, test, type Page } from './fixtures.js'

test.use({ viewport: { width: 1280, height: 900 } })

const WEBM = readFileSync(new URL('./fixtures/moving-square.webm', import.meta.url))
type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number }

function box(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).first().evaluate((element) => {
    const r = element.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
  })
}

/** A new note with a video file of its own beside it, and the side panel open. */
async function withPanels(page: Page): Promise<void> {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.getByRole('button', { name: 'Video', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add a video file (MP4, WebM)' }).click()
  await (await chooser).setFiles({ name: 'lecture.webm', mimeType: 'video/webm', buffer: WEBM })
  await expect.poll(() => page.locator('.nw-video-file video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1)
  await page.getByRole('button', { name: 'Side panel', exact: true }).click()
}

/** Drag a panel by its bar to a point, in small steps, as a hand would. */
async function dragBar(page: Page, bar: string, x: number, y: number): Promise<void> {
  const from = await box(page, bar)
  await page.mouse.move(from.left + 40, from.top + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.left + 30, from.top + 40, { steps: 4 })
  await page.mouse.move(x, y, { steps: 8 })
  await page.mouse.up()
}

test('starts as designed, and a panel dragged by its bar docks where it is let go, kept for the next time', async ({ page }) => {
  await withPanels(page)
  const video = await box(page, '.nw-video')
  const side = await box(page, '.nw-side-panel')
  const notes = await box(page, '.nw-notes-panel')
  // The video above the side panel on the left, the notes on the right.
  expect(Math.abs(video.left - side.left)).toBeLessThan(2)
  expect(video.bottom).toBeLessThanOrEqual(side.top + 1)
  expect(notes.left).toBeGreaterThanOrEqual(video.right - 1)

  // The notes, dragged to the workspace's left edge, go there; the others take the right.
  const dock = await box(page, '.nw-dock')
  await dragBar(page, '.nw-notes-panel .nw-dock-bar', dock.left + 8, dock.top + 300)
  const moved = await box(page, '.nw-notes-panel')
  expect(moved.left).toBe(dock.left)
  expect((await box(page, '.nw-video')).left).toBeGreaterThanOrEqual(moved.right - 1)
  expect(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('shellnote:workspace')!).layout.root))).toContain('"notes"')

  // The side panel, dragged onto the bottom of the notes, goes under them.
  const now = await box(page, '.nw-notes-panel')
  await dragBar(page, '.nw-side-panel .nw-dock-bar', now.left + now.width / 2, now.bottom - 20)
  const under = await box(page, '.nw-side-panel')
  expect(under.top).toBeGreaterThanOrEqual((await box(page, '.nw-notes-panel')).bottom - 1)
  expect(Math.abs(under.left - now.left)).toBeLessThan(2)
})

test('the full view fills the workspace with one panel; a video out of sight pauses; Esc brings the layout back', async ({ page }) => {
  await withPanels(page)
  await page.getByRole('button', { name: 'Play the video' }).click()
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
  const dock = await box(page, '.nw-dock')

  await page.getByRole('button', { name: 'Full view: the notes alone' }).click()
  const notes = await box(page, '.nw-notes-panel')
  expect([notes.left, notes.top, notes.width, notes.height]).toEqual([dock.left, dock.top, dock.width, dock.height])
  await expect(page.locator('.nw-dock-panel[data-panel="video"]')).toHaveCSS('visibility', 'hidden')
  expect(await page.locator('.nw-video-file video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  // The same player, kept: nothing is made again.
  await expect(page.locator('.nw-video-file video')).toHaveCount(1)

  await page.locator('.nw-desk').click({ position: { x: 30, y: 300 } })
  await page.keyboard.press('Escape')
  await expect(page.locator('.nw-dock-panel[data-panel="video"]')).toHaveCSS('visibility', 'visible')
  expect((await box(page, '.nw-notes-panel')).width).toBeLessThan(dock.width)

  // The video alone, and back by its button.
  await page.getByRole('button', { name: 'Full view: the video alone' }).click()
  expect((await box(page, '.nw-video')).width).toBe(dock.width)
  await page.getByRole('button', { name: 'Leave full view' }).click()
  expect((await box(page, '.nw-video')).width).toBeLessThan(dock.width)
})

test('the side panel opens beside the notes with its tabs, remembers the tab, and closes, giving its room back', async ({ page }) => {
  await withPanels(page)
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveText(['Description', 'Transcript', 'Web page', 'Timer', 'Output', 'AI'])
  await page.getByRole('tab', { name: 'Timer' }).click()
  await expect(page.getByRole('tab', { name: 'Timer' })).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => localStorage.getItem('shellnote:side-tab'))).toBe('timer')
  const video = await box(page, '.nw-video')
  await page.getByRole('button', { name: 'Close the side panel' }).click()
  await expect(page.locator('.nw-side-panel')).toHaveCount(0)
  // The video takes the side panel's room.
  expect((await box(page, '.nw-video')).height).toBeGreaterThan(video.height)
  await expect(page.getByRole('button', { name: 'Side panel', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('the bars move: down a side from the grip’s menu, floating as a box where dragged, along a side when let go near it; kept', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()

  // The tools bar down the left side: its tools one under another, still working; the app bar keeps one row.
  await page.getByRole('button', { name: 'Move the tools bar' }).click()
  await page.getByRole('menuitemradio', { name: 'Down the left side' }).click()
  const strip = await box(page, '.nw-bar-strip[data-side="left"]')
  const tools = await box(page, '.nw-bar[data-bar="tools"]')
  expect(tools.left).toBeGreaterThanOrEqual(strip.left)
  expect(tools.height).toBeGreaterThan(tools.width)
  // The panels start on a whole screen pixel beside it: a multiple of 4.
  expect(strip.width % 4).toBe(0)
  expect((await box(page, '.nw-dock')).left).toBe(strip.right)
  await expect(page.locator('.appbar')).toHaveAttribute('data-tools-away', '')
  await page.getByRole('radio', { name: 'Pen', exact: true }).click()
  await expect(page.locator('.nw-desk[data-tool="pen"]')).toBeVisible()

  // The format bar dragged out by its grip floats where it is let go.
  const grip = await box(page, '.nw-bar[data-bar="format"] .nw-bar-grip')
  const main = await box(page, '.main')
  await page.mouse.move(grip.left + grip.width / 2, grip.top + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(main.left + 400, main.top + 300, { steps: 8 })
  await page.mouse.up()
  const floating = page.locator('.nw-bar[data-bar="format"][data-at="float"]')
  await expect(floating).toBeVisible()
  const f = await box(page, '.nw-bar[data-bar="format"]')
  expect(Math.abs(f.top - (main.top + 300))).toBeLessThan(40)
  // Turned down from its menu.
  await page.getByRole('button', { name: 'Move the format bar' }).click()
  await page.getByRole('menuitem', { name: 'Turn it down' }).click()
  await expect(floating).toHaveAttribute('data-dir', 'column')

  // Dragged to the right edge, it goes down the right side.
  const again = await box(page, '.nw-bar[data-bar="format"] .nw-bar-grip')
  await page.mouse.move(again.left + again.width / 2, again.top + again.height / 2)
  await page.mouse.down()
  await page.mouse.move(main.right - 100, main.top + 300, { steps: 6 })
  await page.mouse.move(main.right - 10, main.top + 300, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.nw-bar-strip[data-side="right"] .nw-bar[data-bar="format"]')).toBeVisible()

  // Kept for the next time.
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('shellnote:workspace')!).bars)
  expect(kept).toEqual({ tools: { at: 'left' }, format: { at: 'right' } })
  await page.reload()
  await expect(page.locator('.nw-bar-strip[data-side="left"] .nw-bar[data-bar="tools"]')).toBeVisible()
})

test('the side panel’s timer: a stopwatch, and a countdown that ends with “Time is up”, running on while the panel is closed', async ({ page }) => {
  await page.clock.install()
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.getByRole('button', { name: 'Side panel', exact: true }).click()
  await page.getByRole('tab', { name: 'Timer' }).click()

  await page.getByRole('radio', { name: 'Stopwatch' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.clock.fastForward('01:05')
  await expect(page.getByLabel('Time', { exact: true })).toHaveText('01:05')
  await page.getByRole('button', { name: 'Pause' }).click()

  await page.getByRole('radio', { name: 'Countdown' }).click()
  await page.getByRole('button', { name: '5 min', exact: true }).click()
  await expect(page.getByLabel('Time', { exact: true })).toHaveText('05:00')
  await page.getByRole('button', { name: 'Start' }).click()
  // Closed, it runs on.
  await page.getByRole('button', { name: 'Close the side panel' }).click()
  await page.clock.fastForward('05:01')
  await page.getByRole('button', { name: 'Side panel', exact: true }).click()
  await expect(page.getByLabel('Time is up')).toBeVisible()
})

test('the side panel shows a web page beside the note, sandboxed, with a way out for sites that refuse', async ({ page }) => {
  await page.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>An example page</h1>' }))
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.getByRole('button', { name: 'Side panel', exact: true }).click()
  await page.getByRole('tab', { name: 'Web page' }).click()
  await page.getByLabel('Web address').fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Show', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not a web address')
  await page.getByLabel('Web address').fill('example.com')
  await page.getByRole('button', { name: 'Show', exact: true }).click()
  const frame = page.locator('iframe.nw-web-page')
  await expect(frame).toHaveAttribute('src', 'https://example.com/')
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/)
  expect(await frame.getAttribute('sandbox')).not.toContain('allow-top-navigation')
  await expect(page.frameLocator('iframe.nw-web-page').getByRole('heading', { name: 'An example page' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open it in a new tab' })).toHaveAttribute('href', 'https://example.com/')
})

test('a transcript pasted into the side panel is kept with the video; a tap on a line plays from there, the line playing marked; found, taken out', async ({ page }) => {
  await withPanels(page)
  await page.getByRole('tab', { name: 'Transcript' }).click()
  await page.getByLabel('Transcript to paste').fill('nothing timed here')
  await page.getByRole('button', { name: 'Keep it with the note' }).click()
  await expect(page.getByRole('alert')).toContainText('No times found')
  await page.getByLabel('Transcript to paste').fill('0:00\nHello and welcome\n0:02\nTwo seconds in')
  // Pasted and not yet kept, it waits while another tab is looked at.
  await page.getByRole('tab', { name: 'Timer' }).click()
  await page.getByRole('tab', { name: 'Transcript' }).click()
  await expect(page.getByLabel('Transcript to paste')).toHaveValue('0:00\nHello and welcome\n0:02\nTwo seconds in')
  await page.getByRole('button', { name: 'Keep it with the note' }).click()
  await expect.poll(() => page.evaluate(() => (window.__shellnote!.doc.media![0] as { transcript?: unknown }).transcript)).toEqual([
    { t: 0, text: 'Hello and welcome' },
    { t: 20, text: 'Two seconds in' },
  ])

  await page.getByRole('button', { name: /Two seconds in/ }).click()
  await expect.poll(() => page.locator('.nw-video-file video').evaluate((video: HTMLVideoElement) => Math.round(video.currentTime))).toBe(2)
  await page.locator('.nw-video-file video').evaluate((video: HTMLVideoElement) => video.pause())
  await expect(page.getByRole('button', { name: /Two seconds in/ })).toHaveAttribute('aria-current', 'true')

  await page.getByLabel('Find in the transcript').fill('welcome')
  await expect(page.locator('.nw-transcript-lines li')).toHaveCount(1)
  await page.getByRole('button', { name: 'Take it out' }).click()
  await expect.poll(() => page.evaluate(() => 'transcript' in window.__shellnote!.doc.media![0]!)).toBe(false)
  await expect(page.getByLabel('Transcript to paste')).toBeVisible()
})

test('down a side, the format bar’s menus show as their signs, the strip as slim as the tools’ one; pressed, they still choose', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('A title')
  await page.getByRole('button', { name: 'Move the format bar' }).click()
  await page.getByRole('menuitemradio', { name: 'Down the right side' }).click()
  const strip = await box(page, '.nw-bar-strip[data-side="right"]')
  expect(strip.width).toBeLessThanOrEqual(68)
  expect((await box(page, '.nw-bar[data-bar="format"]')).width).toBeLessThanOrEqual(strip.width)
  const sign = page.locator('.nw-bar[data-bar="format"] .nw-select-short').first()
  await expect(sign).toHaveText('¶')
  await expect(page.locator('.nw-bar[data-bar="format"] .nw-font-menu .nw-select-short')).toHaveText('Aa')
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.getByRole('combobox', { name: 'Block type' }).selectOption('h1')
  await expect(sign).toHaveText('H1')
  await expect.poll(() => page.evaluate(() => Object.values(window.__shellnote!.doc.block).some((block) => (block as { role?: string }).role === 'h1'))).toBe(true)
})

test('full screen keeps the workspace as laid out, the video and the side panel with the notes; the same button leaves it', async ({ page }) => {
  await withPanels(page)
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true)
  await expect(page.locator('.nw-video-file video')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toBeVisible()
  await expect(page.locator('.nw-page').first()).toBeVisible()
  const leave = page.getByRole('button', { name: 'Leave full screen' })
  await expect(leave).toHaveAttribute('aria-pressed', 'true')
  await leave.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null)
  await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

// A screenshot, 6 November 2026: with a bar down a side, the colour panel was cut off by the strip the bar sits in, the strip
// scrolled sideways, and a grey scrollbar stood beside the bar. A sweep of every bar's menus then found the same in Pen
// settings, Paper and the bars' own menus, on every side. A menu must be whole, on the screen and on top.
const MENUS = '.nw-popover, .nw-font-library, .nw-table-grid, .nw-dropdown'

/** What is wrong with the open menu: nine points inside it, each of which must be the menu's own. */
const notWhole = (page: Page, where: string): Promise<string[]> =>
  page.locator(MENUS).first().evaluate((menu, at) => {
    const r = menu.getBoundingClientRect()
    const found: string[] = []
    if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) found.push(`${at}: off the screen, ${[r.left, r.top, r.right, r.bottom].map(Math.round).join(' ')}`)
    for (const x of [r.left + 8, (r.left + r.right) / 2, r.right - 8]) {
      for (const y of [r.top + 8, (r.top + r.bottom) / 2, r.bottom - 8]) {
        const there = document.elementFromPoint(x, y)
        if (there && menu !== there && !menu.contains(there)) found.push(`${at}: at ${Math.round(x)},${Math.round(y)} under ${(there.className || there.tagName).toString().split(' ')[0]}`)
      }
    }
    for (const strip of document.querySelectorAll('.nw-bar-strip')) if (strip.scrollWidth > strip.clientWidth + 1) found.push(`${at}: the strip scrolls sideways`)
    return found
  }, where)

/** Opens each menu of a bar in turn, as a press does, and asks whether it is whole. */
async function eachMenu(page: Page, bar: string, where: string, found: string[]): Promise<number> {
  const buttons = page.locator(`.nw-bar[data-bar="${bar}"] button[aria-expanded], .nw-bar[data-bar="${bar}"] button[aria-haspopup]`)
  let opened = 0
  for (let i = 0; i < (await buttons.count()); i++) {
    const button = buttons.nth(i)
    const name = await button.getAttribute('aria-label')
    if (await button.isDisabled()) continue
    await button.evaluate((element: HTMLElement) => element.click())
    if ((await page.locator(MENUS).count()) === 0) continue
    opened++
    found.push(...(await notWhole(page, `${where}, ${name}`)))
    await button.evaluate((element: HTMLElement) => {
      if (element.getAttribute('aria-expanded') === 'true') element.click()
    })
  }
  return opened
}

/** Sends a bar along a side, or floating; "corner" floats it near the workspace's bottom right. */
async function sendBar(page: Page, bar: string, place: string): Promise<void> {
  const grip = page.locator(`.nw-bar[data-bar="${bar}"] .nw-bar-grip`)
  await grip.evaluate((element: HTMLElement) => element.click())
  const name = { top: 'Along the top', left: 'Down the left side', right: 'Down the right side', bottom: 'Along the bottom', float: 'Floating box', corner: 'Floating box' }[place]!
  await page.getByRole('menuitemradio', { name, exact: true }).evaluate((element: HTMLElement) => element.click())
  if (place !== 'corner') return
  const at = (await grip.boundingBox())!
  // Inside the desktop app the window is the app's own, and Playwright keeps no size for it: the page says.
  const size = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  await page.mouse.move(at.x + 10, at.y + 10)
  await page.mouse.down()
  await page.mouse.move(size.width - 140, size.height - 110, { steps: 4 })
  await page.mouse.up()
}

for (const [width, height] of inApp ? [[1280, 800], [800, 600]] as const : [[1280, 800], [800, 600], [360, 740]] as const) {
  test(`at ${width} by ${height}, every menu of the bars is whole and on top, wherever the bar is`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height })
    await page.goto('/?sample=mixed')
    await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
    const found: string[] = []
    const seen = { tools: 0, format: 0, pen: 0, table: 0 }
    // A caret in the text: the tools' Table and the format bar's own come alive.
    const caret = (): Promise<void> => page.locator('.nw-frame .ProseMirror').first().evaluate((element: HTMLElement) => element.focus())
    for (const place of ['top', 'left', 'right', 'bottom', 'float', 'corner']) {
      await caret()
      // Both float together, one over the other: a menu must come over the other bar too.
      await sendBar(page, 'tools', place === 'corner' ? 'float' : place)
      await sendBar(page, 'format', place)
      seen.tools += await eachMenu(page, 'tools', `tools ${place}`, found)
      seen.format += await eachMenu(page, 'format', `format ${place}`, found)
      // A side's scrollbar is slim and only up and down, shown or not.
      for (const strip of await page.locator('.nw-bar-strip[data-side="left"], .nw-bar-strip[data-side="right"]').all()) {
        expect(await strip.evaluate((element: HTMLElement) => [getComputedStyle(element).overflowX, element.offsetWidth - element.clientWidth <= 7])).toEqual(['hidden', true])
      }
    }
    // The pen's own bar, in the same places.
    await page.getByRole('radio', { name: 'Pen', exact: true }).evaluate((element: HTMLElement) => element.click())
    for (const place of ['top', 'left', 'right', 'bottom', 'corner']) {
      await sendBar(page, 'format', place)
      seen.pen += await eachMenu(page, 'format', `pen ${place}`, found)
    }
    // A table's own: the delete and style menus.
    await page.getByRole('radio', { name: 'Type', exact: true }).evaluate((element: HTMLElement) => element.click())
    await caret()
    await page.getByRole('button', { name: 'Table', exact: true }).evaluate((element: HTMLElement) => element.click())
    await page.locator('.nw-pick-cells button').nth(12).evaluate((element: HTMLElement) => element.click())
    await expect(page.getByRole('button', { name: 'Table style' })).toBeVisible()
    for (const place of ['left', 'right', 'bottom', 'corner']) {
      await sendBar(page, 'format', place)
      seen.table += await eachMenu(page, 'format', `table ${place}`, found)
    }
    expect(found).toEqual([])
    // Each kind was really opened: the tools' Paper and Table, the format's Colour, the pen's settings, the table's two.
    expect(seen.tools).toBeGreaterThanOrEqual(12)
    expect(seen.format).toBeGreaterThanOrEqual(6)
    expect(seen.pen).toBeGreaterThanOrEqual(5)
    expect(seen.table).toBeGreaterThanOrEqual(8)
  })
}

// Options down a side "are not visible". With both bars on one side, a window 730 high showed all of the first and of the
// second only its first button; the eraser's two choices hung off both edges of the strip.
for (const [width, height] of inApp ? [[1536, 730], [1280, 800]] as const : [[1536, 730], [1280, 800], [1180, 820], [820, 1180]] as const) {
  test(`at ${width} by ${height}, with both bars down a side, every option is in sight, whichever tool is chosen`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height })
    await page.goto('/?sample=mixed')
    await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
    const found: string[] = []
    const check = (where: string, side: string): Promise<string[]> =>
      page.locator(`.nw-bar-strip[data-side="${side}"]`).evaluate((strip: HTMLElement, at) => {
        const edge = strip.getBoundingClientRect()
        const out: string[] = []
        if (strip.scrollHeight > strip.clientHeight + 1) out.push(`${at}: it must be scrolled, ${strip.scrollHeight} in ${strip.clientHeight}`)
        if (Math.round(edge.width) % 4 !== 0) out.push(`${at}: ${edge.width} wide, no multiple of 4`)
        for (const one of strip.querySelectorAll<HTMLElement>('button, select')) {
          const r = one.getBoundingClientRect()
          if (r.width === 0) continue
          if (r.left < edge.left - 0.5 || r.right > edge.right + 0.5 || r.top < edge.top - 0.5 || r.bottom > edge.bottom + 0.5) out.push(`${at}: ${one.getAttribute('aria-label') ?? one.textContent} is out of sight, ${[r.left, r.top, r.right, r.bottom].map(Math.round).join(' ')}`)
        }
        return out
      }, where)
    for (const side of ['left', 'right']) {
      await sendBar(page, 'tools', side)
      await sendBar(page, 'format', side)
      for (const tool of ['Type', 'Select', 'Pen', 'Highlighter', 'Eraser']) {
        await page.getByRole('radio', { name: tool, exact: true }).evaluate((element: HTMLElement) => element.click())
        await page.waitForTimeout(60)
        found.push(...(await check(`${side}, ${tool}`, side)))
      }
    }
    expect(found).toEqual([])
    // The eraser's choices still choose, and read as words.
    await expect(page.getByRole('radio', { name: 'Part of a stroke' })).toBeVisible()
    await page.getByRole('radio', { name: 'Part of a stroke' }).click()
    await expect(page.getByRole('radio', { name: 'Part of a stroke' })).toHaveAttribute('aria-checked', 'true')
    // A shorter bar for another tool does not move the notes.
    await page.getByRole('radio', { name: 'Type', exact: true }).evaluate((element: HTMLElement) => element.click())
    const typed = (await box(page, '.nw-bar-strip[data-side="right"]')).width
    await page.getByRole('radio', { name: 'Pen', exact: true }).evaluate((element: HTMLElement) => element.click())
    expect((await box(page, '.nw-bar-strip[data-side="right"]')).width).toBe(typed)
  })
}
