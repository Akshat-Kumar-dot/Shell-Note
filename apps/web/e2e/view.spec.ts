// The read-only page view in a real browser: drawing, zoom, and drawing only
// the pages near the screen.
import { expect, test } from './fixtures.js'

test('draws a sample note: roles, lists, style tokens and placeholders', async ({ page }) => {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-page-slot')).toHaveCount(3)
  const first = page.locator('.nw-page[data-page="w1"]')
  const heading = first.locator('h1.nw-text')
  await expect(heading).toHaveText('Chapter 3: Waves')
  // Its tokens, size xl and colour blue, become real values: 18 pt is 24 CSS pixels.
  expect(await heading.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).color])).toEqual(['24px', 'rgb(31, 95, 191)'])
  // CSS draws list numbers, bullets and ticks from the data attributes.
  const before = (selector: string) => first.locator(selector).evaluate((el) => getComputedStyle(el, '::before').content)
  expect(await before('[data-id="o2"]')).toBe('"2."')
  expect(await before('[data-id="l1"]')).toBe('"•"')
  expect(await before('[data-id="tk"]')).toBe('"☑"')
  await expect(first.locator('.nw-math code').first()).toHaveText('\\sum_{x=1}^{10} x')
  // Handwriting: each stroke a group of lines, one for each width it is drawn at.
  await expect(first.locator('.nw-ink > g')).toHaveCount(2)
})

test('zooms with the buttons, and with Ctrl and the wheel', async ({ page }) => {
  await page.goto('/?sample=physics')
  const slot = page.locator('.nw-page-slot').first()
  const width = async (): Promise<number> => (await slot.boundingBox())!.width
  // An A4 page is 210 mm wide: 793.7 CSS pixels at 100%.
  const start = await width()
  expect(start).toBeCloseTo(793.7, 0)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  expect(await width()).toBeCloseTo(start * 1.1, 0)
  await page.getByRole('button', { name: 'Actual size' }).click()
  expect(await width()).toBeCloseTo(start, 0)
  await page.mouse.move(400, 400)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Control')
  await expect.poll(width).toBeGreaterThan(start * 1.2)
  await expect(page.getByRole('button', { name: 'Actual size' })).not.toHaveText('100%')
})

test('draws only the pages near the screen', async ({ page }) => {
  await page.goto('/?sample=long')
  await expect(page.locator('.nw-page-slot')).toHaveCount(30)
  // The first page fills the screen; the next is drawn ahead of scrolling.
  await expect(page.locator('.nw-page-slot[data-shown]')).toHaveCount(2)
  await page.locator('.nw-desk').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(page.getByText('Page 30')).toBeVisible()
  await expect(page.locator('.nw-page-slot[data-index="0"][data-shown]')).toHaveCount(0)
  expect(await page.locator('.nw-page-slot[data-shown]').count()).toBeLessThanOrEqual(3)
})
