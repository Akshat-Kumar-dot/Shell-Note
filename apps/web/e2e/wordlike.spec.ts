// The editor like Word what is chosen shows only its words, never the blank
// space beside them; a click on bare paper puts the caret on the nearest line;
// and a click with the Select tool chooses the block under it.
import { expect, test, type Page } from './fixtures.js'
import { chooseTool } from './shell.js'

test.use({ viewport: { width: 1280, height: 1000 } })

async function start(page: Page): Promise<void> {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
}

/** Three short lines, as in a screenshot. */
async function threeLines(page: Page): Promise<void> {
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.type('Alpha beta gamma')
  await page.keyboard.press('Enter')
  await page.keyboard.type('gh')
  await page.keyboard.press('Enter')
  await page.keyboard.type('g')
}

type Box = { left: number; top: number; right: number; bottom: number }

/** Where a text block's words are drawn on the screen. */
function wordsOf(page: Page, text: string): Promise<Box> {
  return page.evaluate((text) => {
    const block = [...document.querySelectorAll<HTMLElement>('.nw-frame [data-id]')].find((el) => el.textContent === text)!
    const range = document.createRange()
    range.selectNodeContents(block)
    const r = range.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }, text)
}

function texts(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.values(window.__shellnote!.doc.block).flatMap((b) => (b.type === 'text' ? [(b as { md: string }).md] : [])))
}

function idOf(page: Page, text: string): Promise<string> {
  return page.evaluate((text) => Object.values(window.__shellnote!.doc.block).find((b) => b.type === 'text' && (b as { md: string }).md === text)!.id, text)
}

async function useTool(page: Page, name: 'Type' | 'Select'): Promise<void> {
  await chooseTool(page, name === 'Type' ? 'type' : 'select')
}

test('lines chosen whole by a Select box show only their words, not the blank space beside them', async ({ page }) => {
  await start(page)
  await threeLines(page)
  const gh = await wordsOf(page, 'gh')
  const g = await wordsOf(page, 'g')
  const frame = (await page.locator('.nw-frame').first().boundingBox())!
  await useTool(page, 'Select')
  await page.mouse.move(gh.left - 6, gh.top - 4)
  await page.mouse.down()
  await page.mouse.move(gh.left + 60, g.bottom + 4, { steps: 5 })
  await page.mouse.up()
  const chosen = await page.evaluate(() => window.__shellnote!.store.selection.blocks)
  expect(chosen).toEqual([await idOf(page, 'gh'), await idOf(page, 'g')])
  // Each highlight ends where its words end, far from the frame's right edge.
  const marks = await page.locator('.nw-chosen-words').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right))
  expect(marks).toHaveLength(2)
  expect(marks[0]!).toBeLessThan(gh.right + 2)
  expect(marks[1]!).toBeLessThan(g.right + 2)
  expect(Math.max(...marks)).toBeLessThan(frame.x + frame.width / 2)
  await expect(page.locator('.nw-frame [data-chosen]')).toHaveCount(0)
})

test('with Type, a click on bare paper puts the caret on the nearest line: beside a line at its start or end, below the text at its end', async ({ page }) => {
  await start(page)
  await threeLines(page)
  const frame = (await page.locator('.nw-frame').first().boundingBox())!
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  const alpha = await wordsOf(page, 'Alpha beta gamma')
  const gh = await wordsOf(page, 'gh')
  // In the left margin, level with the second line: its start.
  await page.mouse.click((sheet.x + frame.x) / 2, (gh.top + gh.bottom) / 2)
  await page.keyboard.type('X')
  // In the right margin, level with the first line: its end.
  await page.mouse.click((frame.x + frame.width + sheet.x + sheet.width) / 2, (alpha.top + alpha.bottom) / 2)
  await page.keyboard.type('Y')
  // Well below the text: the end of the last line.
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height + 150)
  await page.keyboard.type('Z')
  expect(await texts(page)).toEqual(['Alpha beta gammaY', 'Xgh', 'gZ'])
  await expect(page.locator('.nw-draft')).toHaveCount(0)
})

test('with Select, a click chooses the block under it, Shift adds or lets go, and Delete removes it in one undo step', async ({ page }) => {
  await start(page)
  await threeLines(page)
  const gh = await wordsOf(page, 'gh')
  const g = await wordsOf(page, 'g')
  const [ghId, gId] = [await idOf(page, 'gh'), await idOf(page, 'g')]
  const chosen = () => page.evaluate(() => ({ blocks: window.__shellnote!.store.selection.blocks, kind: window.__shellnote!.store.selectionKind }))
  await useTool(page, 'Select')
  await page.mouse.click(gh.left + 3, (gh.top + gh.bottom) / 2)
  expect(await chosen()).toEqual({ blocks: [ghId], kind: 'objects' })
  await expect(page.locator('.nw-chosen-words')).toHaveCount(1)
  await page.keyboard.down('Shift')
  await page.mouse.click(g.left + 2, (g.top + g.bottom) / 2)
  expect((await chosen()).blocks).toEqual([ghId, gId])
  await page.mouse.click(gh.left + 3, (gh.top + gh.bottom) / 2)
  await page.keyboard.up('Shift')
  expect((await chosen()).blocks).toEqual([gId])
  await page.keyboard.press('Delete')
  expect(await texts(page)).toEqual(['Alpha beta gamma', 'gh'])
  await page.keyboard.press('Control+z')
  expect(await texts(page)).toEqual(['Alpha beta gamma', 'gh', 'g'])
})
