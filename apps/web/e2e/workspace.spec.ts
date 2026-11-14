// The workspace: the notes, the panel beside them (the AI, or Beside, with the video inside it) and a video taken out,
// docked like Obsidian's panes and dragged by their bars to any side; a full view; the panel's parts; the tool bar that
// moves to any side or floats.
import { readFileSync } from 'node:fs'
import { expect, inApp, test, type Page } from './fixtures.js'
import { chooseTool, eraserWay, noteMenu, openPart, openVideoMenu, penRow, textStyle } from './shell.js'

test.use({ viewport: { width: 1280, height: 900 } })

const WEBM = readFileSync(new URL('./fixtures/moving-square.webm', import.meta.url))
type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number }

function box(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).first().evaluate((element) => {
    const r = element.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
  })
}

/** A new note with a video file of its own, shown inside Beside, which opens for it. */
async function withPanels(page: Page): Promise<void> {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await openVideoMenu(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add a video file (MP4, WebM)' }).click()
  await (await chooser).setFiles({ name: 'lecture.webm', mimeType: 'video/webm', buffer: WEBM })
  await expect.poll(() => page.locator('.nw-video-file video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1)
}

/** Drag something by a point of it to another, in small steps, as a hand would. */
async function dragFrom(page: Page, selector: string, x: number, y: number): Promise<void> {
  const from = await box(page, selector)
  await page.mouse.move(from.left + 40, from.top + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.left + 30, from.top + 40, { steps: 4 })
  await page.mouse.move(x, y, { steps: 8 })
  await page.mouse.up()
}

test('starts as designed, and a panel dragged by its bar docks where it is let go, kept for the next time', async ({ page }) => {
  await withPanels(page)
  const side = await box(page, '.nw-side-panel')
  const notes = await box(page, '.nw-notes-panel')
  const video = await box(page, '.nw-video')
  // The notes on the left; the panel beside them on their right, from the window's top, its head level with the tabs.
  expect(side.left).toBeGreaterThanOrEqual(notes.right - 1)
  expect(side.top).toBe((await box(page, '.sh-tabs')).top)
  expect((await box(page, '.sh-tabs')).right).toBeLessThanOrEqual(side.left + 1)
  // The video inside it, under its head.
  expect(video.left).toBeGreaterThanOrEqual(side.left)
  expect(video.right).toBeLessThanOrEqual(side.right)
  expect(video.top).toBeGreaterThan(side.top + 40)

  // The panel, dragged onto the bottom of the notes, goes under them.
  await dragFrom(page, '.nw-side-panel .nw-dock-bar', notes.left + notes.width / 2, notes.bottom - 20)
  const under = await box(page, '.nw-side-panel')
  expect(under.top).toBeGreaterThanOrEqual((await box(page, '.nw-notes-panel')).bottom - 1)
  expect(Math.abs(under.left - notes.left)).toBeLessThan(2)
  expect(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('shellnote:workspace-2')!).layout.root))).toContain('"side"')

  // The video, dragged out by its name to the workspace's left edge, docks there as a panel of its own.
  const dock = await box(page, '.nw-dock')
  await dragFrom(page, '.nw-video-caption', dock.left + 8, dock.top + 300)
  const out = await box(page, '.nw-video')
  expect(out.left).toBe(dock.left)
  expect((await box(page, '.nw-notes-panel')).left).toBeGreaterThanOrEqual(out.right - 1)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shellnote:workspace-2')!).beside.video)).toBe(false)
})

