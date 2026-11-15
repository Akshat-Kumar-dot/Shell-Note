// The note's sheets in a real browser: the note's menu (its kind, its pages, its paper, export), the seamless view
// with the margins between pages folded away, a pen's line drawn across a hidden page line moving whole to the next
// page, a text note shown seamless without paper, and dark paper in the dark theme.
import { expect, test, type Page } from './fixtures.js'
import { chooseTool, penRow } from './shell.js'

/** A choice of the note's menu: a line of its first level, then one of the choices it opens. */
/** Lines typed into the terminal, each answered, then the terminal closed. */
async function terminal(page: Page, ...lines: string[]): Promise<void> {
  await page.keyboard.press('Control+Shift+P')
  const box = page.getByRole('textbox', { name: 'Terminal line' })
  const outputs = page.locator('.nw-terminal-out')
  for (const line of lines) {
    const before = await outputs.count()
    await box.fill(line)
    await box.press('Enter')
    await expect(outputs).toHaveCount(before + 1)
  }
  await box.press('Escape')
}

async function choose(page: Page, line: 'Kind' | 'Page' | 'Paper', choice: string): Promise<void> {
  await page.getByRole('button', { name: 'This note', exact: true }).click()
  await page.getByRole('menuitem', { name: line, exact: true }).click()
  await page.getByRole(line === 'Paper' ? 'menuitem' : 'menuitemradio', { name: choice, exact: true }).click()
}

