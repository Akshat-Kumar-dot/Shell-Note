// The tools, and choosing blocks as objects. Select draws a box that takes
// only what is inside it, even over text or pictures: whole blocks, or just
// the letters under it, a letter counting when its middle is inside. The
// toolbar, the mark keys and Delete then act on exactly that, as one undo
// step. With Type, a click on bare paper puts the caret on the nearest line;
// with the Free cursor, a caret where it clicks, for a new frame. A click and
// Shift+click choose blocks placed on the page.
import { expect, test, type Page } from './fixtures.js'
import { chooseTool, zoom, zoomShown } from './shell.js'

// Tall enough to show a whole A4 page at 100%, so every point a test clicks is on screen.
test.use({ viewport: { width: 1280, height: 1200 } })

type Area = { page: string; x: number; y: number; w: number; h: number }
type Piece = { block: string; start: number; end: number }
type Picked = { blocks: string[]; words?: Piece[]; here?: Area }

function chosen(page: Page): Promise<{ selection: Picked; kind: string }> {
  return page.evaluate(() => ({ selection: window.__shellnote!.store.selection as Picked, kind: window.__shellnote!.store.selectionKind }))
}

function blockIds(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.__shellnote!.doc.block))
}

function md(page: Page, id: string): Promise<string> {
  return page.evaluate((id) => (window.__shellnote!.doc.block[id] as unknown as { md: string }).md, id)
}

/** A point on the first page, in millimetres from its top-left corner (A4, 210 by 297 mm), as screen pixels. */
async function onPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  return { x: sheet.x + (x * sheet.width) / 210, y: sheet.y + (y * sheet.height) / 297 }
}

/** Open the app and wait until the note is drawn: the browser's kept copy is read first. */
async function start(page: Page, address = '/#/new'): Promise<void> {
  await page.goto(address)
  await expect(page.locator('.nw-page').first()).toBeVisible()
  // Editable once it has checked that no other tab edits it.
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
}

async function useTool(page: Page, name: 'Type' | 'Select' | 'Free cursor'): Promise<void> {
  await chooseTool(page, name === 'Type' ? 'type' : name === 'Select' ? 'select' : 'free')
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
}

type Rect = { left: number; right: number; top: number; bottom: number }
/** A text block's words as drawn: its plain text, and where each character is. */
type Letters = { id: string; text: string; rects: Rect[] }

/** Where each character of these text blocks is drawn, for blocks with no formulas. */
function drawnLetters(page: Page, ids: string[]): Promise<Letters[]> {
  return page.evaluate((ids) => {
    const range = document.createRange()
    return ids.map((id) => {
      const block = document.querySelector(`.nw-frame [data-id="${id}"]`)!
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
      let text = ''
      const rects: Rect[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const content = node.textContent ?? ''
        for (let i = 0; i < content.length; i++) {
          range.setStart(node, i)
          range.setEnd(node, i + 1)
          const r = range.getBoundingClientRect()
          rects.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
        }
        text += content
      }
      return { id, text, rects }
    })
  }, ids)
}

/**
 * What a box holds by the project's rule, worked out from where the letters are
 * drawn: the letters whose middles are inside it, those side by side or with
 * only spaces between them making one piece.
 */
function piecesUnder(blocks: Letters[], box: Rect): Piece[] {
  const out: Piece[] = []
  for (const { id, text, rects } of blocks) {
    let piece: Piece | undefined
    rects.forEach((r, i) => {
      if (/\s/u.test(text[i]!)) return
      const x = (r.left + r.right) / 2
      const y = (r.top + r.bottom) / 2
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
        if (piece) out.push(piece)
        piece = undefined
      } else if (piece && text.slice(piece.end, i).trim() === '') {
        piece.end = i + 1
      } else {
        if (piece) out.push(piece)
        piece = { block: id, start: i, end: i + 1 }
      }
    })
    if (piece) out.push(piece)
  }
  return out
}

type Word = Rect & { word: string; start: number; end: number }

