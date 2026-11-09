// Colours as in Word's panel (Stage 3a): Automatic, the eight note colours
// with their shades, Word's standard colours, the colours used last, and More
// colours for an exact colour by its field, hue, red, green and blue, or code.
// On the selected words or a whole line, one undo step each.
import { expect, test, type Page } from './fixtures.js'

test.use({ viewport: { width: 1280, height: 1000 } })

type Block = { md?: string; style?: { color?: string } }

function first(page: Page): Promise<Block> {
  return page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const frame = doc.block[doc.page[doc.pages[0]!]!.free[0]!] as unknown as { kids: string[] }
    return doc.block[frame.kids[0]!] as unknown as Block
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

async function start(page: Page, words: string): Promise<void> {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type(words)
}

/** Double-click a word on the page, as a person selects it. */
async function pick(page: Page, word: string): Promise<void> {
  const box = await page.evaluate((word) => {
    const walker = document.createTreeWalker(document.querySelector('.nw-page')!, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(word)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + word.length)
      const r = range.getBoundingClientRect()
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
    }
    throw new Error(`"${word}" is not on the page`)
  }, word)
  await page.mouse.dblclick(box.x, box.y)
}

const colour = (page: Page) => page.getByRole('button', { name: 'Colour', exact: true })
const panel = (page: Page) => page.getByRole('group', { name: 'Colours' })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'More colours' })

