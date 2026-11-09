// The pen (phase 3): strokes written with the mouse as a pen would be, one
// undo step each; a clearly straight line straightened, and a stroke held
// still snapped to a shape, each as a second undo step; the eraser, whole
// strokes and part of one; the highlighter under the words; the pen switches
// for one note; and palms, with pointer events as a touch screen sends them.
import { readFileSync } from 'node:fs'
import { expect, inApp, test, type Page } from './fixtures.js'

type Ink = { id: string; strokes: { pts: number[]; tool?: string; straight?: true; shape?: { kind: string; key: number[] } }[] }

/** Every ink block of the note, with its strokes. */
const inks = (page: Page): Promise<Ink[]> =>
  page.evaluate(() => Object.values(window.__shellnote!.doc.block).filter((block) => block.type === 'ink') as unknown as Ink[])
/** Ink blocks the sample did not have. */
const added = async (page: Page, before: readonly Ink[]): Promise<Ink[]> => (await inks(page)).filter((ink) => !before.some((old) => old.id === ink.id))
const strokeCount = async (page: Page): Promise<number> => (await inks(page)).reduce((sum, ink) => sum + ink.strokes.length, 0)

async function start(page: Page): Promise<void> {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
}

/** A point of the first page, in millimetres from its corner, on the screen. */
async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.nw-page').first().boundingBox())!
  return { x: box.x + (x / 210) * box.width, y: box.y + (y / 297) * box.height }
}

/** Write through points (millimetres on the page) with the mouse, as a hand does: pressed at the first, let go at the last. */
async function write(page: Page, points: readonly [number, number][], hold?: () => Promise<void>): Promise<void> {
  const screen = await Promise.all(points.map(([x, y]) => at(page, x, y)))
  await page.mouse.move(screen[0]!.x, screen[0]!.y)
  await page.mouse.down()
  for (const pt of screen.slice(1)) await page.mouse.move(pt.x, pt.y)
  if (hold) await hold()
  await page.mouse.up()
}

/** A wavy line across, as handwriting goes: never straight. */
const wave = (x: number, y: number, length: number): [number, number][] => Array.from({ length: 31 }, (_, i) => [x + (length * i) / 30, y + 3 * Math.sin(i / 2.5)])

const tool = (page: Page, name: string) => page.getByRole('radio', { name, exact: true })

// Tall enough to show a whole A4 page at 100%.
test.use({ viewport: { width: 1280, height: 1200 } })

test('the pen writes a stroke as one undo step, in a new ink block in front', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  await expect(page.getByRole('toolbar', { name: 'Pen' })).toBeVisible()
  await write(page, wave(40, 150, 60))
  await expect.poll(async () => (await added(page, before)).length).toBe(1)
  const [ink] = await added(page, before)
  expect(ink!.strokes).toHaveLength(1)
  expect(ink!.strokes[0]!.pts.length).toBeGreaterThan(9)
  const free = await page.evaluate((id) => window.__shellnote!.doc.page.w1!.free.at(-1) === id, ink!.id)
  expect(free).toBe(true)
  // Drawn on the page: one stroke, one group.
  await expect(page.locator(`svg.nw-ink[data-id="${ink!.id}"] > g`)).toHaveCount(1)
  // Close by and soon after: the same block.
  await write(page, wave(40, 158, 60))
  await expect.poll(async () => (await added(page, before))[0]?.strokes.length).toBe(2)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await added(page, before))[0]?.strokes.length).toBe(1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await added(page, before)).length).toBe(0)
})

test('a clearly straight line is straightened, as a second undo step that gives back the line as drawn', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  await write(page, Array.from({ length: 12 }, (_, i): [number, number] => [40 + i * 6, 150 + (i % 2) * 0.2]))
  await expect.poll(async () => (await added(page, before))[0]?.strokes[0]?.straight).toBe(true)
  const line = (await added(page, before))[0]!.strokes[0]!
  expect(line.pts).toHaveLength(6)
  // Level, as the angle snaps within 4°.
  expect(line.pts[1]).toBe(line.pts[4])
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await added(page, before))[0]?.strokes[0]?.straight).toBeUndefined()
  expect((await added(page, before))[0]!.strokes[0]!.pts.length).toBeGreaterThan(6)
})

test('a stroke held still snaps to its shape, which one undo gives back as drawn', async ({ page }) => {
  await page.clock.install()
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  const circle = Array.from({ length: 41 }, (_, i): [number, number] => [100 + 20 * Math.cos((i / 40) * 2.1 * Math.PI), 160 + 20 * Math.sin((i / 40) * 2.1 * Math.PI)])
  // Held still for longer than the hold, without letting go.
  await write(page, circle, () => page.clock.runFor(700))
  await expect.poll(async () => (await added(page, before))[0]?.strokes[0]?.shape?.kind).toBe('circle')
  const { key } = (await added(page, before))[0]!.strokes[0]!.shape!
  expect(Math.abs(key[2]! - 2000)).toBeLessThan(250)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await added(page, before))[0]?.strokes[0]?.shape).toBeUndefined()
})

test('the eraser takes whole strokes in one sweep, as one undo step', async ({ page }) => {
  await start(page)
  await tool(page, 'Pen').click()
  const strokes = await strokeCount(page)
  await write(page, wave(40, 150, 40))
  await write(page, wave(40, 160, 40))
  await expect.poll(() => strokeCount(page)).toBe(strokes + 2)
  await tool(page, 'Eraser').click()
  await expect(page.getByRole('toolbar', { name: 'Eraser' })).toBeVisible()
  await write(page, Array.from({ length: 10 }, (_, i): [number, number] => [60, 140 + i * 3]))
  await expect.poll(() => strokeCount(page)).toBe(strokes)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => strokeCount(page)).toBe(strokes + 2)
})

test('the eraser can take only the part of a stroke it passes over', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  await write(page, wave(40, 150, 80))
  await expect.poll(async () => (await added(page, before)).length).toBe(1)
  await tool(page, 'Eraser').click()
  await page.getByRole('radio', { name: 'Part of a stroke' }).click()
  await write(page, Array.from({ length: 10 }, (_, i): [number, number] => [80, 140 + i * 2.5]))
  await expect.poll(async () => (await added(page, before))[0]?.strokes.length).toBe(2)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await added(page, before))[0]?.strokes.length).toBe(1)
})

test('the highlighter marks over the words, see-through, in a layer under the ink', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Highlighter').click()
  await expect(page.getByRole('toolbar', { name: 'Highlighter' })).toBeVisible()
  await write(page, Array.from({ length: 10 }, (_, i): [number, number] => [25 + i * 5, 40.5 + (i % 2) * 0.4]))
  await expect.poll(async () => (await added(page, before))[0]?.strokes[0]?.tool).toBe('highlighter')
  const [ink] = await added(page, before)
  const under = page.locator(`svg.nw-ink-under[data-id="${ink!.id}"]`)
  await expect(under).toHaveCount(1)
  expect(await under.evaluate((svg) => getComputedStyle(svg).mixBlendMode)).toBe('multiply')
})