/** A block's words as drawn, line by line. */
function lines({ text, rects }: Letters): Word[][] {
  const words = [...text.matchAll(/\S+/gu)].map((m): Word => {
    const first = rects[m.index]!
    const last = rects[m.index + m[0].length - 1]!
    return { word: m[0], start: m.index, end: m.index + m[0].length, left: first.left, right: last.right, top: first.top, bottom: first.bottom }
  })
  const tops = [...new Set(words.map((w) => Math.round(w.top)))]
  return tops.map((top) => words.filter((w) => Math.round(w.top) === top))
}

/** Delete by the rule: whole words take one space along; letters cut from inside a word go alone. Last piece first. */
function cutAll(text: string, pieces: Piece[]): string {
  let out = text
  for (const piece of [...pieces].sort((a, b) => b.start - a.start)) {
    let { start, end } = piece
    const whole = (start === 0 || /\s/u.test(out[start - 1]!)) && (end === out.length || /\s/u.test(out[end]!))
    if (whole && out[end] === ' ') end++
    else if (whole && out[start - 1] === ' ') start--
    out = out.slice(0, start) + out.slice(end)
  }
  return out
}

/** The text of one piece. */
const textOf = (blocks: Letters[], piece: Piece): string => blocks.find((b) => b.id === piece.block)!.text.slice(piece.start, piece.end)

/** Type a paragraph of 120 numbered words into the first frame; its id. */
async function typeParagraph(page: Page): Promise<string> {
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.keyboard.insertText(Array.from({ length: 120 }, (_, i) => `w${String(i + 1).padStart(3, '0')}`).join(' '))
  return page.evaluate(() => Object.values(window.__shellnote!.doc.block).find((b) => b.type === 'text')!.id)
}


test('Type is the tool at first; Select takes the caret out of the text', async ({ page }) => {
  await start(page)
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'type')
  await page.locator('.nw-frame .ProseMirror').first().click()
  await expect(page.locator('.nw-frame .ProseMirror').first()).toBeFocused()
  await useTool(page, 'Select')
  await expect(page.locator('.nw-frame .ProseMirror').first()).not.toBeFocused()
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'select')
})

test('a Select box takes the pictures and handwriting inside it, starting even on a picture; Delete removes them, as one undo step', async ({ page }) => {
  await start(page, '/?sample=physics')
  await useTool(page, 'Select')
  // The picture g1 is at 110–190 mm across and 120–180 mm down; the handwriting k1 at 25–85 mm and 190–205 mm.
  await drag(page, await onPage(page, 185, 125), await onPage(page, 20, 210))
  await expect.poll(async () => (await chosen(page)).selection.blocks.sort()).toEqual(['g1', 'k1'])
  expect((await chosen(page)).kind).toBe('objects')
  await expect(page.locator('.nw-box[data-selected]')).toHaveCount(2)
  await expect(page.locator('.nw-region')).toHaveCount(1)
  // The picture was not moved by the press that started the box.
  const g1 = await page.evaluate(() => window.__shellnote!.doc.block.g1 as unknown as { x: number; y: number })
  expect([g1.x, g1.y]).toEqual([11000, 12000])

  await page.keyboard.press('Delete')
  await expect.poll(async () => (await blockIds(page)).filter((id) => id === 'g1' || id === 'k1')).toEqual([])
  await expect(page.locator('.nw-region')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await blockIds(page)).filter((id) => id === 'g1' || id === 'k1').sort()).toEqual(['g1', 'k1'])
})

test('a Select box over every word of a block takes the block whole; Delete removes the blocks, and the frame they leave empty', async ({ page }) => {
  await start(page, '/?sample=physics')
  await useTool(page, 'Select')
  // From the margin, across the whole width of the frame's three blocks.
  await drag(page, await onPage(page, 5, 12), await onPage(page, 205, 60))
  await expect.poll(async () => (await chosen(page)).selection.blocks).toEqual(['t1', 't2', 'm1'])
  expect((await chosen(page)).selection.words).toBeUndefined()
  // The two lines show their words, and the formula its block.
  await expect(page.locator('[data-id="t1"] .nw-chosen-words')).not.toHaveCount(0)
  await expect(page.locator('[data-id="t2"] .nw-chosen-words')).not.toHaveCount(0)
  await expect(page.locator('.nw-frame [data-chosen]')).toHaveCount(1)
  // Escape lets them go, and the box with them.
  await page.keyboard.press('Escape')
  await expect(page.locator('.nw-frame [data-chosen], .nw-frame .nw-chosen-words')).toHaveCount(0)
  await expect(page.locator('.nw-region')).toHaveCount(0)
  await drag(page, await onPage(page, 5, 12), await onPage(page, 205, 60))
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await blockIds(page)).filter((id) => ['f1', 't1', 't2', 'm1'].includes(id))).toEqual([])
})


