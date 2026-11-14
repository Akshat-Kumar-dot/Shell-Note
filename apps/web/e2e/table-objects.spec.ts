// Tables as objects, as in Word (Stage 3a): the ⊕ handle chooses a table and
// drags it elsewhere, onto the next page too, in one undo step; a column's
// border and the table's corner resize it; the bar gives it a look; Delete
// removes it; and all of it is kept after a reload.
import { expect, test, type Page } from './fixtures.js'
import { zoom } from './shell.js'

type Table = { id: string; type: 'table'; parent: string; rows: string[][]; cols?: number[]; width?: number; look?: string }
type Frame = { id: string; type: 'frame'; page: string; kids: string[] }

const table = (page: Page): Promise<Table | undefined> =>
  page.evaluate(() => Object.values(window.__shellnote!.doc.block).find((b) => b.type === 'table') as unknown as Table | undefined)
const block = (page: Page, id: string): Promise<Frame | Table | undefined> => page.evaluate((id) => window.__shellnote!.doc.block[id] as unknown as Frame | Table | undefined, id)
const chosen = (page: Page) => page.evaluate(() => ({ kind: window.__shellnote!.store.selectionKind, blocks: window.__shellnote!.store.selection.blocks }))

/** A new note: two lines, then a table of two columns with words in its cells. */
async function start(page: Page, columns = 2): Promise<Table> {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('First line')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Second line')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('button', { name: `${columns} by 2 table` }).click()
  await page.keyboard.type('Name')
  await expect.poll(async () => (await table(page))?.rows[0]?.[0]).toBe('Name')
  return (await table(page))!
}

/** Where an element is, by its middle. */
async function middle(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(selector).first().boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Press on the ⊕ handle and drag it to a point, in steps, as a hand does. */
async function dragHandle(page: Page, to: { x: number; y: number }): Promise<void> {
  const from = await middle(page, '.nw-table-handle')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await expect(page.locator('.nw-drop-line')).toBeVisible()
  await page.mouse.up()
}

test.use({ viewport: { width: 1280, height: 1000 } })

test('⊕ chooses the table: the bar shows its tools, Escape lets it go, Delete removes it in one undo step', async ({ page }) => {
  const made = await start(page)
  // While the caret is in the table, its handle shows.
  await expect(page.locator('.nw-table-handle')).toBeVisible()
  const handle = await middle(page, '.nw-table-handle')
  await page.mouse.click(handle.x, handle.y)
  await expect.poll(() => chosen(page)).toEqual({ kind: 'objects', blocks: [made.id] })
  await expect(page.locator('.nw-table[data-chosen]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Table style' })).toBeVisible()
  // The keys now act on the table, not on the text.
  await expect(page.locator('.nw-frame .ProseMirror').first()).not.toBeFocused()
  await page.keyboard.press('Escape')
  await expect.poll(() => chosen(page)).toEqual({ kind: 'objects', blocks: [] })
  await page.locator('.nw-table td').first().click()
  await page.mouse.click(handle.x, handle.y)
  await page.keyboard.press('Delete')
  await expect.poll(() => table(page)).toBeUndefined()
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await table(page))?.rows[0]?.[0]).toBe('Name')
})

