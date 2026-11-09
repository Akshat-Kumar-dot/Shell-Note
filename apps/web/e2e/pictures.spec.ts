// Pictures: added with the Picture button, by pasting or by dropping; moved,
// resized and removed; with a formatted caption and a hidden description.
// Every change reaches core's document, one undo step each.
import { expect, test, type Locator, type Page } from './fixtures.js'

// Tall enough to show a whole A4 page at 100% below the toolbar, so every point a test drops on is on screen.
test.use({ viewport: { width: 1280, height: 1200 } })

type Picture = { id: string; page?: string; parent?: string; x?: number; y?: number; w?: number; h?: number; asset: string; alt?: string; caption?: string }
type Kid = { type: string; md?: string; caption?: string }
/** A picture to make: width and height in pixels, and a colour, so each one has its own bytes. */
type Drawn = [number, number, string]

function pictures(page: Page): Promise<Picture[]> {
  return page.evaluate(() => Object.values(window.__shellnote!.doc.block).filter((b) => b.type === 'image') as unknown as Picture[])
}

/** The first frame's blocks, as core holds them. */
function kids(page: Page): Promise<Kid[]> {
  return page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const frame = doc.block[doc.page[doc.pages[0]!]!.free[0]!] as unknown as { kids: string[] }
    return frame.kids.map((id) => doc.block[id] as unknown as Kid)
  })
}

/** A PNG file of one colour, made by the browser. */
async function png(page: Page, [w, h, color]: Drawn): Promise<Buffer> {
  const data = await page.evaluate(
    ([w, h, color]) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const g = canvas.getContext('2d')!
      g.fillStyle = color
      g.fillRect(0, 0, w, h)
      return canvas.toDataURL('image/png').split(',')[1]!
    },
    [w, h, color] as Drawn,
  )
  return Buffer.from(data, 'base64')
}

/** In the page: pictures as files in a DataTransfer, as a clipboard or a drag carries them. */
interface Carrier {
  carry(drawn: Drawn[]): Promise<DataTransfer>
}

// A test cannot hand the page a function, so the page gets this one before each test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as Carrier).carry = async (drawn) => {
      const data = new DataTransfer()
      for (const [w, h, color] of drawn) {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const g = canvas.getContext('2d')!
        g.fillStyle = color
        g.fillRect(0, 0, w, h)
        const blob = await new Promise<Blob>((done) => canvas.toBlob((made) => done(made!), 'image/png'))
        data.items.add(new File([blob], `${color.slice(1)}.png`, { type: 'image/png' }))
      }
      return data
    }
  })
})

/** Paste pictures on an element, as Ctrl+V with pictures on the clipboard would. */
async function paste(target: Locator, drawn: Drawn[]): Promise<void> {
  await target.evaluate(async (el, drawn) => {
    const data = await (window as unknown as Carrier).carry(drawn)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, drawn)
}

/** Drop pictures at a point on the screen, as dragging files from a folder would. */
async function drop(page: Page, x: number, y: number, drawn: Drawn[]): Promise<void> {
  // At a whole pixel, as a pointer is: a drop event keeps only whole pixels, cutting off the rest, and at the
  // screen's own 125 % the page's middle can come out as 639.99999 (found in the app, 18 October 2026).
  ;[x, y] = [Math.round(x), Math.round(y)]
  await page.evaluate(
    async ([drawn, x, y]) => {
      const data = await (window as unknown as Carrier).carry(drawn)
      const target = document.elementFromPoint(x, y)!
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    },
    [drawn, x, y] as const,
  )
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

test('the Picture button puts a picture on the page at its own size; Delete removes it, and undo brings it back', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Picture' }).click()
  await (await chooser).setFiles({ name: 'blue.png', mimeType: 'image/png', buffer: await png(page, [400, 300, '#4a90d9']) })
  await expect.poll(() => pictures(page)).toHaveLength(1)
  const [picture] = await pictures(page)
  // 400 × 300 pixels at 96 to the inch, under the empty frame: 20 mm in, 35 mm down.
  expect(picture).toMatchObject({ x: 2000, y: 3500, w: 10583, h: 7938 })
  expect(picture!.asset).toMatch(/^[0-9a-f]{64}$/)
  const asset = await page.evaluate((hash) => window.__shellnote!.doc.asset[hash], picture!.asset)
  expect(asset).toMatchObject({ mime: 'image/png', w: 400, h: 300 })
  // The new picture is selected and has the keys.
  await expect(page.locator('.nw-picture[data-selected]')).toBeFocused()
  await expect(page.locator('.nw-picture img')).toHaveJSProperty('naturalWidth', 400)

  await page.keyboard.press('Delete')
  await expect.poll(() => pictures(page)).toHaveLength(0)
  await page.keyboard.press('Control+z')
  await expect.poll(() => pictures(page)).toHaveLength(1)
  // Undo of the whole add takes the asset away too, and redo brings both back.
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => Object.keys(window.__shellnote!.doc.asset).length)).toBe(0)
  await page.keyboard.press('Control+y')
  await expect(page.locator('.nw-picture img')).toBeVisible()
})

test('pictures pasted with the caret in the text go into it after the line, as one undo step', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const text = page.locator('.nw-frame .ProseMirror').first()
  await text.click()
  await page.keyboard.type('Hello')
  await paste(text, [
    [200, 100, '#d94a4a'],
    [100, 100, '#3aa655'],
  ])
  await expect.poll(async () => (await kids(page)).map((kid) => kid.type)).toEqual(['text', 'image', 'image'])
  const [first, second] = await pictures(page)
  expect(first!.asset).not.toBe(second!.asset)
  await expect(page.locator('.nw-frame img')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await kids(page)).map((kid) => kid.type)).toEqual(['text'])
})

