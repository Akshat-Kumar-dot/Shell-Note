// Note control, step 3 (24 October 2026;): tables, formulas, diagrams and pictures written from the terminal into the
// note, as the page then draws them; Mermaid itself reads a diagram before it goes in, a broken one and a broken
// formula refused with why and nothing changed; one Undo takes a whole request back; a picture of another note of the
// library put into this one, its bytes with it.
import { expect, test, type Page } from './fixtures.js'

const terminal = (page: Page) => page.getByRole('dialog', { name: 'Terminal' })

/** Type lines (a request: one Enter) and wait for the terminal's answer to say `wait`. */
async function typed(page: Page, text: string, wait: string | RegExp): Promise<void> {
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  const outputs = terminal(page).locator('.nw-terminal-out')
  const before = await outputs.count()
  await line.fill(text)
  await line.press('Enter')
  await expect.poll(() => outputs.count()).toBeGreaterThan(before)
  await expect(terminal(page).getByRole('log')).toContainText(wait)
}

/** The blocks of a frame, as the note's data has them: each one's type and its main content. */
const frameBlocks = (page: Page, frame: string): Promise<{ id: string; type: string; what: unknown }[]> =>
  page.evaluate((id) => {
    const doc = window.__shellnote!.doc
    return ((doc.block[id] as { kids: string[] }).kids ?? []).map((kid) => {
      const block = doc.block[kid] as { type: string; md?: string; rows?: string[][]; tex?: string; src?: string; alt?: string }
      return { id: kid, type: block.type, what: block.md ?? block.rows ?? block.tex ?? block.src ?? block.alt }
    })
  }, frame)

test('a table, a formula and a diagram written from the terminal, drawn on the page; broken ones refused with why; one Undo a request (step 3)', async ({ page }) => {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  const before = await frameBlocks(page, 'fa')

  // A table and a formula under it, in one request.
  await typed(page, 'table: add after="the lab kit paragraph"\n| Wave | Speed |\n| --- | --- |\n| Sound | 343 m/s |\nend\nmaths: add after=$1\n$$v = f \\lambda$$\nend', 'maths.add: added the formula')
  const after = await frameBlocks(page, 'fa')
  const at = after.findIndex((block) => block.id === 'p2')
  expect(after[at + 1]).toMatchObject({ type: 'table', what: [['Wave', 'Speed'], ['Sound', '343 m/s']] })
  expect(after[at + 2]).toMatchObject({ type: 'math', what: 'v = f \\lambda' })
  await expect(page.locator('.nw-page-slot[data-index="0"] table')).toContainText('343 m/s')

  // A row added by its neighbour's words, then the whole table rewritten: the row kept, the cell changed.
  await typed(page, 'table: add row block="the table" row=Sound\n| Light | 3e8 m/s |\nend', 'added 1 row')
  await typed(page, 'table: rewrite block="the table"\n| Wave | Speed |\n|---|---|\n| Sound | 340 m/s |\n| Light | 3e8 m/s |\nend', 'rewrote the table')
  expect((await frameBlocks(page, 'fa'))[at + 1]!.what).toEqual([['Wave', 'Speed'], ['Sound', '340 m/s'], ['Light', '3e8 m/s']])

  // A broken formula and a diagram Mermaid cannot read: refused, with why, and the note as it was.
  const kept = await page.evaluate(() => window.__shellnote!.doc.rev)
  await typed(page, 'maths: add after=p1\n\\frac{1}{2\nend', 'The formula cannot go in: A { is never closed')
  await typed(page, 'diagram: add after=p1\nflowchart LR\n  A[One --> B\nend', 'The diagram cannot go in')
  expect(await page.evaluate(() => window.__shellnote!.doc.rev)).toBe(kept)

  // A diagram that reads, fenced as models write it: drawn on the page.
  await typed(page, 'diagram: add after=p1\n```mermaid\nflowchart LR\n  A[Source] --> B[Receiver]\n```\nend', 'added a flowchart')
  await expect(page.locator('.nw-page-slot[data-index="0"] .nw-diagram svg').first()).toBeVisible()

  // Undo, one request at a time, back to the note as it was.
  for (let i = 0; i < 4; i++) await typed(page, 'edit.undo', 'undone')
  expect((await frameBlocks(page, 'fa')).map((block) => block.id)).toEqual(before.map((block) => block.id))
})

