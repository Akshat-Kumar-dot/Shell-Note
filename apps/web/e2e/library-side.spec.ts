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

  // Found by name, with where it is; Escape empties the search.
  const search = side.getByRole('searchbox', { name: 'Search the library' })
  await search.fill('untit')
  await expect(side.getByRole('button', { name: 'Untitled, in Physics' })).toBeVisible()
  await search.press('Escape')
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
})

test("the rail's search puts the caret in the library's search, the column shown for it if it was hidden", async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const rail = page.getByRole('navigation', { name: 'Places' })
  const side = page.getByRole('navigation', { name: 'Library' })
  await rail.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(side.getByRole('searchbox', { name: 'Search the library' })).toBeFocused()
  await side.getByRole('button', { name: 'Sort and place' }).click()
  await page.getByRole('menuitem', { name: 'Hide the library', exact: true }).click()
  await expect(side).toHaveCount(0)
  await rail.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(side.getByRole('searchbox', { name: 'Search the library' })).toBeFocused()
})