test('a Select box around whole words takes them whole; Bold and Delete act on just those, Delete taking one space along', async ({ page }) => {
  await start(page)
  const id = await typeParagraph(page)
  const before = await md(page, id)
  const [para] = await drawnLetters(page, [id])
  const rows = lines(para!)
  expect(rows.length).toBeGreaterThanOrEqual(5)
  // Around words 3 to 6 of the second line, the box's sides in the spaces between words.
  const row = rows[1]!
  const box = { left: (row[1]!.right + row[2]!.left) / 2, right: (row[5]!.right + row[6]!.left) / 2, top: row[0]!.top + 2, bottom: row[0]!.bottom - 2 }
  const expected = piecesUnder([para!], box)
  expect(expected.map((piece) => textOf([para!], piece))).toEqual([row.slice(2, 6).map((w) => w.word).join(' ')])

  await useTool(page, 'Select')
  await drag(page, { x: box.left, y: box.top }, { x: box.right, y: box.bottom })
  await expect.poll(async () => (await chosen(page)).selection.words).toEqual(expected)
  expect((await chosen(page)).selection.blocks).toEqual([])
  await expect(page.locator('.nw-chosen-words')).toHaveCount(1)

  // Bold goes to just those words, and the box stays for the next button.
  const words = textOf([para!], expected[0]!)
  await page.getByRole('button', { name: 'Bold' }).click()
  await expect.poll(() => md(page, id)).toBe(before.replace(words, `**${words}**`))
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Control+z')
  await expect.poll(() => md(page, id)).toBe(before)

  // Delete cuts just those words, with one space, as one undo step.
  await page.keyboard.press('Delete')
  await expect.poll(() => md(page, id)).toBe(before.replace(`${words} `, ''))
  await expect(page.locator('.nw-chosen-words')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect.poll(() => md(page, id)).toBe(before)
})

test('a Select box through words of a five-line paragraph takes exactly the letters under it; Ctrl+I and Delete act on just those', async ({ page }) => {
  await start(page)
  const id = await typeParagraph(page)
  const before = await md(page, id)
  const [para] = await drawnLetters(page, [id])
  const rows = lines(para!)
  // From the middle of the third word to the middle of the sixth, down from line 2 to line 4.
  const middle = (w: Word): number => (w.left + w.right) / 2
  const box = { left: middle(rows[1]![2]!), right: middle(rows[1]![5]!), top: rows[1]![0]!.top + 2, bottom: rows[3]![0]!.bottom - 2 }
  const expected = piecesUnder([para!], box)
  expect(expected).toHaveLength(3)

  await useTool(page, 'Select')
  await drag(page, { x: box.left, y: box.top }, { x: box.right, y: box.bottom })
  await expect.poll(async () => (await chosen(page)).selection.words).toEqual(expected)
  await expect(page.locator('.nw-chosen-words')).toHaveCount(3)

  await page.keyboard.press('Control+i')
  await expect(page.locator('.nw-frame em')).toHaveText(expected.map((piece) => textOf([para!], piece)))
  await page.keyboard.press('Control+z')
  await expect(page.locator('.nw-frame em')).toHaveCount(0)

  await page.keyboard.press('Delete')
  await expect.poll(() => md(page, id)).toBe(cutAll(before, expected))
  await page.keyboard.press('Control+z')
  await expect.poll(() => md(page, id)).toBe(before)
})

test('a Select box over part of a long word takes just the letters under it; Ctrl+B and Delete act on just those', async ({ page }) => {
  await start(page)
  await page.locator('.nw-frame .ProseMirror').first().click()
  const typed = ['h'.repeat(60), 'h'.repeat(55), 'j'.repeat(70)]
  for (const [i, line] of typed.entries()) {
    if (i > 0) await page.keyboard.press('Enter')
    await page.keyboard.insertText(line)
  }
  const ids = await page.evaluate(() => {
    const doc = window.__shellnote!.doc
    const frame = Object.values(doc.block).find((b) => b.type === 'frame' && (b as unknown as { kids: string[] }).kids.length > 0)
    return (frame as unknown as { kids: string[] }).kids
  })
  expect(await Promise.all(ids.map((id) => md(page, id)))).toEqual(typed)
  const letters = await drawnLetters(page, ids)
  // From the 40th letter of the first line, past the end of every line, over all three lines.
  const box = {
    left: Math.round(letters[0]!.rects[39]!.left),
    right: Math.round(Math.max(...letters.map((line) => line.rects.at(-1)!.right)) + 20),
    top: Math.round(letters[0]!.rects[0]!.top) + 1,
    bottom: Math.round(letters[2]!.rects[0]!.bottom) - 1,
  }
  // The end of each line that reaches the box; the line of j is too short to.
  const expected = piecesUnder(letters, box)
  expect(expected.map((piece) => [piece.block, piece.end])).toEqual([
    [ids[0], 60],
    [ids[1], 55],
  ])

  await useTool(page, 'Select')
  await drag(page, { x: box.left, y: box.top }, { x: box.right, y: box.bottom })
  await expect.poll(async () => (await chosen(page)).selection.words).toEqual(expected)
  expect((await chosen(page)).selection.blocks).toEqual([])
  await expect(page.locator('.nw-chosen-words')).toHaveCount(2)

  // Ctrl+B makes just those letters bold, and Ctrl+Z takes it back.
  await page.keyboard.press('Control+b')
  await expect(page.locator('.nw-frame strong')).toHaveText(expected.map((piece) => textOf(letters, piece)))
  await page.keyboard.press('Control+z')
  await expect(page.locator('.nw-frame strong')).toHaveCount(0)

  // Delete cuts just those letters, as one undo step.
  await page.keyboard.press('Delete')
  await expect.poll(() => Promise.all(ids.map((id) => md(page, id)))).toEqual(typed.map((line, n) => cutAll(line, expected.filter((p) => p.block === ids[n]))))
  await page.keyboard.press('Control+z')
  await expect.poll(() => Promise.all(ids.map((id) => md(page, id)))).toEqual(typed)
})

test('a Select box on empty paper marks the place, for an AI edit to put things there later', async ({ page }) => {
  await start(page)
  await useTool(page, 'Select')
  await drag(page, await onPage(page, 40, 150), await onPage(page, 120, 200))
  const { selection } = await chosen(page)
  expect(selection.blocks).toEqual([])
  expect(selection.here).toMatchObject({ page: expect.any(String) })
  expect(Math.abs(selection.here!.x - 4000)).toBeLessThan(30)
  expect(Math.abs(selection.here!.w - 8000)).toBeLessThan(30)
  expect(Math.abs(selection.here!.h - 5000)).toBeLessThan(30)
  await expect(page.locator('.nw-region')).toHaveCount(1)
})

test('a click chooses a block on the page, and Shift+click adds one or takes it away', async ({ page }) => {
  await start(page, '/?sample=physics')
  await page.mouse.click(...Object.values(await onPage(page, 150, 150)) as [number, number])
  await expect.poll(async () => (await chosen(page)).selection.blocks).toEqual(['g1'])
  const ink = await onPage(page, 55, 197)
  await page.keyboard.down('Shift')
  await page.mouse.click(ink.x, ink.y)
  await expect.poll(async () => (await chosen(page)).selection.blocks).toEqual(['g1', 'k1'])
  await page.mouse.click(...Object.values(await onPage(page, 150, 150)) as [number, number])
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await chosen(page)).selection.blocks).toEqual(['k1'])
})

