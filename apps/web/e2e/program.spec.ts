// The program panel (other programs inside ShellNote, stage 2, 25 October 2026): another program's own window kept
// on a panel of the workspace. The real windows are the app's on Windows only (`pnpm desktop:apps` checks them); here
// the system's part is a stand-in that records what the panel asks of it, so the panel's own work is checked in Edge:
// the box it sends as it moves, its hiding while something of ours is over it, the program closing, dragged off and
// put back, and let go when the panel closes.
import { expect, inApp, test, type Page } from './fixtures.js'

test.use({ viewport: { width: 1280, height: 900 } })

type Call = { name: string; size?: number[]; id?: number; place?: unknown; front?: boolean; area?: { x: number; y: number; width: number; height: number }; covered?: boolean; again?: boolean; restore?: boolean; seen?: boolean }

declare global {
  interface Window {
    __programCalls?: Call[]
    __programTell?: (told: unknown) => void
    /** The stand-in's open windows, changed by a test as programs open. */
    __programWindows?: { id: number; title: string; program: string; left_out: 'administrator' | 'unknown' | 'held' | null }[]
    /** The stand-in's pictures: who listens to frames, and a frame sent to them. */
    __programFrames?: Set<(frame: never) => void>
    __programFrame?: (frame: unknown) => void
    /** The stand-in's place of a window now, and, when true, a program that never answers. */
    __programPlace?: unknown
    __programSilent?: boolean
    /** Whether the stand-in's program can go back; a window.open caught. */
    __programStays?: boolean
    /** The stand-in's words of a place, and of a picture. */
    __programWords?: string | null
    /** The stand-in's window shows a password box. */
    __programPassword?: boolean
    __pictureWords?: string | null
    __opened?: string | undefined
  }
}

/** A new note, with the stand-in host given. */
async function withStandIn(page: Page): Promise<void> {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.evaluate(() => {
    const calls: Call[] = []
    window.__programCalls = calls
    window.__programFrame = (frame) => {
      for (const listener of window.__programFrames ?? []) listener(frame as never)
    }
    window.__programWindows = [
      { id: 11, title: 'Lecture 4.pptx - PowerPoint', program: 'POWERPNT.EXE', left_out: null },
      { id: 12, title: 'Registry Editor', program: 'regedit.exe', left_out: 'administrator' },
      { id: 13, title: 'New InPrivate tab - Microsoft Edge', program: 'msedge.exe', left_out: null },
    ]
    window.__shellnote!.programHost.set({
      list: () => Promise.resolve([...window.__programWindows!]),
      hold: (id, area, _border, again) => {
        calls.push({ name: 'hold', id, area, ...(again ? { again } : {}) })
        return Promise.resolve()
      },
      place: (id, area) => {
        calls.push({ name: 'place', id, area })
        return Promise.resolve()
      },
      letGo: (id, restore) => {
        calls.push({ name: 'letGo', id, ...(restore === false ? { restore } : {}) })
        return Promise.resolve()
      },
      // PowerPoint's icon a red square, the others none.
      icon: (id) => Promise.resolve(id === 11 ? Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => [220, 40, 40, 255][i % 4]!) : undefined),
      cover: (id, covered) => {
        calls.push({ name: 'cover', id, covered })
        return Promise.resolve()
      },
      onTold: (listener) => {
        window.__programTell = listener as (told: unknown) => void
        return () => undefined
      },
      // A painted frame for each picture asked: PowerPoint red, the others blue, 40 by 30.
      picture: (id, _width, _height, seen) => {
        calls.push({ name: 'picture', id, seen })
        const colour = id === 11 ? [220, 40, 40, 255] : [40, 40, 220, 255]
        setTimeout(() => window.__programFrame?.({ id, width: 40, height: 30, rgba: Uint8ClampedArray.from({ length: 40 * 30 * 4 }, (_, i) => colour[i % 4]!) }), 0)
        return Promise.resolve()
      },
      stopPicture: (id) => {
        calls.push({ name: 'stopPicture', id })
        return Promise.resolve()
      },
      goTo: (id, place, front) => {
        calls.push({ name: 'goTo', id, place, front })
        return Promise.resolve(!window.__programStays)
      },
      mayKeepPicture: (id) => {
        calls.push({ name: 'mayKeepPicture', id })
        return Promise.resolve(!window.__programPassword)
      },
      wordsOf: (id) => {
        calls.push({ name: 'wordsOf', id })
        return Promise.resolve(window.__programWords ?? null)
      },
      readPicture: (width, height, rgba) => {
        calls.push({ name: 'readPicture', size: [width, height, rgba.length] })
        return Promise.resolve(window.__pictureWords ?? null)
      },
      placeOf: (id) => {
        calls.push({ name: 'placeOf', id })
        return window.__programSilent ? new Promise(() => undefined) : Promise.resolve((window.__programPlace ?? null) as never)
      },
      onFrame: (listener) => {
        const listeners = (window.__programFrames ??= new Set())
        listeners.add(listener as (frame: never) => void)
        return () => void listeners.delete(listener as (frame: never) => void)
      },
    })
  })
}

