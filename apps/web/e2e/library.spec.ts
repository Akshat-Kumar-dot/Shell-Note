// The library's home page (the design pass's exit checks): new notes and
// folders, folders inside folders, rename, move (never a folder into itself),
// Recently deleted with Undo, restore and delete for good, search, sort, a
// reload keeping everything, the note storage version 1 kept moved in exactly,
// and two tabs on one note never overwriting each other.
import { readFile } from 'node:fs/promises'
import { expect, inApp, test, type Locator, type Page } from './fixtures.js'

/** Open the home page and wait for it. */
async function home(page: Page, address = '/'): Promise<void> {
  await page.goto(address)
  await expect(page.locator('.home')).toBeVisible()
}

const exact = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u')

/** The card with this name. */
function card(page: Page, name: string): Locator {
  return page.locator('.card').filter({ has: page.locator('.card-name', { hasText: exact(name) }) })
}

/** The names on the cards, in order. */
function names(page: Page): Promise<string[]> {
  return page.locator('.card .card-name').allInnerTexts()
}

async function menu(page: Page, name: string, action: string): Promise<void> {
  await card(page, name).locator('.card-more').click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

/** Rename the card in focus by F2, typing the new name. */
async function renameWithF2(page: Page, from: string, to: string): Promise<void> {
  await card(page, from).locator('.card-open').focus()
  await page.keyboard.press('F2')
  const field = page.getByRole('textbox', { name: `New name for ${from}` })
  await expect(field).toBeFocused()
  await field.fill(to)
  await field.press('Enter')
  await expect(card(page, to)).toBeVisible()
}

async function newNoteHere(page: Page, title: string): Promise<void> {
  await page.locator('.home-actions').getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('.nw-page').first()).toBeVisible()
  const field = page.getByRole('textbox', { name: 'Title' })
  await field.fill(title)
  await field.press('Enter')
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type(`Notes about ${title}`)
  await page.getByRole('button', { name: 'Back to notes' }).click()
  await expect(page.locator('.home')).toBeVisible()
  await expect(card(page, title)).toBeVisible()
}

test('a new library is friendly and empty; New note opens a note, and back home it is a card with a thumbnail of its first page', async ({ page }) => {
  await home(page)
  await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible()
  await newNoteHere(page, 'Waves')
  await expect(card(page, 'Waves').locator('.card-meta')).toContainText('Edited just now')
  // Changes not yet in a file: a dot.
  await expect(card(page, 'Waves').locator('.card-dot')).toHaveCount(1)
  const thumb = card(page, 'Waves').locator('img.card-thumb')
  await expect(thumb).toBeVisible()
  await expect(thumb).toHaveJSProperty('naturalWidth', 240)
})

test('folders hold folders and notes; a path leads back up; rename by F2 or the menu; a reload keeps everything', async ({ page }) => {
  await home(page)
  await page.getByRole('button', { name: 'New folder' }).click()
  // A new folder's name is ready to type.
  const field = page.getByRole('textbox', { name: 'New name for Untitled folder' })
  await expect(field).toBeFocused()
  await field.fill('Physics')
  await field.press('Enter')
  await card(page, 'Physics').locator('.card-open').click()
  await expect(page.getByRole('navigation', { name: 'Folder path' })).toContainText('Physics')
  await expect(page.getByRole('heading', { name: 'This folder is empty' })).toBeVisible()

  // A folder inside it, and a note inside that.
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New name for Untitled folder' }).press('Enter')
  await renameWithF2(page, 'Untitled folder', 'Lab')
  await card(page, 'Lab').locator('.card-open').click()
  await newNoteHere(page, 'Pendulum')
  await expect(page.getByRole('navigation', { name: 'Folder path' })).toHaveText(/Notes.*Physics.*Lab/u)

  // Up the path, and the folder says what it holds.
  await page.getByRole('navigation', { name: 'Folder path' }).getByRole('link', { name: 'Physics' }).click()
  await expect(card(page, 'Lab').locator('.card-meta')).toHaveText('1 note')
  await menu(page, 'Lab', 'Rename')
  const rename = page.getByRole('textbox', { name: 'New name for Lab' })
  await rename.fill('Lab work')
  await rename.press('Enter')
  await expect(card(page, 'Lab work')).toBeVisible()

  // New items get "Untitled", then "Untitled 2", even beside each other.
  await page.locator('.home-actions').getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled')
  await page.getByRole('button', { name: 'New note' }).click()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled 2')
  await page.getByRole('button', { name: 'Back to notes' }).click()
  await expect.poll(() => names(page)).toEqual(expect.arrayContaining(['Lab work', 'Untitled', 'Untitled 2']))

  await page.reload()
  await expect(card(page, 'Lab work')).toBeVisible()
  await card(page, 'Lab work').locator('.card-open').click()
  await expect(card(page, 'Pendulum')).toBeVisible()
})

