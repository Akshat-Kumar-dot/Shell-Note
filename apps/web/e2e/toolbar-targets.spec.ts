// Where the toolbar's changes go "a change lands on the last caret's word").
// For every way of selecting words, and every change, only the selected words
// change: never the word the caret was in before. And the bar is never locked:
// with only a caret, a change goes to its whole word, or to the words typed
// next; with nothing chosen, to where the caret last was, shown in grey.
import { expect, test, type Page } from './fixtures.js'
import { chooseTool, textFont, textRow, textSize } from './shell.js'

test.use({ viewport: { width: 1280, height: 1000 } })

type Block = { id: string; md: string; style?: Record<string, string> }

function lines(page: Page): Promise<Block[]> {
  return page.evaluate(() => Object.values(window.__shellnote!.doc.block).filter((b) => b.type === 'text') as unknown as Block[])
}

type Box = { left: number; top: number; right: number; bottom: number }

/** Where some words are drawn on the screen. */
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

/** Wait until the editor has caught up with a caret moved by the keyboard: the browser moves it first, the editor hears of it a moment later. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const dom = getSelection()
    const element = document.activeElement?.closest('.ProseMirror') as (Element & { editor?: { view: { posAtDOM(n: Node, o: number): number }; state: { selection: { head: number } } } }) | null
    if (!dom?.focusNode || !element?.editor) return false
    return element.editor.view.posAtDOM(dom.focusNode, dom.focusOffset) === element.editor.state.selection.head
  })
}

const middle = (box: Box): [number, number] => [(box.left + box.right) / 2, (box.top + box.bottom) / 2]

/** Two lines, and the caret left inside "delta": the word the old bug changed instead. */
async function setUp(page: Page): Promise<void> {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('Alpha beta gamma')
  await page.keyboard.press('Enter')
  await page.keyboard.type('delta epsilon')
  const delta = await wordBox(page, 'delta')
  await page.mouse.click(delta.left + 8, (delta.top + delta.bottom) / 2)
}

/** Ways of selecting: each selects "beta", or with a triple-click the whole first line. */
const SELECT: Record<string, { whole: boolean; run: (page: Page) => Promise<void> }> = {
  'a double-click': {
    whole: false,
    run: async (page) => {
      await page.mouse.dblclick(...middle(await wordBox(page, 'beta')))
      await settled(page)
    },
  },
  // As a double-click selects on Windows: the word and the space after it (found in Edge). The change still goes to the word alone.
  'a double-click on Windows': {
    whole: false,
    run: async (page) => {
      const beta = await wordBox(page, 'beta')
      await page.mouse.click(beta.left + 1, (beta.top + beta.bottom) / 2)
      for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
      await settled(page)
    },
  },
  'a drag': {
    whole: false,
    run: async (page) => {
      const beta = await wordBox(page, 'beta')
      const y = (beta.top + beta.bottom) / 2
      await page.mouse.move(beta.left + 1, y)
      await page.mouse.down()
      await page.mouse.move(beta.right - 1, y, { steps: 6 })
      await page.mouse.up()
    },
  },
  'Shift and the arrows': {
    whole: false,
    run: async (page) => {
      const beta = await wordBox(page, 'beta')
      await page.mouse.click(beta.left + 1, (beta.top + beta.bottom) / 2)
      for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
      await settled(page)
    },
  },
  'a Select box': {
    whole: false,
    run: async (page) => {
      await chooseTool(page, 'select')
      const beta = await wordBox(page, 'beta')
      await page.mouse.move(beta.left - 3, beta.top - 3)
      await page.mouse.down()
      await page.mouse.move(beta.right + 3, beta.bottom + 3, { steps: 6 })
      await page.mouse.up()
    },
  },
  'a triple-click': {
    whole: true,
    run: async (page) => {
      const [x, y] = middle(await wordBox(page, 'beta'))
      await page.mouse.click(x, y, { clickCount: 3 })
    },
  },
}