const calls = (page: Page): Promise<Call[]> => page.evaluate(() => window.__programCalls ?? [])
const last = async (page: Page, name: string): Promise<Call | undefined> => (await calls(page)).filter((call) => call.name === name).at(-1)

/** The panel body's box as the system is given it: CSS pixels times the page's scale. */
const bodyArea = (page: Page) =>
  page.locator('.nw-program-body').evaluate((element) => {
    const box = element.getBoundingClientRect()
    const scale = window.devicePixelRatio
    return { x: Math.round(box.left * scale), y: Math.round(box.top * scale), width: Math.round(box.width * scale), height: Math.round(box.height * scale) }
  })

async function hold(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Program panel' }).click()
  await page.getByRole('button', { name: /^Lecture 4\.pptx/u }).click()
  await expect(page.locator('.nw-program-body')).toHaveAttribute('data-state', 'held')
}

/** One word's worth of strokes with the pen, left on the first page. */
async function writeLine(page: Page, down = 220): Promise<void> {
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  const [x, y] = [sheet.x + 60, sheet.y + down]
  for (let k = 0; k < 3; k++) {
    const x0 = x + k * 26
    await page.mouse.move(x0, y)
    await page.mouse.down()
    for (const [dx, dy] of [[4, 24], [8, 0], [12, 24], [16, 0]] as const) await page.mouse.move(x0 + dx, y + dy, { steps: 4 })
    await page.mouse.up()
  }
}

const moments = (page: Page) => page.evaluate(() => Object.values(window.__shellnote!.doc.block).flatMap((block) => (block.type === 'ink' ? block.strokes.map((stroke) => stroke.pm) : [])))
const programs = (page: Page) => page.evaluate(() => window.__shellnote!.doc.programs)

async function withPen(page: Page): Promise<void> {
  await withStandIn(page)
  await page.getByRole('radio', { name: 'Pen', exact: true }).click()
  await page.keyboard.press('Escape')
}

/** The app bar's buttons drawn over each other, in pairs. */
const overlaps = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.appbar button, .appbar .title')].map((button) => ({ name: button.getAttribute('aria-label') ?? '', box: button.getBoundingClientRect() })).filter(({ box }) => box.width > 0)
    const found: string[] = []
    boxes.forEach((a, i) => {
      if (a.box.left < -0.5 || a.box.right > innerWidth + 0.5) found.push(`${a.name} off the screen`)
      for (const b of boxes.slice(i + 1)) if (a.box.left < b.box.right - 0.5 && a.box.right > b.box.left + 0.5 && a.box.top < b.box.bottom && a.box.bottom > b.box.top) found.push(`${a.name} over ${b.name}`)
    })
    return found
  })

// At 1,536 pixels wide the Video button was once drawn on the tools' Paper button.
// Every icon stays inside one row: the bar tightens step by step as the window narrows
// (Workspace.tsx, useOneRow), so from ONE_ROW pixels up every icon is in one row, and two rows only below.
// Measured 26 October 2026: one row down to 1,048 px in Edge with the Program panel's button; the app's own minimise,
// maximise and close take 138 px more.
const ONE_ROW = inApp ? 1240 : 1100
test('the app bar’s buttons never overlap, and every icon is in one row from 1,100 px (1,240 in the app), with the Program panel’s button or without it', async ({ page }) => {
  const widths = [...Array.from({ length: 33 }, (_, i) => 760 + i * 36), 1536, 1920]
  const sweep = async (): Promise<string[]> => {
    const found: string[] = []
    const seen: string[] = []
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      // The bar settles a moment after the window changes (it measures itself).
      await page.waitForTimeout(150)
      for (const pair of await overlaps(page)) found.push(`${width}: ${pair}`)
      const bar = await page.locator('.appbar').evaluate((element) => ({ rows: element.hasAttribute('data-rows') ? 2 : 1, step: element.getAttribute('data-tight') ?? '0', height: Math.round(element.getBoundingClientRect().height) }))
      seen.push(`${width}:${bar.rows === 1 ? `step ${bar.step}` : 'two rows'}/${bar.height}`)
      if (width >= ONE_ROW && (bar.rows !== 1 || bar.height > 68)) found.push(`${width}: not one row (${bar.rows} rows, ${bar.height} px)`)
    }
    console.log(seen.join('  '))
    return found
  }
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  expect(await sweep()).toEqual([])
  await withStandIn(page)
  await expect(page.getByRole('button', { name: 'Program panel' })).toBeVisible()
  expect(await sweep()).toEqual([])
})

