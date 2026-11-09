// Typing in a frame: every change reaches core's document as operations, and
// changes from outside reach the screen without moving the caret.
import { expect, test, type Page } from './fixtures.js'

type Block = { id: string; type: string; role?: string; indent?: number; md?: string; done?: true }

/** The first frame's blocks, as core holds them. */
function blocks(page: Page): Promise<Block[]> {
  return page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const frame = doc.block[doc.page[doc.pages[0]!]!.free[0]!] as unknown as { kids: string[] }
    return frame.kids.map((id) => doc.block[id] as unknown as Block)
  })
}

/**
 * Wait until the editor has caught up with a caret move. The browser tells the
 * editor about one a moment after the key; a person is never fast enough to
 * notice, but a test can press the next key first.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const dom = getSelection()
    const element = document.activeElement?.closest('.ProseMirror') as (Element & { editor?: { view: { posAtDOM(n: Node, o: number): number }; state: { selection: { from: number } } } }) | null
    if (!dom?.anchorNode || !element?.editor) return false
    return element.editor.view.posAtDOM(dom.anchorNode, dom.anchorOffset) === element.editor.state.selection.from
  })
}

async function startTyping(page: Page): Promise<void> {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
}

test('Markdown-style shortcuts make headings, lists, to-dos and quotes', async ({ page }) => {
  await startTyping(page)
  const keys = page.keyboard
  await keys.type('# Forces')
  await keys.press('Enter')
  await keys.type('A push or a pull.')
  await keys.press('Enter')
  await keys.type('- gravity')
  await keys.press('Enter')
  await keys.type('friction')
  await keys.press('Enter')
  // Enter on an empty item steps out of the list.
  await keys.press('Enter')
  await keys.type('1. measure')
  await keys.press('Enter')
  await keys.type('divide')
  await keys.press('Enter')
  await keys.press('Enter')
  await keys.type('[ ] revise')
  await keys.press('Enter')
  await keys.press('Enter')
  await keys.type('> Quote me.')
  expect((await blocks(page)).map((b) => [b.role, b.md])).toEqual([
    ['h1', 'Forces'],
    ['p', 'A push or a pull.'],
    ['li', 'gravity'],
    ['li', 'friction'],
    ['oli', 'measure'],
    ['oli', 'divide'],
    ['todo', 'revise'],
    ['quote', 'Quote me.'],
  ])
  // The screen numbers the steps, as the exports would.
  await expect(page.locator('.nw-frame .nw-text[data-role="oli"]').nth(1)).toHaveAttribute('data-number', '2')
})

test('Enter splits a block and Backspace joins it back; the first part keeps its id', async ({ page }) => {
  await startTyping(page)
  await page.keyboard.type('SecondLine')
  const [before] = await blocks(page)
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
  await settled(page)
  await page.keyboard.press('Enter')
  const split = await blocks(page)
  expect(split.map((b) => b.md)).toEqual(['Second', 'Line'])
  expect(split[0]!.id).toBe(before!.id)
  expect(split[1]!.id).toMatch(/^[A-Za-z0-9]{8}$/)
  await page.keyboard.press('Backspace')
  expect((await blocks(page)).map((b) => [b.id, b.md])).toEqual([[before!.id, 'SecondLine']])
})

test('formats words with the usual shortcuts', async ({ page }) => {
  await startTyping(page)
  const keys = page.keyboard
  await keys.type('a ')
  await keys.press('Control+b')
  await keys.type('bold')
  await keys.press('Control+b')
  await keys.type(' and ')
  await keys.press('Control+i')
  await keys.type('italic')
  await keys.press('Control+i')
  await keys.type(' and `code` too')
  expect((await blocks(page))[0]!.md).toBe('a **bold** and *italic* and `code` too')
})

test('Ctrl+Shift+X strikes words through, and Ctrl+Shift+S saves to a new file instead of striking them', async ({ page }) => {
  // Count the file dialogs asked for, as Chrome's picker would open them; each one is closed at once.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    w.savePicks = 0
    w.showSaveFilePicker = async () => {
      w.savePicks = (w.savePicks as number) + 1
      throw new DOMException('Closed', 'AbortError')
    }
  })
  await startTyping(page)
  const keys = page.keyboard
  await keys.type('a ')
  await keys.press('Control+Shift+x')
  await keys.type('gone')
  await keys.press('Control+Shift+x')
  await keys.type(' b')
  expect((await blocks(page))[0]!.md).toBe('a ~~gone~~ b')
  await keys.press('Control+Shift+s')
  await expect.poll(() => page.evaluate(() => (window as unknown as { savePicks: number }).savePicks)).toBe(1)
  expect((await blocks(page))[0]!.md).toBe('a ~~gone~~ b')
})

test('Tab and Shift+Tab indent and outdent', async ({ page }) => {
  await startTyping(page)
  await page.keyboard.type('- one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  await page.keyboard.press('Tab')
  expect((await blocks(page)).map((b) => b.indent)).toEqual([0, 1])
  await page.keyboard.press('Shift+Tab')
  expect((await blocks(page)).map((b) => b.indent)).toEqual([0, 0])
})

test('a change from outside keeps the caret where it was', async ({ page }) => {
  await page.goto('/?sample=physics')
  await page.locator('.nw-frame [data-id="t2"]').click()
  await page.keyboard.press('End')
  await settled(page)
  // As undo or an AI edit would: change the heading, and insert a block above the paragraph being typed in.
  await page.evaluate(() =>
    window.__shellnote!.store.apply([
      { op: 'splice', id: 't1', field: 'md', at: 0, del: 0, ins: 'Laws: ' },
      { op: 'add', block: { id: 'nb000001', r: 0, type: 'text', parent: 'f1', role: 'p', indent: 0, md: 'Inserted from outside.' }, at: 1 },
    ]),
  )
  await expect(page.locator('.nw-frame [data-id="t1"]')).toHaveText("Laws: Newton's laws")
  await page.keyboard.type(' (first law)')
  const doc = await page.evaluate(() => window.__shellnote!.doc)
  expect((doc.block.t2 as unknown as Block).md).toBe('An object at rest stays at rest unless a **force** acts on it. (first law)')
  expect((doc.block.f1 as unknown as { kids: string[] }).kids).toEqual(['t1', 'nb000001', 't2', 'm1'])
})

test('a numbered list counts on at any indent, and a sub-list shows letters', async ({ page }) => {
  await startTyping(page)
  const keys = page.keyboard
  // Tab first, then a numbered list: both items at the same indent.
  await keys.press('Tab')
  await keys.type('1. first')
  await keys.press('Enter')
  await keys.type('second')
  await keys.press('Enter')
  await keys.press('Tab')
  await keys.type('inner')
  const markers = page.locator('.nw-frame .nw-text[data-role="oli"]')
  await expect(markers).toHaveCount(3)
  expect(await markers.evaluateAll((els) => els.map((el) => getComputedStyle(el, '::before').content))).toEqual(['"1."', '"2."', '"a."'])
})