test('a folder cannot move into itself or one of its own folders; notes and folders move anywhere else', async ({ page }) => {
  await home(page)
  for (const name of ['Physics', 'Maths']) {
    await page.getByRole('button', { name: 'New folder' }).click()
    const field = page.getByRole('textbox', { name: /New name for Untitled folder/u })
    await field.fill(name)
    await field.press('Enter')
    await expect(card(page, name)).toBeVisible()
  }
  await card(page, 'Physics').locator('.card-open').click()
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New name for Untitled folder' }).fill('Waves')
  await page.keyboard.press('Enter')
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click()

  await menu(page, 'Physics', 'Move to…')
  const dialog = page.getByRole('dialog', { name: 'Move “Physics”' })
  await expect(dialog.getByRole('radio', { name: /Physics/u })).toBeDisabled()
  await expect(dialog.getByRole('radio', { name: /Waves/u })).toBeDisabled()
  await dialog.getByRole('radio', { name: /Maths/u }).click()
  await dialog.getByRole('button', { name: 'Move here' }).click()
  await expect(page.getByRole('status')).toContainText('Moved “Physics” to “Maths”')
  await expect.poll(() => names(page)).toEqual(['Maths'])
  await card(page, 'Maths').locator('.card-open').click()
  await expect(card(page, 'Physics')).toBeVisible()

  // Escape closes the dialog and moves nothing.
  await menu(page, 'Physics', 'Move to…')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(card(page, 'Physics')).toBeVisible()
})