test('the full view fills the workspace with one panel; a video out of sight pauses; Esc brings the layout back', async ({ page }) => {
  await withPanels(page)
  await page.getByRole('button', { name: 'Play the video' }).click()
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
  const dock = await box(page, '.nw-dock')

  await noteMenu(page, 'Full view: the notes alone')
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

test('Beside opens with its parts, remembers the part, and closes, the video inside it out of sight and paused', async ({ page }) => {
  await withPanels(page)
  const side = page.getByRole('region', { name: 'Side panel' })
  await expect(side.getByRole('radio')).toHaveText(['Video', 'Web page'])
  await expect(side.getByRole('tab')).toHaveText(['Description', 'Transcript', ''])
  await openPart(page, 'Timer')
  await expect(side.getByRole('tab', { name: 'Timer' })).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => localStorage.getItem('shellnote:side-tab'))).toBe('timer')
  await page.getByRole('button', { name: 'Close the side panel' }).click()
  await expect(page.locator('.nw-side-panel')).toHaveCount(0)
  await expect(page.locator('.nw-dock-panel[data-panel="video"]')).toHaveCSS('visibility', 'hidden')
  await expect(page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Beside the note' })).toHaveAttribute('aria-pressed', 'false')
  // The rail's Beside brings it back on the part it was on; the AI is the panel's other section.
  await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Beside the note' }).click()
  await expect(side.getByRole('tab', { name: 'Timer' })).toHaveAttribute('aria-selected', 'true')
  await openPart(page, 'Chat')
  await expect(side.getByRole('tab')).toHaveText(['Chat', 'Changes', 'Scratch pad'])
  await expect(page.locator('.nw-dock-panel[data-panel="video"]')).toHaveCSS('visibility', 'hidden')
})

test('the tool bar moves: down a side from the grip’s menu, floating as a pill where dragged, along a side when let go near it; kept', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()

  // Down the left side: its tools one under another, still working.
  await page.getByRole('button', { name: 'Move the tool bar' }).click()
  await page.getByRole('menuitemradio', { name: 'Down the left side' }).click()
  const strip = await box(page, '.nw-bar-strip[data-side="left"]')
  const tools = await box(page, '.nw-bar[data-bar="tools"]')
  expect(tools.left).toBeGreaterThanOrEqual(strip.left)
  expect(tools.height).toBeGreaterThan(tools.width)
  // The pages start on a whole screen pixel beside it: a multiple of 4.
  expect(strip.width % 4).toBe(0)
  expect((await box(page, '.sh-notes-row .pages-area')).left).toBe(strip.right)
  await chooseTool(page, 'pen')
  await expect(page.locator('.nw-desk[data-tool="pen"]')).toBeVisible()

  // Dragged out by its grip, it floats where it is let go.
  const grip = await box(page, '.nw-bar[data-bar="tools"] .nw-bar-grip')
  const main = await box(page, '.main')
  await page.mouse.move(grip.left + grip.width / 2, grip.top + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(main.left + 400, main.top + 300, { steps: 8 })
  await page.mouse.up()
  const floating = page.locator('.nw-bar[data-bar="tools"][data-at="float"]')
  await expect(floating).toBeVisible()
  const f = await box(page, '.nw-bar[data-bar="tools"]')
  expect(Math.abs(f.top - (main.top + 300))).toBeLessThan(40)
  // Turned down from its menu.
  await page.getByRole('button', { name: 'Move the tool bar' }).click()
  await page.getByRole('menuitem', { name: 'Turn it down' }).click()
  await expect(floating).toHaveAttribute('data-dir', 'column')

  // Dragged to the right edge, it goes down the right side.
  const again = await box(page, '.nw-bar[data-bar="tools"] .nw-bar-grip')
  await page.mouse.move(again.left + again.width / 2, again.top + again.height / 2)
  await page.mouse.down()
  await page.mouse.move(main.right - 100, main.top + 300, { steps: 6 })
  await page.mouse.move(main.right - 10, main.top + 300, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.nw-bar-strip[data-side="right"] .nw-bar[data-bar="tools"]')).toBeVisible()

  // Kept for the next time.
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('shellnote:workspace-2')!).bars.tools)
  expect(kept).toEqual({ at: 'right' })
  await page.reload()
  await expect(page.locator('.nw-bar-strip[data-side="right"] .nw-bar[data-bar="tools"]')).toBeVisible()
  // Back under the tabs.
  await page.getByRole('button', { name: 'Move the tool bar' }).click()
  await page.getByRole('menuitemradio', { name: 'Under the tabs' }).click()
  await expect(page.locator('.nw-bar[data-bar="tools"]')).toHaveAttribute('data-at', 'top')
})

