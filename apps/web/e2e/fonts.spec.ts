// The font library: fonts bundled with the app, added to the font menu beside
// the four font styles, used on a block, and kept in the menu after a reload.
import { expect, test, type Page } from './fixtures.js'

function firstStyle(page: Page): Promise<{ font?: string } | undefined> {
  return page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const frame = doc.block[doc.page[doc.pages[0]!]!.free[0]!] as unknown as { kids: string[] }
    return (doc.block[frame.kids[0]!] as unknown as { style?: { font?: string } }).style
  })
}

test('a font added from the library joins the font menu, sets a block in it, and stays in the menu', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('Lecture notes')
  const menu = page.getByRole('combobox', { name: 'Font' })
  await expect(menu.locator('option')).toHaveText(['Sans', 'Serif', 'Mono', 'Handwriting', 'More fonts…'])

  await menu.selectOption('+more')
  const library = page.getByRole('dialog', { name: 'Font library' })
  await expect(library.getByRole('listitem')).toHaveCount(15)
  await library.getByRole('button', { name: 'Lora in the font menu' }).click()
  await expect(library.getByRole('button', { name: 'Lora in the font menu' })).toHaveAttribute('aria-pressed', 'true')
  await library.getByRole('button', { name: 'Close the font library' }).click()
  await expect(library).toBeHidden()

  // The whole line, chosen as in Word, takes the font as its style.
  const line = page.locator('.nw-frame .nw-text').first()
  await line.click({ clickCount: 3 })
  await menu.selectOption('lora')
  await expect.poll(async () => (await firstStyle(page))?.font).toBe('lora')
  await expect(line).toHaveAttribute('data-font', 'lora')
  await expect(line).toHaveCSS('font-family', /Lora/)
  // The browser loaded the bundled font from the app itself, not from the internet.
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px Lora'))).toBe(true)

  await page.reload()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('x')
  await expect(page.getByRole('combobox', { name: 'Font' }).locator('option', { hasText: 'Lora' })).toHaveCount(1)
})