test('Delete goes to Recently deleted with Undo; restore brings it back; delete for good and emptying ask first', async ({ page }) => {
  await home(page)
  await newNoteHere(page, 'Draft')
  await newNoteHere(page, 'Keep')

  // Delete, then Undo in the toast.
  await menu(page, 'Draft', 'Delete')
  await expect(card(page, 'Draft')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(card(page, 'Draft')).toBeVisible()

  // Delete with the Delete key, then restore from Recently deleted.
  await card(page, 'Draft').locator('.card-open').focus()
  await page.keyboard.press('Delete')
  await expect(card(page, 'Draft')).toHaveCount(0)
  await page.getByRole('link', { name: /Recently deleted/u }).click()
  await expect(card(page, 'Draft').locator('.card-meta')).toContainText('30 days left')
  await menu(page, 'Draft', 'Restore')
  await expect(page.getByRole('status')).toContainText('Restored “Draft” to the top level')
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click()
  await expect(card(page, 'Draft')).toBeVisible()

  // Delete for good asks first; Cancel keeps it.
  await menu(page, 'Draft', 'Delete')
  await page.getByRole('link', { name: /Recently deleted/u }).click()
  await menu(page, 'Draft', 'Delete for good')
  const ask = page.getByRole('dialog', { name: 'Delete for good?' })
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(card(page, 'Draft')).toBeVisible()
  await menu(page, 'Draft', 'Delete for good')
  await ask.getByRole('button', { name: 'Delete for good' }).click()
  await expect(page.getByRole('heading', { name: 'Recently deleted is empty' })).toBeVisible()

  // Emptying asks first too.
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click()
  await menu(page, 'Keep', 'Delete')
  await page.getByRole('link', { name: /Recently deleted/u }).click()
  await page.getByRole('button', { name: 'Empty Recently deleted' }).click()
  await page.getByRole('dialog', { name: 'Empty Recently deleted?' }).getByRole('button', { name: 'Empty it' }).click()
  await expect(page.getByRole('heading', { name: 'Recently deleted is empty' })).toBeVisible()
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible()
})

test('search finds titles anywhere in the library, and sorting puts the oldest or newest first', async ({ page }) => {
  await home(page)
  await newNoteHere(page, 'Résumé of waves')
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New name for Untitled folder' }).fill('Physics')
  await page.keyboard.press('Enter')
  await card(page, 'Physics').locator('.card-open').click()
  await newNoteHere(page, 'Newton')
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click()
  // The top level is a view of its own, made afresh once the address has changed: typed into before, the old one's search box is gone.
  await expect(card(page, 'Physics')).toBeVisible()

  const search = page.getByRole('searchbox', { name: 'Search notes by title' })
  await search.fill('NEWTON')
  await expect.poll(() => names(page)).toEqual(['Newton'])
  await expect(card(page, 'Newton').locator('.card-meta')).toHaveText('In Notes › Physics')
  await search.fill('resume')
  await expect.poll(() => names(page)).toEqual(['Résumé of waves'])
  await search.fill('nothing like it')
  await expect(page.getByRole('heading', { name: 'Nothing matches “nothing like it”' })).toBeVisible()
  await search.press('Escape')
  await expect(search).toHaveValue('')

  await newNoteHere(page, 'Later')
  // Folders first, then notes; newest first by default.
  await expect.poll(() => names(page)).toEqual(['Physics', 'Later', 'Résumé of waves'])
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('created-oldest')
  await expect.poll(() => names(page)).toEqual(['Physics', 'Résumé of waves', 'Later'])
  // The choice is remembered.
  await page.reload()
  await expect.poll(() => names(page)).toEqual(['Physics', 'Résumé of waves', 'Later'])
})

test('cards are reached with Tab and the arrows; Enter opens; a right-click opens the menu', async ({ page }) => {
  await home(page)
  await newNoteHere(page, 'One')
  await newNoteHere(page, 'Two')
  await card(page, 'Two').locator('.card-open').focus()
  await page.keyboard.press('ArrowRight')
  await expect(card(page, 'One').locator('.card-open')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(card(page, 'Two').locator('.card-open')).toBeFocused()
  await card(page, 'One').locator('.card-open').click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Actions for One' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await card(page, 'One').locator('.card-open').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('One')
})

test('a long press with a finger or a pen opens a card’s menu, as a right-click does', async ({ page }) => {
  await home(page)
  await newNoteHere(page, 'Pressed')
  const target = card(page, 'Pressed').locator('.card-open')
  const box = (await target.boundingBox())!
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerType: 'pen', isPrimary: true, bubbles: true }
  await target.dispatchEvent('pointerdown', at)
  await expect(page.getByRole('menu', { name: 'Actions for Pressed' })).toBeVisible()
  await target.dispatchEvent('pointerup', at)
  // The click that ends the press opens nothing.
  await target.dispatchEvent('click', at)
  await expect(page.locator('.home')).toBeVisible()
  await expect(page.getByRole('menu', { name: 'Actions for Pressed' })).toBeVisible()
})

test('the note this browser kept before the library moves in exactly, and the old store is kept', async ({ page }) => {
  const raw = JSON.parse(await readFile(new URL('../../../packages/core/test/fixtures/mixed.json', import.meta.url), 'utf8')) as { id: string; title: string; asset: Record<string, unknown> }
  // An empty page of the same site, to make storage version 1 as the old app did, before the app first runs.
  await page.route('**/seed', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto('/seed')
  await page.evaluate(async (doc) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('shellnote', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('note')
        request.result.createObjectStore('assets')
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['note', 'assets'], 'readwrite')
        tx.objectStore('note').put({ doc, file: { name: 'waves.shellnote', rev: 3, savedAt: 1000 } }, 'current')
        for (const hash of Object.keys(doc.asset)) tx.objectStore('assets').put(new Blob(['picture']), hash)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, raw)

  await home(page)
  await expect(card(page, raw.title)).toBeVisible()
  await card(page, raw.title).locator('.card-open').click()
  await page.waitForURL(/#\/note\//u)
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(raw.title)
  expect(await page.evaluate(() => window.__shellnote!.doc)).toEqual(raw)
  await expect(page.getByRole('status')).toContainText('Changed since saved to waves.shellnote')
  // The old store is still there, with the note in it, and the move is not done twice.
  const old = await page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const request = indexedDB.open('shellnote')
        request.onsuccess = () => {
          const get = request.result.transaction('note').objectStore('note').get('current')
          get.onsuccess = () => resolve((get.result as { doc: { id: string } } | undefined)?.doc.id)
        }
      }),
  )
  expect(old).toBe(raw.id)
  await page.getByRole('button', { name: 'Back to notes' }).click()
  await expect(page.locator('.home')).toBeVisible()
  await page.reload()
  await expect(page.locator('.card')).toHaveCount(1)
})

