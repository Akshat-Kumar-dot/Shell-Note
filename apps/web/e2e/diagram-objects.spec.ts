// Diagrams as objects, once made: one
// placed on the page shows its corners when chosen, and resizes from them,
// keeping its shape, its drawing growing with it; chosen, it moves with
// either tool. One in the text has a table's ⊕ handle: a click chooses it, and
// dragged onto bare paper it goes on its own, at the size it was drawn, to be
// moved and resized there. Each is one undo step.
import { expect, test, type Page } from './fixtures.js'

type Diagram = { id: string; type: 'diagram'; src: string; parent?: string; page?: string; x?: number; y?: number; w?: number; h?: number }

const block = (page: Page, id: string): Promise<Diagram | undefined> => page.evaluate((id) => window.__shellnote!.doc.block[id] as unknown as Diagram | undefined, id)
const chosen = (page: Page) => page.evaluate(() => ({ kind: window.__shellnote!.store.selectionKind, blocks: window.__shellnote!.store.selection.blocks }))

/** The mixed sample, with both its diagrams drawn: `df` placed on the page, `dc` at the end of the text in the frame `fa`. */
async function start(page: Page): Promise<void> {
  await page.goto('/?sample=mixed')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await expect(page.locator('.nw-diagram[data-drawn]')).toHaveCount(2, { timeout: 15_000 })
}

/** Where an element is, by its middle. */
async function middle(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(selector).first().boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Press, drag in steps as a hand does, and let go. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

// Tall enough to show a whole A4 page at 100%.
test.use({ viewport: { width: 1280, height: 1200 } })

test('a diagram on the page resizes from a corner, keeping its shape, its drawing growing with it; with Select, a press on it once chosen moves it; one undo step each', async ({ page }) => {
  await start(page)
  const box = page.locator('.nw-free[data-free="diagram"]')
  const before = (await block(page, 'df'))!
  // With Type, a click chooses it, and its four corners show.
  await box.click()
  await expect.poll(() => chosen(page)).toEqual({ kind: 'objects', blocks: ['df'] })
  await expect(box.locator('.nw-handle')).toHaveCount(4)
  // Its drawing fills the box.
  const svg = box.locator('svg').first()
  const drawn = (await svg.boundingBox())!
  expect(drawn.width / (await box.boundingBox())!.width).toBeGreaterThan(0.85)

  // The bottom-left corner, out and down: the top-right corner stays where it was.
  const corner = await middle(page, '.nw-free[data-free="diagram"] .nw-handle[data-corner="sw"]')
  await drag(page, corner, { x: corner.x - 80, y: corner.y + 80 })
  await expect.poll(async () => (await block(page, 'df'))!.w).toBeGreaterThan(before.w! + 1000)
  const resized = (await block(page, 'df'))!
  expect(resized.x! + resized.w!).toBe(before.x! + before.w!)
  expect(resized.y).toBe(before.y)
  expect(Math.abs(resized.w! / resized.h! - before.w! / before.h!)).toBeLessThan(0.01)
  await expect.poll(async () => (await svg.boundingBox())!.width / drawn.width).toBeCloseTo(resized.w! / before.w!, 1)

  // With Select, a click chooses it, and a press on it then moves it rather than starting a box.
  await page.getByRole('radio', { name: 'Select' }).click()
  await box.click()
  await expect.poll(() => chosen(page)).toEqual({ kind: 'objects', blocks: ['df'] })
  const at = await middle(page, '.nw-free[data-free="diagram"]')
  await drag(page, at, { x: at.x - 60, y: at.y + 40 })
  await expect.poll(async () => (await block(page, 'df'))!.y).toBeGreaterThan(resized.y! + 500)
  const moved = (await block(page, 'df'))!
  expect(moved.x).toBeLessThan(resized.x! - 500)
  expect([moved.w, moved.h]).toEqual([resized.w, resized.h])
  await expect(page.locator('.nw-region')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await block(page, 'df'))!.y).toBe(resized.y)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await block(page, 'df'))!.w).toBe(before.w)
  expect(await block(page, 'df')).toMatchObject({ x: before.x, y: before.y, h: before.h })
})

test("a diagram in the text: its ⊕ chooses it and Delete removes it; dragged onto bare paper, it goes on its own at the size it was drawn, to be resized; one undo step each", async ({ page }) => {
  await start(page)
  const figure = page.locator('.nw-frame .nw-diagram[data-id="dc"]')
  const handle = '.nw-frame .nw-diagram[data-id="dc"] .nw-object-handle'
  await figure.scrollIntoViewIfNeeded()
  await figure.hover()
  await expect(page.locator(handle)).toBeVisible()
  const grip = await middle(page, handle)
  await page.mouse.click(grip.x, grip.y)
  await expect.poll(() => chosen(page)).toEqual({ kind: 'objects', blocks: ['dc'] })
  await expect(page.locator('.nw-frame .nw-diagram[data-chosen]')).toHaveCount(1)
  await page.keyboard.press('Delete')
  await expect.poll(() => block(page, 'dc')).toBeUndefined()
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await block(page, 'dc'))?.parent).toBe('fa')

  // Onto bare paper, right of the text and below the other diagram.
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  await figure.hover()
  const size = (await figure.boundingBox())!
  const from = await middle(page, handle)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 2 })
  await page.mouse.move(sheet.x + sheet.width * 0.6, sheet.y + sheet.height * 0.7, { steps: 8 })
  await expect(page.locator('.nw-drop-line')).toBeVisible()
  await page.mouse.up()
  await expect.poll(async () => (await block(page, 'dc'))?.page).toBe('w1')
  const placed = (await block(page, 'dc'))!
  expect(placed.parent).toBeUndefined()
  // The size it was drawn at: the page is 21000 units across.
  const perPx = 21000 / sheet.width
  expect(Math.abs(placed.w! - size.width * perPx)).toBeLessThan(60)
  expect(Math.abs(placed.h! - size.height * perPx)).toBeLessThan(60)
  // It stays chosen, now with corners, and one of them resizes it.
  await expect.poll(() => chosen(page)).toEqual({ kind: 'objects', blocks: ['dc'] })
  const free = '.nw-free[data-free="diagram"]:has([data-id="dc"])'
  await expect(page.locator(`${free} .nw-handle`)).toHaveCount(4)
  const corner = await middle(page, `${free} .nw-handle[data-corner="se"]`)
  await drag(page, corner, { x: corner.x - 40, y: corner.y - 40 })
  await expect.poll(async () => (await block(page, 'dc'))!.w).toBeLessThan(placed.w! - 500)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await block(page, 'dc'))!.w).toBe(placed.w)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await block(page, 'dc'))?.parent).toBe('fa')
  const kids = await page.evaluate(() => (window.__shellnote!.doc.block.fa as unknown as { kids: string[] }).kids)
  expect(kids.at(-1)).toBe('dc')
})
