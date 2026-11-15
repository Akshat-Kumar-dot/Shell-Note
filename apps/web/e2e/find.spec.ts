// The command box (Ctrl+P) and search in every note (Ctrl+Shift+F): a note opened by its name, a command run with the
// choice it asks for, and words found inside notes, marked, a line opening its note.
import { expect, test, type Page } from './fixtures.js'
import { toLibrary } from './shell.js'

/** A note made with these words in it, kept in the library. */
async function noteWith(page: Page, title: string, words: string): Promise<void> {
  await page.goto('/#/new')
  await expect(page.locator('.nw-page').first()).toBeVisible()
  const field = page.getByRole('textbox', { name: 'Title' })
  await field.fill(title)
  await field.press('Enter')
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type(words)
  await toLibrary(page)
  await expect(page.locator('.home')).toBeVisible()
}

test('Ctrl+P opens a note by its name, and runs a command, asking for the choice it needs', async ({ page }) => {
  await noteWith(page, 'Optics', 'Light bends in water')
  await page.keyboard.press('Control+p')
  const box = page.getByRole('combobox', { name: 'Open a note, or run a command' })
  await expect(box).toBeFocused()
  // Empty, the notes opened last.
  await expect(page.getByRole('option', { name: /Optics/u })).toBeVisible()
  await box.fill('opti')
  await box.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Optics')

  // A command, its choice asked for in the box.
  await page.keyboard.press('Control+p')
  await box.fill('app look')
  await box.press('Enter')
  await expect(page.locator('.cmd-step')).toContainText('Choose the look')
  await page.getByRole('option', { name: 'Islands' }).click()
  await expect(page.locator('.cmd')).toHaveCount(0)
  await expect(page.locator('.shell')).toHaveAttribute('data-look', 'islands')

  // Words that give the choice: it runs at once.
  await page.keyboard.press('Control+p')
  await box.fill('dark')
  await page.getByRole('option', { name: /^Theme: light, dark/u }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // A line that makes its own choice runs it, the chosen line showing its Enter: Settings, at Pen.
  await page.keyboard.press('Control+p')
  await box.fill('settings pen')
  const chosen = page.locator('.cmd-item[aria-selected="true"]')
  await expect(chosen).toContainText('Settings: Pen')
  await expect(chosen.locator('.cmd-enter')).toHaveText('Enter')
  await box.press('Enter')
  await expect(page.getByRole('heading', { name: 'Pen', level: 1 })).toBeVisible()
  // Escape closes it, and Ctrl+P again too.
  await page.keyboard.press('Control+p')
  await expect(box).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cmd')).toHaveCount(0)
})

test('Ctrl+Shift+F finds words inside every note, in any order, quotes side by side; a line opens its note', async ({ page }) => {
  await noteWith(page, 'Mechanics', "Newton's second law of motion")
  await noteWith(page, 'Sound', 'Sound waves carry energy')
  await page.keyboard.press('Control+Shift+F')
  const column = page.getByRole('navigation', { name: 'Search in every note' })
  const box = column.getByRole('searchbox', { name: 'Search in every note' })
  await expect(box).toBeFocused()

  // Every word, in any order: the note, its line, the words marked.
  await box.fill('law newton')
  await expect(column.locator('.sx-note')).toHaveCount(1)
  await expect(column.locator('.sx-note')).toContainText('Mechanics')
  await expect(column.locator('.sx-line mark')).toHaveText(['Newton', 'law'])
  // Words in quotes, side by side as written.
  await box.fill('"second law"')
  await expect(column.locator('.sx-note')).toHaveCount(1)
  await box.fill('"law second"')
  await expect(column).toContainText('No note holds')
  // Anywhere in a word.
  await box.fill('ener')
  await expect(column.locator('.sx-note')).toContainText('Sound')

  // A line opens its note.
  await column.locator('.sx-line').first().click()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Sound')
  // The search stays in the column; Escape twice puts it away.
  await box.press('Escape')
  await box.press('Escape')
  await expect(page.getByRole('navigation', { name: 'Library' })).toBeVisible()
})