test("a note's own pen switches go with it, as one undo step", async ({ page }) => {
  await start(page)
  await tool(page, 'Pen').click()
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await page.getByRole('radio', { name: 'This note' }).click()
  await page.getByRole('combobox', { name: 'Shapes' }).selectOption({ label: 'Off' })
  await expect.poll(() => page.evaluate(() => window.__shellnote!.doc.pen)).toEqual({ shapes: 'off' })
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => page.evaluate(() => window.__shellnote!.doc.pen)).toBeUndefined()
})

/** One pointer event as a touch screen or pen sends it, at a point of the page in millimetres. */
type Step = { type: 'pen' | 'touch'; id: number; kind: 'pointerdown' | 'pointermove' | 'pointerup'; at: [number, number]; size?: number; pressure?: number }

/** A pointer's whole stroke: down, moves, up. */
const strokeOf = (type: 'pen' | 'touch', id: number, points: readonly [number, number][], size?: number): Step[] =>
  points.map((at, i) => ({ type, id, kind: i === 0 ? 'pointerdown' : i === points.length - 1 ? 'pointerup' : 'pointermove', at, ...(size === undefined ? {} : { size }) }))

/** Send pointer events, in order, at once: as the hardware does, with no time between them for anything else. */
async function send(page: Page, steps: readonly Step[]): Promise<void> {
  const box = (await page.locator('.nw-page').first().boundingBox())!
  const screen = steps.map((step) => ({ ...step, x: box.x + (step.at[0] / 210) * box.width, y: box.y + (step.at[1] / 297) * box.height }))
  await page.evaluate((screen) => {
    for (const step of screen) {
      // Each a moment after the last, as the hardware's samples are: the page's clock counts in tenths of a
      // millisecond, and the pen takes a second sample on the same tick for one it has seen (found in the app, where
      // drawing a sample can take less than a tick).
      const tick = performance.now() + 0.15
      while (performance.now() < tick);
      document.elementFromPoint(step.x, step.y)!.dispatchEvent(
        new PointerEvent(step.kind, {
          pointerId: step.id,
          pointerType: step.type,
          isPrimary: true,
          clientX: step.x,
          clientY: step.y,
          width: step.size ?? 12,
          height: step.size ?? 12,
          pressure: step.pressure ?? (step.kind === 'pointerup' ? 0 : 0.5),
          button: step.kind === 'pointermove' ? -1 : 0,
          buttons: step.kind === 'pointerup' ? 0 : 1,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      )
    }
  }, screen)
}

/** Whether the live layer thrown away each event (the second canvas) has ink at a point of the page, in millimetres. */
async function tailInkAt(page: Page, x: number, y: number): Promise<boolean> {
  const box = (await page.locator('.nw-page').first().boundingBox())!
  const client = { x: box.x + (x / 210) * box.width, y: box.y + (y / 297) * box.height }
  return page.locator('canvas.nw-live-ink').nth(1).evaluate((canvas: HTMLCanvasElement, at) => {
    const rect = canvas.getBoundingClientRect()
    const scale = canvas.width / rect.width
    const pixel = canvas.getContext('2d')!.getImageData(Math.round((at.x - rect.left) * scale), Math.round((at.y - rect.top) * scale), 1, 1).data
    return pixel[3]! > 0
  }, client)
}

test("while a pen writes or erases, its dot or ring is drawn at its tip, as Windows hides the cursor then; gone when it lifts", async ({ page }) => {
  await start(page)
  await tool(page, 'Pen').click()
  const stroke = strokeOf('pen', 7, Array.from({ length: 12 }, (_, i): [number, number] => [40 + i * 3, 150 + Math.sin(i) * 2]))
  await send(page, stroke.slice(0, -1))
  expect(await tailInkAt(page, 40 + 10 * 3, 150 + Math.sin(10) * 2)).toBe(true)
  await send(page, stroke.slice(-1))
  expect(await tailInkAt(page, 40 + 10 * 3, 150 + Math.sin(10) * 2)).toBe(false)
  // The eraser's ring, the same way.
  await tool(page, 'Eraser').click()
  const sweep = strokeOf('pen', 8, [[100, 200], [110, 200], [120, 200]])
  await send(page, sweep.slice(0, -1))
  expect(await tailInkAt(page, 110 + 2.5, 200)).toBe(true)
  await send(page, sweep.slice(-1))
  expect(await tailInkAt(page, 110 + 2.5, 200)).toBe(false)
})

test('the plain pen is a ballpoint, its width moving only a little with pressure; the fountain pen swings with it', async ({ page }) => {
  await start(page)
  await tool(page, 'Pen').click()
  /** The pressures a stroke keeps, written with pressures from light to firm. */
  const written = async (kind: string, y: number): Promise<number[]> => {
    await page.getByRole('radio', { name: kind, exact: true }).click()
    const before = await inks(page)
    const points = Array.from({ length: 16 }, (_, i): [number, number] => [40 + i * 3, y + Math.sin(i) * 3])
    await send(page, strokeOf('pen', 11, points).map((step, i) => ({ ...step, pressure: step.kind === 'pointerup' ? 0 : 0.05 + (i % 5) * 0.2 })))
    await expect.poll(async () => (await added(page, before)).flatMap((ink) => ink.strokes).length).toBeGreaterThan(0)
    return (await added(page, before)).flatMap((ink) => ink.strokes)[0]!.pts.filter((_, i) => i % 3 === 2)
  }
  const plain = await written('Plain pen', 150)
  // About 0.8 to 1.3 times the width, 128 being the width chosen.
  expect(Math.min(...plain)).toBeGreaterThanOrEqual(Math.floor(128 * 0.79))
  expect(Math.max(...plain)).toBeLessThanOrEqual(Math.ceil(128 * 1.3))
  const fountain = await written('Fountain pen', 190)
  expect(Math.max(...fountain) - Math.min(...fountain)).toBeGreaterThan(Math.max(...plain) - Math.min(...plain))
})

test('pressure off: a pen draws an even width, however hard it presses', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await page.getByRole('combobox', { name: 'Pressure' }).selectOption({ label: 'Off (even width)' })
  await page.keyboard.press('Escape')
  const points = Array.from({ length: 14 }, (_, i): [number, number] => [40 + i * 3, 160 + Math.sin(i) * 3])
  await send(page, strokeOf('pen', 9, points).map((step, i) => ({ ...step, pressure: step.kind === 'pointerup' ? 0 : 0.1 + (i % 4) * 0.25 })))
  await expect.poll(async () => (await added(page, before)).flatMap((ink) => ink.strokes).length).toBe(1)
  const pts = (await added(page, before))[0]!.strokes[0]!.pts
  expect(pts.filter((_, i) => i % 3 === 2).every((p) => p === 128)).toBe(true)
})

test('a finger draws until a pen is used; a big contact, or a touch while the pen writes, is a palm and does nothing', async ({ page }) => {
  await start(page)
  await tool(page, 'Pen').click()
  const strokes = await strokeCount(page)
  await send(page, strokeOf('touch', 21, wave(40, 150, 40)))
  await expect.poll(() => strokeCount(page)).toBe(strokes + 1)
  // A big contact is a palm, pen or no pen.
  await send(page, strokeOf('touch', 22, wave(40, 170, 40), 80))
  expect(await strokeCount(page)).toBe(strokes + 1)
  // The hand resting on the screen while the pen writes: the pen's stroke only, and no scrolling.
  const scrolled = await page.locator('.nw-desk').evaluate((desk) => desk.scrollTop)
  const pen = strokeOf('pen', 23, wave(40, 190, 40))
  const palm = strokeOf('touch', 24, wave(60, 230, 40))
  await send(page, [...pen.slice(0, 10), ...palm, ...pen.slice(10)])
  await expect.poll(() => strokeCount(page)).toBe(strokes + 2)
  expect(await page.locator('.nw-desk').evaluate((desk) => desk.scrollTop)).toBe(scrolled)
})

test('the cursor stays the pen dot while writing, over the page and the desk around it', async ({ page }) => {
  await start(page)
  await tool(page, 'Pen').click()
  // While the pen is down its events go to the desk, which then gives the cursor: the same dot.
  const cursor = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).cursor)
  expect(await cursor('.nw-desk')).toMatch(/^url\("data:image\/svg\+xml/)
  expect(await cursor('.nw-page')).toBe(await cursor('.nw-desk'))
  await tool(page, 'Type').click()
  expect(await cursor('.nw-desk')).not.toMatch(/^url/)
})

test('a bracket is neatened the moment the pen lifts, as a second undo step, unless its switch is off', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  // An opening bracket, 10 mm tall: a shallow curve bulging left.
  const paren = (x: number): [number, number][] => Array.from({ length: 21 }, (_, i) => [x + 2.5 * (1 - Math.sin((i / 20) * Math.PI)), 150 + i * 0.5])
  await write(page, paren(60))
  await expect.poll(async () => (await added(page, before))[0]?.strokes[0]?.shape?.kind).toBe('paren')
  expect((await added(page, before))[0]!.strokes[0]!.shape!.key[4]).toBe(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await added(page, before))[0]?.strokes[0]?.shape).toBeUndefined()
  // Switched off in Pen settings: left as drawn.
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await page.getByRole('checkbox', { name: '( )' }).uncheck()
  await page.keyboard.press('Escape')
  await write(page, paren(90))
  const strokes = async () => (await added(page, before)).flatMap((ink) => ink.strokes)
  await expect.poll(async () => (await strokes()).length).toBe(2)
  expect((await strokes()).every((stroke) => stroke.shape === undefined)).toBe(true)
})