test('⊕ drags the table above a line, and onto the next page, each in one undo step, and it stays chosen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1700 })
  const made = await start(page)
  const frame = made.parent
  // Up, above the first line.
  const first = (await page.getByText('First line').boundingBox())!
  await dragHandle(page, { x: first.x + 40, y: first.y + 2 })
  await expect.poll(async () => ((await block(page, frame)) as Frame).kids.indexOf(made.id)).toBe(0)
  await expect.poll(() => chosen(page)).toEqual({ kind: 'objects', blocks: [made.id] })
  await page.keyboard.press('Control+z')
  await expect.poll(async () => ((await block(page, frame)) as Frame).kids.indexOf(made.id)).toBe(2)

  // A second page, as text running over the first would make, seen at half size.
  await page.evaluate(() => {
    const { doc, store } = window.__shellnote!
    const first = doc.page[doc.pages[0]!]!
    store.apply([
      { op: 'page', add: { id: 'p2', w: first.w, h: first.h, bg: 'blank', free: [] } },
      { op: 'add', block: { id: 'f2', r: 0, type: 'frame', page: 'p2', x: 2000, y: 2000, w: first.w - 4000, h: 0, kids: [] } },
      { op: 'add', block: { id: 'g2', r: 0, type: 'text', parent: 'f2', role: 'p', indent: 0, md: 'On page two' } },
    ] as never)
  })
  for (let i = 0; i < 4; i++) await zoom(page, 'out')
  await expect(page.getByText('On page two')).toBeVisible()
  await page.locator('.nw-table td').first().click()
  const two = (await page.getByText('On page two').boundingBox())!
  await dragHandle(page, { x: two.x + 20, y: two.y + 1 })
  await expect.poll(async () => (await table(page))?.parent).toBe('f2')
  expect(((await block(page, 'f2')) as Frame).kids).toEqual([made.id, 'g2'])
  expect(((await block(page, frame)) as Frame).kids).not.toContain(made.id)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await table(page))?.parent).toBe(frame)
  expect(((await block(page, 'f2')) as Frame).kids).toEqual(['g2'])

  // Onto bare paper: a frame is made there for it, and undo takes the frame away too.
  await page.locator('.nw-table td').first().click()
  const sheet = (await page.locator('.nw-page').nth(1).boundingBox())!
  await dragHandle(page, { x: sheet.x + sheet.width * 0.3, y: sheet.y + sheet.height * 0.6 })
  const parent = (await table(page))!.parent
  expect(parent).not.toBe(frame)
  expect(await block(page, parent)).toMatchObject({ type: 'frame', page: 'p2', kids: [made.id] })
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await table(page))?.parent).toBe(frame)
  expect(await block(page, parent)).toBeUndefined()
})

test("a column's border and the table's corner resize it, the bar gives it a look, one undo step each, and all are kept", async ({ page }) => {
  await start(page, 3)
  const across = (await page.locator('.nw-grid').first().boundingBox())!.width
  // The first column's right border, a sixth of the table to the right.
  const border = await middle(page, '.nw-col-border[data-col="0"]')
  await page.mouse.move(border.x, border.y)
  await page.mouse.down()
  await page.mouse.move(border.x + across / 6, border.y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await table(page))?.cols?.[2]).toBe(333)
  const cols = (await table(page))!.cols!
  expect(cols.reduce((sum, share) => sum + share, 0)).toBe(1000)
  expect(cols[0]).toBeGreaterThan(480)
  expect(cols[0]).toBeLessThan(520)
  await expect(page.locator('.nw-grid col').first()).toHaveAttribute('style', `width: ${cols[0]! / 10}%;`)

  // The corner, three tenths of the frame to the left: the table is 70% as wide as its frame.
  const corner = await middle(page, '.nw-table-corner')
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x - across * 0.3, corner.y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await table(page))?.width).toBeGreaterThan(650)
  expect((await table(page))!.width).toBeLessThan(750)

  // A look from the bar.
  await page.getByRole('button', { name: 'Table style' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Banded rows' }).click()
  await expect.poll(async () => (await table(page))?.look).toBe('banded')
  await expect(page.locator('.nw-grid').first()).toHaveAttribute('data-look', 'banded')

  // One undo step each: the look, then the width, then the columns.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await table(page))?.look).toBeUndefined()
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await table(page))?.width).toBeUndefined()
  expect((await table(page))!.cols).toEqual(cols)
  await page.keyboard.press('Control+y')
  await page.keyboard.press('Control+y')
  await expect.poll(async () => (await table(page))?.look).toBe('banded')

  // Kept in the library: a reload gives the same table.
  const now = (await table(page))!
  await expect.poll(() => page.evaluate(() => window.__shellnote!.keptRev === window.__shellnote!.doc.rev)).toBe(true)
  await page.reload()
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  expect(await table(page)).toMatchObject({ cols: now.cols, width: now.width, look: 'banded' })
  await expect(page.locator('.nw-grid').first()).toHaveAttribute('data-look', 'banded')
})