test('with Type, a click or a drag on bare paper lets go of what is chosen, puts the caret on the nearest line, and makes nothing', async ({ page }) => {
  await start(page, '/?sample=physics')
  await page.mouse.click(...Object.values(await onPage(page, 150, 150)) as [number, number])
  await expect.poll(async () => (await chosen(page)).selection.blocks).toEqual(['g1'])
  const before = await blockIds(page)
  // As in Word: the caret goes into the text, and no new frame is made.
  await page.mouse.click(...Object.values(await onPage(page, 60, 250)) as [number, number])
  await expect(page.locator('[data-id="f1"] .ProseMirror')).toBeFocused()
  expect((await chosen(page)).kind).toBe('text')
  await expect(page.locator('.nw-draft')).toHaveCount(0)
  await drag(page, await onPage(page, 20, 230), await onPage(page, 120, 280))
  await expect(page.locator('.nw-marquee, .nw-region')).toHaveCount(0)
  expect((await chosen(page)).kind).toBe('text')
  expect(await blockIds(page)).toEqual(before)
})

test('with the Free cursor, a click on bare paper puts a caret there; typing makes a frame on that spot, and a click that types nothing leaves nothing', async ({ page }) => {
  await start(page)
  await useTool(page, 'Free cursor')
  const before = await blockIds(page)
  // A click, and away again: nothing is made.
  await page.mouse.click(...Object.values(await onPage(page, 60, 200)) as [number, number])
  await expect(page.locator('.nw-draft')).toHaveCount(1)
  await page.mouse.click(...Object.values(await onPage(page, 150, 250)) as [number, number])
  await page.keyboard.press('Escape')
  expect(await blockIds(page)).toEqual(before)

  await page.mouse.click(...Object.values(await onPage(page, 60, 150)) as [number, number])
  await page.keyboard.type('Hello there')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Second line')
  const frames = await page.evaluate(() => {
    const doc = window.__shellnote!.doc
    return Object.values(doc.block)
      .filter((b) => b.type === 'frame')
      .map((b) => {
        const f = b as unknown as { id: string; x: number; y: number; kids: string[] }
        return { x: f.x, y: f.y, words: f.kids.map((id) => (doc.block[id] as unknown as { md: string }).md) }
      })
  })
  const made = frames.find((f) => f.words.length > 0)!
  expect(made.words).toEqual(['Hello there', 'Second line'])
  expect(Math.abs(made.x - 6000)).toBeLessThan(30)
  expect(Math.abs(made.y - (15000 - 300))).toBeLessThan(30)
  // The new frame's own editor has the caret.
  await expect(page.locator('.nw-draft')).toHaveCount(0)

  // Undo takes back the second line, then the frame with its first words.
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(() => blockIds(page)).toEqual(before)
})

