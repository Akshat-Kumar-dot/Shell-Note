// Note control, step 4: a block put by a place word lands in that part of the page
// as Edge draws it, clear of the others; a box of text, a page added and taken out; and the page picture's checks
// flag every overlap Edge draws on the sample notes' pages, none it does not.
import { expect, test, type Page } from './fixtures.js'

const terminal = (page: Page) => page.getByRole('dialog', { name: 'Terminal' })

/** Type lines (one request) and wait for the terminal's answer to say `wait`, allowing what asks first. */
async function typed(page: Page, text: string, wait: string | RegExp): Promise<string> {
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  const outputs = terminal(page).locator('.nw-terminal-out')
  const before = await outputs.count()
  await line.fill(text)
  await line.press('Enter')
  for (let waited = 0; (await outputs.count()) <= before && waited < 10_000; waited += 100) {
    const question = terminal(page).getByRole('alertdialog', { name: 'Allow it?' })
    if (await question.isVisible()) await question.getByRole('button', { name: 'Allow', exact: true }).click()
    await page.waitForTimeout(100)
  }
  await expect(terminal(page).getByRole('log')).toContainText(wait)
  return outputs.last().innerText()
}

/** The blocks placed on a drawn page, by id: their boxes in thousandths of the page's width and height. */
const placedOn = (page: Page, pageId: string): Promise<Record<string, { x: number; y: number; w: number; h: number }>> =>
  page.evaluate((id) => {
    const sheet = document.querySelector<HTMLElement>(`.nw-page[data-page="${CSS.escape(id)}"]`)!
    const whole = sheet.getBoundingClientRect()
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {}
    // A frame carries its id; a block placed on the page sits in a box of its own, its id on what it holds.
    for (const el of sheet.querySelectorAll<HTMLElement>(':scope > .nw-free')) {
      const id = el.dataset.id ?? el.querySelector<HTMLElement>('[data-id]')?.dataset.id
      if (id === undefined) continue
      const box = el.getBoundingClientRect()
      out[id] = { x: ((box.left - whole.left) / whole.width) * 1000, y: ((box.top - whole.top) / whole.height) * 1000, w: (box.width / whole.width) * 1000, h: (box.height / whole.height) * 1000 }
    }
    return out
  }, pageId)

test('a block put in a part of a page lands there as Edge draws it, clear of the others; a box, a page added and taken out (step 4)', async ({ page }) => {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  await typed(page, 'block: move block="the ripple tank photo" to="top right" page=3', 'moved gi at the top right of page 3')
  await typed(page, 'box: new to="bottom left" page=3\nRemember: a wave carries energy, not matter.\nend', 'added a box')
  await typed(page, 'screen.page page=3', 'page 3')
  await expect(page.locator('.nw-page[data-page="w3"] [data-id="gi"]')).toBeVisible()
  await expect(page.locator('.nw-page[data-page="w3"]')).toContainText('Remember: a wave carries energy')
  const boxes = await placedOn(page, 'w3')
  const gi = boxes.gi!
  // Its middle in the top third and the right third.
  expect(gi.x + gi.w / 2).toBeGreaterThan(667)
  expect(gi.y + gi.h / 2).toBeLessThan(333)
  const box = Object.entries(boxes).find(([id]) => id !== 'gi' && id !== 'fe')![1]
  expect(box.x + box.w / 2).toBeLessThan(333)
  expect(box.y + box.h / 2).toBeGreaterThan(667)
  // Nothing on the page covers another.
  const all = Object.values(boxes)
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const [a, b] = [all[i]!, all[j]!]
    expect(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) <= 1 || Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) <= 1).toBe(true)
  }
  // A page added after page 1, written on, then taken out (it asks first).
  await typed(page, 'page: add after=1', 'added page 2')
  await typed(page, 'text: add at=top page=2\nOn the new page.\nend', 'added paragraph')
  expect(await page.evaluate(() => window.__shellnote!.doc.pages.length)).toBe(4)
  await typed(page, 'page: remove page=2', 'removed page 2')
  expect(await page.evaluate(() => window.__shellnote!.doc.pages.length)).toBe(3)
})

for (const sample of ['mixed', 'physics', 'long']) {
  test(`the page picture flags every overlap Edge draws on the ${sample} sample's pages, and none it does not (step 4)`, async ({ page }) => {
    await page.goto(`/?sample=${sample}`)
    await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
    await page.keyboard.press('Control+Shift+P')
    // One overlap made on purpose, on the first page: its second block moved onto its first.
    if (sample === 'mixed') await typed(page, 'op {"op":"move","id":"mf","to":{"page":"w1","x":10750,"y":2200}}', 'done: move')
    const pages = await page.evaluate(() => window.__shellnote!.doc.pages.slice(0, 3))
    for (const [i, id] of pages.entries()) {
      await typed(page, `screen.page page=${i + 1}`, `page ${i + 1}`)
      const picture = await typed(page, `look page ${i + 1}`, /checks: /u)
      const flagged = new Set([...picture.matchAll(/⚠ (\w+) overlaps (\w+)/gu)].map((m) => [m[1]!, m[2]!].sort().join(' ')))
      const boxes = Object.entries(await placedOn(page, id))
      const drawn = new Set<string>()
      // More than 1 mm both ways, as the check counts it: on A4, 1 mm is about 4.8 thousandths across, 3.4 down.
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        const [[ia, A], [ib, B]] = [boxes[a]!, boxes[b]!]
        if (Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) > 6 && Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) > 4) drawn.add([ia, ib].sort().join(' '))
      }
      expect([...flagged].sort(), `page ${i + 1} of ${sample}`).toEqual([...drawn].sort())
      if (sample === 'mixed' && i === 0) expect(flagged).toContain('fb mf')
    }
  })
}
