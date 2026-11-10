// The library beside a note, on the left (or moved to the right): its folders and notes, a note opened in one click, a
// folder named in place, a search by name, and the side hidden, shown or moved as it was left.
import { expect, test } from './fixtures.js'

test('the library beside a note opens a note in one click, makes and names a folder, finds by name, and stays as it was left', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const side = page.getByRole('navigation', { name: 'Library' })
  const desk = page.locator('.nw-desk')
  /** Whether the library is left of the pages; undefined while either is not drawn. */
  const onTheLeft = async (): Promise<boolean | undefined> => {
    const [library, pages] = [await side.boundingBox(), await desk.boundingBox()]
    return library && pages ? library.x < pages.x : undefined
  }
  // Narrower than 1400 pixels it starts hidden: a strip with its arrow, on the left.
  await side.getByRole('button', { name: 'Show the library' }).click()
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
  await side.getByRole('button', { name: 'Move the library to the right' }).click()
  await expect.poll(onTheLeft).toBe(false)
  await page.reload()
  await expect.poll(onTheLeft).toBe(false)
  await side.getByRole('button', { name: 'Move the library to the left' }).click()
  await expect.poll(onTheLeft).toBe(true)

  // Hidden, it stays hidden after a reload; shown, it stays shown, the folder still open.
  await side.getByRole('button', { name: 'Hide the library' }).click()
  await page.reload()
  await expect(side.getByRole('button', { name: 'Show the library' })).toBeVisible()
  await side.getByRole('button', { name: 'Show the library' }).click()
  await page.reload()
  await expect(side.getByRole('button', { name: 'Physics: 1 note' })).toHaveAttribute('aria-expanded', 'true')
})