// Tables, captions and inline formulas.
test('a Select box takes a table or a captioned picture whole, never words inside them, and counts an inline formula as one letter', async ({ page }) => {
  await start(page, '/?sample=mixed')
  // A table after the first paragraph, and a caption under the picture in the text.
  await page.evaluate(() => {
    window.__shellnote!.store.apply([
      { op: 'add', block: { id: 'tblAbcde', r: 0, type: 'table', parent: 'fa', rows: [['alpha beta', 'gamma'], ['delta', 'epsilon zeta']], head: true }, at: 1 },
      { op: 'update', id: 'ic', set: { caption: 'A wave on a string' } },
    ] as never)
  })
  const table = page.locator('[data-id="tblAbcde"]')
  await expect(table).toBeVisible()
  await useTool(page, 'Select')
  const nothing = { blocks: [] as string[] }
  const taken = async (): Promise<Picked> => {
    const { selection } = await chosen(page)
    return { blocks: selection.blocks, ...(selection.words ? { words: selection.words } : {}) }
  }

  // A corner of the table, less than 30% of it and not its centre: nothing, and no words from its cells.
  let r = (await table.boundingBox())!
  await drag(page, { x: r.x + 2, y: r.y + 2 }, { x: r.x + r.width * 0.3, y: r.y + r.height * 0.4 })
  await expect.poll(async () => (await chosen(page)).selection.here).toBeDefined()
  await expect.poll(taken).toEqual(nothing)
  // Its centre: the table, whole.
  await drag(page, { x: r.x + r.width / 2 - 10, y: r.y + r.height / 2 - 6 }, { x: r.x + r.width / 2 + 10, y: r.y + r.height / 2 + 6 })
  await expect.poll(taken).toEqual({ blocks: ['tblAbcde'] })

  // Only the caption: nothing. The picture's centre: the picture with its caption, whole.
  const picture = page.locator('[data-id="ic"]')
  await picture.scrollIntoViewIfNeeded()
  const caption = (await picture.locator('figcaption').boundingBox())!
  await drag(page, { x: caption.x + 2, y: caption.y + 2 }, { x: caption.x + caption.width - 2, y: caption.y + caption.height - 2 })
  await expect.poll(taken).toEqual(nothing)
  r = (await picture.boundingBox())!
  await drag(page, { x: r.x + r.width / 2 - 10, y: r.y + r.height / 2 - 10 }, { x: r.x + r.width / 2 + 10, y: r.y + r.height / 2 + 10 })
  await expect.poll(taken).toEqual({ blocks: ['ic'] })

  // A box around the formula T: it alone, as $T$, so Ctrl+B makes just it bold.
  const p1 = page.locator('[data-id="p1"]')
  await p1.scrollIntoViewIfNeeded()
  const before = await md(page, 'p1')
  const t = (await p1.locator('.nw-math-inline[data-tex="T"]').boundingBox())!
  await drag(page, { x: t.x - 1, y: t.y + 1 }, { x: t.x + t.width + 1, y: t.y + t.height - 1 })
  await expect.poll(async () => (await taken()).words?.map((piece) => [piece.block, piece.end - piece.start])).toEqual([['p1', '$T$'.length]])
  await page.keyboard.press('Control+b')
  await expect.poll(() => md(page, 'p1')).toBe(before.replace('$T$', '**$T$**'))
  await page.keyboard.press('Control+z')
  await expect.poll(() => md(page, 'p1')).toBe(before)
  // A formula counts by its middle: a box over just its right end takes nothing.
  const f = (await p1.locator('.nw-math-inline[data-tex="f = 1/T"]').boundingBox())!
  await drag(page, { x: f.x + f.width * 0.7, y: f.y + 1 }, { x: f.x + f.width - 1, y: f.y + f.height - 1 })
  await expect.poll(taken).toEqual(nothing)
})

