// Note control, step 1 (21 October 2026): the page as text, and the change report, against the page as Edge draws
// it. The picture must list every block drawn on its page and none drawn on another, each by its id; and a change
// typed in the terminal must be reported as the page then shows it.
import { expect, test, type Page } from './fixtures.js'

const terminal = (page: Page) => page.getByRole('dialog', { name: 'Terminal' })

/** Type a line, wait for the terminal to answer it, and give the log's text after it. */
async function typed(page: Page, text: string, wait: string | RegExp): Promise<string> {
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  await line.fill(text)
  await line.press('Enter')
  await expect(terminal(page).getByRole('log')).toContainText(wait)
  return terminal(page).getByRole('log').innerText()
}

/** The ids of the note's blocks drawn on each page, as the screen has them. */
const drawnIds = (page: Page): Promise<string[][]> =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.nw-page[data-page]')].map((sheet) => [...new Set([...sheet.querySelectorAll<HTMLElement>('[data-id]')].map((el) => el.dataset.id!))]))

test('look page gives the page as drawn: every block on it by its id and kind, none from another page, no millimetres', async ({ page }) => {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  const log = await typed(page, 'look page 1', /checks: /u)
  const picture = log.slice(log.lastIndexOf('page 1 of 3'))
  const listed = new Set([...picture.matchAll(/^ {2}(\w+) {2}/gmu)].map((m) => m[1]!))
  const frames = new Set([...picture.matchAll(/\(frame (\w+)/gu)].map((m) => m[1]!))
  const [first = [], second = []] = await drawnIds(page)
  // Every block the picture lists is drawn on page 1.
  for (const id of listed) expect(first, `${id} is drawn on page 1`).toContain(id)
  // Every block drawn on page 1 is listed, or is the frame it sits in.
  const blocks = (await typed(page, 'blocks', /page 3 \(/u)).split('\n')
  const isBlock = (id: string): boolean => blocks.some((one) => one.trimStart().startsWith(`${id} · `))
  for (const id of first.filter(isBlock)) expect(listed.has(id) || frames.has(id), `${id} is in the picture`).toBe(true)
  // None drawn only on another page.
  for (const id of second.filter((id) => isBlock(id) && !first.includes(id))) expect(listed.has(id), `${id} is not on page 1`).toBe(false)
  expect(picture).not.toMatch(/\d mm/u)
  expect(picture.length).toBeLessThan(2500)
})

test('a change typed in the terminal is reported as the page then shows it: what is new, where, and what it pushed', async ({ page }) => {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  const op = JSON.stringify({ op: 'add', block: { type: 'text', parent: 'fa', role: 'h2', indent: 0, md: 'Summary of the chapter' }, at: 3 })
  const log = await typed(page, `op ${op}`, /changed: /u)
  const report = log.slice(log.lastIndexOf('changed: '))
  expect(report).toMatch(/^changed: \w{8} new: heading, level 2 “Summary of the chapter”, page 1, in the left column/u)
  // The blocks under it in the column were pushed down, as the page now draws them.
  expect(report).toMatch(/l1 pushed down \d+ mm/u)
  // And the picture shows it in its place, after the second paragraph.
  const after = await typed(page, 'look page 1', /checks: /u)
  expect(after.slice(after.lastIndexOf('page 1 of 3'))).toMatch(/ {2}p2 {2}paragraph 2[^\n]*\n {2}\w{8} {2}heading 2, level 2 {2}“Summary of the chapter”/u)
})