// Found 6 November 2026 at a phone's 360 pixels: Back lay under Video, the title under both, and at 320 Video was off the
// screen. The sweep above begins at 760. The app's window is at least 480 across.
test('on a phone or in a small window, every button of the app bar can be reached and none lies over another', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const found: string[] = []
  for (const width of [320, 340, 360, 375, 384, 390, 412, 430, 460, 480, 520, 600, 680, 740].filter((one) => !inApp || one >= 480)) {
    await page.setViewportSize({ width, height: 800 })
    await page.waitForTimeout(150)
    for (const pair of await overlaps(page)) found.push(`${width}: ${pair}`)
  }
  expect(found).toEqual([])
})

// On an iPad every icon stays in one row too, as at a laptop's width. Upright as much as
// on its side: from the smallest usual iPad's width up. The app has no iPad.
test('on an iPad, upright or on its side, every icon of the app bar is in one row', async ({ page }) => {
  test.skip(inApp, 'the app’s bar also holds its own window buttons')
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const found: string[] = []
  for (const width of [768, 810, 820, 834, 1024, 1080, 1180, 1194, 1366]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(150)
    for (const pair of await overlaps(page)) found.push(`${width}: ${pair}`)
    const bar = await page.locator('.appbar').evaluate((element: HTMLElement) => ({ rows: element.dataset.rows, height: element.offsetHeight }))
    if (bar.rows !== undefined || bar.height > 68) found.push(`${width}: not one row (${bar.rows ?? 1} rows, ${bar.height} high)`)
  }
  expect(found).toEqual([])
})

test('the browser shows no program panel: it is the app’s, on Windows', async ({ page }) => {
  test.skip(inApp, 'the app is where the panel is')
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Video', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Program panel' })).toHaveCount(0)
})

test('each window in the list shows its program’s icon, or a plain window mark', async ({ page }) => {
  await withStandIn(page)
  await page.getByRole('button', { name: 'Program panel' }).click()
  const powerpoint = page.getByRole('button', { name: /^Lecture 4\.pptx/u })
  await expect(powerpoint.locator('img.nw-program-icon')).toBeVisible()
  // Drawn from the pixels given: red at its middle.
  const middle = await powerpoint.locator('img.nw-program-icon').evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d')!
    context.drawImage(img, 0, 0)
    return [...context.getImageData(16, 16, 1, 1).data]
  })
  expect(middle).toEqual([220, 40, 40, 255])
  await expect(page.getByRole('list', { name: 'Open windows' }).getByRole('button', { name: /Registry Editor/u }).locator('svg.nw-program-icon')).toBeVisible()
})

test('the list keeps itself up to date: a program opened after the panel shows up, with no reload', async ({ page }) => {
  await withStandIn(page)
  await page.getByRole('button', { name: 'Program panel' }).click()
  await expect(page.getByRole('button', { name: /^Lecture 4\.pptx/u })).toBeVisible()
  // A program opened now, while the panel shows its list.
  await page.evaluate(() => window.__programWindows!.push({ id: 14, title: 'notes.pdf - Microsoft Edge', program: 'msedge.exe', left_out: null }))
  await expect(page.getByRole('button', { name: /^notes\.pdf/u })).toBeVisible({ timeout: 4000 })
  // And one closed goes from the list too.
  await page.evaluate(() => {
    window.__programWindows = window.__programWindows!.filter((w) => w.id !== 11)
  })
  await expect(page.getByRole('button', { name: /^Lecture 4\.pptx/u })).toHaveCount(0, { timeout: 4000 })
})

test('started as administrator, the panel offers no window and says why (the research’s rule, 3.9)', async ({ page }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  // The system's words, as apps.rs refuses the list then.
  const why = 'shellnote was started as administrator, so it puts no other program on a panel. Start ShellNote the usual way to use the panel.'
  await page.evaluate((why) => {
    const refused = (): Promise<never> => Promise.reject(why)
    window.__shellnote!.programHost.set({ list: refused, hold: refused, place: refused, letGo: refused, cover: refused, onTold: () => () => undefined })
  }, why)
  await page.getByRole('button', { name: 'Program panel' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'started as administrator' })).toHaveText(why)
  await expect(page.getByRole('list', { name: 'Open windows' }).getByRole('button')).toHaveCount(0)
})

