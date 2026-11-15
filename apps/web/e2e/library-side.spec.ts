// The library's column beside every screen: its folders and notes, a note opened in one click, a folder named in
// place, a search by name, and the column hidden, shown or moved to the window's other side, as it was left.
import { expect, test } from './fixtures.js'

test('the library column opens a note in one click, makes and names a folder, finds by name, and stays as it was left', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const side = page.getByRole('navigation', { name: 'Library' })
  const desk = page.locator('.nw-desk')
  /** Whether the library is left of the pages; undefined while either is not drawn. */
  const onTheLeft = async (): Promise<boolean | undefined> => {
    const [library, pages] = [await side.boundingBox(), await desk.boundingBox()]
    return library && pages ? library.x < pages.x : undefined
  }
  /** One of the column's own places, from its menu. */
  const place = async (name: string): Promise<void> => {
    await side.getByRole('button', { name: 'Sort and place' }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  // A laptop's window has room for it: it shows from the start, on the left.
  await expect.poll(onTheLeft).toBe(true)
  const title = page.getByRole('textbox', { name: 'Title' })
  await title.fill('Waves')
  await title.press('Enter')
  await expect(side.getByRole('button', { name: 'Waves', exact: true })).toHaveAttribute('aria-current', 'page')
  const waves = page.url()

  // A folder, named in place.
  await side.getByRole('button', { name: 'Add a folder' }).click()
  const name = side.getByRole('textbox', { name: 'New name for Untitled folder' })
  await expect(name).toBeFocused()
  await name.fill('Physics')
  await name.press('Enter')
  const physics = side.getByRole('button', { name: 'Physics: 0 notes' })
  await expect(physics).toBeVisible()

  // A note in it, from the folder's own +: open, in its folder, opened on its own.
  await physics.hover()
  await side.getByRole('button', { name: 'Add a note to Physics' }).click()
  await expect(page).not.toHaveURL(waves)
  await expect(side.getByRole('button', { name: 'Physics: 1 note' })).toHaveAttribute('aria-expanded', 'true')
  await expect(side.getByRole('button', { name: 'Untitled', exact: true })).toHaveAttribute('aria-current', 'page')

  // One click opens the other note, as it was kept.
  await side.getByRole('button', { name: 'Waves', exact: true }).click()
  await expect(page).toHaveURL(waves)
  await expect(title).toHaveValue('Waves')

  // Found by name in the command box ("Open or run…" at the column's top), with where it is; Escape closes it.
  await side.getByRole('button', { name: /^Open or run/u }).click()
  const box = page.getByRole('combobox', { name: 'Open a note, or run a command' })
  await expect(box).toBeFocused()
  await box.fill('untit')
  await expect(page.getByRole('option', { name: /Untitled.*Physics/u })).toBeVisible()
  await box.press('Escape')
  await expect(box).toHaveCount(0)
  await expect(side.getByRole('button', { name: 'Physics: 1 note' })).toBeVisible()

  // Moved to the right, it stays there after a reload, and comes back.
  await place('Move the library to the right')
  await expect.poll(onTheLeft).toBe(false)
  await page.reload()
  await expect.poll(onTheLeft).toBe(false)
  await place('Move the library to the left')
  await expect.poll(onTheLeft).toBe(true)

  // Hidden, it stays hidden after a reload; shown again from the tabs' row, it stays shown, the folder still open.
  await place('Hide the library')
  await expect(side).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Show the library' })).toBeVisible()
  await page.getByRole('button', { name: 'Show the library' }).click()
  await page.reload()
  await expect(side.getByRole('button', { name: 'Physics: 1 note' })).toHaveAttribute('aria-expanded', 'true')
  // The same button of the tabs' row hides it, one press each way.
  await page.getByRole('button', { name: 'Hide the library', exact: true }).click()
  await expect(side).toHaveCount(0)
  await page.getByRole('button', { name: 'Show the library', exact: true }).click()
  await expect(side).toBeVisible()
})

test("the rail's search opens search in every note in the column, the caret in its box, the column shown for it if it was hidden", async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const rail = page.getByRole('navigation', { name: 'Places' })
  const side = page.getByRole('navigation', { name: 'Library' })
  const search = page.getByRole('navigation', { name: 'Search in every note' })
  await rail.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(search.getByRole('searchbox', { name: 'Search in every note' })).toBeFocused()
  await expect(rail.getByRole('button', { name: 'Search', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Escape with no words: the library's column is back.
  await page.keyboard.press('Escape')
  await expect(side).toBeVisible()
  await side.getByRole('button', { name: 'Sort and place' }).click()
  await page.getByRole('menuitem', { name: 'Hide the library', exact: true }).click()
  await expect(side).toHaveCount(0)
  // Hidden, the column shows for the search, as Ctrl+Shift+F asks.
  await page.keyboard.press('Control+Shift+F')
  await expect(search.getByRole('searchbox', { name: 'Search in every note' })).toBeFocused()
})
