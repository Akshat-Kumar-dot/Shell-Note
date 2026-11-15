// The pen's own touch, the Hand, the More menu's Diagram and a text note's title, in a real browser. A pen's stroke
// writes and takes the pen up, whatever is in hand; a pen's tap on typed words is a click, the caret there.
import { expect, test, type Page } from './fixtures.js'
import { chooseTool, penRow, textRow } from './shell.js'

/** The open note's own state, as the workspace gives it to the checks. */
const store = (page: Page) => page.evaluate(() => ({ tool: window.__shellnote!.store.tool, inks: Object.values(window.__shellnote!.doc.block).filter((b) => (b as { type: string }).type === 'ink').length }))

/** A pen's touch along these points of the screen: pressed at the first, lifted at the last. */
async function pen(page: Page, points: readonly { x: number; y: number }[]): Promise<void> {
  await page.evaluate(async (points) => {
    for (const [i, at] of points.entries()) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      const kind = i === 0 ? 'pointerdown' : i === points.length - 1 ? 'pointerup' : 'pointermove'
      document.elementFromPoint(at.x, at.y)!.dispatchEvent(
        new PointerEvent(kind, { pointerId: 9, pointerType: 'pen', isPrimary: true, clientX: at.x, clientY: at.y, width: 1, height: 1, pressure: kind === 'pointerup' ? 0 : 0.5, button: kind === 'pointermove' ? -1 : 0, buttons: kind === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true }),
      )
    }
  }, points)
}

test("with typing in hand, the pen's stroke writes and takes the pen up; its tap on words puts the caret there", async ({ page }) => {
  await page.goto('/?sample=physics')
  await expect(textRow(page)).toBeVisible()
  const { inks } = await store(page)
  const words = (await page.locator('.nw-text', { hasText: 'An object at rest' }).boundingBox())!
  // A tap on the words: the caret there, nothing written.
  await pen(page, [
    { x: words.x + 40, y: words.y + words.height / 2 },
    { x: words.x + 40, y: words.y + words.height / 2 },
  ])
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.ProseMirror') !== null)).toBe(true)
  expect(await store(page)).toEqual({ tool: 'type', inks })
  // A stroke on the paper below: written, and the pen's row up.
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  const from = { x: sheet.x + 200, y: sheet.y + 380 }
  await pen(page, Array.from({ length: 12 }, (_, i) => ({ x: from.x + i * 8, y: from.y + i * 3 })))
  await expect.poll(async () => (await store(page)).inks).toBe(inks + 1)
  expect((await store(page)).tool).toBe('pen')
  await expect(penRow(page)).toBeVisible()
})

test('with the pen in hand, its tap on typed words puts the caret there and takes typing up, writing nothing', async ({ page }) => {
  await page.goto('/?sample=physics')
  await chooseTool(page, 'pen')
  const { inks } = await store(page)
  const words = (await page.locator('.nw-text', { hasText: 'An object at rest' }).boundingBox())!
  await pen(page, [
    { x: words.x + 60, y: words.y + words.height / 2 },
    { x: words.x + 60, y: words.y + words.height / 2 },
  ])
  await expect.poll(async () => (await store(page)).tool).toBe('type')
  expect((await store(page)).inks).toBe(inks)
  await expect(textRow(page)).toBeVisible()
})

test('the Hand, in the pen’s row, moves the sheet and writes nothing', async ({ page }) => {
  await page.goto('/?sample=long')
  await chooseTool(page, 'pen')
  await penRow(page).getByRole('button', { name: 'Move the sheet', exact: true }).click()
  await expect(penRow(page)).toBeVisible()
  const desk = page.locator('.nw-desk')
  await expect(desk).toHaveAttribute('data-tool', 'hand')
  const box = (await desk.boundingBox())!
  await page.mouse.move(box.x + 300, box.y + 400)
  await page.mouse.down()
  await page.mouse.move(box.x + 300, box.y + 100, { steps: 5 })
  await page.mouse.up()
  expect(await desk.evaluate((el) => el.scrollTop)).toBeGreaterThan(250)
  expect((await store(page)).inks).toBe(0)
  await expect(page.locator('.nw-box[data-free="ink"]')).toHaveCount(0)
})

test("More's Diagram puts a flowchart under the caret's line; a text note has its title at the top of its first page", async ({ page }) => {
  await page.goto('/?sample=physics')
  await page.locator('.nw-text', { hasText: "Newton's laws" }).click()
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Diagram', exact: true }).click()
  // Mermaid draws it when it has loaded, later under load.
  await expect(page.locator('[data-free="diagram"], .nw-diagram').first()).toBeVisible({ timeout: 20_000 })
  // A text note: its title, typed there too, and its line, at the top of the first page.
  await page.getByRole('button', { name: 'This note', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Kind', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Text note', exact: true }).click()
  const title = page.getByRole('textbox', { name: "The note's title, at the top of its page" })
  await expect(title).toHaveValue('Physics lecture 4')
  await expect(page.locator('.nw-title-line')).toContainText('edited')
  await title.fill('Waves and forces')
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Waves and forces')
})