// Check 4: the box stays where it was drawn.
test('the box stays on the page through scrolling and zoom, until Escape or a click outside it', async ({ page }) => {
  await start(page, '/?sample=physics')
  await useTool(page, 'Select')
  await drag(page, await onPage(page, 30, 230), await onPage(page, 90, 270))
  const region = page.locator('.nw-region')
  await expect(region).toHaveCount(1)
  const where = async (): Promise<number[]> => {
    const box = (await region.boundingBox())!
    const sheet = (await page.locator('.nw-page').first().boundingBox())!
    return [(box.x - sheet.x) / sheet.width, (box.y - sheet.y) / sheet.height, box.width / sheet.width, box.height / sheet.height]
  }
  const drawn = await where()
  const picked = (await chosen(page)).selection
  const near = (now: number[]): boolean => now.every((value, i) => Math.abs(value - drawn[i]!) < 0.003)

  await page.locator('.nw-desk').evaluate((desk) => desk.scrollBy(0, 200))
  await expect.poll(async () => near(await where())).toBe(true)
  await zoom(page, 'in')
  await expect(zoomShown(page)).toHaveText('110%')
  await expect.poll(async () => near(await where())).toBe(true)
  expect((await chosen(page)).selection).toEqual(picked)

  await page.keyboard.press('Escape')
  await expect(region).toHaveCount(0)
  // A click on the paper outside the box, or beside the page, lets it go too.
  await zoom(page, 'actual')
  await drag(page, await onPage(page, 30, 230), await onPage(page, 90, 270))
  await expect(region).toHaveCount(1)
  await page.mouse.click(...(Object.values(await onPage(page, 150, 250)) as [number, number]))
  await expect(region).toHaveCount(0)
  await drag(page, await onPage(page, 30, 230), await onPage(page, 90, 270))
  await expect(region).toHaveCount(1)
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  await page.mouse.click(sheet.x - 40, sheet.y + 300)
  await expect(region).toHaveCount(0)
})

