// A board on the screen: made by its command, a flowchart drawn on it by board.draw, its steps and links drawn; the
// whole board in view; a step chosen and moved, its middle on a dot of the paper and its links coming with it, then
// undone; a link and a step taken out, each undone; zoom about the pointer with Ctrl and the wheel; the board moved
// with Space held; and the view found again where it was left.
import { expect, test, type Page } from './fixtures.js'
import { zoomShown } from './shell.js'

/** Lines typed into the terminal, which is then closed, so it covers nothing. */
async function terminal(page: Page, ...lines: string[]): Promise<void> {
  await page.keyboard.press('Control+Shift+P')
  const box = page.getByRole('textbox', { name: 'Terminal line' })
  const outputs = page.locator('.nw-terminal-out')
  for (const line of lines) {
    const before = await outputs.count()
    await box.fill(line)
    await box.press('Enter')
    await expect(outputs).toHaveCount(before + 1)
  }
  await box.press('Escape')
}

const CHART = ['board.draw', 'flowchart TD', '  A([Start]) --> B[Write the **draft**] --> C[Review] --> D{Passed?}', '  D -->|yes| E([Publish])', '  D -->|no| B', 'end'].join('\n')

test('a board shows its flowchart, its steps are chosen, moved and taken out, and it moves and zooms', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  await terminal(page, 'note.new type=board name="How a post is published"')
  const board = page.locator('div.nw-board')
  await expect(board).toBeVisible()
  const row = page.getByRole('toolbar', { name: 'Board' })
  await expect(row).toBeVisible()

  // A flowchart drawn from its Mermaid: its steps, their words, its links and their words.
  await terminal(page, CHART)
  const steps = board.locator('.nw-step')
  await expect(steps).toHaveCount(5)
  await expect(board.locator('.nw-step', { hasText: 'Write the draft' }).locator('strong')).toHaveText('draft')
  await expect(board.locator('.nw-step[data-shape="diamond"]')).toHaveCount(1)
  await expect(board.locator('.nw-link')).toHaveCount(5)
  await expect(board.locator('.nw-link-words text')).toHaveText(['yes', 'no'])
  await expect(page.locator('.sh-status')).toContainText('5 steps')

  // The whole board in view.
  await row.getByRole('button', { name: 'The whole board' }).click()
  for (const step of await steps.all()) await expect(step.locator('path')).toBeInViewport()

  // A step chosen and moved: its links come with it, its middle on a 5 mm dot; Undo puts it back.
  const review = board.locator('.nw-step', { hasText: 'Review' })
  const id = await review.getAttribute('data-id')
  const line = board.locator(`.nw-link[data-to="${id}"] .nw-link-line`)
  const left = (): Promise<string> => review.evaluate((el) => (el as HTMLElement).style.left)
  const was = { left: await left(), d: await line.getAttribute('d') }
  const shape = (await review.locator('path').boundingBox())!
  const from = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x - 150, from.y + 10, { steps: 6 })
  await page.mouse.up()
  await expect.poll(left).not.toBe(was.left)
  expect(await line.getAttribute('d')).not.toBe(was.d)
  await expect(board.locator('.nw-chosen')).toHaveCount(1)
  const middle = await review.evaluate((el) => parseFloat((el as HTMLElement).style.left) + parseFloat((el as HTMLElement).style.width) / 2)
  expect(Math.abs(middle / 5 - Math.round(middle / 5))).toBeLessThan(1e-6)
  await row.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(left).toBe(was.left)

  // A link chosen by its words and taken out with Delete; a step taken out, its links with it; each undone.
  await board.locator('.nw-link-words', { hasText: 'no' }).locator('rect').click()
  await expect(board.locator('.nw-link[data-chosen]')).toHaveCount(1)
  await page.keyboard.press('Delete')
  await expect(board.locator('.nw-link')).toHaveCount(4)
  await row.getByRole('button', { name: 'Undo' }).click()
  await expect(board.locator('.nw-link')).toHaveCount(5)
  await board.locator('.nw-step', { hasText: 'Publish' }).locator('path').click()
  await page.keyboard.press('Delete')
  await expect(steps).toHaveCount(4)
  await expect(board.locator('.nw-link')).toHaveCount(4)
  await row.getByRole('button', { name: 'Undo' }).click()
  await expect(steps).toHaveCount(5)

  // Ctrl and the wheel zoom about the pointer: the step under it stays under it, and grows.
  const start = board.locator('.nw-step', { hasText: 'Start' }).locator('path')
  const before = (await start.boundingBox())!
  const at = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
  const shown = await zoomShown(page).textContent()
  await page.mouse.move(at.x, at.y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Control')
  await expect(zoomShown(page)).not.toHaveText(shown!)
  await expect.poll(async () => (await start.boundingBox())!.width).toBeGreaterThan(before.width * 1.2)
  const zoomed = (await start.boundingBox())!
  expect(Math.abs(zoomed.x + zoomed.width / 2 - at.x)).toBeLessThan(3)
  expect(Math.abs(zoomed.y + zoomed.height / 2 - at.y)).toBeLessThan(3)

  // Space held and a drag on the bare board moves it, choosing nothing.
  const area = (await board.boundingBox())!
  const bare = { x: area.x + 20, y: area.y + area.height - 20 }
  await page.mouse.click(bare.x, bare.y)
  await page.keyboard.down('Space')
  await page.mouse.move(bare.x, bare.y)
  await page.mouse.down()
  await page.mouse.move(bare.x + 80, bare.y - 40, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect.poll(async () => Math.round((await start.boundingBox())!.x - zoomed.x)).toBe(80)
  await expect(board.locator('.nw-chosen')).toHaveCount(0)

  // Opened again, the board shows as it was left.
  const left2 = await zoomShown(page).textContent()
  await page.waitForTimeout(500)
  await page.reload()
  await expect(board.locator('.nw-step')).toHaveCount(5)
  await expect(zoomShown(page)).toHaveText(left2!)
})

test('a board’s commands work from the terminal, and the note menu has no pages for a board', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  await terminal(page, 'note.new type=board name="Plan"', 'board.add\nPlan the week\nend', 'board.add after="the step Plan" shape=decision\nDone?\nend')
  const board = page.locator('div.nw-board')
  await expect(board.locator('.nw-step')).toHaveCount(2)
  await expect(board.locator('.nw-step[data-shape="diamond"]')).toHaveText('Done?')
  await expect(board.locator('.nw-link')).toHaveCount(1)
  await terminal(page, 'board.link from="Done?" to="Plan the week" label=no', 'board.look block="the diamond" colour=red')
  await expect(board.locator('.nw-link')).toHaveCount(2)
  await expect(board.locator('.nw-step[data-shape="diamond"]')).toHaveAttribute('data-coloured', '')
  // A board stays a board: the menu offers no kind and no page size, and a kind is refused with what to do.
  await page.getByRole('button', { name: 'This note', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Kind' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Page' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+P')
  const box = page.getByRole('textbox', { name: 'Terminal line' })
  await box.fill('note.kind type=sketch')
  await box.press('Enter')
  await expect(page.locator('.nw-terminal-out').last()).toContainText('a board stays a board')
})