/** A colour, size or font: the selected words take it as a span; a whole line, as its style. */
function styled(key: string, value: string): (line: Block, whole: boolean) => void {
  return (line, whole) =>
    expect({ md: line.md, style: line.style }).toEqual(whole ? { md: 'Alpha beta gamma', style: { [key]: value } } : { md: `Alpha [beta]{${key}=${value}} gamma`, style: undefined })
}

/** The changes, each with what the first line should then hold. */
const CHANGE: Record<string, { run: (page: Page) => Promise<void>; expect: (line: Block, whole: boolean) => void }> = {
  Bold: {
    run: (page) => page.getByRole('button', { name: 'Bold', exact: true }).click(),
    expect: (line, whole) => expect(line.md).toBe(whole ? '**Alpha beta gamma**' : 'Alpha **beta** gamma'),
  },
  colour: {
    run: async (page) => {
      await page.getByRole('button', { name: 'Colour', exact: true }).click()
      await page.getByRole('button', { name: 'red', exact: true }).click()
    },
    expect: styled('color', 'red'),
  },
  size: {
    run: (page) => textSize(page, 'Large'),
    expect: styled('size', 'l'),
  },
  font: {
    run: async (page) => {
      await textFont(page, 'Serif')
    },
    expect: styled('font', 'serif'),
  },
  link: {
    run: async (page) => {
      page.once('dialog', (dialog) => void dialog.accept('https://example.com/x'))
      await page.getByRole('button', { name: 'Link', exact: true }).click()
    },
    expect: (line, whole) => expect(line.md).toBe(whole ? '[Alpha beta gamma](https://example.com/x)' : 'Alpha [beta](https://example.com/x) gamma'),
  },
}

for (const [how, select] of Object.entries(SELECT)) {
  for (const [what, change] of Object.entries(CHANGE)) {
    test(`${what} after ${how} changes only the selected words, not the word the caret was in`, async ({ page }) => {
      await setUp(page)
      await select.run(page)
      await change.run(page)
      await expect(async () => change.expect((await lines(page))[0]!, select.whole)).toPass({ timeout: 5000 })
      const second = (await lines(page))[1]!
      expect(second.md).toBe('delta epsilon')
      expect(second.style).toBeUndefined()
    })
  }
}

test('with nothing chosen, the bar stays on and acts where the caret last was, shown in grey', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('Alpha beta gamma')
  const beta = await wordBox(page, 'beta')
  await page.mouse.click(beta.left + 10, (beta.top + beta.bottom) / 2)
  // The editor hears of the caret a moment after the browser moves it; a person's next click comes later still.
  await settled(page)
  // Beside the page: nothing is chosen, and no text has the focus.
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  await page.mouse.click(sheet.x - 30, sheet.y + 300)
  await expect(page.locator('.nw-frame .nw-last-caret')).toHaveCount(1)
  const off = await textRow(page).locator('button:disabled').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  // Only what does not apply here: nothing to redo.
  expect(off.sort()).toEqual(['Redo'])
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect.poll(async () => (await lines(page))[0]!.md).toBe('Alpha **beta** gamma')
  // The caret was inside "beta", so the size goes to that word too.
  await textSize(page, 'Large')
  await expect.poll(async () => (await lines(page))[0]!.md).toBe('Alpha [**beta**]{size=l} gamma')
})

test('with only a caret inside a word, Bold changes the whole word; between words, only the words typed next', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('Alpha beta gamma')
  const beta = await wordBox(page, 'beta')
  await page.mouse.click(beta.left + 10, (beta.top + beta.bottom) / 2)
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect.poll(async () => (await lines(page))[0]!.md).toBe('Alpha **beta** gamma')
  await page.keyboard.press('End')
  await page.keyboard.type(' ')
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.keyboard.type('next')
  await expect.poll(async () => (await lines(page))[0]!.md).toBe('Alpha **beta** gamma **next**')
})