test('lists the windows, holds the one chosen on the panel’s box, and follows the panel', async ({ page }) => {
  await withStandIn(page)
  await page.getByRole('button', { name: 'Program panel' }).click()
  // Right of the notes, as the default layout has it.
  const notes = await page.locator('.nw-notes-panel').boundingBox()
  const panel = await page.locator('.nw-program').boundingBox()
  expect(panel!.x).toBeGreaterThanOrEqual(notes!.x + notes!.width - 1)
  // A window run as administrator is shown greyed with the reason; a private window is never offered.
  await expect(page.getByRole('button', { name: /Registry Editor/u })).toBeDisabled()
  await expect(page.getByText('Run as administrator: ShellNote cannot move it')).toBeVisible()
  await expect(page.getByRole('button', { name: /InPrivate/u })).toHaveCount(0)

  await page.getByRole('button', { name: /^Lecture 4\.pptx/u }).click()
  await expect(page.locator('.nw-program-body')).toHaveAttribute('data-state', 'held')
  expect(await last(page, 'hold')).toEqual({ name: 'hold', id: 11, area: await bodyArea(page) })
  await expect(page.locator('.nw-program-name')).toHaveText('Lecture 4.pptx - PowerPoint')

  // In full view, the program's box is sent again, and again when the layout comes back.
  await page.getByRole('button', { name: 'Full view: the program alone' }).click()
  await expect.poll(async () => (await last(page, 'place'))?.area).toEqual(await bodyArea(page))
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await last(page, 'place'))?.area).toEqual(await bodyArea(page))

  // The edge between the notes and the panel dragged: the box follows.
  const before = (await calls(page)).length
  const edge = page.locator('.nw-dock-splitter[data-dir="row"]').last()
  const at = (await edge.boundingBox())!
  await page.mouse.move(at.x + at.width / 2, at.y + 200)
  await page.mouse.down()
  await page.mouse.move(at.x - 120, at.y + 200, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await last(page, 'place'))?.area).toEqual(await bodyArea(page))
  expect((await calls(page)).length).toBeGreaterThan(before)
})

/** The colour at the middle of a picture's canvas. */
function middleOf(page: Page): Promise<number[]> {
  return page.locator('.nw-program-picture').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data])
}

test('covered, the program’s last picture stands where its window was (stage 3)', async ({ page }) => {
  await withStandIn(page)
  await hold(page)
  // Kept at two frames a second while the window itself is seen: not shown, under it.
  await expect.poll(() => last(page, 'picture')).toEqual({ name: 'picture', id: 11, seen: false })
  const picture = page.locator('.nw-program-picture')
  await expect(picture).toBeHidden()
  await page.evaluate(() => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.id = 'over'
    dialog.style.cssText = 'position:fixed;inset:0;'
    document.body.append(dialog)
  })
  await expect.poll(() => last(page, 'cover')).toEqual({ name: 'cover', id: 11, covered: true })
  await expect(picture).toBeVisible()
  expect(await middleOf(page)).toEqual([220, 40, 40, 255])
  await page.evaluate(() => document.getElementById('over')!.remove())
  await expect(picture).toBeHidden()
})

test('elsewhere: a program’s live picture, view only, its window not moved; Bring it here puts it on the panel', async ({ page }) => {
  await withStandIn(page)
  await page.getByRole('button', { name: 'Program panel' }).click()
  await page.getByRole('button', { name: 'Show the picture of Lecture 4.pptx - PowerPoint' }).click()
  await expect.poll(() => last(page, 'picture')).toEqual({ name: 'picture', id: 11, seen: true })
  await expect(page.locator('.nw-program-picture')).toBeVisible()
  expect(await middleOf(page)).toEqual([220, 40, 40, 255])
  // View only: nothing held.
  expect(await last(page, 'hold')).toBeUndefined()
  await page.getByRole('button', { name: 'Back to the list' }).click()
  await expect.poll(() => last(page, 'stopPicture')).toEqual({ name: 'stopPicture', id: 11 })
  await expect(page.getByRole('list', { name: 'Open windows' })).toBeVisible()

  await page.getByRole('button', { name: 'Show the picture of Lecture 4.pptx - PowerPoint' }).click()
  await expect(page.locator('.nw-program-picture')).toBeVisible()
  await page.getByRole('button', { name: 'Bring it here' }).click()
  await expect(page.locator('.nw-program-body')).toHaveAttribute('data-state', 'held')
  expect(await last(page, 'hold')).toMatchObject({ name: 'hold', id: 11 })
})

