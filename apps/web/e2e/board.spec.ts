// A board on the screen: made by its command, a flowchart drawn on it by board.draw, its steps and links drawn; the
// whole board in view; a step chosen and moved, its middle on a dot of the paper and its links coming with it, then
// undone; a link and a step taken out, each undone; zoom about the pointer with Ctrl and the wheel; the board moved
// with Space held; and the view found again where it was left. Made with the mouse and the keys: steps drawn with the
// Step tool and their words typed in place, Tab, links drawn by a drag (to a step, and to the bare board), the chosen
// step's and link's buttons, the points where links join and their switch, and text boxes typed, moved and sized.
import { expect, test, type Locator, type Page } from './fixtures.js'
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

/** A drag with the mouse, in small steps, as a hand makes it. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

/** The middle of what a locator shows on the screen. */
async function middleOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A step's middle, in millimetres on the board, from where it is drawn. */
const stepMiddle = (step: Locator): Promise<{ x: number; y: number }> =>
  step.evaluate((el) => {
    const style = (el as HTMLElement).style
    return { x: parseFloat(style.left) + parseFloat(style.width) / 2, y: parseFloat(style.top) + parseFloat(style.height) / 2 }
  })

/** On a dot of the paper: a whole number of 5 mm. */
const onDot = (mm: number): boolean => Math.abs(mm / 5 - Math.round(mm / 5)) < 1e-6

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

test('the Step tool draws steps and links, their words typed where they are, and Tab adds the next', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  await terminal(page, 'note.new type=board name="Made by hand"')
  const board = page.locator('div.nw-board')
  const row = page.getByRole('toolbar', { name: 'Board' })
  await expect(row).toBeVisible()
  const area = (await board.boundingBox())!
  const steps = board.locator('.nw-step')
  const links = board.locator('.nw-link')

  // A drag on the bare board draws a box over the box dragged, its middle on a dot; the caret goes into it.
  await row.getByRole('button', { name: 'Step', exact: true }).click()
  await expect(board).toHaveAttribute('data-tool', 'step')
  await drag(page, { x: area.x + 260, y: area.y + 90 }, { x: area.x + 420, y: area.y + 160 })
  await expect(steps).toHaveCount(1)
  await page.keyboard.type('Start')
  await page.keyboard.press('Enter')
  await expect(steps.first()).toHaveText('Start')
  const first = await stepMiddle(steps.first())
  expect(onDot(first.x) && onDot(first.y)).toBe(true)
  // With the Step tool in hand, every step shows its four points.
  await expect(board.locator('.nw-point[data-step]')).toHaveCount(4)

  // A drag from the step let go on the bare board: a step of the same shape there, joined, the caret in it.
  const start = steps.first().locator('path')
  const from = await middleOf(start)
  await drag(page, from, { x: from.x, y: from.y + 170 })
  await expect(steps).toHaveCount(2)
  await expect(links).toHaveCount(1)
  await page.keyboard.type('Write the draft')
  await page.keyboard.press('Enter')
  await expect(board.locator('.nw-step', { hasText: 'Write the draft' })).toHaveCount(1)

  // Tab, the new step chosen: the next step after it, chosen, the caret in its words.
  await page.keyboard.press('Tab')
  await expect(steps).toHaveCount(3)
  await page.keyboard.type('Passed?')
  await page.keyboard.press('Enter')
  await expect(links).toHaveCount(2)

  // The chosen step's buttons: its shape from a menu opened by a click, its colour.
  await row.getByRole('button', { name: 'Select', exact: true }).click()
  const passed = board.locator('.nw-step', { hasText: 'Passed?' })
  await passed.locator('path').click()
  await row.getByRole('button', { name: 'Shape', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Diamond: a decision' }).click()
  await expect(passed).toHaveAttribute('data-shape', 'diamond')
  await row.getByRole('button', { name: 'Colour', exact: true }).click()
  await page.getByRole('radiogroup', { name: "The step's colour" }).getByRole('radio', { name: 'Blue' }).click()
  await expect(passed).toHaveAttribute('data-coloured', '')

  // A link drawn from the chosen step's point back to the second step: while it is dragged only a straight line shows,
  // with the point it will join marked and no step to come; let go, code runs it.
  await expect(board.locator('.nw-point[data-step]')).toHaveCount(4)
  const draft = board.locator('.nw-step', { hasText: 'Write the draft' })
  const point = await middleOf(board.locator('.nw-point[data-point="left"]'))
  const target = await middleOf(draft.locator('path'))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 10 })
  await expect(board.locator('.nw-drag-line')).toHaveCount(1)
  await expect(board.locator('.nw-point[data-marked]')).toHaveCount(1)
  await expect(steps).toHaveCount(3)
  await page.mouse.up()
  await expect(links).toHaveCount(3)
  await expect(board.locator('.nw-drag-line')).toHaveCount(0)
  const back = board.locator(`.nw-link[data-from="${await passed.getAttribute('data-id')}"][data-to="${await draft.getAttribute('data-id')}"]`)
  await expect(back).toHaveCount(1)
  // One undo step: the link goes, and comes back.
  await row.getByRole('button', { name: 'Undo' }).click()
  await expect(links).toHaveCount(2)
  await row.getByRole('button', { name: 'Redo' }).click()
  await expect(links).toHaveCount(3)

  // A double-click types a step's words in place; Escape ends, the step still chosen; Undo takes the words back.
  await start.dblclick()
  await page.keyboard.press('End')
  await page.keyboard.type(' here')
  await page.keyboard.press('Escape')
  await expect(steps.first()).toHaveText('Start here')
  await expect(board.locator('.nw-chosen')).toHaveCount(1)
  await row.getByRole('button', { name: 'Undo' }).click()
  await expect(steps.first()).toHaveText('Start')
  // Enter types the chosen step's words too.
  await start.click()
  await page.keyboard.press('Enter')
  await page.keyboard.press('End')
  await page.keyboard.type(' now')
  await page.keyboard.press('Enter')
  await expect(steps.first()).toHaveText('Start now')

  // With the Step tool, a click on the bare board makes a step of the usual size there: a box 34 mm by 15 mm.
  await row.getByRole('button', { name: 'Step', exact: true }).click()
  await page.mouse.click(area.x + area.width - 200, area.y + area.height - 120)
  await expect(steps).toHaveCount(4)
  await page.keyboard.type('Alone')
  await page.keyboard.press('Enter')
  const alone = board.locator('.nw-step', { hasText: 'Alone' })
  await expect(alone).toHaveAttribute('data-shape', 'box')
  expect(await alone.evaluate((el) => [(el as HTMLElement).style.width, (el as HTMLElement).style.height])).toEqual(['34mm', '15mm'])
})

