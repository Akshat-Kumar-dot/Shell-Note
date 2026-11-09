// Keeping the note: in this browser's library after every change, so a reload
// gives the same note; and in a .shellnote file, so Save then Open gives the
// same note (phase 2's exit checks). The browser's own file dialogs cannot be driven by
// a test, so one test stands in for them the way Chrome's picker behaves, and
// another uses the download and file input that other browsers get.
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from './fixtures.js'

type Drawn = [number, number, string]
interface Carrier {
  carry(drawn: Drawn[]): Promise<DataTransfer>
}

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

/** Open a new note and wait until it is drawn. */
async function start(page: Page): Promise<void> {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await expect(page.locator('.nw-page').first()).toBeVisible()
}

/** Wait until the library keeps the note as it is now. */
async function kept(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__shellnote !== undefined && window.__shellnote.keptRev === window.__shellnote.doc.rev)
}

function note(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__shellnote!.doc)
}

/** A note with a title, a heading, a list, a table and a picture, made by typing and pasting. */
async function write(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Title' }).fill('Lecture 4')
  await page.locator('.nw-frame .ProseMirror').first().click()
  for (const line of ['# Forces', '- gravity', 'friction']) {
    await page.keyboard.type(line)
    await page.keyboard.press('Enter')
  }
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('button', { name: '2 by 2 table' }).click()
  await page.keyboard.type('Mass')
  await page.keyboard.press('Tab')
  await page.keyboard.type('**Weight**')
  await page.locator('body').evaluate(async (body) => {
    const data = await (window as unknown as Carrier).carry([[160, 90, '#4a90d9']])
    body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.nw-page img')).toBeVisible()
}

test('a reload gives the same note, pictures and all', async ({ page }) => {
  await start(page)
  await write(page)
  await kept(page)
  const before = await note(page)
  await page.reload()
  await expect(page.locator('.nw-page').first()).toBeVisible()
  expect(await note(page)).toEqual(before)
  await expect(page.locator('.nw-page img')).toHaveJSProperty('naturalWidth', 160)
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Lecture 4')
})

test('Save, then Open, gives the same note, through the browser file picker', async ({ page }) => {
  // As Chrome's picker does it, with the file kept in the page instead of on disk.
  await page.addInitScript(() => {
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
    w.savePicks = 0
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => {
      w.savePicks = (w.savePicks as number) + 1
      return handle(suggestedName)
    }
    w.showOpenFilePicker = async () => [handle([...files.keys()][0]!)]
  })
  await start(page)
  await write(page)
  await page.keyboard.press('Control+s')
  const status = page.getByRole('status')
  await expect(status).toContainText('Saved to Lecture 4.shellnote')
  // A change, then Save again: the same file, without asking where.
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('More')
  await expect(status).toContainText('Changed since saved')
  await page.keyboard.press('Control+s')
  await expect(status).toContainText('Saved to Lecture 4.shellnote')
  expect(await page.evaluate(() => (window as unknown as { savePicks: number }).savePicks)).toBe(1)
  const before = await note(page)

  await page.getByRole('button', { name: 'New note' }).click()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+o')
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Lecture 4')
  expect(await note(page)).toEqual(before)
  await expect(page.locator('.nw-page img')).toHaveJSProperty('naturalWidth', 160)
  await expect(status).toContainText('Saved to Lecture 4.shellnote')
})

test('without the file picker, Save downloads the file and Open reads it back', async ({ page }) => {
  // As in Firefox and Safari, which have no File System Access API.
  await page.addInitScript(() => {
    for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) Object.defineProperty(window, name, { value: undefined, configurable: true })
  })
  await start(page)
  await write(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save' }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe('Lecture 4.shellnote')
  const bytes = await readFile((await saved.path())!)
  const before = await note(page)

  await page.getByRole('button', { name: 'New note' }).click()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file' }).click()
  await (await chooser).setFiles({ name: 'Lecture 4.shellnote', mimeType: 'application/zip', buffer: bytes })
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Lecture 4')
  expect(await note(page)).toEqual(before)
})

test('leaving a note keeps it in the library, its card marked until it is saved to a file', async ({ page }) => {
  await start(page)
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('Unsaved thoughts')
  await expect(page.getByRole('status')).toHaveText('Not saved to a file yet')
  // Nothing is lost by leaving, so nothing is asked.
  await page.getByRole('button', { name: 'New note' }).click()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled 2')
  await expect(page.locator('.nw-frame .ProseMirror').first()).not.toContainText('Unsaved thoughts')
  await page.getByRole('button', { name: 'Back to notes' }).click()
  const card = (name: string) => page.locator('.card').filter({ has: page.locator('.card-name', { hasText: new RegExp(`^${name}$`, 'u') }) })
  await expect(card('Untitled').locator('.card-dot')).toHaveCount(1)
  await expect(card('Untitled 2').locator('.card-dot')).toHaveCount(0)
})

test('a file that is not a note is refused with a hint, and the note stays', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    w.showOpenFilePicker = async () => [{ name: 'photo.shellnote', kind: 'file', getFile: async () => new File(['not a zip'], 'photo.shellnote') }]
  })
  await start(page)
  const message = new Promise<string>((resolve) => page.once('dialog', (dialog) => void dialog.accept().then(() => resolve(dialog.message()))))
  await page.keyboard.press('Control+o')
  expect(await message).toMatch(/could not be opened.*not a notes file/i)
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled')
})