// Check 5: the toolbar and the mark keys act only on what the box holds.
test('a colour, a link and every mark key act only on the words a box holds, each one undo step', async ({ page }) => {
  await start(page, '/?sample=physics')
  const before = await md(page, 't2')
  const [t2] = await drawnLetters(page, ['t2'])
  // Around "at rest stays", the third to fifth words.
  const row = lines(t2!)[0]!
  const box = { left: (row[1]!.right + row[2]!.left) / 2, right: (row[4]!.right + row[5]!.left) / 2, top: row[0]!.top + 2, bottom: row[0]!.bottom - 2 }
  await useTool(page, 'Select')
  await drag(page, { x: box.left, y: box.top }, { x: box.right, y: box.bottom })
  await expect.poll(async () => (await chosen(page)).selection.words?.map((piece) => t2!.text.slice(piece.start, piece.end))).toEqual(['at rest stays'])

  await page.getByRole('button', { name: 'Colour', exact: true }).click()
  await page.getByRole('button', { name: 'red', exact: true }).click()
  await expect.poll(() => md(page, 't2')).toBe(before.replace('at rest stays', '[at rest stays]{color=red}'))
  await page.keyboard.press('Control+z')
  await expect.poll(() => md(page, 't2')).toBe(before)

  page.once('dialog', (dialog) => void dialog.accept('https://example.com/waves'))
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await expect.poll(() => md(page, 't2')).toBe(before.replace('at rest stays', '[at rest stays](https://example.com/waves)'))
  await page.keyboard.press('Control+z')
  await expect.poll(() => md(page, 't2')).toBe(before)

  for (const [keys, around] of [
    ['Control+b', '**'],
    ['Control+i', '*'],
    ['Control+Shift+x', '~~'],
    ['Control+e', '`'],
    ['Control+Shift+h', '=='],
  ] as const) {
    await page.keyboard.press(keys)
    await expect.poll(() => md(page, 't2'), keys).toBe(before.replace('at rest stays', `${around}at rest stays${around}`))
    await page.keyboard.press('Control+z')
    await expect.poll(() => md(page, 't2'), keys).toBe(before)
  }
  // The box is still there after all of it.
  await expect(page.locator('.nw-region')).toHaveCount(1)
})

// Check 7: switching tools.
test('the tools switch cleanly: Type at first with the Free cursor off, and each tool does only its own thing', async ({ page }) => {
  await start(page, '/?sample=physics')
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'type')
  const [t2] = await drawnLetters(page, ['t2'])
  const row = lines(t2!)[0]!
  const from = { x: row[2]!.left + 2, y: (row[2]!.top + row[2]!.bottom) / 2 }
  const to = { x: row[4]!.right - 2, y: (row[4]!.top + row[4]!.bottom) / 2 }

  // Type: a drag over text selects the text, as in any editor; no box.
  await drag(page, from, to)
  await expect.poll(async () => (await chosen(page)).kind).toBe('text')
  expect((await chosen(page)).selection).toMatchObject({ range: { block: 't2' } })
  await expect(page.locator('.nw-region, .nw-marquee')).toHaveCount(0)

  // Select: the same drag draws a box. Back to Type, a click in the text puts the caret there, and the box goes.
  await useTool(page, 'Select')
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'select')
  await drag(page, from, to)
  await expect(page.locator('.nw-region')).toHaveCount(1)
  await useTool(page, 'Type')
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'type')
  await page.mouse.click(from.x, from.y)
  await expect(page.locator('[data-id="f1"] .ProseMirror')).toBeFocused()
  await expect(page.locator('.nw-region')).toHaveCount(0)
  expect((await chosen(page)).kind).toBe('text')

  // Free cursor: a click on bare paper puts a caret there; choosing Select lets it go, making nothing.
  const blocksBefore = await blockIds(page)
  await useTool(page, 'Free cursor')
  await page.mouse.click(...(Object.values(await onPage(page, 60, 250)) as [number, number]))
  await expect(page.locator('.nw-draft')).toHaveCount(1)
  await useTool(page, 'Select')
  await expect(page.locator('.nw-draft')).toHaveCount(0)
  expect(await blockIds(page)).toEqual(blocksBefore)
  // Type again: a click on bare paper makes no caret.
  await useTool(page, 'Type')
  await page.mouse.click(...(Object.values(await onPage(page, 60, 250)) as [number, number]))
  await expect(page.locator('.nw-draft')).toHaveCount(0)
})