test('nothing pictured while ShellNote cannot be seen (the research’s rule, 3.9)', async ({ page }) => {
  await withStandIn(page)
  await page.getByRole('button', { name: 'Program panel' }).click()
  await page.getByRole('button', { name: 'Show the picture of Lecture 4.pptx - PowerPoint' }).click()
  await expect.poll(() => last(page, 'picture')).toEqual({ name: 'picture', id: 11, seen: true })
  const turn = (state: 'hidden' | 'visible') =>
    page.evaluate((now) => {
      Object.defineProperty(document, 'visibilityState', { value: now, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }, state)
  await turn('hidden')
  await expect.poll(() => last(page, 'stopPicture')).toEqual({ name: 'stopPicture', id: 11 })
  await turn('visible')
  await expect.poll(async () => (await page.evaluate(() => window.__programCalls!.filter((call) => call.name === 'picture').length))).toBe(2)
})

test('hidden while something of ours is over it, and back when it goes', async ({ page }) => {
  await withStandIn(page)
  await hold(page)
  // A dialog over the panel: the program hidden, a stand-in with its title shown.
  await page.evaluate(() => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.id = 'over'
    dialog.style.cssText = 'position:fixed;inset:0;'
    document.body.append(dialog)
  })
  await expect.poll(() => last(page, 'cover')).toEqual({ name: 'cover', id: 11, covered: true })
  await expect(page.locator('.nw-program-standin')).toHaveText('Lecture 4.pptx - PowerPoint')
  await page.evaluate(() => document.getElementById('over')!.remove())
  await expect.poll(() => last(page, 'cover')).toEqual({ name: 'cover', id: 11, covered: false })
  await expect(page.locator('.nw-program-standin')).toHaveCount(0)

  // Another panel in full view hides it too.
  await page.getByRole('button', { name: 'Full view: the notes alone' }).click()
  await expect.poll(() => last(page, 'cover')).toEqual({ name: 'cover', id: 11, covered: true })
  await page.keyboard.press('Escape')
  await expect.poll(() => last(page, 'cover')).toEqual({ name: 'cover', id: 11, covered: false })
})

test('dragged off by its own title bar it is let go, and put back; closed, the list comes back', async ({ page }) => {
  await withStandIn(page)
  await hold(page)
  await page.evaluate(() => window.__programTell!({ kind: 'moved', id: 11, x: 40, y: 40, width: 800, height: 600, minimised: false }))
  await expect(page.getByText('Lecture 4.pptx - PowerPoint was moved off the panel.')).toBeVisible()
  // Dragged off: let go where the person dropped it, not given back its old place.
  expect(await last(page, 'letGo')).toEqual({ name: 'letGo', id: 11, restore: false })
  await page.getByRole('button', { name: 'Put back' }).click()
  await expect(page.locator('.nw-program-body')).toHaveAttribute('data-state', 'held')
  // Put back: its first place, from before the panel, kept to be given back.
  expect(await last(page, 'hold')).toEqual({ name: 'hold', id: 11, area: await bodyArea(page), again: true })

  await page.evaluate(() => window.__programTell!({ kind: 'title', id: 11, title: 'Lecture 5.pptx - PowerPoint' }))
  await expect(page.locator('.nw-program-name')).toHaveText('Lecture 5.pptx - PowerPoint')
  await page.evaluate(() => window.__programTell!({ kind: 'closed', id: 11 }))
  await expect(page.getByText('Lecture 5.pptx - PowerPoint closed.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Lecture 4\.pptx/u })).toBeVisible()
})

test('a line written beside a program keeps its moment: the program, when, its place; the first adds the program to the note, in its own undo step', async ({ page }) => {
  await withPen(page)
  // Nothing on the panel: a line keeps no moment, and the note names no program.
  await writeLine(page, 120)
  await expect.poll(async () => (await moments(page)).length).toBe(3)
  expect(await moments(page)).toEqual([undefined, undefined, undefined])
  expect(await programs(page)).toBeUndefined()
  while ((await moments(page)).length > 0) await page.keyboard.press('Control+z')

  await page.evaluate(() => {
    window.__programPlace = { slide: 257, n: 2 }
  })
  await hold(page)
  const started = Date.now()
  await writeLine(page)
  await expect.poll(async () => (await moments(page)).length).toBe(3)
  const [source] = (await programs(page))!
  expect(source).toEqual({ id: expect.any(String), program: 'POWERPNT.EXE', title: 'Lecture 4.pptx - PowerPoint' })
  const kept = await moments(page)
  for (const moment of kept) {
    expect(moment).toMatchObject({ m: source!.id, at: expect.any(Number), place: { slide: 257, n: 2 } })
    expect(moment!.at).toBeGreaterThanOrEqual(started - 1000)
    expect(moment!.at).toBeLessThanOrEqual(Date.now())
  }

  // Undone back to no strokes: the note names no program either, and nothing was left behind.
  while ((await moments(page)).length > 0) await page.keyboard.press('Control+z')
  expect(await programs(page)).toBeUndefined()

  // Written again after the slide moved on (more than a second later, so it is asked again): one program, the new place.
  await page.waitForTimeout(1100)
  await page.evaluate(() => {
    window.__programPlace = { slide: 258, n: 3 }
  })
  await writeLine(page)
  await expect.poll(async () => (await moments(page)).length).toBe(3)
  expect(await programs(page)).toHaveLength(1)
  expect((await moments(page))[0]!.place).toEqual({ slide: 258, n: 3 })

  // Its title changes (a browser's does, with each page): still the one program.
  await page.evaluate(() => window.__programTell!({ kind: 'title', id: 11, title: 'Lecture 4.pptx [read-only] - PowerPoint' }))
  await writeLine(page, 320)
  await expect.poll(async () => (await moments(page)).length).toBe(6)
  expect(await programs(page)).toHaveLength(1)

  // Dragged off: let go, so a line keeps nothing of it.
  await page.evaluate(() => window.__programTell!({ kind: 'moved', id: 11, x: 40, y: 40, width: 800, height: 600, minimised: false }))
  await expect(page.locator('.nw-program-body')).toHaveAttribute('data-state', 'moved-off')
  await writeLine(page, 420)
  await expect.poll(async () => (await moments(page)).length).toBe(9)
  // Counted, not by the last three: an ink block tidied or moved goes to the end of the note's blocks, so these are not
  // in the order they were written (it failed so once, inside the app, under load, 6 November 2026).
  expect((await moments(page)).filter((moment) => moment === undefined)).toHaveLength(3)
})

test('a program that does not answer never holds a line: the line is kept without a place; one shown by its picture keeps its moment too', async ({ page }) => {
  await withPen(page)
  await page.evaluate(() => {
    window.__programSilent = true
    window.__programWindows!.push({ id: 14, title: 'waves.ts - project - Visual Studio Code', program: 'Code.exe', left_out: null })
  })
  await page.getByRole('button', { name: 'Program panel' }).click()
  await page.getByRole('button', { name: /^Show the picture of waves\.ts/u }).click()
  await expect(page.locator('.nw-program-picture')).toBeVisible()
  await writeLine(page)
  await expect.poll(async () => (await moments(page)).length).toBe(3)
  const [source] = (await programs(page))!
  expect(source).toMatchObject({ program: 'Code.exe', title: 'waves.ts - project - Visual Studio Code' })
  expect(await moments(page)).toEqual([0, 1, 2].map(() => ({ m: source!.id, at: expect.any(Number) })))
})

test('a line’s mark goes back to its place, by the person’s tap; a program that cannot shows the place; × takes the places off', async ({ page }) => {
  await withPen(page)
  await page.evaluate(() => {
    window.__programPlace = { slide: 257, n: 2, deck: 'C:/talks/Lecture 4.pptx' }
  })
  await hold(page)
  await writeLine(page)
  const mark = page.getByRole('button', { name: /^Back to slide 2 of Lecture 4\.pptx/u })
  await expect(mark).toHaveText('↩ slide 2')
  const sheet = (await page.locator('.nw-page').first().boundingBox())!
  expect((await mark.boundingBox())!.x).toBeLessThan(sheet.x + 60)

  // The program beside the note goes back, not brought in front.
  await mark.click()
  await expect.poll(() => last(page, 'goTo')).toEqual({ name: 'goTo', id: 11, place: { slide: 257, n: 2, deck: 'C:/talks/Lecture 4.pptx' }, front: false })
  await expect(page.getByRole('dialog', { name: 'Where this line was written' })).toHaveCount(0)

  // It cannot (the slide was deleted): the line's place shown instead, and closed.
  await page.evaluate(() => {
    window.__programStays = true
  })
  await mark.click()
  const shown = page.getByRole('dialog', { name: 'Where this line was written' })
  await expect(shown).toContainText('slide 2')
  await expect(shown).toContainText('Lecture 4.pptx - PowerPoint')
  await shown.getByRole('button', { name: 'Close' }).click()
  await expect(shown).toHaveCount(0)

  // Let go, the same program still open elsewhere: that window goes back, brought in front.
  await page.getByRole('button', { name: 'Let the program go' }).click()
  await page.evaluate(() => {
    window.__programStays = false
  })
  await mark.click()
  await expect.poll(() => last(page, 'goTo')).toMatchObject({ id: 11, front: true })

  // Closed altogether: the place shown, nothing started.
  await page.evaluate(() => {
    window.__programWindows = []
  })
  const asked = (await calls(page)).filter((call) => call.name === 'goTo').length
  await mark.click()
  await expect(shown).toContainText('slide 2')
  expect((await calls(page)).filter((call) => call.name === 'goTo')).toHaveLength(asked)
  await shown.getByRole('button', { name: 'Close' }).click()

  // × takes the places off the line, one undo step.
  await mark.hover()
  await page.getByRole('button', { name: 'Take the places off this line' }).click()
  await expect(mark).toHaveCount(0)
  expect(await moments(page)).toEqual([undefined, undefined, undefined])
  await page.keyboard.press('Control+z')
  await expect(mark).toBeVisible()
})

test('each family’s mark says its place; a web page with its program closed opens in the person’s browser; another scheme never does', async ({ page }) => {
  await withPen(page)
  await page.evaluate(() => {
    window.open = ((address: string) => {
      window.__opened = address
      return null
    }) as typeof window.open
    window.__programWindows!.push({ id: 15, title: 'Waves - Google Chrome', program: 'chrome.exe', left_out: null })
  })
  await page.getByRole('button', { name: 'Program panel' }).click()
  await page.getByRole('button', { name: /^Waves - Google Chrome/u }).click()
  await expect(page.locator('.nw-program-body')).toHaveAttribute('data-state', 'held')
  const lineAt = async (place: unknown, down: number): Promise<void> => {
    await page.evaluate((place) => {
      window.__programPlace = place
    }, place)
    await page.waitForTimeout(1050)
    await writeLine(page, down)
  }
  await lineAt({ address: 'https://www.example.com/waves?x=1' }, 120)
  await lineAt({ page: 4, file: 'https://arxiv.org/pdf/1234.5678' }, 220)
  await lineAt({ file: 'C:/project/waves.ts', line: 42 }, 320)
  await lineAt({ address: 'file:///C:/notes/My%20Page.html' }, 420)
  await lineAt({ address: 'javascript:alert(1)' }, 520)
  for (const words of ['↩ example.com', '↩ p. 4', '↩ waves.ts:42', '↩ My Page.html']) await expect(page.locator('.nw-program-mark button', { hasText: words })).toBeVisible()

  // The panel closed, no such program open: a web page opens in the person's own browser, at its page; others show the place.
  await page.getByRole('button', { name: 'Close the program' }).click()
  await page.evaluate(() => {
    window.__programWindows = []
  })
  await page.locator('.nw-program-mark button', { hasText: '↩ example.com' }).click()
  await expect.poll(() => page.evaluate(() => window.__opened)).toBe('https://www.example.com/waves?x=1')
  await page.locator('.nw-program-mark button', { hasText: '↩ p. 4' }).click()
  await expect.poll(() => page.evaluate(() => window.__opened)).toBe('https://arxiv.org/pdf/1234.5678#page=4')
  await page.evaluate(() => {
    window.__opened = undefined
  })
  await page.locator('.nw-program-mark button', { hasText: 'javascript' }).click()
  await expect(page.getByRole('dialog', { name: 'Where this line was written' })).toBeVisible()
  expect(await page.evaluate(() => window.__opened)).toBeUndefined()
})

test('the words of each place are kept once, from the program or else its picture, beside it in the note; shown under the transcript, with a way back', async ({ page }) => {
  await withPen(page)
  await page.evaluate(() => {
    window.__programPlace = { slide: 257, n: 2 }
    window.__programWords = 'Waves carry energy'
  })
  await hold(page)
  await writeLine(page)
  const places = async () => (await programs(page))?.[0]?.places
  await expect.poll(places).toEqual([{ place: { slide: 257, n: 2 }, words: 'Waves carry energy' }])

  // The same place again: asked once. Its number changed, it is the same slide.
  await page.waitForTimeout(1050)
  await page.evaluate(() => {
    window.__programPlace = { slide: 257, n: 5 }
    window.__programWords = 'Words read again'
  })
  await writeLine(page, 320)
  await expect.poll(async () => (await moments(page)).length).toBe(6)
  await page.waitForTimeout(100)
  expect((await calls(page)).filter((call) => call.name === 'wordsOf')).toHaveLength(1)
  expect(await places()).toHaveLength(1)

  // Another place the program gives no words for: what its picture shows, read from the last frame kept.
  await page.waitForTimeout(1050)
  await page.evaluate(() => {
    window.__programPlace = { slide: 258, n: 6 }
    window.__programWords = null
    window.__pictureWords = '  What the picture shows '
  })
  await writeLine(page, 420)
  await expect.poll(async () => (await places())?.length).toBe(2)
  expect((await places())![1]).toEqual({ place: { slide: 258, n: 6 }, words: 'What the picture shows' })
  expect(await last(page, 'readPicture')).toEqual({ name: 'readPicture', size: [40, 30, 40 * 30 * 4] })

  // Shown under the transcript; ↩ goes back by the person's tap.
  await page.getByRole('button', { name: 'Side panel', exact: true }).click()
  await page.getByRole('tab', { name: 'Transcript' }).click()
  const shown = page.getByRole('region', { name: 'What the programs showed' })
  await expect(shown).toContainText('Waves carry energy')
  await expect(shown).toContainText('What the picture shows')
  await shown.getByRole('button', { name: '↩ slide 2' }).click()
  await expect.poll(() => last(page, 'goTo')).toMatchObject({ id: 11, place: { slide: 257, n: 2 } })
})

test('a small picture is kept with a line when the view changed, never while a password box shows, and goes with its places', async ({ page }) => {
  await withPen(page)
  const paint = (colour: number[]) =>
    page.evaluate((colour) => {
      window.__programFrame!({ id: 11, width: 40, height: 30, rgba: Uint8ClampedArray.from({ length: 40 * 30 * 4 }, (_, i) => colour[i % 4]!) })
    }, colour)
  await page.evaluate(() => {
    window.__programPlace = { slide: 257, n: 2 }
    window.__programPassword = true
  })
  await hold(page)
  const pictures = async () => (await moments(page)).map((moment) => moment?.pic)
  const assets = () => page.evaluate(() => Object.keys(window.__shellnote!.doc.asset))

  // A password box shows: none kept.
  await writeLine(page, 120)
  await expect.poll(async () => (await moments(page)).length).toBe(3)
  await page.waitForTimeout(100)
  expect((await pictures()).filter(Boolean)).toEqual([])

  // Gone: the next stroke's pen lands with the picture being made, and a later stroke of the line keeps it. One picture.
  await page.evaluate(() => {
    window.__programPassword = false
  })
  await writeLine(page, 220)
  await expect.poll(async () => (await moments(page)).length).toBe(6)
  await expect.poll(async () => (await pictures()).filter(Boolean).length).toBe(1)
  const [first] = await assets()
  expect(await page.evaluate((hash) => window.__shellnote!.doc.asset[hash!], first)).toMatchObject({ mime: expect.stringMatching(/^image\/(webp|png)$/u), w: 40, h: 30 })

  // The same view: no more pictures, though more lines are written.
  await writeLine(page, 320)
  await expect.poll(async () => (await moments(page)).length).toBe(9)
  await page.waitForTimeout(100)
  expect((await pictures()).filter(Boolean)).toHaveLength(1)

  // Another view: one more.
  await paint([255, 255, 255, 255])
  await writeLine(page, 420)
  await expect.poll(async () => (await moments(page)).length).toBe(12)
  await expect.poll(async () => (await pictures()).filter(Boolean).length).toBe(2)
  expect(await assets()).toHaveLength(2)

  // The same picture but another place (a next slide may look all but the same): one more.
  await page.waitForTimeout(1050)
  await page.evaluate(() => {
    window.__programPlace = { slide: 258, n: 3 }
  })
  await writeLine(page, 520)
  await expect.poll(async () => (await moments(page)).length).toBe(15)
  await expect.poll(async () => (await pictures()).filter(Boolean).length).toBe(3)
  await page.waitForTimeout(1050)
  await page.evaluate(() => {
    window.__programPlace = { slide: 257, n: 2 }
  })

  // A program that cannot go back shows the line's picture.
  await page.evaluate(() => {
    window.__programStays = true
  })
  const marks = page.getByRole('button', { name: /^Back to slide 2 of Lecture 4\.pptx/u })
  await marks.last().click()
  const shown = page.getByRole('dialog', { name: 'Where this line was written' })
  await expect(shown.getByRole('img')).toBeVisible()
  await shown.getByRole('button', { name: 'Close' }).click()

  // × takes a line's places off, and its picture once no other line keeps it (the last two lines show the same frame, so
  // they keep one picture): one undo step each.
  const takeOff = async (mark: typeof marks): Promise<void> => {
    await mark.hover()
    await mark.locator('..').getByRole('button', { name: 'Take the places off this line' }).click()
  }
  await takeOff(marks.last())
  await expect.poll(async () => (await pictures()).filter(Boolean).length).toBe(2)
  expect(await assets()).toHaveLength(2)
  await takeOff(page.getByRole('button', { name: /^Back to slide 3 of Lecture 4\.pptx/u }))
  await expect.poll(async () => (await assets()).length).toBe(1)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await assets()).length).toBe(2)
  await expect.poll(async () => (await pictures()).filter(Boolean).length).toBe(2)
})

test('the panel shows its mark while lines keep a program’s place, and only then', async ({ page }) => {
  await withPen(page)
  await page.getByRole('button', { name: 'Program panel' }).click()
  await expect(page.locator('.nw-program-keeping')).toHaveCount(0)
  await page.getByRole('button', { name: /^Lecture 4\.pptx/u }).click()
  await expect(page.locator('.nw-program-keeping')).toBeVisible()
  await page.getByRole('button', { name: 'Let the program go' }).click()
  await expect(page.locator('.nw-program-keeping')).toHaveCount(0)
})

test('closing the panel lets the program go', async ({ page }) => {
  await withStandIn(page)
  await hold(page)
  await page.getByRole('button', { name: 'Close the program' }).click()
  await expect(page.locator('.nw-program')).toHaveCount(0)
  expect(await last(page, 'letGo')).toEqual({ name: 'letGo', id: 11 })
})