test("a chosen link's buttons, its end moved to another step, and the points shown only when asked for", async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  await terminal(page, 'note.new type=board name="Links"', CHART)
  const board = page.locator('div.nw-board')
  const row = page.getByRole('toolbar', { name: 'Board' })
  await row.getByRole('button', { name: 'The whole board' }).click()
  const id = (words: string): Promise<string | null> => board.locator('.nw-step', { hasText: words }).getAttribute('data-id')
  const [start, draft, passed] = [await id('Start'), await id('Write the draft'), await id('Passed?')]

  // Pointing at a step shows nothing by itself; a click chooses it, and its four points show.
  const review = board.locator('.nw-step', { hasText: 'Review' }).locator('path')
  const near = await middleOf(review)
  await page.mouse.move(near.x, near.y)
  await page.mouse.move(near.x + 4, near.y + 2)
  await page.waitForTimeout(600)
  await expect(board.locator('.nw-point')).toHaveCount(0)
  await review.click()
  await expect(board.locator('.nw-point[data-step]')).toHaveCount(4)

  // The link "no" chosen: its buttons in the row, a point at each end, none in its middle.
  await board.locator('.nw-link-words', { hasText: 'no' }).locator('rect').click()
  const no = board.locator(`.nw-link[data-from="${passed}"][data-to="${draft}"]`)
  await expect(no).toHaveAttribute('data-chosen', '')
  await expect(board.locator('.nw-point[data-end]')).toHaveCount(2)
  await expect(board.locator('.nw-point[data-step]')).toHaveCount(0)
  await row.getByRole('radio', { name: 'Curved' }).click()
  await row.getByRole('radio', { name: 'Dotted' }).click()
  await expect(no).toHaveAttribute('data-line', 'dotted')
  await row.getByRole('button', { name: 'Arrow' }).click()
  await expect(no.locator('.nw-link-line')).not.toHaveAttribute('marker-end', /url/u)
  const words = row.getByRole('textbox', { name: 'Words' })
  await words.fill('try again')
  await words.press('Enter')
  await expect(no.locator('.nw-link-words text')).toHaveText('try again')

  // Its arrow end dragged onto Start: the link leads there, its words and look kept.
  await drag(page, await middleOf(board.locator('.nw-point[data-end="to"]')), await middleOf(board.locator('.nw-step', { hasText: 'Start' }).locator('path')))
  const moved = board.locator(`.nw-link[data-from="${passed}"][data-to="${start}"]`)
  await expect(moved).toHaveCount(1)
  await expect(no).toHaveCount(0)
  await expect(moved).toHaveAttribute('data-line', 'dotted')
  await expect(moved.locator('.nw-link-words text')).toHaveText('try again')
  // Removed by its button, and back with Undo.
  await row.getByRole('button', { name: 'Remove the link' }).click()
  await expect(moved).toHaveCount(0)
  await row.getByRole('button', { name: 'Undo' }).click()
  await expect(moved).toHaveCount(1)

  // The switch off: no points anywhere, and a link is still drawn with the Step tool from a step to a step.
  await terminal(page, 'settings.points on=false')
  await review.click()
  await expect(board.locator('.nw-chosen')).toHaveCount(1)
  await expect(board.locator('.nw-point')).toHaveCount(0)
  await row.getByRole('button', { name: 'Step', exact: true }).click()
  await expect(board.locator('.nw-point')).toHaveCount(0)
  await drag(page, await middleOf(board.locator('.nw-step', { hasText: 'Publish' }).locator('path')), await middleOf(board.locator('.nw-step', { hasText: 'Start' }).locator('path')))
  await expect(board.locator(`.nw-link[data-to="${start}"]`)).toHaveCount(2)
  await terminal(page, 'settings.points on=true')
  await expect(board.locator('.nw-point[data-step]').first()).toBeVisible()
})

