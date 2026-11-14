// The stroke recorder (?record=strokes): it asks for one thing at a time, keeps
// every sample a stroke sent, goes on by itself after a one-stroke ask, keeps
// its progress in the library (IndexedDB, one ask at a time), and teaches the
// pen the person's hand.
import { expect, test, type Page } from './fixtures.js'
import { chooseTool, openPenSettings } from './shell.js'

type Item = { kind: string; strokes: { type: string; samples: number[][] }[] }

/** The asks the library keeps for the recording, in the order drawn. */
const recorded = (page: Page): Promise<Item[]> =>
  page.evaluate(
    () =>
      new Promise<Item[]>((resolve, reject) => {
        const open = indexedDB.open('shellnote')
        open.onsuccess = () => {
          const meta = open.result.transaction('meta').objectStore('meta')
          const all = meta.getAll(IDBKeyRange.bound('recording:item:', 'recording:item:\uffff'))
          all.onsuccess = () => resolve(all.result as Item[])
          all.onerror = () => reject(all.error)
        }
        open.onerror = () => reject(open.error)
      }),
  )

test('the recorder keeps each stroke sample by sample, and goes on by itself after a shape', async ({ page }) => {
  await page.goto('/?record=strokes')
  await page.evaluate(() => localStorage.removeItem('shellnote:recorded-strokes'))
  await page.reload()
  await expect(page.getByText(/Draw a straight line, any direction, then lift · 1 of 12/)).toBeVisible()
  const sheet = (await page.getByLabel('Draw here').boundingBox())!
  await page.mouse.move(sheet.x + 40, sheet.y + 40)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) await page.mouse.move(sheet.x + 40 + i * 10, sheet.y + 40 + i)
  await page.mouse.up()
  await expect(page.getByText(/· 2 of 12 · 1 of \d+ in all/)).toBeVisible()
  await expect.poll(async () => (await recorded(page)).length).toBe(1)
  const kept = await recorded(page)
  expect(kept[0]!.kind).toBe('line')
  const stroke = kept[0]!.strokes[0]!
  expect(stroke.type).toBe('mouse')
  expect(stroke.samples.length).toBeGreaterThanOrEqual(20)
  // x, y in 0.01 mm, pressure, tilt, time, contact size.
  expect(stroke.samples[0]).toHaveLength(8)
  // Kept across a reload.
  await page.reload()
  await expect(page.getByText(/· 2 of 12 · 1 of \d+ in all/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download (1 kept)' })).toBeEnabled()
})

test("the pen's settings link to the recorder, say what it is for, and the recorder leads back to the library", async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await openPenSettings(page)
  const hand = page.getByRole('group', { name: 'Your hand' })
  const about = hand.getByRole('button', { name: 'What is the stroke recorder?' })
  await expect(about).toHaveAttribute('aria-expanded', 'false')
  await about.click()
  await expect(hand.getByRole('note')).toContainText('Teach the pen your hand.')
  await about.click()
  await expect(hand.getByRole('note')).toHaveCount(0)
  await hand.getByRole('link', { name: 'Teach the pen your hand' }).click()
  await expect(page.getByRole('heading', { name: 'Stroke recorder' })).toBeVisible()
  await page.getByRole('link', { name: '← Back to notes' }).click()
  // Back in the library.
  await expect(page.locator('.home')).toBeVisible()
})