test('the panel has Automatic, the note colours with their shades, and the standard colours, each on the selected words', async ({ page }) => {
  await start(page, 'one two three four')
  // A note colour stays a name, as the AI writes it.
  await pick(page, 'one')
  await colour(page).click()
  await expect(panel(page).getByRole('button')).toHaveCount(1 + 1 + 8 * 5 + 10 + 1)
  await page.getByRole('button', { name: 'red', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect.poll(async () => (await first(page)).md).toBe('[one]{color=red} two three four')
  // The panel shows the colour of the words selected.
  await colour(page).click()
  await expect(page.getByRole('button', { name: 'red', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  // A shade and a standard colour are codes.
  await pick(page, 'two')
  await colour(page).click()
  await page.getByRole('button', { name: 'Red, darker 50%' }).click()
  await pick(page, 'three')
  await colour(page).click()
  await page.getByRole('button', { name: 'Dark red, #c00000' }).click()
  await expect.poll(async () => (await first(page)).md).toBe('[one]{color=red} [two]{color=#631414} [three]{color=#c00000} four')
  await expect(page.locator('.nw-frame span[data-color="#c00000"]')).toHaveCSS('color', 'rgb(192, 0, 0)')
  // Automatic takes the colour away.
  await pick(page, 'one')
  await colour(page).click()
  await page.getByRole('button', { name: 'Automatic' }).click()
  await expect.poll(async () => (await first(page)).md).toBe('one [two]{color=#631414} [three]{color=#c00000} four')
})

test('More colours gives an exact colour by code or by red, green and blue, as one undo step, and keeps it among the recent ones', async ({ page }) => {
  await start(page, 'one two three')
  await pick(page, 'two')
  await colour(page).click()
  await page.getByRole('button', { name: 'More colours…' }).click()
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByRole('textbox', { name: 'Hex' }).fill('#2A9D8F')
  await dialog(page).getByRole('button', { name: 'OK' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect.poll(async () => (await first(page)).md).toBe('one [two]{color=#2a9d8f} three')
  await expect(page.locator('.nw-frame span[data-color="#2a9d8f"]')).toHaveCSS('color', 'rgb(42, 157, 143)')
  // The text has the focus again: typing carries on.
  await expect(page.locator('.nw-frame .ProseMirror').first()).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await expect.poll(async () => (await first(page)).md).toBe('one [two]{color=#2a9d8f} three!')

  // The whole line, chosen with a triple-click, by red, green and blue: its own colour, the words' giving way.
  await page.locator('.nw-frame .nw-text').first().click({ clickCount: 3 })
  await settled(page)
  await colour(page).click()
  await expect(page.getByRole('button', { name: 'Colour #2a9d8f' })).toBeVisible()
  await page.getByRole('button', { name: 'More colours…' }).click()
  await dialog(page).getByRole('spinbutton', { name: 'Red' }).fill('255')
  await dialog(page).getByRole('spinbutton', { name: 'Green' }).fill('136')
  await dialog(page).getByRole('spinbutton', { name: 'Blue' }).fill('0')
  await expect(dialog(page).getByRole('textbox', { name: 'Hex' })).toHaveValue('#ff8800')
  await dialog(page).getByRole('button', { name: 'OK' }).click()
  await expect.poll(async () => (await first(page)).style?.color).toBe('#ff8800')
  expect((await first(page)).md).toBe('one two three!')
  await expect(page.locator('.nw-frame .nw-text[data-color="#ff8800"]')).toHaveCSS('color', 'rgb(255, 136, 0)')
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await first(page)).md).toBe('one [two]{color=#2a9d8f} three!')
  expect((await first(page)).style).toBeUndefined()

  // The colours used last are kept in this browser, even in a new note.
  await page.reload()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('x')
  await colour(page).click()
  await expect(page.getByRole('button', { name: 'Colour #ff8800' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Colour #2a9d8f' })).toBeVisible()
})

test("More colours' field and hue slider choose a colour, and Cancel changes nothing", async ({ page }) => {
  await start(page, 'one two three')
  await pick(page, 'two')
  await colour(page).click()
  await page.getByRole('button', { name: 'More colours…' }).click()
  const hex = dialog(page).getByRole('textbox', { name: 'Hex' })
  // From the colour in use: ink.
  await expect(hex).toHaveValue('#1d1d22')
  // The hue slider at red, then the field's top right corner: the brightest, fullest red.
  const hue = dialog(page).getByRole('slider', { name: 'Hue' })
  await hue.focus()
  await page.keyboard.press('Home')
  const field = (await dialog(page).getByRole('group', { name: /Colour field/u }).boundingBox())!
  await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2)
  await page.mouse.down()
  await page.mouse.move(field.x + field.width + 20, field.y - 20, { steps: 4 })
  await page.mouse.up()
  await expect(hex).toHaveValue('#ff0000')
  // Along the slider, a third of the way round the colour wheel: green.
  await hue.focus()
  for (let i = 0; i < 120; i++) await page.keyboard.press('ArrowRight')
  await expect(hex).toHaveValue('#00ff00')
  // Cancel: back to the panel, and the words are as they were.
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(panel(page)).toBeVisible()
  expect((await first(page)).md).toBe('one two three')
  // Typed without its #, and used with Enter.
  await page.getByRole('button', { name: 'More colours…' }).click()
  await hex.fill('7030A0')
  await hex.press('Enter')
  await expect.poll(async () => (await first(page)).md).toBe('one [two]{color=#7030a0} three')
})

test('the colour panel closes with its ✕, with Escape, and with a click outside it; the first two give the text its focus back', async ({ page }) => {
  await start(page, 'one two three')

  await colour(page).click()
  await expect(panel(page)).toBeVisible()
  await page.getByRole('button', { name: 'Close colours' }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator('.nw-frame .ProseMirror').first()).toBeFocused()
  await page.keyboard.type('A')

  await colour(page).click()
  await page.getByRole('button', { name: 'More colours…' }).click()
  await dialog(page).getByRole('spinbutton', { name: 'Red' }).fill('9')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('.nw-frame .ProseMirror').first()).toBeFocused()
  await page.keyboard.type('B')
  await expect.poll(async () => (await first(page)).md).toBe('one two threeAB')

  await colour(page).click()
  await expect(panel(page)).toBeVisible()
  await page.mouse.click(5, 600)
  await expect(panel(page)).toHaveCount(0)
})
