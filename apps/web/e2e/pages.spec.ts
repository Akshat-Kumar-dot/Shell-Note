// Page overflow: text that runs past the bottom margin continues in a frame
// on the next page, linked with `next`, and the caret goes with it. Undo
// takes back the push with the typing that caused it.
import { expect, test, type Page } from './fixtures.js'

type Frame = { id: string; page: string; kids: string[]; next?: string; h: number }

function frames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const doc = window.__shellnote!.doc
    return doc.pages.flatMap((id) => doc.page[id]!.free.map((free) => doc.block[free] as unknown as Frame).filter((b) => (b as unknown as { type: string }).type === 'frame'))
  })
}

function pageCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__shellnote!.doc.pages.length)
}

test('lines past the bottom margin continue on a new page, and the caret goes with them', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  // About 36 lines fit on an A4 page; 45 do not.
  for (let n = 1; n <= 45; n++) {
    await page.keyboard.type(`Line ${n}`)
    if (n < 45) await page.keyboard.press('Enter')
  }
  await expect.poll(() => pageCount(page)).toBe(2)
  const [first, second] = await frames(page)
  expect(first!.next).toBe(second!.id)
  expect(second!.page).not.toBe(first!.page)
  // The lines are all there, in order, across the two frames.
  const words = await page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const all: string[] = []
    for (let at: string | undefined = doc.page[doc.pages[0]!]!.free[0]; at; at = (doc.block[at] as unknown as { next?: string }).next) {
      for (const kid of (doc.block[at] as unknown as { kids: string[] }).kids) all.push((doc.block[kid] as unknown as { md: string }).md)
    }
    return all
  })
  expect(words).toEqual(Array.from({ length: 45 }, (_, i) => `Line ${i + 1}`))
  // The first frame's height is written as it is drawn, and it ends on its page (it starts 20 mm down).
  expect(first!.h).toBeGreaterThan(20000)
  expect(2000 + first!.h).toBeLessThan(29700)

  // Typing carries on where the caret went: at the end of the last line, on page two.
  await page.keyboard.type(' and more')
  await expect.poll(async () => {
    const [, next] = await frames(page)
    return page.evaluate((id) => (window.__shellnote!.doc.block[id] as unknown as { md: string }).md, next!.kids.at(-1)!)
  }).toBe('Line 45 and more')

  // Undo takes back the push with the typing that caused it, and the note does not push again.
  for (let i = 0; i < 20 && (await pageCount(page)) > 1; i++) await page.keyboard.press('Control+z')
  expect(await pageCount(page)).toBe(1)
  await page.waitForTimeout(200)
  expect(await pageCount(page)).toBe(1)
})

test('“Add a page” under the last page adds one like it, its size and its paper, and scrolls to it; one undo step', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await expect(page.locator('.nw-page-slot')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add a page' }).click()
  await expect(page.locator('.nw-page-slot')).toHaveCount(2)
  const [one, two] = await page.evaluate(() => {
    const doc = window.__shellnote!.doc
    return doc.pages.map((id) => {
      const sheet = doc.page[id]!
      return { w: sheet.w, h: sheet.h, bg: sheet.bg ?? null, free: sheet.free.length }
    })
  })
  expect(two).toEqual({ ...one, free: 0 })
  // Scrolled to: the new page's top in the upper half of the desk.
  await expect
    .poll(() =>
      page.locator('.nw-page-slot').nth(1).evaluate((slot) => {
        const desk = slot.closest('.nw-desk')!.getBoundingClientRect()
        const top = slot.getBoundingClientRect().top
        return top >= desk.top - 1 && top < desk.top + desk.height / 2
      }),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => pageCount(page)).toBe(1)
})
