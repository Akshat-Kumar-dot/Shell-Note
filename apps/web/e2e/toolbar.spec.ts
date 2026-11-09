// Undo and redo, and the toolbar: every change goes through core, one undo
// step each, and the caret and selection stay where they were.
import { expect, inApp, test, type Page } from './fixtures.js'

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

test('the block type and style buttons change the block, one undo step each', async ({ page }) => {
  await startTyping(page)
  await page.keyboard.type('A title')
  await page.getByRole('combobox', { name: 'Block type' }).selectOption('h1')
  // The whole line, chosen as in Word, takes a size as its style.
  await page.locator('.nw-frame .nw-text').first().click({ clickCount: 3 })
  await page.getByRole('button', { name: 'Large', exact: true }).click()
  await page.getByRole('button', { name: 'Centre' }).click()
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

test('a to-do item can be ticked from the toolbar', async ({ page }) => {
  await startTyping(page)
  await page.keyboard.type('[ ] buy milk')
  await page.getByRole('button', { name: 'Ticked' }).click()
  expect((await blocks(page))[0]).toMatchObject({ role: 'todo', done: true })
  await expect(page.locator('.nw-frame .nw-text[data-done]')).toHaveCount(1)
})

// With room, every button is at least 40 px. In a narrow window the app bar may tighten its own buttons to 34, then
// 30 px, to keep every icon in one row (Workspace.tsx, useOneRow): never less.
test('every button of the bars is at least 40 px, for a finger or a pen, the colour panel included; the app bar never under 30 px in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto('/?sample=physics')
  await page.locator('[data-id="t2"]').click()
  await page.getByRole('button', { name: 'Colour', exact: true }).click()
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.nw-toolstrip button, .nw-toolstrip select, .nw-formatbar button, .nw-formatbar select, .nw-colour-panel button, .appbar button')]
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({ name: element.getAttribute('aria-label') ?? element.textContent, ...element.getBoundingClientRect().toJSON() }))
      .filter(({ width, height }) => width < 40 || height < 36),
  )
  expect(small).toEqual([])
  // Inside the app a page of the tests' server may not resize the window (Tauri allows that command to the app's own
  // pages only); the bar's steps are the same styles there, checked here in Edge.
  if (inApp) return
  await page.keyboard.press('Escape')
  // Narrow enough for the tightest step, not yet two rows.
  await page.setViewportSize({ width: 1060, height: 900 })
  await expect(page.locator('.appbar')).toHaveAttribute('data-tight', '3')
  const tightest = await page.locator('.appbar button').evaluateAll((buttons) =>
    buttons
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => ({ name: element.getAttribute('aria-label') ?? element.textContent, ...element.getBoundingClientRect().toJSON() }))
      .filter(({ width, height }) => width < 30 || height < 30),
  )
  expect(tightest).toEqual([])
})

test('the pen, highlighter and eraser of phase 3 are tools in the room kept for them, each with its own bar', async ({ page }) => {
  await page.goto('/?sample=physics')
  for (const name of ['Pen', 'Highlighter', 'Eraser']) {
    const tile = page.getByRole('radio', { name, exact: true })
    await tile.click()
    await expect(tile).toBeChecked()
    await expect(page.getByRole('toolbar', { name })).toBeVisible()
  }
  // Back to Type: the format bar again.
  await page.getByRole('radio', { name: 'Type', exact: true }).click()
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible()
})

test('the paper is chosen for every page, or for the page in view only, one undo step each', async ({ page }) => {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const papers = (): Promise<string[]> => page.evaluate(() => window.__shellnote!.doc.pages.map((id) => window.__shellnote!.doc.page[id]!.bg))
  const before = await papers()
  await page.getByRole('button', { name: 'Paper' }).click()
  await page.getByRole('button', { name: 'Lines' }).click()
  await expect.poll(papers).toEqual(['ruled', 'ruled', 'ruled'])
  await expect(page.locator('.nw-page').first()).toHaveAttribute('data-bg', 'ruled')
  await page.getByRole('radio', { name: 'This page' }).click()
  await page.getByRole('button', { name: 'Dots' }).click()
  await expect.poll(papers).toEqual(['dots', 'ruled', 'ruled'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: 'Paper' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(papers).toEqual(['ruled', 'ruled', 'ruled'])
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(papers).toEqual(before)
})