test('undoing a correction at once teaches the pen to leave strokes like that one alone, and it is kept with the library', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  const line = (y: number): [number, number][] => Array.from({ length: 12 }, (_, i) => [40 + i * 6, y + (i % 2) * 0.2])
  const strokes = async () => (await added(page, before)).flatMap((ink) => ink.strokes)
  await write(page, line(150))
  await expect.poll(async () => (await strokes())[0]?.straight).toBe(true)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await strokes())[0]?.straight).toBeUndefined()
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await expect(page.getByRole('group', { name: 'Your hand' })).toContainText('learned from 1 correction you undid')
  await page.keyboard.press('Escape')
  // The same stroke again, further down: left as drawn.
  await write(page, line(185))
  await expect.poll(async () => (await strokes()).length).toBe(2)
  expect((await strokes()).every((stroke) => stroke.straight === undefined)).toBe(true)
  // Kept in the library, so a reload still knows it.
  await page.reload()
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await tool(page, 'Pen').click()
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await expect(page.getByRole('group', { name: 'Your hand' })).toContainText('learned from 1 correction you undid')
  // Forgotten, after asking.
  await page.getByRole('button', { name: 'Forget…' }).click()
  await page.getByRole('button', { name: 'Forget', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Your hand' })).toContainText('the pen goes by general rules')
})

test('redoing a correction straight after undoing it keeps the correction, and the pen unlearns the lesson', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  const line = (y: number): [number, number][] => Array.from({ length: 12 }, (_, i) => [40 + i * 6, y + (i % 2) * 0.2])
  const strokes = async () => (await added(page, before)).flatMap((ink) => ink.strokes)
  await write(page, line(150))
  await expect.poll(async () => (await strokes())[0]?.straight).toBe(true)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await strokes())[0]?.straight).toBeUndefined()
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect.poll(async () => (await strokes())[0]?.straight).toBe(true)
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await expect(page.getByRole('group', { name: 'Your hand' })).toContainText('the pen goes by general rules')
  await page.keyboard.press('Escape')
  // So the same line again is straightened, as before any lesson.
  await write(page, line(185))
  await expect.poll(async () => (await strokes()).filter((stroke) => stroke.straight).length).toBe(2)
})

test('a quick scribble over a word deletes it, and is not kept itself; one undo brings the word back', async ({ page }) => {
  await start(page)
  await tool(page, 'Pen').click()
  const strokes = await strokeCount(page)
  await write(page, wave(40, 150, 25))
  await write(page, wave(40, 157, 25))
  await expect.poll(() => strokeCount(page)).toBe(strokes + 2)
  // Two back-and-forths across the word, a point every millimetre as a pen sends them.
  const corners: [number, number][] = [
    [37, 149],
    [68, 151],
    [38, 154],
    [67, 156],
    [37, 159],
  ]
  const scribble = corners.slice(1).flatMap(([x, y], i) => {
    const [fx, fy] = corners[i]!
    const n = Math.ceil(Math.hypot(x - fx, y - fy))
    return Array.from({ length: n }, (_, k): [number, number] => [fx + ((x - fx) * (k + 1)) / n, fy + ((y - fy) * (k + 1)) / n])
  })
  await write(page, [corners[0]!, ...scribble])
  await expect.poll(() => strokeCount(page)).toBe(strokes)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => strokeCount(page)).toBe(strokes + 2)
})