// Check 8: another page, and other zoom levels.
test('a box works on page 2 and stays on the page it was started on', async ({ page }) => {
  await start(page, '/?sample=long')
  await page.evaluate(() => {
    window.__shellnote!.store.apply([
      { op: 'add', block: { id: 'pg2Words', r: 0, type: 'text', parent: 'f2', role: 'p', indent: 0, md: 'alpha beta gamma delta epsilon zeta eta theta iota kappa' }, at: 1 },
    ] as never)
  })
  // Only pages near the screen are drawn: scroll to page 2's place first.
  await page.locator('.nw-page-slot').nth(1).scrollIntoViewIfNeeded()
  await expect(page.locator('[data-id="pg2Words"]')).toBeVisible()
  const [para] = await drawnLetters(page, ['pg2Words'])
  const row = lines(para!)[0]!
  const middle = (w: Word): number => (w.left + w.right) / 2
  const box = { left: middle(row[1]!), right: middle(row[4]!), top: row[0]!.top + 2, bottom: row[0]!.bottom - 2 }
  const expected = piecesUnder([para!], box)
  await useTool(page, 'Select')
  await drag(page, { x: box.left, y: box.top }, { x: box.right, y: box.bottom })
  await expect.poll(async () => (await chosen(page)).selection.words).toEqual(expected)
  expect((await chosen(page)).selection.here?.page).toBe('p2')

  // Dragged from the bottom of page 1 onto page 2, the box stops at page 1's edge.
  const first = await page.evaluate(() => window.__shellnote!.doc.pages[0]!)
  await page.locator('.nw-page-slot').nth(0).evaluate((slot) => slot.scrollIntoView({ block: 'end' }))
  const one = page.locator('.nw-page-slot').nth(0).locator('.nw-page')
  const two = page.locator('.nw-page-slot').nth(1).locator('.nw-page')
  const a = (await one.boundingBox())!
  const b = (await two.boundingBox())!
  await drag(page, { x: a.x + 100, y: a.y + a.height - 60 }, { x: b.x + 300, y: b.y + 60 })
  const here = (await chosen(page)).selection.here!
  expect(here.page).toBe(first)
  expect(here.y + here.h).toBeLessThanOrEqual(29700)
  expect(here.y + here.h).toBeGreaterThan(29700 - 50)
})

test('a box takes the same letters at 50% and at 200% zoom', async ({ page }) => {
  await start(page, '/?sample=physics')
  await useTool(page, 'Select')
  for (const [button, label, clicks] of [
    ['Zoom out', '50%', 4],
    ['Zoom in', '200%', 9],
  ] as const) {
    for (let i = 0; i < clicks; i++) await zoom(page, button === 'Zoom in' ? 'in' : 'out')
    await expect(zoomShown(page)).toHaveText(label)
    await page.locator('[data-id="t2"]').scrollIntoViewIfNeeded()
    const [t2] = await drawnLetters(page, ['t2'])
    const row = lines(t2!)[0]!
    const middle = (w: Word): number => (w.left + w.right) / 2
    const box = { left: middle(row[2]!), right: middle(row[6]!), top: row[0]!.top + 1, bottom: row[0]!.bottom - 1 }
    const expected = piecesUnder([t2!], box)
    expect(expected.length, label).toBe(1)
    await drag(page, { x: box.left, y: box.top }, { x: box.right, y: box.bottom })
    await expect.poll(async () => (await chosen(page)).selection.words, label).toEqual(expected)
  }
})
