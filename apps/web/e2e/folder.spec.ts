// The library kept in a folder, in the desktop app: a note is a real
// .shellnote file, what another device writes into the folder shows in the
// library as it arrives, and a change to the note that is open joins what is
// being typed, with the caret and the undo steps as they were. It runs on the
// app's own built pages: only those may call the app's commands, a page from
// the test server may not.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply, createDoc, pack, unpack, type Doc, type Lineage, type Op } from '@shellnote/core'
import { expect, inApp, test, type Page } from './fixtures.js'

test.use({ libraryInFolder: true })
test.skip(!inApp, 'the library is kept in a folder in the desktop app only')

/** The paragraphs a note's file holds, in the order written. */
function inFile(path: string): string[] {
  try {
    const { doc } = unpack(new Uint8Array(readFileSync(path)))
    const frame = Object.values(doc.block).find((block) => block.type === 'frame')
    return frame?.type === 'frame' ? frame.kids.map((id) => doc.block[id]!).flatMap((block) => (block.type === 'text' ? [block.md] : [])) : []
  } catch {
    // Not there yet, or being written.
    return []
  }
}

/** The paragraphs on the page, as drawn. */
const onPage = (page: Page): Promise<string[]> => page.locator('.nw-frame .ProseMirror').first().locator('p').allInnerTexts()

/** The note's file as another device would write it: its own change on top of what the file holds, which it has seen. */
function fromAnotherDevice(path: string, change: (doc: Doc) => Op[]): void {
  const opened = unpack(new Uint8Array(readFileSync(path)))
  const doc = apply(opened.doc, change(opened.doc)).doc
  const seen = opened.lineage!
  const lineage: Lineage = { v: 1, by: 'otherDev', at: Date.now(), id: '0'.repeat(32), seen: { ...seen.seen, otherDev: doc.rev }, base: { seen: seen.seen, rev: opened.doc.rev } }
  writeFileSync(path, pack(doc, opened.assets, lineage))
}

test('a note is a file in the folder; another device’s note appears, and its change joins the note being typed in', async ({ page, folder }) => {
  // The app's own pages, as it opened them.
  await expect(page).toHaveURL(/^http:\/\/tauri\.localhost\//u)
  await expect(page.locator('.home-actions')).toBeVisible()
  // Settings says where the notes are.
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('library-place')).toContainText('In the folder')
  await expect(page.getByRole('button', { name: 'Keep them in the app instead' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  // A note another device made arrives in the folder, and shows without a reload.
  writeFileSync(join(folder!, 'From the phone.shellnote'), pack(createDoc({ title: 'From the phone' })))
  await expect(page.getByText('From the phone')).toBeVisible({ timeout: 15_000 })

  // A new note here is a file, named after its title.
  await page.locator('.home-actions').getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.getByLabel('Title').fill('Trip')
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('Pack the tent')
  const file = join(folder!, 'Trip.shellnote')
  await expect.poll(() => inFile(file), { timeout: 15_000 }).toEqual(['Pack the tent'])
  expect(readdirSync(folder!).filter((name) => name.endsWith('.shellnote') && !name.startsWith('.')).sort()).toEqual(['From the phone.shellnote', 'Trip.shellnote'])

  // Another device adds a paragraph to it while it is open here.
  fromAnotherDevice(file, (doc) => {
    const frame = Object.values(doc.block).find((block) => block.type === 'frame')!
    return [{ op: 'add', block: { id: 'fromPhone', r: 0, type: 'text', parent: frame.id, role: 'p', indent: 0, md: 'Back by Sunday' } }]
  })
  await expect.poll(() => onPage(page), { timeout: 15_000 }).toEqual(['Pack the tent', 'Back by Sunday'])

  // The caret is where it was: typing goes on at the end of the first line.
  await page.keyboard.type(' and the stove')
  await expect.poll(() => onPage(page)).toEqual(['Pack the tent and the stove', 'Back by Sunday'])
  await expect.poll(() => inFile(file), { timeout: 15_000 }).toEqual(['Pack the tent and the stove', 'Back by Sunday'])
  // Undo takes back the typing, never what came in.
  await page.keyboard.press('Control+z')
  await expect.poll(() => onPage(page)).toEqual(['Pack the tent', 'Back by Sunday'])
  await page.keyboard.press('Control+y')
  // And the file ends with both.
  await expect.poll(() => inFile(file), { timeout: 15_000 }).toEqual(['Pack the tent and the stove', 'Back by Sunday'])

  // Renamed, its file is renamed with it.
  await page.getByLabel('Title').fill('The trip')
  await expect.poll(() => existsSync(join(folder!, 'The trip.shellnote')) && !existsSync(file), { timeout: 15_000 }).toBe(true)
  expect(inFile(join(folder!, 'The trip.shellnote'))).toEqual(['Pack the tent and the stove', 'Back by Sunday'])
})