test('two tabs on one note: the second shows it read-only, and "Edit here instead" moves the editing over', async ({ page }) => {
  await page.goto('/#/new')
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('First tab')
  await page.waitForFunction(() => window.__shellnote!.keptRev === window.__shellnote!.doc.rev)

  // Opened as a person opens it: a link to the note, clicked with Ctrl. A new tab in a browser, a new window in the app.
  await page.evaluate((href) => {
    const a = Object.assign(document.createElement('a'), { href, id: 'again', textContent: 'this note again' })
    Object.assign(a.style, { position: 'fixed', left: '0', top: '0', zIndex: '99999', background: '#fff' })
    document.body.append(a)
  }, page.url())
  const [second] = await Promise.all([page.context().waitForEvent('page'), page.locator('#again').click({ modifiers: ['Control'] })])
  await page.evaluate(() => document.getElementById('again')?.remove())
  // A tab in a browser, a window in the app.
  const tab = inApp ? 'window' : 'tab'
  await expect(second.getByRole('status').filter({ hasText: `open in another ${tab}` })).toBeVisible()
  await expect(second.locator('.nw-frame .ProseMirror')).toHaveCount(0)
  await expect(second.locator('.nw-page')).toContainText('First tab')

  // The first tab's changes show in the second.
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' and more')
  await expect(second.locator('.nw-page')).toContainText('First tab and more')

  await second.getByRole('button', { name: 'Edit here instead' }).click()
  await expect(second.locator('.nw-frame .ProseMirror').first()).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: `being edited in another ${tab}` })).toBeVisible()
  await expect(page.locator('.nw-frame .ProseMirror')).toHaveCount(0)
  await second.locator('.nw-frame .ProseMirror').first().click()
  await second.keyboard.press('Control+End')
  await second.keyboard.type(' from the second')
  await expect(page.locator('.nw-page')).toContainText('First tab and more from the second')
})

test("the app's own links open apart with Ctrl+click: a tab of their own in a browser, a window of their own in the app", async ({ page }) => {
  await home(page)
  // Inside the app such a page must never go to the person's browser, which cannot open the app's pages (found 18 October 2026).
  const [other] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: 'Recently deleted' }).click({ modifiers: ['Control'] })])
  await expect(other.getByRole('heading', { name: 'Recently deleted', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recently deleted', exact: true })).toHaveCount(0)
  await expect(page.locator('.home')).toBeVisible()
})

test('the settings show the storage used and change between light and dark, the paper staying white', async ({ page }) => {
  await home(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByTestId('storage-used')).toContainText('Your notes and pictures use')
  await dialog.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(22, 23, 26)')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.locator('.home-actions').getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('.nw-page').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  // Remembered in this browser.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('asking the browser to keep the notes always shows its answer, a silent no included (found in Edge)', async ({ page }) => {
  // Edge and Chrome answer at once and show nothing: here the browser's answer is set by the test.
  await page.addInitScript(() => {
    const answer = { keep: false }
    Object.assign(window, { __keepAnswer: answer })
    Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => false })
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => answer.keep })
  })
  await home(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  // Inside the app, WebView2 keeps the notes, and the settings say so.
  const keeper = inApp ? 'WebView2, which the app runs in,' : 'The browser'
  await expect(dialog).toContainText(`${keeper} may clear them by itself when space runs low.`)

  await dialog.getByRole('button', { name: inApp ? 'Ask WebView2 to keep them' : 'Ask the browser to keep them' }).click()
  await expect(dialog.getByRole('status')).toContainText(inApp ? 'WebView2 said no, for now' : 'The browser said no, for now.')
  await expect(dialog.getByRole('status')).toContainText(inApp ? 'it decides by itself, as Edge does' : 'bookmarked, installed as an app or use often')

  await page.evaluate(() => {
    ;(window as unknown as { __keepAnswer: { keep: boolean } }).__keepAnswer.keep = true
  })
  await dialog.getByRole('button', { name: 'Ask again' }).click()
  await expect(dialog).toContainText(`${keeper} has agreed not to clear them by itself.`)
  await expect(dialog.getByRole('status')).toBeEmpty()
  await expect(dialog.getByRole('button', { name: /Ask/u })).toHaveCount(0)
})
