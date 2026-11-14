// The file format's version 2 in the editor (Stage 3a): underline, subscript
// and superscript by button and by Word's keys, in text, a table's cell, a
// caption and on a Select box; and size and font on the selected words, a whole
// line taking them as its style.
import { expect, test, type Page } from './fixtures.js'
import { chooseTool, fontAndSize, moreMark, textRow, textSize } from './shell.js'

test.use({ viewport: { width: 1280, height: 1000 } })

type Block = { id: string; type: string; md?: string; style?: Record<string, string>; rows?: string[][]; caption?: string }

const blocks = (page: Page): Promise<Block[]> => page.evaluate(() => Object.values(window.__shellnote!.doc.block) as unknown as Block[])
const texts = async (page: Page): Promise<Block[]> => (await blocks(page)).filter((b) => b.type === 'text')

async function start(page: Page): Promise<void> {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
}

/** Wait until the editor has caught up with a caret moved by the keyboard: the browser moves it first, the editor hears of it a moment later. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const dom = getSelection()
    const element = document.activeElement?.closest('.ProseMirror') as (Element & { editor?: { view: { posAtDOM(n: Node, o: number): number }; state: { selection: { head: number } } } }) | null
    if (!dom?.focusNode || !element?.editor) return false
    return element.editor.view.posAtDOM(dom.focusNode, dom.focusOffset) === element.editor.state.selection.head
  })
}

/** Select characters [start, end) of the line the caret is on, with Home and Shift and the arrows. */
async function selectChars(page: Page, start: number, end: number): Promise<void> {
  await page.keyboard.press('Home')
  for (let i = 0; i < start; i++) await page.keyboard.press('ArrowRight')
  for (let i = start; i < end; i++) await page.keyboard.press('Shift+ArrowRight')
  await settled(page)
}

type Box = { left: number; top: number; right: number; bottom: number }
function wordBox(page: Page, words: string): Promise<Box> {
  return page.evaluate((words) => {
    const walker = document.createTreeWalker(document.querySelector('.nw-page')!, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(words)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + words.length)
      const r = range.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }
    throw new Error(`"${words}" is not on the page`)
  }, words)
}

test('underline, subscript and superscript by button and by key, with the keys in the tooltips', async ({ page }) => {
  await start(page)
  await page.keyboard.type('H2O and x2 and under')
  await expect(page.getByRole('button', { name: 'Underline' })).toHaveAttribute('title', /Ctrl\+U/u)
  // Subscript and superscript are under More, each with its keys.
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Subscript', exact: true })).toHaveAttribute('title', /Ctrl\+=/u)
  await expect(page.getByRole('menuitemcheckbox', { name: 'Superscript', exact: true })).toHaveAttribute('title', /Ctrl\+Shift\+=/u)
  await page.keyboard.press('Escape')
  await selectChars(page, 1, 2)
  await moreMark(page, 'Subscript')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('H[2]{.sub}O and x2 and under')
  await expect(page.locator('.nw-frame sub')).toHaveText('2')
  await selectChars(page, 9, 10)
  await page.keyboard.press('Control+Shift+Equal')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('H[2]{.sub}O and x[2]{.sup} and under')
  await selectChars(page, 15, 20)
  await page.keyboard.press('Control+u')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('H[2]{.sub}O and x[2]{.sup} and [under]{.underline}')
  // Subscript in place of superscript, as in Word: never both.
  await selectChars(page, 9, 10)
  await page.keyboard.press('Control+Equal')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('H[2]{.sub}O and x[2]{.sub} and [under]{.underline}')
  // Each is one undo step.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('H[2]{.sub}O and x[2]{.sup} and [under]{.underline}')
})

test('the keys mark the words, not the space after them that a double-click on Windows selects too', async ({ page }) => {
  await start(page)
  await page.keyboard.type('one two three')
  // "two " with its space, as Windows selects it.
  await selectChars(page, 4, 8)
  await page.keyboard.press('Control+u')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('one [two]{.underline} three')
  await page.keyboard.press('Control+Equal')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('one [[two]{.sub}]{.underline} three')
  // The selection is as it was: Delete takes the space along, as on Windows.
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('one three')
})

test('the marks work in a table cell, on a Select box, and in a caption', async ({ page }) => {
  await start(page)
  await page.keyboard.type('some words here')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('button', { name: '2 by 2 table' }).click()
  await page.keyboard.type('x2')
  await page.keyboard.press('Shift+ArrowLeft')
  await settled(page)
  await moreMark(page, 'Superscript')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await blocks(page)).find((b) => b.type === 'table')?.rows?.[0]?.[0]).toBe('x[2]{.sup}')
  // A Select box around "words", then Ctrl+U.
  const words = await wordBox(page, 'words')
  await chooseTool(page, 'select')
  await page.mouse.move(words.left - 2, words.top - 2)
  await page.mouse.down()
  await page.mouse.move(words.right + 2, words.bottom + 2, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Control+u')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('some [words]{.underline} here')
  // The table's caption: typed, selected, underlined from the bar.
  await chooseTool(page, 'type')
  await page.locator('.nw-table td').first().click()
  await page.locator('.nw-table .nw-caption').click()
  await page.keyboard.type('Table one')
  await page.keyboard.press('Shift+Home')
  await settled(page)
  await page.getByRole('button', { name: 'Underline' }).click()
  await expect.poll(async () => (await blocks(page)).find((b) => b.type === 'table')?.caption).toBe('[Table one]{.underline}')
})

test('size and font change only the selected words, a whole line takes them as its style, and they are kept', async ({ page }) => {
  await start(page)
  await page.keyboard.type('Alpha beta gamma')
  const beta = await wordBox(page, 'beta')
  await page.mouse.dblclick((beta.left + beta.right) / 2, (beta.top + beta.bottom) / 2)
  await textSize(page, 'Large')
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('Alpha [beta]{size=l} gamma')
  const menu = await fontAndSize(page)
  await expect(menu.getByRole('radio', { name: 'Large', exact: true })).toHaveAttribute('aria-checked', 'true')
  await menu.getByRole('menuitemradio', { name: 'Serif', exact: true }).click()
  await expect.poll(async () => (await texts(page))[0]!.md).toBe('Alpha [[beta]{font=serif}]{size=l} gamma')
  await expect(page.locator('.nw-frame span[data-size="l"]')).toHaveCSS('font-size', /^18\.6/u)
  // The whole line: its own style, and the words' own size gives way to it.
  await page.mouse.click((beta.left + beta.right) / 2, (beta.top + beta.bottom) / 2, { clickCount: 3 })
  await textSize(page, 'Extra large')
  await expect.poll(async () => (await texts(page))[0]!.style).toEqual({ size: 'xl' })
  expect((await texts(page))[0]!.md).toBe('Alpha [beta]{font=serif} gamma')
  // Kept in the library: a reload gives the same words.
  await expect.poll(() => page.evaluate(() => window.__shellnote!.keptRev === window.__shellnote!.doc.rev)).toBe(true)
  await page.reload()
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  expect((await texts(page))[0]).toMatchObject({ md: 'Alpha [beta]{font=serif} gamma', style: { size: 'xl' } })
})