test('a new letter never redraws the letters before it, whichever way the ink grows', async ({ page }) => {
  await start(page)
  await tool(page, 'Pen').click()
  const letter = (x: number): [number, number][] => Array.from({ length: 25 }, (_, i) => [x + (i / 24) * 6 + 1.5 * Math.sin(i / 3), 150 - 6 * Math.abs(Math.sin((i / 24) * Math.PI * 1.3))])
  for (let k = 0; k < 3; k++) await write(page, letter(60 + k * 9))
  await expect(page.locator('[data-free="ink"]')).toHaveCount(2)
  // Watch the ink already drawn while two more letters land: one to the right, which grows the box, and one to
  // the left, which moves its corner and every stroke in it.
  const ink = page.locator('[data-free="ink"]').last()
  await ink.evaluate((el) => {
    const seen: string[] = []
    ;(window as unknown as { seen: string[] }).seen = seen
    const svg = el.querySelector('svg.nw-ink')!
    const old = new Set(svg.querySelectorAll('path'))
    new MutationObserver((list) => {
      for (const m of list) {
        // Its placement in the box moves as the box does, the other way: on the page it stays still (checked below).
        if (m.target === svg && m.type === 'attributes' && m.attributeName !== 'style') seen.push(`svg ${m.attributeName}`)
        if (m.type === 'attributes' && old.has(m.target as SVGPathElement)) seen.push(`old path ${m.attributeName}`)
        for (const gone of m.removedNodes) if (gone instanceof Element && gone.querySelector('path') && [...gone.querySelectorAll('path')].some((p) => old.has(p))) seen.push('old path removed')
      }
    }).observe(svg, { subtree: true, attributes: true, childList: true })
  })
  const where = () => ink.locator('svg.nw-ink').evaluate((svg) => svg.getBoundingClientRect().toJSON() as { x: number; y: number; width: number })
  const before = await where()
  await write(page, letter(87))
  await write(page, letter(51))
  await expect.poll(() => ink.locator('svg.nw-ink > g').count()).toBe(5)
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([])
  const after = await where()
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.05)
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.05)
  expect(after.width).toBeCloseTo(before.width, 3)
})

test.describe('at 125 % screen scaling, as on most laptops', () => {
  test.use({ deviceScaleFactor: 1.25 })

  test('nothing on the screen changes when the pen lifts: the live line is the line kept, pixel for pixel', async ({ page }) => {
    await page.goto('/#/new')
    await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
    await tool(page, 'Pen').click()
    await page.getByRole('radio', { name: 'Extra fine' }).click()
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
    // The writing spot, 55 mm across and 38 mm down, in the middle of the view.
    await page.locator('.nw-desk').evaluate((desk) => {
      const sheet = desk.querySelector('.nw-page')!.getBoundingClientRect()
      const view = desk.getBoundingClientRect()
      desk.scrollBy(sheet.left + (55 / 210) * sheet.width - (view.left + view.width / 2), sheet.top + (38 / 297) * sheet.height - (view.top + view.height / 2))
    })
    const b = (await page.locator('.nw-page').first().boundingBox())!
    const at = (x: number, y: number) => ({ x: b.x + (x / 210) * b.width, y: b.y + (y / 297) * b.height })
    // How many pixels differ between two pictures, slightly (an edge's shade) and clearly, worked out by the browser itself.
    const compare = (a: Buffer, c: Buffer) =>
      page.evaluate(
        async ([a, c]) => {
          const read = async (png: string) => {
            // From its bytes, not fetched: the desktop app's policy lets the page fetch no data: address.
            const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (letter) => letter.charCodeAt(0))], { type: 'image/png' }))
            const canvas = new OffscreenCanvas(image.width, image.height)
            const g = canvas.getContext('2d')!
            g.drawImage(image, 0, 0)
            return g.getImageData(0, 0, image.width, image.height).data
          }
          const [x, y] = await Promise.all([read(a), read(c)])
          let slight = 0
          let clear = 0
          let ink = 0
          for (let i = 0; i < x.length; i += 4) {
            const d = Math.abs(x[i]! - y[i]!) + Math.abs(x[i + 1]! - y[i + 1]!) + Math.abs(x[i + 2]! - y[i + 2]!)
            if (d > 90) slight++
            if (d > 300) clear++
            if (x[i]! < 128) ink++
          }
          return { slight, clear, ink }
        },
        [a.toString('base64'), c.toString('base64')] as const,
      )
    for (let n = 0; n < 3; n++) {
      // A letter like an m: humps, as a hand writes it.
      const x0 = 50 + n * 4
      const pts = Array.from({ length: 60 }, (_, i) => at(x0 + (i / 59) * 3, 40 - 2.2 * Math.abs(Math.sin((i / 59) * Math.PI * 2.5))))
      const clip = { x: at(x0, 40).x - 20, y: at(x0, 40).y - 120, width: 260, height: 160 }
      await page.mouse.move(pts[0]!.x, pts[0]!.y)
      await page.mouse.down()
      for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y)
      await expect.poll(async () => (await page.screenshot({ clip })).length).toBeGreaterThan(0)
      const down = await page.screenshot({ clip })
      await page.mouse.up()
      await expect.poll(() => strokeCount(page)).toBe(n + 1)
      // Once the page has drawn the kept stroke and the live one has gone.
      await expect.poll(() => page.locator('canvas.nw-live-ink').first().evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v) => v !== 0))).toBe(false)
      const up = await page.screenshot({ clip })
      const { slight, clear, ink } = await compare(down, up)
      // One pixel at an edge may round otherwise: the live line is drawn on a canvas, the kept one by the page, and a
      // graphics chip draws the two each its own way (on the laptop's NVIDIA chip in 15 runs of 24, on its Intel chip, the
      // app's own, in 1 of 24; never more than that one pixel, with the line on whole screen pixels).
      // A line moved or thinned changes a hundred or more.
      expect(clear, `letter ${n}: pixels clearly changed`).toBeLessThanOrEqual(1)
      expect(slight / ink, `letter ${n}: share of its pixels changed even slightly`).toBeLessThan(0.1)
    }
  })
})