test("a picture of another note of the library put into this one, by its description and note, its bytes with it", async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  await typed(page, 'note.new name=Lab', 'new note "Lab"')
  // A picture of its own in the Lab note: a red square drawn on a canvas, kept as a person's pasted picture is.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 30
    const context = canvas.getContext('2d')!
    context.fillStyle = '#e0563a'
    context.fillRect(0, 0, 40, 30)
    const blob = await new Promise<Blob>((done) => canvas.toBlob((made) => done(made!), 'image/png'))
    const hook = window.__shellnote!
    const picture = await hook.store.assets.add(blob)
    const frame = Object.values(hook.doc.block).find((block) => block.type === 'frame')!.id
    hook.store.apply([{ op: 'asset', hash: picture.hash, meta: picture.meta }, { op: 'add', block: { id: 'labpic01', r: 0, type: 'image', parent: frame, asset: picture.hash, alt: 'Red square' } }], { origin: 'test' })
  })
  await page.waitForFunction(() => window.__shellnote!.keptRev === window.__shellnote!.doc.rev)
  await typed(page, 'note.new name=Report', 'new note "Report"')
  await typed(page, 'text: add at=top\nResults\nend', 'added paragraph')
  await typed(page, 'picture: add picture="the red square from my Lab note" after="Results"\nThe square from the lab\nend', 'added the picture “Red square” from “Lab”')
  const image = await page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const block = Object.values(doc.block).find((one) => one.type === 'image') as { asset: string; alt?: string; caption?: string } | undefined
    return block ? { alt: block.alt, caption: block.caption, meta: doc.asset[block.asset] !== undefined, bytes: window.__shellnote!.store.assets.blob(block.asset) !== undefined } : undefined
  })
  expect(image).toEqual({ alt: 'Red square', caption: 'The square from the lab', meta: true, bytes: true })
  await expect(page.locator('.nw-page img').first()).toBeVisible()
  // A picture of no note is said so, with what there is.
  await typed(page, 'picture: add picture="a volcano"', 'No picture the agent may place fits "a volcano". Pictures in the library: “Red square” in “Lab”')
})

test('a Q and A recipe drawn: each question a heading 3, bigger than its answer, pairs apart by the theme’s own space (step 5, sp1); write: add says the shape it chose', async ({ page }) => {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  await typed(page, 'recipe: qa after="the lab kit paragraph"\nQ: What does a wave carry?\nA: Energy, not matter.\nQ: What links period and frequency?\nA: f = 1/T.\nend', 'made 2 questions and answers')
  const drawn = await page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>('.nw-page[data-page="w1"]')!
    const mm = sheet.getBoundingClientRect().width / 210
    const questions = [...sheet.querySelectorAll<HTMLElement>('.nw-text[data-role="h3"]')].filter((el) => /What does a wave carry|What links period/u.test(el.textContent ?? ''))
    const answer = questions[0]!.nextElementSibling as HTMLElement
    const size = (el: HTMLElement): number => Number.parseFloat(getComputedStyle(el).fontSize)
    return { count: questions.length, bigger: size(questions[0]!) > size(answer), gap: (questions[1]!.getBoundingClientRect().top - answer.getBoundingClientRect().bottom) / mm }
  })
  expect(drawn.count).toBe(2)
  expect(drawn.bigger).toBe(true)
  // The theme's space above a heading 3 (sp1): there, and under the 4 mm the plan first asked.
  expect(drawn.gap).toBeGreaterThan(0.5)
  expect(drawn.gap).toBeLessThan(4)
  await typed(page, 'write: add after="the lab kit paragraph"\n1. Measure the period\n2. Compute the frequency\nend', 'wrote it as numbered steps (steps in order)')
})