test("the note's menu shows what the note is, its pages and its paper, and opens each in itself", async ({ page }) => {
  await page.goto('/?sample=long')
  await page.getByRole('button', { name: 'This note', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Kind', exact: true })).toContainText('Mixed')
  await expect(page.getByRole('menuitem', { name: 'Page', exact: true })).toContainText('A4 · pages')
  await expect(page.getByRole('menuitem', { name: 'Paper', exact: true })).toContainText('Blank')
  await expect(page.getByRole('menuitem', { name: 'Cover picture', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Export', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Page', exact: true }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Pages A4', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('menuitemradio', { name: 'Pages upright', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitem', { name: 'Back to This note', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Kind', exact: true })).toBeVisible()
})

test('seamless: the same pages as one sheet, no page buttons, the margins between them folded away; and back', async ({ page }) => {
  await page.goto('/?sample=long')
  const pages = page.locator('.nw-pages')
  await expect(page.getByRole('button', { name: 'Add a page', exact: true })).toBeVisible()
  await choose(page, 'Page', 'No page breaks')
  await expect(pages).toHaveAttribute('data-view', 'seamless')
  await expect(page.locator('.nw-page-slot')).toHaveCount(30)
  await expect(page.getByRole('button', { name: 'Add a page', exact: true })).toHaveCount(0)
  await expect(page.locator('.nw-page-bar')).toHaveCount(0)
  // Each page between two shows 257 mm of its 297: 20 mm of margin folded away above and below (971.3 CSS pixels).
  expect((await page.locator('.nw-page-slot').nth(1).boundingBox())!.height).toBeCloseTo((257 / 25.4) * 96, 0)
  // No gap: the second page starts where the first ends.
  const [one, two] = [(await page.locator('.nw-page-slot').nth(0).boundingBox())!, (await page.locator('.nw-page-slot').nth(1).boundingBox())!]
  expect(two.y).toBeCloseTo(one.y + one.height, 0)
  await choose(page, 'Page', 'Pages, one below another')
  await expect(pages).not.toHaveAttribute('data-view', 'seamless')
  await expect(page.getByRole('button', { name: 'Add a page', exact: true })).toBeVisible()
  // One undo takes the view back.
  await choose(page, 'Page', 'No page breaks')
  await page.keyboard.press('Control+z')
  await expect(pages).not.toHaveAttribute('data-view', 'seamless')
})

test('a line drawn across a hidden page line moves whole to the top of the next page', async ({ page }) => {
  await page.goto('/?sample=long')
  await choose(page, 'Page', 'No page breaks')
  await chooseTool(page, 'pen')
  // Where the first page's writing area ends and the second's begins, on the screen.
  const fold = (await page.locator('.nw-page-slot').nth(1).boundingBox())!
  await page.locator('.nw-desk').evaluate((el, y) => {
    el.scrollTop += y - el.getBoundingClientRect().top - 200
  }, fold.y)
  const seam = (await page.locator('.nw-page-slot').nth(1).boundingBox())!
  await page.mouse.move(seam.x + 300, seam.y - 25)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(seam.x + 300 + i * 5, seam.y - 25 + i * 5)
  await page.mouse.up()
  const ink = page.locator('.nw-box[data-free="ink"]')
  await expect(ink).toHaveCount(1)
  // On the second page, its top at the top of the writing area (20 mm, less the pen's half width).
  await expect(ink.locator('xpath=ancestor::*[contains(@class,"nw-page")][1]')).toHaveAttribute('data-page', 'p2')
  expect(Number.parseFloat(await ink.evaluate((el) => (el as HTMLElement).style.top))).toBeCloseTo(20, 0)
})

test('a page size and a way up for every page, the column fitted to it', async ({ page }) => {
  await page.goto('/?sample=physics')
  const slot = page.locator('.nw-page-slot').first()
  await choose(page, 'Page', 'Pages A5')
  await expect.poll(async () => (await slot.boundingBox())!.width).toBeCloseTo((148 / 25.4) * 96, 0)
  await choose(page, 'Page', 'Pages across')
  await expect.poll(async () => (await slot.boundingBox())!.width).toBeCloseTo((210 / 25.4) * 96, 0)
  await page.getByRole('button', { name: 'This note', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Page', exact: true })).toContainText('A5 across')
})

test('a text note shown seamless has no paper; dark paper is a choice in the dark theme, and printing stays white', async ({ page }) => {
  await page.goto('/?sample=long')
  await choose(page, 'Kind', 'Text note')
  await choose(page, 'Page', 'No page breaks')
  await expect(page.locator('.nw-pages')).toHaveAttribute('data-paperless', '')
  await expect(page.locator('html')).toHaveAttribute('data-paperless', '')
  expect(await page.locator('.nw-page').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await choose(page, 'Kind', 'Mixed note')
  await expect(page.locator('html')).not.toHaveAttribute('data-paperless', '')

  // The dark theme and dark paper, by the commands Settings' own buttons call: a sample note is left behind by going to
  // another screen, Settings' tab too, so it is asked for here (Appearance's buttons are the library tests').
  await terminal(page, 'settings.theme look=dark', 'settings.paper on=true')
  await expect(page.locator('html')).toHaveAttribute('data-paper', 'dark')
  expect(await page.locator('.nw-page').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(26, 26, 27)')
  // The print window's pages, all of them, are white whatever the screen shows; they go when it closes.
  await page.evaluate(() => {
    window.print = () => undefined
  })
  await page.getByRole('button', { name: 'This note', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click()
  await expect(page.locator('.nw-print .nw-print-page')).toHaveCount(30)
  await page.emulateMedia({ media: 'print' })
  expect(await page.locator('.nw-print .nw-page').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)')
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.nw-print')).toHaveCount(0)
})

test("a sketch takes the pen in hand, and says in the status line that its sheet grows; a text note takes typing", async ({ page }) => {
  await page.goto('/?sample=long')
  const status = page.locator('.sh-status')
  await expect(status.locator('.sh-kind')).toHaveText('Mixed')
  await choose(page, 'Kind', 'Sketch note')
  await expect(penRow(page)).toBeVisible()
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'pen')
  await choose(page, 'Page', 'One growing sheet')
  await expect(status.locator('.sh-kind')).toHaveText('Sketch · growing sheet')
  await expect(status).toContainText('Blank')
  await expect(page.getByRole('note').filter({ hasText: 'The sheet grows as you write near its edge' })).toBeVisible()
  await choose(page, 'Kind', 'Text note')
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'type')
  await expect(status.locator('.sh-kind')).toHaveText('Text · no page breaks')
  await expect(page.getByText('The sheet grows as you write near its edge')).toHaveCount(0)
})

test("a line drawn in a page's top margin, down into the writing area, stays where it is drawn", async ({ page }) => {
  await page.goto('/?sample=long')
  await choose(page, 'Kind', 'Sketch note')
  await choose(page, 'Page', 'One growing sheet')
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  // From 8 mm below the sheet's top edge, 30 mm down: across the top margin's edge (20 mm).
  const mm = sheet.width / 210
  await page.mouse.move(sheet.x + 300, sheet.y + 8 * mm)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(sheet.x + 300 + i * 6, sheet.y + (8 + i * 3) * mm)
  await page.mouse.up()
  const ink = page.locator('.nw-box[data-free="ink"]')
  await expect(ink).toHaveCount(1)
  const first = (await page.locator('.nw-page').first().getAttribute('data-page')) ?? ''
  await expect(ink.locator('xpath=ancestor::*[contains(@class,"nw-page")][1]')).toHaveAttribute('data-page', first)
  expect(Number.parseFloat(await ink.evaluate((el) => (el as HTMLElement).style.top))).toBeLessThan(10)
})