test('the timer beside the note: a stopwatch, and a countdown that ends with “Time is up”, running on while the panel is closed', async ({ page }) => {
  await page.clock.install()
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await openPart(page, 'Timer')

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
  await openPart(page, 'Timer')
  await expect(page.getByLabel('Time is up')).toBeVisible()
})

test('Beside shows a web page beside the note, sandboxed, with a way out for sites that refuse', async ({ page }) => {
  await page.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>An example page</h1>' }))
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await openPart(page, 'Web page')
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

test('a transcript pasted beside the video is kept with it; a tap on a line plays from there, the line playing marked; found, taken out', async ({ page }) => {
  await withPanels(page)
  await openPart(page, 'Transcript')
  await page.getByLabel('Transcript to paste').fill('nothing timed here')
  await page.getByRole('button', { name: 'Keep it with the note' }).click()
  await expect(page.getByRole('alert')).toContainText('No times found')
  await page.getByLabel('Transcript to paste').fill('0:00\nHello and welcome\n0:02\nTwo seconds in')
  // Pasted and not yet kept, it waits while another part is looked at.
  await openPart(page, 'Timer')
  await openPart(page, 'Transcript')
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

test('down a side, the Style button shows its sign, the strip slim; pressed, it still chooses', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('A title')
  await page.getByRole('button', { name: 'Move the tool bar' }).click()
  await page.getByRole('menuitemradio', { name: 'Down the right side' }).click()
  const strip = await box(page, '.nw-bar-strip[data-side="right"]')
  expect(strip.width).toBeLessThanOrEqual(68)
  expect((await box(page, '.nw-bar[data-bar="tools"]')).width).toBeLessThanOrEqual(strip.width)
  const style = page.locator('.nw-bar[data-bar="tools"]').getByRole('button', { name: 'Style', exact: true })
  await expect(style.locator('.sh-word-text')).toBeHidden()
  await expect(style.locator('.sh-word-sign')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await textStyle(page, 'Heading 1')
  await expect.poll(() => page.evaluate(() => Object.values(window.__shellnote!.doc.block).some((block) => (block as { role?: string }).role === 'h1'))).toBe(true)
})

test('full screen keeps the workspace as laid out, the panel beside the notes and the video in it; the same button leaves it', async ({ page }) => {
  await withPanels(page)
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true)
  await expect(page.locator('.nw-video-file video')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Side panel' })).toBeVisible()
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
const MENUS = '.sh-menu, .nw-popover, .nw-font-library, .nw-table-grid, .nw-dropdown'

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

/** Opens each menu of the tool bar in turn, as a press does, and asks whether it is whole. A tool not in hand is left be. */
async function eachMenu(page: Page, where: string, found: string[]): Promise<number> {
  const buttons = page.locator('.nw-bar[data-bar="tools"] button[aria-expanded], .nw-bar[data-bar="tools"] button[aria-haspopup]')
  let opened = 0
  for (let i = 0; i < (await buttons.count()); i++) {
    const button = buttons.nth(i)
    const name = await button.getAttribute('aria-label')
    if (!(await button.isVisible()) || (await button.isDisabled()) || (await button.getAttribute('aria-pressed')) === 'false') continue
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

/** Sends the tool bar along a side, or floating; "corner" floats it near the workspace's bottom right. */
async function sendBar(page: Page, place: string): Promise<void> {
  const grip = page.locator('.nw-bar[data-bar="tools"] .nw-bar-grip')
  await grip.evaluate((element: HTMLElement) => element.click())
  const name = { top: 'Under the tabs', left: 'Down the left side', right: 'Down the right side', bottom: 'Along the bottom', float: 'Floating', corner: 'Floating' }[place]!
  await page.getByRole('menuitemradio', { name, exact: true }).evaluate((element: HTMLElement) => element.click())
  if (place !== 'corner') return
  const at = (await grip.boundingBox())!
  // Inside the desktop app the window is the app's own, and Playwright keeps no size for it: the page says.
  const size = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  await page.mouse.move(at.x + 5, at.y + 10)
  await page.mouse.down()
  await page.mouse.move(size.width - 140, size.height - 110, { steps: 4 })
  await page.mouse.up()
}

for (const [width, height] of inApp ? [[1280, 800], [800, 600]] as const : [[1280, 800], [800, 600], [360, 740]] as const) {
  test(`at ${width} by ${height}, every menu of the tool bar is whole and on top, wherever the bar is`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height })
    await page.goto('/?sample=mixed')
    await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
    const found: string[] = []
    const seen = { words: 0, pen: 0, table: 0 }
    // A caret in the text: the Table and the words' own menus come alive.
    const caret = (): Promise<void> => page.locator('.nw-frame .ProseMirror').first().evaluate((element: HTMLElement) => element.focus())
    for (const place of ['top', 'left', 'right', 'bottom', 'float', 'corner']) {
      await caret()
      await sendBar(page, place)
      seen.words += await eachMenu(page, `words ${place}`, found)
      // A side's scrollbar is slim and only up and down, shown or not.
      for (const strip of await page.locator('.nw-bar-strip[data-side="left"], .nw-bar-strip[data-side="right"]').all()) {
        expect(await strip.evaluate((element: HTMLElement) => [getComputedStyle(element).overflowX, element.offsetWidth - element.clientWidth <= 7])).toEqual(['hidden', true])
      }
    }
    // The pen's own row, in the same places.
    await chooseTool(page, 'pen')
    for (const place of ['top', 'left', 'right', 'bottom', 'corner']) {
      await sendBar(page, place)
      seen.pen += await eachMenu(page, `pen ${place}`, found)
    }
    // A table's own: the delete and style menus.
    await chooseTool(page, 'type')
    await caret()
    await page.getByRole('button', { name: 'Table', exact: true }).evaluate((element: HTMLElement) => element.click())
    await page.locator('.nw-pick-cells button').nth(12).evaluate((element: HTMLElement) => element.click())
    await expect(page.getByRole('button', { name: 'Table style' })).toBeVisible()
    for (const place of ['left', 'right', 'bottom', 'corner']) {
      await sendBar(page, place)
      seen.table += await eachMenu(page, `table ${place}`, found)
    }
    expect(found).toEqual([])
    // Each kind was really opened: the words' Style, Font and size, Colour, Align, Table and More; the pen's Pen, Colour
    // and Width; a table's two.
    expect(seen.words).toBeGreaterThanOrEqual(24)
    expect(seen.pen).toBeGreaterThanOrEqual(10)
    expect(seen.table).toBeGreaterThanOrEqual(8)
  })
}

// Options down a side "are not visible": a window 730 high showed only part of a bar; the eraser's two choices hung off
// both edges of the strip.
for (const [width, height] of inApp ? [[1536, 730], [1280, 800]] as const : [[1536, 730], [1280, 800], [1180, 820], [820, 1180]] as const) {
  test(`at ${width} by ${height}, with the tool bar down a side, every option is in sight, whichever tool is chosen`, async ({ page }) => {
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
      await sendBar(page, side)
      for (const tool of ['type', 'select', 'pen', 'highlighter', 'eraser'] as const) {
        await chooseTool(page, tool)
        await page.waitForTimeout(60)
        found.push(...(await check(`${side}, ${tool}`, side)))
      }
    }
    expect(found).toEqual([])
    // The eraser's choices still choose (its menu stays open after a choice).
    await eraserWay(page, 'Part of a stroke')
    await expect(page.getByRole('menuitemradio', { name: 'Part of a stroke' })).toHaveAttribute('aria-checked', 'true')
    await penRow(page).getByRole('button', { name: 'Eraser', exact: true }).click()
    // A shorter bar for another tool does not move the notes.
    await chooseTool(page, 'type')
    const typed = (await box(page, '.nw-bar-strip[data-side="right"]')).width
    await chooseTool(page, 'pen')
    expect((await box(page, '.nw-bar-strip[data-side="right"]')).width).toBe(typed)
  })
}
