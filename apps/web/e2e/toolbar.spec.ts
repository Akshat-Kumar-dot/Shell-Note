// Undo and redo, and the note's row of tools: every change goes through core, one undo step each, and the caret and
// selection stay where they were.
import { expect, inApp, test, type Page } from './fixtures.js'
import { chooseTool, penRow, textAlign, textRow, textSize, textStyle } from './shell.js'

type Block = { id: string; role?: string; md?: string; done?: true; style?: Record<string, string> }

function blocks(page: Page): Promise<Block[]> {
  return page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const frame = doc.block[doc.page[doc.pages[0]!]!.free[0]!] as unknown as { kids: string[] }
    return frame.kids.map((id) => doc.block[id] as unknown as Block)
  })
}

/** Wait until the editor has caught up with a caret move (see typing.spec.ts). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const dom = getSelection()
    const element = document.activeElement?.closest('.ProseMirror') as (Element & { editor?: { view: { posAtDOM(n: Node, o: number): number }; state: { selection: { head: number } } } }) | null
    if (!dom?.focusNode || !element?.editor) return false
    return element.editor.view.posAtDOM(dom.focusNode, dom.focusOffset) === element.editor.state.selection.head
  })
}

async function startTyping(page: Page): Promise<void> {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
}

/** Select the last `count` characters before the caret. */
async function selectBack(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await page.keyboard.press('Shift+ArrowLeft')
  await settled(page)
}

test('Ctrl+Z and Ctrl+Y undo and redo, a typed line at a time', async ({ page }) => {
  await startTyping(page)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await page.keyboard.type('Hello world')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Second line')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
  await page.keyboard.press('Control+z')
  expect((await blocks(page)).map((b) => b.md)).toEqual(['Hello world'])
  await page.keyboard.press('Control+z')
  expect(await blocks(page)).toEqual([])
  await expect(page.locator('.nw-frame .ProseMirror')).toHaveText('')
  await page.keyboard.press('Control+y')
  await page.keyboard.press('Control+Shift+z')
  expect((await blocks(page)).map((b) => b.md)).toEqual(['Hello world', 'Second line'])
  await expect(page.locator('.nw-frame .ProseMirror')).toContainText('Second line')
})

test("the block's style, size and alignment change the block, one undo step each", async ({ page }) => {
  await startTyping(page)
  await page.keyboard.type('A title')
  await textStyle(page, 'Heading 1')
  // The Style button names the block's style.
  await expect(textRow(page).getByRole('button', { name: 'Style', exact: true })).toContainText('Heading 1')
  // The whole line, chosen as in Word, takes a size as its style.
  await page.locator('.nw-frame .nw-text').first().click({ clickCount: 3 })
  await textSize(page, 'Large')
  await textAlign(page, 'Centre')
  expect((await blocks(page))[0]).toMatchObject({ role: 'h1', md: 'A title', style: { size: 'l', align: 'center' } })
  // The text still has the focus: typing carries on there.
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  expect((await blocks(page))[0]!.md).toBe('A title!')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  expect((await blocks(page))[0]).toMatchObject({ role: 'h1', style: { size: 'l' } })
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await blocks(page))[0]).toMatchObject({ role: 'p', md: 'A title' })
})

test('the word buttons format the selected words and keep them selected', async ({ page }) => {
  await startTyping(page)
  await page.keyboard.type('make this bold')
  await selectBack(page, 4)
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Italic' }).click()
  expect((await blocks(page))[0]!.md).toBe('make this ***bold***')
  // Colour goes to the selected words, as an AI's style would send it.
  await page.getByRole('button', { name: 'Colour', exact: true }).click()
  await page.getByRole('button', { name: 'red', exact: true }).click()
  expect((await blocks(page))[0]!.md).toBe('make this [***bold***]{color=red}')
  // With only a caret inside a word, colour goes to that word, as in Word.
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await settled(page)
  await page.getByRole('button', { name: 'Colour', exact: true }).click()
  await page.getByRole('button', { name: 'green', exact: true }).click()
  expect((await blocks(page))[0]!.md).toBe('[make]{color=green} this [***bold***]{color=red}')
  // At the end of the line, it goes to the words typed next; the block keeps its own colour.
  await page.keyboard.press('End')
  await page.keyboard.type(' ')
  await settled(page)
  await page.getByRole('button', { name: 'Colour', exact: true }).click()
  await page.getByRole('button', { name: 'blue', exact: true }).click()
  await page.keyboard.type('now')
  const block = (await blocks(page))[0]!
  expect(block.style).toBeUndefined()
  expect(block.md).toMatch(/now\]\{color=blue\}$/u)
})