test("with shading and scratch-outs taught, shading across a drawing keeps it, and a quick scribble over a word still deletes it", async ({ page }) => {
  // Long by design: it teaches the pen, then draws hatching and scribbles a point every millimetre, one pointer event
  // each. Alone on an idle laptop it takes about 30 s, the default limit (measured 24 October 2026), so it gets three.
  test.slow()
  /** A path through corners (millimetres), a point every millimetre, as a pen sends them. */
  const through = (corners: readonly [number, number][]): [number, number][] => [
    corners[0]!,
    ...corners.slice(1).flatMap(([x, y], i) => {
      const [fx, fy] = corners[i]!
      const n = Math.ceil(Math.hypot(x - fx, y - fy))
      return Array.from({ length: n }, (_, k): [number, number] => [fx + ((x - fx) * (k + 1)) / n, fy + ((y - fy) * (k + 1)) / n])
    }),
  ]
  const hatching = (x: number, y: number, w: number, h: number, passes: number): [number, number][] => through(Array.from({ length: passes + 1 }, (_, k): [number, number] => [x + (k % 2) * w, y + (h * k) / passes + (k % 2) * 4]))
  const scribble = (x: number, y: number): [number, number][] => through([[x, y], [x + 31, y + 2], [x + 1, y + 5], [x + 30, y + 7], [x, y + 10]])
  const circle = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 61 }, (_, i): [number, number] => [cx + r * Math.cos((i / 60) * 2.1 * Math.PI), cy + r * Math.sin((i / 60) * 2.1 * Math.PI)])

  await start(page)
  await tool(page, 'Pen').click()
  const strokes = await strokeCount(page)
  // The premise: with the general rules alone, shading across a circle deletes it.
  await write(page, circle(55, 210, 18))
  await expect.poll(() => strokeCount(page)).toBe(strokes + 1)
  await write(page, hatching(33, 193, 44, 34, 8))
  await expect.poll(() => strokeCount(page)).toBe(strokes)

  // Teach the pen: writing, scratch-outs over a word, and shading, as the recorder keeps them (0.01 mm, a sample every 8 ms),
  // left where the recorder looked before, which it carries into the library the first time it opens.
  await page.evaluate(
    ({ words, scratches, shades }) => {
      const stroke = (points: [number, number][]) => ({ type: 'pen', samples: points.map(([x, y], i) => [Math.round(x * 100), Math.round(y * 100), 0.5, 0, 0, i * 8, 1, 1]) })
      const items = [
        ...scratches.map(([word, scratch]) => ({ kind: 'scratch', strokes: [stroke(word!), stroke(scratch!)] })),
        ...words.map((word) => ({ kind: 'word', strokes: [stroke(word)] })),
        ...shades.map((shade) => ({ kind: 'shade', strokes: [stroke(shade)] })),
      ]
      localStorage.setItem('shellnote:recorded-strokes', JSON.stringify({ v: 1, device: { userAgent: 'test', dpr: 1 }, started: '2026-10-16T00:00:00.000Z', items }))
    },
    {
      words: Array.from({ length: 24 }, (_, k) => wave(10 + (k % 5), 20 + k * 3, 18 + (k % 7) * 2)),
      scratches: [0, 1, 2].map((k) => [wave(10, 20 + k * 20, 25), scribble(8 + k, 18 + k * 20)]),
      shades: [0, 1, 2, 3].map((k) => hatching(20 + k, 20 + k * 2, 42 + k * 2, 32 + k, 8)),
    },
  )
  await page.goto('/?record=strokes')
  await page.getByRole('button', { name: 'Teach my pen' }).click()
  await expect(page.getByRole('status')).toContainText('your scratch-outs, your shading, which deletes nothing')

  await start(page)
  await tool(page, 'Pen').click()
  const now = await strokeCount(page)
  await write(page, circle(55, 210, 18))
  await expect.poll(() => strokeCount(page)).toBe(now + 1)
  await write(page, hatching(33, 193, 44, 34, 8))
  // The shading is kept as ink, and the circle stays.
  await expect.poll(() => strokeCount(page)).toBe(now + 2)
  // A quick scribble over a word still deletes the word.
  await write(page, wave(40, 150, 25))
  await write(page, wave(40, 157, 25))
  await expect.poll(() => strokeCount(page)).toBe(now + 4)
  await write(page, scribble(37, 149))
  await expect.poll(() => strokeCount(page)).toBe(now + 2)
})

/** A path through corners (millimetres on the page), a point every millimetre or so, as a hand moves. */
const through = (corners: readonly [number, number][]): [number, number][] =>
  corners.flatMap(([x, y], i) => {
    if (i === 0) return [[x, y] as [number, number]]
    const [x0, y0] = corners[i - 1]!
    const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0)))
    return Array.from({ length: n }, (_, k): [number, number] => [x0 + ((x - x0) * (k + 1)) / n, y0 + ((y - y0) * (k + 1)) / n])
  })

/** An arrow pointing right, its tail at x, y, `length` long, its barbs `barb` long at 35° off straight back: tip, the barb above, the one below. */
const head = (x: number, y: number, length: number, barb: number) => ({
  tip: [x + length, y] as [number, number],
  up: [x + length - barb * Math.cos((35 * Math.PI) / 180), y - barb * Math.sin((35 * Math.PI) / 180)] as [number, number],
  down: [x + length - barb * Math.cos((35 * Math.PI) / 180), y + barb * Math.sin((35 * Math.PI) / 180)] as [number, number],
})

/** Every stroke the note did not have before, across its new ink blocks. */
const newStrokes = async (page: Page, before: readonly Ink[]) => (await added(page, before)).flatMap((ink) => ink.strokes)

test('an arrow drawn in one stroke becomes an arrow as the pen lifts, with no hold, an inch long and under; the frame after the lift shows it', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  // The design: the shaft, a barb, back to the tip, the other barb. The shaft bows 1.2 mm, as a hand's does.
  const { tip, up, down } = head(40, 150, 40, 9)
  const shaft = Array.from({ length: 41 }, (_, i): [number, number] => [40 + i, 150 + 1.2 * Math.sin((i / 40) * Math.PI)])
  // Read the live layer as the lift is handled, before any frame is drawn: after the pen layer's own handler.
  const probe = [at(page, 60, 150), at(page, 60, 151.2)]
  const [onLine, onBow] = await Promise.all(probe)
  await page.evaluate(([onLine, onBow]) => {
    window.addEventListener(
      'pointerup',
      () => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas.nw-live-ink')!
        const rect = canvas.getBoundingClientRect()
        const scale = canvas.width / rect.width
        const g = canvas.getContext('2d')!
        const inkAt = (p: { x: number; y: number }) => g.getImageData(Math.round((p.x - rect.left) * scale) - 1, Math.round((p.y - rect.top) * scale) - 1, 3, 3).data.some((v, i) => i % 4 === 3 && v > 0)
        ;(window as unknown as { lifted: unknown }).lifted = { onLine: inkAt(onLine!), onBow: inkAt(onBow!) }
      },
      { once: true },
    )
  }, [onLine, onBow])
  await write(page, [...shaft, ...through([tip, up, tip, down]).slice(1)])
  await expect.poll(async () => (await newStrokes(page, before))[0]?.shape?.kind).toBe('arrow')
  const key = (await newStrokes(page, before))[0]!.shape!.key
  // From the tail to the tip, level.
  expect(key[1]).toBe(key[3])
  expect(Math.abs(key[2]! - key[0]! - 4000)).toBeLessThan(150)
  // The straight shaft is on the live layer as the lift is handled, the bowed one as drawn is not.
  expect(await page.evaluate(() => (window as unknown as { lifted: unknown }).lifted)).toEqual({ onLine: true, onBow: false })
  // A small one, 18 mm long.
  const small = head(120, 150, 18, 5)
  await write(page, through([[120, 150], small.tip, small.up, small.tip, small.down]))
  await expect.poll(async () => (await newStrokes(page, before)).at(-1)?.shape?.kind).toBe('arrow')
  // One undo gives back the arrow as drawn. (Undone, it also teaches the pen to leave strokes like it alone, so
  // nothing like it is drawn after.)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await newStrokes(page, before)).at(-1)?.shape).toBeUndefined()
})