test('a picture dropped on bare paper lands where it was dropped; dropped on the text, it goes in', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  // The middle of an A4 page is (105 mm, 148.5 mm); a 96-pixel picture is 25.4 mm across.
  await drop(page, sheet.x + sheet.width / 2, sheet.y + sheet.height / 2, [[96, 96, '#7a3db8']])
  await expect.poll(() => pictures(page)).toHaveLength(1)
  const [placed] = await pictures(page)
  // Within half a pixel, 0.13 mm, since a pointer is at whole pixels.
  expect(Math.abs(placed!.x! - (10500 - 1270))).toBeLessThan(15)
  expect(Math.abs(placed!.y! - (14850 - 1270))).toBeLessThan(15)

  const text = page.locator('.nw-frame .ProseMirror').first()
  await text.click()
  await page.keyboard.type('A line')
  const line = (await text.boundingBox())!
  await drop(page, line.x + 20, line.y + line.height / 2, [[50, 50, '#d9640a']])
  await expect.poll(async () => (await kids(page)).map((kid) => kid.type)).toEqual(['text', 'image'])
})

test('dragging moves a picture and a corner resizes it, keeping its shape, one undo step each', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await paste(page.locator('body'), [[400, 200, '#4a90d9']])
  const box = page.locator('.nw-picture')
  await expect(box).toBeFocused()
  const [before] = await pictures(page)

  const at = (await box.boundingBox())!
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
  await page.mouse.down()
  await page.mouse.move(at.x + at.width / 2 + 100, at.y + at.height / 2 + 50, { steps: 5 })
  await page.mouse.up()
  // 100 screen pixels at 100% are 26.46 mm.
  await expect.poll(async () => (await pictures(page))[0]!.x).toBeGreaterThan(before!.x! + 2600)
  const [moved] = await pictures(page)
  expect(Math.abs(moved!.x! - before!.x! - 2646)).toBeLessThan(30)
  expect(Math.abs(moved!.y! - before!.y! - 1323)).toBeLessThan(30)
  expect([moved!.w, moved!.h]).toEqual([before!.w, before!.h])

  const handle = (await page.locator('.nw-handle[data-corner="se"]').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 - 100, handle.y + handle.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await pictures(page))[0]!.w).toBeLessThan(moved!.w!)
  const [resized] = await pictures(page)
  expect([resized!.x, resized!.y]).toEqual([moved!.x, moved!.y])
  expect(Math.abs(resized!.w! / resized!.h! - 2)).toBeLessThan(0.01)

  // The arrow keys nudge it by a millimetre.
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await pictures(page))[0]!.x).toBe(resized!.x! + 100)

  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await pictures(page))[0]!.w).toBe(moved!.w)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await pictures(page))[0]!.x).toBe(before!.x)
})

test('a picture on the page takes a formatted caption and a hidden description', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await paste(page.locator('body'), [[300, 200, '#4a90d9']])
  await expect(page.locator('.nw-picture')).toBeFocused()
  // Enter goes to the caption; Ctrl+B and the toolbar's buttons format it.
  await page.keyboard.press('Enter')
  await page.keyboard.type('Forces on a ')
  await page.keyboard.press('Control+b')
  await page.keyboard.type('block')
  await expect.poll(async () => (await pictures(page))[0]!.caption).toBe('Forces on a **block**')
  await page.keyboard.press('Home')
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight')
  await settled(page)
  await page.getByRole('button', { name: 'Italic' }).click()
  await expect.poll(async () => (await pictures(page))[0]!.caption).toBe('*Forces* on a **block**')
  await expect(page.locator('.nw-picture .nw-caption em')).toHaveText('Forces')

  // Escape hands the keys back to the picture; the description is typed in the toolbar.
  await page.keyboard.press('Escape')
  await expect(page.locator('.nw-picture')).toBeFocused()
  await page.getByRole('textbox', { name: 'Description' }).fill('A blue rectangle')
  await expect.poll(async () => (await pictures(page))[0]!.alt).toBe('A blue rectangle')
  await expect(page.locator('.nw-picture img')).toHaveAttribute('alt', 'A blue rectangle')
})

test('a picture in the text: a click selects it, its caption is typed in place, and Delete removes it', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const text = page.locator('.nw-frame .ProseMirror').first()
  await text.click()
  await page.keyboard.type('Hello')
  await paste(text, [[200, 100, '#d94a4a']])
  const picture = page.locator('.nw-frame .nw-image')
  await expect(picture).toBeVisible()

  await picture.locator('.nw-image-pic').click()
  await expect(picture).toHaveClass(/ProseMirror-selectednode/)
  await expect(page.getByRole('textbox', { name: 'Description' })).toBeVisible()
  await picture.locator('figcaption').click()
  await page.keyboard.type('Red ')
  await page.keyboard.press('Control+b')
  await page.keyboard.type('box')
  await page.keyboard.press('Enter')
  await page.keyboard.type('After')
  await expect.poll(() => kids(page)).toEqual([
    expect.objectContaining({ type: 'text', md: 'Hello' }),
    expect.objectContaining({ type: 'image', caption: 'Red **box**' }),
    expect.objectContaining({ type: 'text', md: 'After' }),
  ])

  await picture.locator('.nw-image-pic').click()
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await kids(page)).map((kid) => kid.type)).toEqual(['text', 'text'])
})