test("a to-do item can be ticked from the row's More menu", async ({ page }) => {
  await startTyping(page)
  await page.keyboard.type('[ ] buy milk')
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Ticked', exact: true }).click()
  expect((await blocks(page))[0]).toMatchObject({ role: 'todo', done: true })
  await expect(page.locator('.nw-frame .nw-text[data-done]')).toHaveCount(1)
})

// The design's buttons: 32 pixels with a mouse (40 where a finger or a pen presses, by the same rule), the colour
// panel's swatches 40 for a finger. The row stays one row however narrow the window: it scrolls sideways instead.
test("every button of the rows is the design's 32 pixels at least, the colour panel's 40; a narrow window scrolls the row, never wraps it", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto('/?sample=physics')
  await page.locator('[data-id="t2"]').click()
  const small = async (selector: string, least: number) =>
    page.evaluate(
      ([selector, least]) =>
        [...document.querySelectorAll<HTMLElement>(selector as string)]
          .filter((element) => element.offsetParent !== null)
          .map((element) => ({ name: element.getAttribute('aria-label') ?? element.textContent, ...element.getBoundingClientRect().toJSON() }))
          .filter(({ width, height }) => width < (least as number) || height < (least as number)),
      [selector, least],
    )
  expect(await small('.sh-tools button', 32)).toEqual([])
  await chooseTool(page, 'pen')
  expect(await small('.sh-tools button', 32)).toEqual([])
  await chooseTool(page, 'type')
  await page.locator('[data-id="t2"]').click()
  await page.getByRole('button', { name: 'Colour', exact: true }).click()
  expect(await small('.nw-colour-panel button', 40)).toEqual([])
  await page.keyboard.press('Escape')
  // Inside the app a page of the tests' server may not resize the window (Tauri allows that command to the app's own
  // pages only); the row is the same styles there, checked here in Edge.
  if (inApp) return
  await page.setViewportSize({ width: 900, height: 900 })
  const row = textRow(page)
  await expect.poll(async () => (await row.boundingBox())!.height).toBe(43)
  expect(await row.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await row.evaluate((element) => element.scrollTo({ left: element.scrollWidth }))
  await expect(row.getByRole('button', { name: 'Pen', exact: true })).toBeInViewport()
})

test("the pen, the highlighter and the eraser bring the pen's row in place of the words' row, each shown as in hand; Type brings the words' row back", async ({ page }) => {
  await page.goto('/?sample=physics')
  for (const [tool, name] of [['pen', 'Pen'], ['highlighter', 'Highlighter'], ['eraser', 'Eraser']] as const) {
    await chooseTool(page, tool)
    await expect(page.getByRole('toolbar', { name })).toBeVisible()
    await expect(penRow(page).getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0)
  }
  // Back to Type: the words' row again, in the same place.
  await chooseTool(page, 'type')
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible()
  await expect(penRow(page)).toHaveCount(0)
  // Both rows at once, when chosen so (More), one under the other; and back to one.
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Show both rows', exact: true }).click()
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Pen' })).toBeVisible()
  const [words, pen] = [(await textRow(page).boundingBox())!, (await penRow(page).boundingBox())!]
  expect(pen.y).toBeGreaterThanOrEqual(words.y + words.height - 1)
  await page.keyboard.press('Escape')
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Show both rows', exact: true }).click()
  await expect(penRow(page)).toHaveCount(0)
})

test('the paper is chosen for every page, or for the page in view only, one undo step each', async ({ page }) => {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const papers = (): Promise<string[]> => page.evaluate(() => window.__shellnote!.doc.pages.map((id) => window.__shellnote!.doc.page[id]!.bg))
  const before = await papers()
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('radio', { name: 'Lines', exact: true }).click()
  await expect.poll(papers).toEqual(['ruled', 'ruled', 'ruled'])
  await expect(page.locator('.nw-page').first()).toHaveAttribute('data-bg', 'ruled')
  await page.getByRole('radio', { name: 'This page' }).click()
  await page.getByRole('radio', { name: 'Dots', exact: true }).click()
  await expect.poll(papers).toEqual(['dots', 'ruled', 'ruled'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('radiogroup', { name: 'Paper' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(papers).toEqual(['ruled', 'ruled', 'ruled'])
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(papers).toEqual(before)
})