test('a line and its head drawn as the next stroke become one arrow, either first; one undo gives both back', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  // The line, then the head.
  const a = head(40, 200, 40, 9)
  await write(page, through([[40, 200], a.tip]))
  await expect.poll(async () => (await newStrokes(page, before))[0]?.straight).toBe(true)
  await write(page, through([a.up, a.tip, a.down]))
  await expect.poll(async () => (await newStrokes(page, before)).map((s) => s.shape?.kind ?? 'ink')).toEqual(['arrow'])
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await newStrokes(page, before)).map((s) => (s.straight ? 'line' : (s.shape?.kind ?? 'ink')))).toEqual(['line', 'ink'])
  // The head first, then the line: small, 15 mm.
  const b = head(120, 240, 15, 5)
  await write(page, through([b.up, b.tip, b.down]))
  await write(page, through([[120, 240], b.tip]))
  await expect.poll(async () => (await newStrokes(page, before)).filter((s) => s.shape?.kind === 'arrow')).toHaveLength(1)
  const arrow = (await newStrokes(page, before)).find((s) => s.shape?.kind === 'arrow')!
  expect(arrow.shape!.key[2]! - arrow.shape!.key[0]!).toBeGreaterThan(1300)
})

test('held still a quarter of a second, a stroke shows as its shape and lifting keeps it; moving on, it stays ink', async ({ page }) => {
  await page.clock.install()
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  const circle = (cx: number, cy: number) => Array.from({ length: 41 }, (_, i): [number, number] => [cx + 15 * Math.cos((i / 40) * 2.1 * Math.PI), cy + 15 * Math.sin((i / 40) * 2.1 * Math.PI)])
  await write(page, circle(60, 150), () => page.clock.runFor(300))
  await expect.poll(async () => (await newStrokes(page, before))[0]?.shape?.kind).toBe('circle')
  // A pause as long, then on: a pause in writing.
  const screen = await Promise.all([...circle(140, 150), ...through([[155, 150], [170, 175]])].map(([x, y]) => at(page, x, y)))
  await page.mouse.move(screen[0]!.x, screen[0]!.y)
  await page.mouse.down()
  for (const pt of screen.slice(1, 41)) await page.mouse.move(pt.x, pt.y)
  await page.clock.runFor(300)
  for (const pt of screen.slice(41)) await page.mouse.move(pt.x, pt.y)
  await page.mouse.up()
  await expect.poll(async () => (await newStrokes(page, before)).length).toBe(2)
  const ink = (await newStrokes(page, before))[1]!
  expect(ink.shape).toBeUndefined()
  // Kept as drawn, on to the end of the line it went on with.
  const ys = ink.pts.filter((_, i) => i % 3 === 1)
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3500)
})

/** Smoothing off in this person's Pen settings, so a small flick drawn with the mouse stays as drawn. */
async function smoothingOff(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await page.getByRole('combobox', { name: 'Smoothing' }).selectOption({ label: 'Off' })
  await page.keyboard.press('Escape')
}

/** The new ink's strokes as points on the page, in 0.01 mm. */
async function onPage(page: Page, before: readonly Ink[]): Promise<[number, number][][]> {
  const blocks = (await page.evaluate((ids) => Object.values(window.__shellnote!.doc.block).filter((b) => b.type === 'ink' && !ids.includes(b.id)), before.map((b) => b.id))) as unknown as { x: number; y: number; strokes: { pts: number[] }[] }[]
  return blocks.flatMap((b) => b.strokes.map((s) => Array.from({ length: s.pts.length / 3 }, (_, i): [number, number] => [b.x + s.pts[3 * i]!, b.y + s.pts[3 * i + 1]!])))
}

/** A letter l, 6 mm tall at x, y, its foot flicking back up 0.35 mm as the pen lifts, with the mouse. */
const ell = (x: number, y: number, tail = true): [number, number][] => [...through([[x, y], [x, y + 6]]), ...(tail ? ([[x + 0.2, y + 5.72]] as [number, number][]) : [])]
/** An o, 3 mm across, centred at x, y. */
const oh = (x: number, y: number): [number, number][] => Array.from({ length: 25 }, (_, i): [number, number] => [x + 1.5 * Math.cos((i / 24) * 2 * Math.PI), y + 1.5 * Math.sin((i / 24) * 2 * Math.PI)])

test('a stroke is tidied as the pen lifts: the tail where it lifted is cut at once, as its own undo step', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  await smoothingOff(page)
  await write(page, ell(40, 150))
  // Kept already tidied: the foot, which flicked back up as drawn, ends where the downstroke did; nothing waits.
  const [kept] = await onPage(page, before)
  expect(kept!.at(-1)![1]).toBeGreaterThanOrEqual(15595)
  // Undo: first the tidy, which gives back the l as drawn, its foot flicking up; then the stroke.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await onPage(page, before))[0]!.at(-1)![1]).toBeLessThan(15590)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await onPage(page, before)).length).toBe(0)
})

test('a line is levelled as the next line starts: each word moved, whole, onto the line', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  // Two words on a line, the second written 1 mm lower.
  await write(page, oh(40, 150))
  await write(page, ell(42.3, 146, false))
  await write(page, oh(60, 151))
  await write(page, ell(62.3, 147, false))
  await expect.poll(async () => (await newStrokes(page, before)).length).toBe(4)
  // The first line's strokes, left to right (o, l, o, l), by their tops: the tidy may put a block after the next line's.
  const tops = async () =>
    (await onPage(page, before))
      .filter((stroke) => Math.min(...stroke.map((pt) => pt[1])) < 16000)
      .sort((a, b) => Math.min(...a.map((pt) => pt[0])) - Math.min(...b.map((pt) => pt[0])))
      .map((stroke) => Math.min(...stroke.map((pt) => pt[1])))
  const was = await tops()
  expect(Math.abs(was[2]! - was[0]! - 100)).toBeLessThan(30)
  // The next line.
  await write(page, oh(40, 170))
  await expect.poll(async () => {
    const now = await tops()
    return Math.abs(now[2]! - now[0]!)
  }).toBeLessThan(15)
})

