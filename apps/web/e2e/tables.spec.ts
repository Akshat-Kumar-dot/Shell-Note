// Tables, the Word way: a grid picks the size, the bar's table tools and a
// right-click menu insert and delete rows and columns, and a table can be
// pasted. Every change reaches core's document as rows of cells.
import { expect, test, type Locator, type Page } from './fixtures.js'

type Kid = { id: string; type: string; md?: string; rows?: string[][]; head?: true; caption?: string; alt?: string }

/** The first frame's blocks, as core holds them. */
function kids(page: Page): Promise<Kid[]> {
  return page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const frame = doc.block[doc.page[doc.pages[0]!]!.free[0]!] as unknown as { kids: string[] }
    return frame.kids.map((id) => doc.block[id] as unknown as Kid)
  })
}

async function table(page: Page): Promise<Kid | undefined> {
  return (await kids(page)).find((kid) => kid.type === 'table')
}

/** Paste text, with HTML when given, as Ctrl+V would. */
async function paste(target: Locator, text: string, html?: string): Promise<void> {
  await target.evaluate(
    (el, [text, html]) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      if (html) data.setData('text/html', html)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    },
    [text, html] as const,
  )
}

async function startTyping(page: Page): Promise<Locator> {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const text = page.locator('.nw-frame .ProseMirror').first()
  await text.click()
  return text
}

/** Insert a table of columns by rows from the grid, as in Word. */
async function insertTable(page: Page, columns: number, rows: number): Promise<void> {
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('button', { name: `${columns} by ${rows} table` }).click()
}

test('the grid picks a table size, as in Word; Tab goes from cell to cell and adds a row at the end', async ({ page }) => {
  await startTyping(page)
  await page.keyboard.type('Results')
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  // Moving over the grid shows the size to be inserted.
  await page.getByRole('button', { name: '4 by 2 table' }).hover()
  await expect(page.getByRole('group', { name: 'Table size' })).toContainText('4 × 2 table')
  await expect(page.locator('.nw-pick-cell[data-on]')).toHaveCount(8)
  await page.getByRole('button', { name: '3 by 3 table' }).click()
  await expect(page.getByRole('group', { name: 'Table size' })).toBeHidden()
  await expect.poll(async () => (await kids(page)).map((kid) => kid.type)).toEqual(['text', 'table'])
  // A new table is plain, as in Word, and the caret is in its first cell.
  for (const words of ['Name', 'Age', 'Note', 'Ann', '31']) {
    await page.keyboard.type(words)
    await page.keyboard.press('Tab')
  }
  await expect.poll(async () => (await table(page))?.rows).toEqual([
    ['Name', 'Age', 'Note'],
    ['Ann', '31', ''],
    ['', '', ''],
  ])
  expect((await table(page))?.head).toBeUndefined()
  // From the second row's last cell, Tab four times passes the table's last cell: a new row.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab')
  await expect.poll(async () => (await table(page))?.rows?.length).toBe(4)
  // Typing in one cell is one undo step; the new row is another.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await table(page))?.rows?.length).toBe(3)
})

test("the bar's table tools insert and delete rows and columns, switch the header row and delete the table", async ({ page }) => {
  await startTyping(page)
  await insertTable(page, 2, 2)
  await page.keyboard.press('Control+b')
  await page.keyboard.type('Total')
  await expect.poll(async () => (await table(page))?.rows?.[0]?.[0]).toBe('**Total**')

  await page.getByRole('button', { name: 'Insert column right' }).click()
  await page.getByRole('button', { name: 'Insert row above' }).click()
  await expect.poll(async () => (await table(page))?.rows?.map((row) => row.length)).toEqual([3, 3, 3])
  // The new row went above the caret's row, so "Total" is now in the second row.
  expect((await table(page))?.rows?.[1]?.[0]).toBe('**Total**')

  // The header row is the first row, wherever the caret is.
  await page.getByRole('button', { name: 'Header row' }).click()
  await expect.poll(async () => (await table(page))?.head).toBe(true)
  await expect(page.locator('.nw-frame th')).toHaveCount(3)

  // Delete ▾ holds the deletes, as in Word.
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete column' }).click()
  await expect.poll(async () => (await table(page))?.rows?.[0]?.length).toBe(2)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete table' }).click()
  await expect.poll(async () => (await kids(page)).some((kid) => kid.type === 'table')).toBe(false)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await table(page))?.rows?.length).toBe(3)
})

test('a right-click in a cell opens the table menu, acting on the cell clicked', async ({ page }) => {
  await startTyping(page)
  await insertTable(page, 3, 2)
  await page.keyboard.type('a')
  await page.keyboard.press('Tab')
  await page.keyboard.type('b')
  // Right-click the second row's first cell.
  await page.locator('.nw-frame td').nth(3).click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Table' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Insert row below' }).click()
  await expect(menu).toBeHidden()
  await expect.poll(async () => (await table(page))?.rows?.length).toBe(3)
  await page.locator('.nw-frame td').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete row' }).click()
  await expect.poll(async () => (await table(page))?.rows).toEqual([
    ['', '', ''],
    ['', '', ''],
  ])
  // Escape closes the menu without doing anything.
  await page.locator('.nw-frame td').first().click({ button: 'right' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Table' })).toBeHidden()
})

test('a pasted Markdown pipe table becomes a table, and so does a pasted HTML table, merged cells and all', async ({ page }) => {
  const text = await startTyping(page)
  await page.keyboard.type('Before')
  await paste(text, '| Planet | Moons |\n| --- | --: |\n| Earth | 1 |\n| Mars | 2 |')
  await expect.poll(() => table(page)).toMatchObject({
    rows: [
      ['Planet', 'Moons'],
      ['Earth', '1'],
      ['Mars', '2'],
    ],
    head: true,
  })

  // The table's tools show while the caret is in it.
  await page.locator('.nw-frame td').first().click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete table' }).click()
  await expect.poll(() => table(page)).toBeUndefined()
  await text.click()
  await page.keyboard.press('End')
  await paste(text, 'x y', '<table><tr><th>x</th><th>y</th></tr><tr><td colspan="2"><p>wide <b>cell</b></p></td></tr></table>')
  await expect.poll(() => table(page)).toMatchObject({
    rows: [
      ['x', 'y'],
      ['wide **cell**', ''],
    ],
    head: true,
  })
  // The editor shows what core keeps: one cell per spot.
  await expect(page.locator('.nw-frame td[colspan]')).toHaveCount(0)
  await expect(page.locator('.nw-frame td')).toHaveCount(2)
})

test('a table takes a formatted caption and a hidden description', async ({ page }) => {
  await startTyping(page)
  await insertTable(page, 2, 2)
  await page.keyboard.type('Ann')
  // While the caret is in the table, its empty caption line shows, ready to type in.
  const caption = page.locator('.nw-frame .nw-table figcaption')
  await expect(caption).toBeVisible()
  await caption.click()
  await page.keyboard.type('Ages in ')
  await page.keyboard.press('Control+i')
  await page.keyboard.type('2026')
  await expect.poll(async () => (await table(page))?.caption).toBe('Ages in *2026*')
  // Enter after the caption starts a new line under the table.
  await page.keyboard.press('Enter')
  await page.keyboard.type('After')
  await expect.poll(async () => (await kids(page)).map((kid) => kid.type)).toEqual(['table', 'text'])

  await page.locator('.nw-frame td').first().click()
  await page.getByRole('textbox', { name: 'Description' }).fill('Ages of the people we met')
  await expect.poll(async () => (await table(page))?.alt).toBe('Ages of the people we met')
})