test('the Text tool puts a text box on the board, and the box is typed in, moved and sized', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  await terminal(page, 'note.new type=board name="Words on a board"')
  const board = page.locator('div.nw-board')
  const row = page.getByRole('toolbar', { name: 'Board' })
  const area = (await board.boundingBox())!

  // A click with the Text tool: a text box there, the caret in it; while it is typed in, the row for words.
  await row.getByRole('button', { name: 'Text', exact: true }).click()
  await page.mouse.click(area.x + 300, area.y + 150)
  await page.keyboard.type('Remember the deadline')
  const box = board.locator('.nw-frame', { hasText: 'Remember the deadline' })
  await expect(box).toHaveCount(1)
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible()
  await expect(row).toHaveCount(0)
  // Escape: typing stops, the box is chosen, the board's row is back.
  await page.keyboard.press('Escape')
  await expect(row).toBeVisible()
  await expect(board.locator('.nw-chosen')).toHaveCount(1)

  // With Select, the box is moved by a drag.
  await row.getByRole('button', { name: 'Select', exact: true }).click()
  const left = (): Promise<number> => box.evaluate((el) => parseFloat((el as HTMLElement).style.left))
  const was = await left()
  const at = await middleOf(box)
  await drag(page, at, { x: at.x + 80, y: at.y + 40 })
  await expect.poll(left).toBeGreaterThan(was + 10)
  // Sized across by a corner: narrower, its words wrap onto two lines and it grows taller.
  const width = (): Promise<number> => box.evaluate((el) => parseFloat((el as HTMLElement).style.width))
  const tall = (await box.boundingBox())!.height
  const wide = await width()
  const corner = await middleOf(board.locator('.nw-board-corner[data-corner="se"]'))
  await drag(page, corner, { x: corner.x - 110, y: corner.y })
  await expect.poll(width).toBeLessThan(wide - 20)
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(tall * 1.5)
  // A double-click types in it again.
  await box.dblclick()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' on Friday')
  await expect(box).toContainText('Remember the deadline on Friday')
})

test("a board's row is set in Customise, and the board's part goes back as it started", async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  await terminal(page, 'bar.button tools=board button=hand on=false', 'bar.button tools=board button=tidy on=true position=2', 'note.new type=board name="My row"')
  const row = page.getByRole('toolbar', { name: 'Board' })
  await expect(row.getByRole('button', { name: 'Move the board' })).toHaveCount(0)
  await expect(row.getByRole('button').nth(1)).toHaveAccessibleName('Tidy the flowchart')
  // Taken out, the Hand waits under the row's More.
  await row.getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Move the board' })).toBeVisible()
  await page.keyboard.press('Escape')
  // Select always stays.
  await page.keyboard.press('Control+Shift+P')
  const line = page.getByRole('textbox', { name: 'Terminal line' })
  await line.fill('bar.button tools=board button=select on=false')
  await line.press('Enter')
  await expect(page.locator('.nw-terminal-out').last()).toContainText('Select always stays')
  await line.press('Escape')
  await terminal(page, 'layout.reset part=board')
  await expect(row.getByRole('button', { name: 'Move the board' })).toBeVisible()
  await expect(row.getByRole('button').nth(1)).toHaveAccessibleName('Move the board')
})