test('the alphabet: a letter of two strokes is kept as one, and the recorder goes on after a short pause', async ({ page }) => {
  await page.goto('/?record=strokes')
  await page.evaluate(() => localStorage.removeItem('shellnote:recorded-strokes'))
  await page.reload()
  // Skip the shapes, symbols and letter checks, to the alphabet.
  while (!(await page.getByText(/Draw the small letter a,/).isVisible())) await page.getByRole('button', { name: 'Skip these' }).click()
  await expect(page.getByText(/Draw the small letter a, as you write it in a word · 1 of 3/)).toBeVisible()
  const sheet = (await page.getByLabel('Draw here').boundingBox())!
  const stroke = async (x0: number, y0: number, x1: number, y1: number) => {
    await page.mouse.move(sheet.x + x0, sheet.y + y0)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(sheet.x + x0 + ((x1 - x0) * i) / 8, sheet.y + y0 + ((y1 - y0) * i) / 8)
    await page.mouse.up()
  }
  // Two strokes in quick succession: still the same letter.
  await stroke(100, 100, 100, 160)
  await stroke(100, 80, 101, 81)
  await expect(page.getByText(/Draw the small letter a, as you write it in a word · 2 of 3/)).toBeVisible()
  await expect.poll(async () => (await recorded(page)).at(-1)?.kind).toBe('glyph-a')
  const letter = (await recorded(page)).at(-1)!
  expect(letter.kind).toBe('glyph-a')
  expect(letter.strokes).toHaveLength(2)
})

test('Teach my pen makes the pen profile from what is recorded, and the library keeps it', async ({ page }) => {
  await page.goto('/?record=strokes')
  await page.evaluate(() => {
    const stroke = (points: [number, number][]) => ({ type: 'pen', samples: points.map(([x, y], i) => [x, y, 0.5, 0, 0, i * 8, 1, 1]) })
    const word = (k: number) => stroke(Array.from({ length: 30 }, (_, i): [number, number] => [1000 + i * 60, 3000 + 200 * Math.sin(i / 2 + k)]))
    const comma = (k: number) => stroke(Array.from({ length: 12 }, (_, i): [number, number] => [2000 + 80 * Math.cos(i / 4) - i * 10 + k, 2000 + i * 60]))
    const items = [...[0, 1, 2].map((k) => ({ kind: 'comma', strokes: [comma(k)] })), ...Array.from({ length: 25 }, (_, k) => ({ kind: 'word', strokes: [word(k)] }))]
    localStorage.setItem('shellnote:recorded-strokes', JSON.stringify({ v: 1, device: { userAgent: 'test', dpr: 1 }, started: '2026-10-16T00:00:00.000Z', items }))
  })
  await page.reload()
  await page.getByRole('button', { name: 'Teach my pen' }).click()
  await expect(page.getByRole('status')).toContainText('Your pen now goes by your own strokes: 1 of 8 symbols, 0 of 13 shapes, and 25 strokes of your writing')
  // In the library.
  const kept = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('shellnote')
          open.onsuccess = () => {
            const get = open.result.transaction('meta').objectStore('meta').get('pen-profile')
            get.onsuccess = () => resolve((get.result as { examples?: unknown[] } | undefined)?.examples?.length ?? 0)
          }
        }),
    )
  await expect.poll(kept).toBe(28)
  // A file that is no recording teaches nothing.
  await page.getByLabel('Teach from a file').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"v":2}') })
  await expect(page.getByRole('status')).toContainText('That file is not a stroke recording.')
  // In a note, Pen settings shows what was learned, read back from the library.
  await page.goto('/?sample=mixed')
  await chooseTool(page, 'pen')
  await openPenSettings(page)
  await expect(page.getByRole('group', { name: 'Your hand' })).toContainText('learned from 28 recorded strokes')
})

test('progress kept in localStorage before is carried into the library once, and Back one never brings it back', async ({ page }) => {
  await page.goto('/?record=strokes')
  await page.evaluate(() => {
    const line = { type: 'pen', samples: Array.from({ length: 10 }, (_, i) => [1000 + i * 300, 2000, 0.5, 0, 0, i * 8, 1, 1]) }
    localStorage.setItem('shellnote:recorded-strokes', JSON.stringify({ v: 1, device: { userAgent: 'test', dpr: 1 }, started: '2026-10-16T00:00:00.000Z', items: [{ kind: 'line', strokes: [line] }, { kind: 'line', strokes: [line] }] }))
  })
  await page.reload()
  await expect(page.getByText(/· 3 of 12 · 2 of \d+ in all/)).toBeVisible()
  await expect.poll(async () => (await recorded(page)).length).toBe(2)
  // Back twice, to nothing: what localStorage still holds is not read again.
  await page.getByRole('button', { name: 'Back one' }).click()
  await page.getByRole('button', { name: 'Back one' }).click()
  await expect(page.getByText(/· 1 of 12 · 0 of \d+ in all/)).toBeVisible()
  await expect.poll(async () => (await recorded(page)).length).toBe(0)
  await page.reload()
  await expect(page.getByText(/· 1 of 12 · 0 of \d+ in all/)).toBeVisible()
})