test('the person chooses the word a line is put on: with Last word, the first word comes onto the last', async ({ page }) => {
  await page.clock.install()
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await page.getByRole('combobox', { name: 'Line up words on' }).selectOption({ label: 'Last word' })
  await expect(page.getByRole('combobox', { name: 'Gap between words' })).toHaveValue('usual')
  await page.keyboard.press('Escape')
  // Two words on a line, the second 1 mm lower.
  await write(page, oh(40, 150))
  await write(page, ell(42.3, 146, false))
  await write(page, oh(60, 151))
  await write(page, ell(62.3, 147, false))
  await expect.poll(async () => (await newStrokes(page, before)).length).toBe(4)
  const tops = async () =>
    (await onPage(page, before)).sort((a, b) => Math.min(...a.map((pt) => pt[0])) - Math.min(...b.map((pt) => pt[0]))).map((stroke) => Math.min(...stroke.map((pt) => pt[1])))
  const was = await tops()
  await page.clock.runFor(1700)
  // The first word came down 1 mm onto the second; the second stayed (its letters only put on its own line, half a
  // millimetre at most).
  await expect.poll(async () => (await tops())[0]! - was[0]!).toBeGreaterThan(80)
  const now = await tops()
  for (const k of [2, 3]) expect(Math.abs(now[k]! - was[k]!)).toBeLessThan(60)
})

test('developer mode: each tidy rule on or off by itself; with Words onto the line off, a line is not levelled', async ({ page }) => {
  await page.clock.install()
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await expect(page.getByRole('checkbox', { name: 'Words onto the line' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Developer mode' }).check()
  await page.getByRole('checkbox', { name: 'Words onto the line' }).uncheck()
  await page.keyboard.press('Escape')
  // Two words on a line, the second 1 mm lower; a rest.
  await write(page, oh(40, 150))
  await write(page, ell(42.3, 146, false))
  await write(page, oh(60, 151))
  await write(page, ell(62.3, 147, false))
  await expect.poll(async () => (await newStrokes(page, before)).length).toBe(4)
  const tops = async () =>
    (await onPage(page, before)).sort((a, b) => Math.min(...a.map((pt) => pt[0])) - Math.min(...b.map((pt) => pt[0]))).map((stroke) => Math.min(...stroke.map((pt) => pt[1])))
  await page.clock.runFor(1700)
  await page.waitForTimeout(300)
  const now = await tops()
  // Still 1 mm apart: not levelled.
  expect(Math.abs(now[2]! - now[0]! - 100)).toBeLessThan(30)
})

test('the line being written is levelled when the pen rests 1.5 s, with no next line', async ({ page }) => {
  await page.clock.install()
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  // Two words on a line, the second 1 mm lower.
  await write(page, oh(40, 150))
  await write(page, ell(42.3, 146, false))
  await write(page, oh(60, 151))
  await write(page, ell(62.3, 147, false))
  await expect.poll(async () => (await newStrokes(page, before)).length).toBe(4)
  const tops = async () => (await onPage(page, before)).map((stroke) => Math.min(...stroke.map((pt) => pt[1])))
  const was = await tops()
  expect(Math.abs(was[2]! - was[0]! - 100)).toBeLessThan(30)
  // A second's rest: nothing yet.
  await page.clock.runFor(1000)
  expect(await tops()).toEqual(was)
  // Past 1.5 s: the line is level.
  await page.clock.runFor(700)
  await expect.poll(async () => {
    const now = await tops()
    return Math.abs(now[2]! - now[0]!)
  }).toBeLessThan(15)
})

/** A pen's stroke through points of the page (millimetres), a few milliseconds between samples, as a hand writes: the pen's line needs the time between them. */
async function penWrites(page: Page, points: readonly [number, number][]): Promise<void> {
  const box = (await page.locator('.nw-page').first().boundingBox())!
  const screen = points.map(([x, y], i) => ({ kind: i === 0 ? 'pointerdown' : i === points.length - 1 ? 'pointerup' : 'pointermove', x: box.x + (x / 210) * box.width, y: box.y + (y / 297) * box.height }))
  await page.evaluate(async (screen) => {
    for (const step of screen) {
      await new Promise((resolve) => setTimeout(resolve, 4))
      document.elementFromPoint(step.x, step.y)!.dispatchEvent(
        new PointerEvent(step.kind, { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: step.x, clientY: step.y, width: 1, height: 1, pressure: step.kind === 'pointerup' ? 0 : 0.5, button: step.kind === 'pointermove' ? -1 : 0, buttons: step.kind === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true }),
      )
    }
  }, screen)
}

test("a recorded sentence, a word written a letter too high, comes level as the next line starts; the word after it stays on the line", async ({ page }) => {
  // "Hello my name is akshat" as it was recorded, in 0.01 mm: words 0-5, 6-8 (name), 9-13, 14-19.
  const recording = JSON.parse(readFileSync(new URL('../../../packages/core/test/ink/fixtures/recorded-strokes.json', import.meta.url), 'utf8')) as { items: { strokes: { samples: number[][] }[] }[] }
  const strokes = recording.items[472]!.strokes.map((stroke) => stroke.samples.map(([x, y]): [number, number] => [x!, y!]))
  const all = strokes.flat()
  const x0 = Math.min(...all.map((pt) => pt[0]))
  const y0 = Math.min(...all.map((pt) => pt[1]))
  // "name" written 3 mm high: a little over its letters' height.
  const raised = new Set([6, 7, 8])
  const lines = strokes.map((stroke, i) => stroke.map(([x, y]): [number, number] => [30 + (x - x0) / 100, 120 + (y - y0) / 100 - (raised.has(i) ? 3 : 0)]))
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  // Written with Words only, so nothing levels it on a rest before it is measured; then Words and lines.
  const tidyMode = async (label: string) => {
    await page.getByRole('button', { name: 'Pen settings' }).click()
    await page.getByRole('combobox', { name: 'Tidy handwriting' }).selectOption({ label })
    await page.keyboard.press('Escape')
  }
  await tidyMode('Words only')
  for (const stroke of lines) await penWrites(page, stroke)
  await expect.poll(async () => (await onPage(page, before)).length).toBe(20)
  // Each stroke found by its place left to right, as written: tidying moves words, never past each other, and may
  // reorder the note's blocks.
  const left = (stroke: readonly (readonly number[])[]) => Math.min(...stroke.map((pt) => pt[0]!))
  const rank = lines.map((_, k) => k).sort((a, b) => left(lines[a]!) - left(lines[b]!))
  const bottoms = async () => {
    // The sentence's strokes, not the next line's (from 150 mm down).
    const kept = (await onPage(page, before)).filter((stroke) => Math.min(...stroke.map((pt) => pt[1])) < 14500).sort((a, b) => left(a) - left(b))
    const out: number[] = []
    rank.forEach((k, place) => (out[k] = Math.max(...kept[place]!.map((pt) => pt[1]))))
    return out
  }
  // Measured once still: a word is tidied as the pen lifts when the browser is next idle, later under load (found 18
  // October 2026, with 12 tests at once).
  let was = await bottoms()
  for (let still = false; !still; ) {
    await page.waitForTimeout(200)
    const again = await bottoms()
    still = again.every((bottom, i) => bottom === was[i])
    was = again
  }
  // The next line: name comes down the 3 mm; no word after it is pushed down (they were, judged by name as written).
  // Each letter also comes onto its word's line, so a letter may move a little more or less than its word.
  await tidyMode('Words and lines')
  await penWrites(page, through([[30, 150], [31, 155], [33, 150]]))
  await expect.poll(async () => (await bottoms())[7]! - was[7]!).toBeGreaterThan(220)
  const now = await bottoms()
  for (const i of [6, 7]) expect(Math.abs(now[i]! - was[i]! - 300)).toBeLessThan(60)
  for (let i = 9; i < 20; i++) expect(now[i]! - was[i]!).toBeLessThan(50)
})

test('the wand: a box dragged over writing tidies just that, as one undo step; Whole note tidies all; Escape puts it away; switched off, it is off', async ({ page }) => {
  await start(page)
  const before = await inks(page)
  await tool(page, 'Pen').click()
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await page.getByRole('combobox', { name: 'Tidy handwriting' }).selectOption({ label: 'Tidy button only' })
  await page.getByRole('combobox', { name: 'Smoothing' }).selectOption({ label: 'Off' })
  await page.keyboard.press('Escape')
  await write(page, ell(40, 150))
  await write(page, ell(60, 150))
  await expect.poll(async () => (await onPage(page, before)).length).toBe(2)
  const drawn = await onPage(page, before)
  // Nothing on its own.
  await page.waitForTimeout(500)
  expect(await onPage(page, before)).toEqual(drawn)
  const wand = page.getByRole('button', { name: 'Tidy handwriting' })
  // A box over the first l: that one tidied, not the other, and the wand put away; no stroke drawn.
  await wand.click()
  await expect(wand).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status').filter({ hasText: 'Drag over the writing' })).toBeVisible()
  await write(page, [[34, 144], [40, 152], [48, 160]])
  await expect(wand).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await onPage(page, before)).map((s) => s.at(-1)![1] >= 15595)).toEqual([true, false])
  expect((await onPage(page, before)).length).toBe(2)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => await onPage(page, before)).toEqual(drawn)
  // Escape puts the wand away; the next stroke is ink.
  await wand.click()
  await page.keyboard.press('Escape')
  await expect(wand).toHaveAttribute('aria-pressed', 'false')
  // Whole note: both.
  await wand.click()
  await page.getByRole('button', { name: 'Whole note' }).click()
  await expect(wand).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await onPage(page, before)).every((s) => s.at(-1)![1] >= 15595)).toBe(true)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => await onPage(page, before)).toEqual(drawn)
  await page.getByRole('button', { name: 'Pen settings' }).click()
  await page.getByRole('combobox', { name: 'Tidy handwriting' }).selectOption({ label: 'Off' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Tidy handwriting' })).toBeDisabled()
})

