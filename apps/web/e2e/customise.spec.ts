// Settings as a tab of its own, and Customise: a button taken out of a row of tools waits under its More, the pen and
// Type stay in the pen's row, a colour put in reach, the look, and Reset to default putting all of it back.
import { expect, test } from './fixtures.js'
import { chooseTool, penRow, textRow } from './shell.js'

test('Settings opens as a tab with its sections; closing it goes back to the screen it was opened from', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const note = page.url()
  await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'General', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible()
  await expect(page.locator('.set-keys').first()).toContainText('Search in every note')
  await page.getByRole('button', { name: 'Close Settings' }).click()
  await expect(page).toHaveURL(note)
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveCount(0)
})

test('Customise: a button out of a row waits under its More, the pen stays, a colour in reach, the look, Reset to default', async ({ page }) => {
  await page.goto('/#/settings/customise')
  await expect(page.getByRole('heading', { name: 'Customise', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Take Table out of the bar' }).click()
  await expect(page.getByRole('button', { name: 'Put Table in the bar' })).toBeVisible()
  await page.getByRole('button', { name: 'Take Move the sheet out of the row' }).click()
  await page.getByRole('button', { name: 'Put Orange in the row' }).click()
  // The pen and Type never leave the pen's row.
  await expect(page.getByRole('button', { name: 'Take Pen out of the row' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Take Type out of the row' })).toHaveCount(0)
  await page.getByRole('radio', { name: /^Dock/u }).click()
  await expect(page.locator('.shell')).toHaveAttribute('data-look', 'dock')

  // In a note: no Table in the bar for typing, but under its More.
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await expect(textRow(page).getByRole('button', { name: 'Table', exact: true })).toHaveCount(0)
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menu')).toContainText('Table')
  await page.keyboard.press('Escape')
  // The pen's row: orange in reach, Move the sheet under its More.
  await chooseTool(page, 'pen')
  await expect(penRow(page).getByRole('radio', { name: 'Orange' })).toBeVisible()
  await expect(penRow(page).getByRole('button', { name: 'Move the sheet', exact: true })).toHaveCount(0)
  await penRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menu')).toContainText('Move the sheet')
  await page.keyboard.press('Escape')

  // Reset to default: all of it back.
  await page.goto('/#/settings/customise')
  await page.getByRole('button', { name: 'Reset to default' }).click()
  await expect(page.locator('.shell')).toHaveAttribute('data-look', 'flat')
  await expect(page.getByRole('button', { name: 'Take Table out of the bar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Put Orange in the row' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take Move the sheet out of the row' })).toBeVisible()
})