test('after the scratch-outs, shading inside a shape the recorder draws; last, small arrows as written in notes, kept as arrows', async ({ page }) => {
  await page.goto('/?record=strokes')
  await page.evaluate(() => localStorage.removeItem('shellnote:recorded-strokes'))
  await page.reload()
  while (!(await page.getByText(/Draw shading inside the grey shape/).isVisible())) await page.getByRole('button', { name: 'Skip these' }).click()
  await expect(page.getByLabel('The shape to shade')).toBeVisible()
  // The shape is only drawn: the pen draws on the sheet under it.
  await expect(page.getByLabel('The shape to shade')).toHaveCSS('pointer-events', 'none')
  // Then the small arrows, each going on as the pen lifts, the last ask of all.
  await page.getByRole('button', { name: 'Skip these' }).click()
  await expect(page.getByText(/Draw a small arrow, quickly, as you write one in your notes .* · 1 of 12/)).toBeVisible()
  await expect(page.getByLabel('The shape to shade')).toHaveCount(0)
  const sheet = (await page.getByLabel('Draw here').boundingBox())!
  await page.mouse.move(sheet.x + 100, sheet.y + 100)
  await page.mouse.down()
  for (const [x, y] of [[130, 100], [124, 94], [130, 100], [124, 106]] as const) await page.mouse.move(sheet.x + x, sheet.y + y)
  await page.mouse.up()
  await expect(page.getByText(/· 2 of 12/)).toBeVisible()
  await expect.poll(async () => (await recorded(page)).at(-1)?.kind).toBe('arrow-small')
})

test('the scratch-outs can be drawn again with the pen, each replacing the one before, and Teach my pen uses them', async ({ page }) => {
  await page.goto('/?record=strokes')
  await page.evaluate(() => localStorage.removeItem('shellnote:recorded-strokes'))
  await page.reload()
  const again = page.getByRole('button', { name: 'Record scratch-outs again' })
  // Only once the scratch-outs are drawn.
  await expect(again).toBeDisabled()
  while (!(await page.getByText(/Draw shading inside the grey shape/).isVisible())) await page.getByRole('button', { name: 'Skip these' }).click()
  const before = (await recorded(page)).length
  const first = (await recorded(page)).findIndex((item) => item.kind === 'scratch')
  await again.click()
  await expect(page.getByText(/Draw a word, then scratch it out with a zigzag over it, then press Next · 1 of 8 · again/)).toBeVisible()
  const sheet = (await page.getByLabel('Draw here').boundingBox())!
  for (let k = 0; k < 2; k++) {
    await page.mouse.move(sheet.x + 100, sheet.y + 100)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(sheet.x + 100 + (i % 2) * 120, sheet.y + 100 + i * 4)
    await page.mouse.up()
    await page.getByRole('button', { name: 'Next' }).click()
  }
  await expect(page.getByText(/· 3 of 8 · again/)).toBeVisible()
  // Stop: the rest stay as they were, and nothing was added.
  await page.getByRole('button', { name: 'Stop drawing again' }).click()
  await expect(page.getByText(/Draw shading inside the grey shape/)).toBeVisible()
  await expect.poll(async () => (await recorded(page))[first]?.strokes.length).toBe(1)
  const kept = await recorded(page)
  expect(kept).toHaveLength(before)
  expect(kept[first + 1]!.kind).toBe('scratch')
  expect(kept[first + 1]!.strokes).toHaveLength(1)
  expect(kept[first + 2]!.strokes).toHaveLength(0)
  await page.getByRole('button', { name: 'Teach my pen' }).click()
  await expect(page.getByRole('status')).toBeVisible()
})