test('elsewhere the pen’s live canvas goes straight on the screen, for less delay', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.getByRole('radio', { name: 'Pen', exact: true }).click()
  await page.keyboard.press('Escape')
  const asked = await page.locator('.nw-live-ink').first().evaluate((canvas) => (canvas as HTMLCanvasElement).getContext('2d')?.getContextAttributes().desynchronized)
  expect(asked).toBe(true)
})

// A test iPad, 6 November 2026: "when select the pen there is automtixally a text carrot still there", and "it like selects amny
// like icons on whole page". What only a real iPad can show is Scribble itself: this holds its causes away.
test('an ink tool leaves no caret and no text to type in, and nothing to select; the Type tool gives the text back', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const frame = page.locator('.nw-frame .ProseMirror').first()
  await frame.click()
  await page.keyboard.type('Words')
  await expect(frame).toHaveAttribute('contenteditable', 'true')
  await page.getByRole('radio', { name: 'Pen', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(frame).toHaveAttribute('contenteditable', 'false')
  const inDesk = (): Promise<boolean> => page.evaluate(() => document.activeElement?.closest('.nw-desk') !== null && document.activeElement?.closest('.nw-desk') !== undefined)
  expect(await inDesk()).toBe(false)
  expect(await page.evaluate(() => window.getSelection()?.rangeCount ?? 0)).toBe(0)
  const looks = await page.evaluate(() => {
    const select = (selector: string): string => getComputedStyle(document.querySelector(selector)!).webkitUserSelect
    return { page: select('.nw-page'), text: select('.nw-frame .ProseMirror'), button: select('.appbar button'), title: select('.appbar .title') }
  })
  expect(looks).toEqual({ page: 'none', text: 'none', button: 'none', title: 'text' })
  // A touch moved over the desk and a selection begun there are both kept by the page.
  const kept = await page.evaluate(() => {
    const sheet = document.querySelector('.nw-page')!
    const held = (event: Event): boolean => !sheet.dispatchEvent(event)
    return [held(new TouchEvent('touchmove', { bubbles: true, cancelable: true })), held(new Event('selectstart', { bubbles: true, cancelable: true }))]
  })
  expect(kept).toEqual([true, true])
  // Typing again: the text is as it was, and takes the keys.
  await page.getByRole('radio', { name: 'Type', exact: true }).click()
  await expect(frame).toHaveAttribute('contenteditable', 'true')
  await frame.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' more')
  await expect(frame).toContainText('Words more')
  const after = await page.evaluate(() => !document.querySelector('.nw-page')!.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true })))
  expect(after).toBe(false)
})

test.describe('on Android', () => {
  test.skip(inApp, 'only a browser can be an Android: the app’s web view keeps its own user agent')

  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', viewport: { width: 390, height: 800 } })

  // A test phone, 6 November 2026: "the screens turns black as soon as i write with pen". A desynchronized canvas goes
  // straight on the screen there. The black itself shows only on a real Android: this holds the cause away.
  test('the pen draws on no canvas that goes straight on the screen', async ({ page }) => {
    await page.goto('/#/new')
    await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
    await page.getByRole('radio', { name: 'Pen', exact: true }).click()
    await page.keyboard.press('Escape')
    const asked = await page.locator('.nw-live-ink').first().evaluate((canvas) => (canvas as HTMLCanvasElement).getContext('2d')?.getContextAttributes().desynchronized)
    expect(asked).toBe(false)
  })
})

