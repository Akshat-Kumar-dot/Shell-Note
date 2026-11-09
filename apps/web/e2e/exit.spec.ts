// Phase 2's exit checks, as one Playwright test:
// - Type headings, paragraphs and a list. Paste two images. Move and resize one.
// - Undo back to an empty page, then redo to the full page.
// - Reload and get the same document.
// - Save to a file, open it, and get a deep-equal document.
import { expect, inApp, test, type Page } from './fixtures.js'

type Drawn = [number, number, string]
interface Carrier {
  carry(drawn: Drawn[]): Promise<DataTransfer>
}

test.use({ viewport: { width: 1280, height: 1200 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Pictures for the clipboard, made by the browser.
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
    // A stand-in for Chrome's file picker, keeping the file in the page.
    const files = new Map<string, Blob>()
    const handle = (name: string) => ({
      name,
      kind: 'file',
      queryPermission: async () => 'granted',
      createWritable: async () => {
        const parts: BlobPart[] = []
        return { write: async (part: BlobPart) => void parts.push(part), close: async () => void files.set(name, new Blob(parts)) }
      },
      getFile: async () => new File([files.get(name)!], name, { lastModified: Date.now() }),
    })
    const w = window as unknown as Record<string, unknown>
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => handle(suggestedName)
    w.showOpenFilePicker = async () => [handle([...files.keys()][0]!)]
  })
})

function note(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => structuredClone(window.__shellnote!.doc) as unknown as Record<string, unknown>)
}

/** The note with its revision numbers, which every change moves on, set to 0, to compare content. */
function content(doc: Record<string, unknown>): unknown {
  const blocks = doc.block as Record<string, Record<string, unknown>>
  return { ...doc, rev: 0, block: Object.fromEntries(Object.entries(blocks).map(([id, block]) => [id, { ...block, r: 0 }])) }
}

async function onPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  return { x: sheet.x + (x * sheet.width) / 210, y: sheet.y + (y * sheet.height) / 297 }
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
}

test('phase 2 exit: type, paste, move and resize; undo to empty and redo to full; reload; save and open', async ({ page }) => {
  // In the app it takes 12 to 15 s alone, and ran out of its 30 s twice as one of the first tests, eight copies of the
  // app starting at once (25 October 2026).
  test.slow(inApp, 'a long walk, in the app')
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await expect(page.locator('.nw-page').first()).toBeVisible()
  const empty = await note(page)

  // Headings, paragraphs and a list.
  await page.locator('.nw-frame .ProseMirror').first().click()
  for (const line of ['# Newton', 'An object at rest stays at rest.', '## Forces', 'Forces change motion:', '- gravity', 'friction', 'tension']) {
    await page.keyboard.type(line)
    await page.keyboard.press('Enter')
  }
  await page.keyboard.press('Enter')
  await page.keyboard.type('The end.')

  // Two images, pasted where a Free-cursor click on bare paper put the caret.
  await page.getByRole('radio', { name: 'Free cursor' }).click()
  const spot = await onPage(page, 60, 200)
  await page.mouse.click(spot.x, spot.y)
  await page.locator('.nw-draft .ProseMirror').evaluate(async (target) => {
    const data = await (window as unknown as Carrier).carry([
      [300, 200, '#4a90d9'],
      [200, 200, '#d94a4a'],
    ])
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.nw-picture img')).toHaveCount(2)

  // Move one, then resize it from a corner.
  const picture = page.locator('.nw-picture').first()
  const at = (await picture.boundingBox())!
  await drag(page, { x: at.x + at.width / 2, y: at.y + at.height / 2 }, { x: at.x + at.width / 2 + 120, y: at.y + at.height / 2 - 60 })
  const corner = (await page.locator('.nw-handle[data-corner="se"]').boundingBox())!
  await drag(page, { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }, { x: corner.x + corner.width / 2 - 80, y: corner.y + corner.height / 2 - 40 })
  const full = await note(page)
  const roles = Object.values(full.block as Record<string, { type: string; role?: string }>).flatMap((b) => (b.type === 'text' ? [b.role] : []))
  expect(roles).toEqual(['h1', 'p', 'h2', 'p', 'li', 'li', 'li', 'p'])
  expect(Object.values(full.block as Record<string, { type: string }>).filter((b) => b.type === 'image')).toHaveLength(2)

  // Undo back to an empty page, then redo to the full page.
  const undo = page.getByRole('button', { name: 'Undo' })
  const redo = page.getByRole('button', { name: 'Redo' })
  for (let i = 0; i < 100 && (await undo.isEnabled()); i++) await undo.click()
  await expect(undo).toBeDisabled()
  expect(content(await note(page))).toEqual(content(empty))
  await expect(page.locator('.nw-picture')).toHaveCount(0)
  for (let i = 0; i < 100 && (await redo.isEnabled()); i++) await redo.click()
  await expect(redo).toBeDisabled()
  expect(content(await note(page))).toEqual(content(full))
  await expect(page.locator('.nw-picture img')).toHaveCount(2)

  // Reload, and get the same document.
  const before = await note(page)
  await page.waitForFunction(() => window.__shellnote!.keptRev === window.__shellnote!.doc.rev)
  await page.reload()
  await expect(page.locator('.nw-page').first()).toBeVisible()
  expect(await note(page)).toEqual(before)
  await expect(page.locator('.nw-picture img')).toHaveCount(2)

  // Save to a file, open it, and get a deep-equal document.
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('status')).toContainText('Saved to Untitled.shellnote')
  await page.getByRole('button', { name: 'New note' }).click()
  // A new note beside it in the library, editable once it has checked the other tabs.
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled 2')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await expect(page.locator('.nw-picture')).toHaveCount(0)
  await page.keyboard.press('Control+o')
  await expect(page.locator('.nw-picture img')).toHaveCount(2)
  expect(await note(page)).toEqual(before)
})
