// A frame that grows moves what lies below it down, out of its way, in the same
// undo step as the change that made it grow, so a paragraph an AI makes longer
// never runs over a table placed under it.
import { expect, test, type Page } from './fixtures.js'

test.use({ viewport: { width: 1280, height: 1200 } })

type Placed = { y: number; h: number }

function placed(page: Page, id: string): Promise<Placed> {
  return page.evaluate((id) => window.__shellnote!.doc.block[id] as unknown as Placed, id)
}

/** Where a block is drawn on the screen: its top and bottom edges. */
async function drawn(page: Page, id: string): Promise<{ top: number; bottom: number }> {
  const box = (await page.locator(`.nw-page [data-id="${id}"]`).first().boundingBox())!
  return { top: box.y, bottom: box.y + box.height }
}

test('a frame made taller moves the frame below it down, and one undo puts both back', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  // A second frame just under the first, as an AI insert on empty paper makes one.
  const first = await page.evaluate(() => {
    const store = window.__shellnote!.store
    const pageId = store.doc.pages[0]!
    const id = store.doc.page[pageId]!.free[0]!
    const frame = store.doc.block[id] as unknown as { x: number; y: number; w: number }
    store.apply([
      { op: 'add', block: { id: 'under', r: 0, type: 'frame', page: pageId, x: frame.x, y: frame.y + 2500, w: frame.w, h: 1000, kids: [] } },
      { op: 'add', block: { id: 'below1', r: 0, type: 'text', parent: 'under', role: 'p', indent: 0, md: 'The table that was placed under it' }, at: 0 },
    ] as never)
    return id
  })
  await expect(page.locator('.nw-page [data-id="below1"]')).toBeVisible()
  const before = await placed(page, 'under')
  const doc = await page.evaluate(() => structuredClone(window.__shellnote!.doc))

  // Six lines go into the first frame at once, as an AI edit puts them: it grows past the frame under it.
  await page.evaluate((first) => {
    const store = window.__shellnote!.store
    store.apply(
      [1, 2, 3, 4, 5, 6].map((n) => ({ op: 'add', block: { id: `grow${n}`, r: 0, type: 'text', parent: first, role: 'p', indent: 0, md: `Line ${n} of a paragraph that grows` }, at: n - 1 })) as never,
    )
  }, first)
  await expect.poll(async () => (await placed(page, 'under')).y).toBeGreaterThan(before.y)
  // Nothing runs over anything: the first frame ends above the one it pushed.
  expect((await drawn(page, first)).bottom).toBeLessThanOrEqual((await drawn(page, 'under')).top)

  await page.locator('.nw-desk').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await placed(page, 'under')).y).toBe(before.y)
  const back = await page.evaluate(() => window.__shellnote!.doc.block)
  expect(Object.keys(back).sort()).toEqual(Object.keys(doc.block).sort())
})
