// The check of other programs on a panel (src-tauri/src/apps.rs, stage 1), in the app as built: a test window of its
// own (apps-check.ps1, titled "shellnote-apps-check") held on a box of the page, then each thing stage 1 promises
// measured: placed 0 px off; placed again as ShellNote's window moves, from the Rust side; placed on a new box; above
// ShellNote when ShellNote comes in front; hidden and shown with it; its title change and the person's move told to
// the page (and the program left where the person put it); let go with its owner removed and
// shown; its closing told; a window of ShellNote itself refused; held through a change of the page's # route, let go by a
// reload; and let go, still open, when ShellNote closes. The
// app runs with a data folder of its own; nothing but its own test window is held or moved.
//
//   node run.mjs apps     (SHELLNOTE_TARGET=check for the check copy)
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const here = fileURLToPath(new URL('.', import.meta.url))
const exe = process.env.SHELLNOTE_EXE ?? join(here, 'src-tauri/target/release/shellnote.exe')
/** WebView2's developer port for this check: the smoke test has 9333. */
const CDP_PORT = 9334
const TITLE = 'shellnote-apps-check'

if (!existsSync(exe)) {
  console.error(`No built app at ${exe}. Build it first: corepack pnpm desktop:build`)
  process.exit(1)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A PDF of `pages` blank pages, for the place check: the smallest a viewer opens. */
function tinyPdf(pages) {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ')
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`, ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >>')]
  let out = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`
  return `${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}

/** The helper: one line asked, one line of JSON answered. */
const helper = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'apps-check.ps1')], { stdio: ['pipe', 'pipe', 'inherit'] })
const lines = createInterface({ input: helper.stdout })
const answers = []
let waiting
lines.on('line', (line) => {
  if (waiting) {
    const resolve = waiting
    waiting = undefined
    resolve(JSON.parse(line))
  } else answers.push(line)
})
const ask = (question) =>
  new Promise((resolve, reject) => {
    waiting = resolve
    helper.stdin.write(`${question}\n`)
    setTimeout(() => reject(new Error(`the helper did not answer "${question}"`)), 20_000)
  })

const data = mkdtempSync(join(tmpdir(), 'shellnote-apps-check-'))
const env = { ...process.env, SHELLNOTE_BROWSER_ARGS: `--remote-debugging-port=${CDP_PORT}`, WEBVIEW2_USER_DATA_FOLDER: data }
const app = spawn(exe, [], { env, stdio: 'ignore' })

async function connect() {
  const until = Date.now() + 30_000
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
    } catch (error) {
      if (Date.now() > until) throw error
      await wait(250)
    }
  }
}

const results = []
const check = (name, ok, detail = '') => results.push({ check: name, result: ok ? 'pass' : 'FAIL', detail })
/** The largest distance, in pixels, between two boxes' edges. */
const off = (a, b) => Math.max(Math.abs(a.l - b.l), Math.abs(a.t - b.t), Math.abs(a.r - b.r), Math.abs(a.b - b.b))

/**
 * The watchers waiting on the ShellNote of process `pid` (ShellNote started as `--watch`), each with its
 * parent's process number: no child of ShellNote', so ending ShellNote with all it started leaves it.
 */
function watchersOf(pid) {
  const listed = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='shellnote.exe'" | ForEach-Object { "$($_.ParentProcessId) $($_.CommandLine)" }`], { encoding: 'utf8' }).stdout
  return listed
    .split(/\r?\n/u)
    .filter((line) => line.includes(`--watch ${pid} `))
    .map((line) => ({ parent: Number(line.split(' ')[0]) }))
}

/** `watchersOf(pid)` once it has `count` of them, or after 3 s. */
async function watchersBecome(pid, count) {
  let found = watchersOf(pid)
  for (let i = 0; i < 20 && found.length !== count; i++) {
    await wait(150)
    found = watchersOf(pid)
  }
  return found
}

let browser
try {
  const test = (await ask('new')).hwnd
  // Its own place and size before any panel: given back when it is let go.
  const firstSeen = await ask(`seen ${test}`)
  browser = await connect()
  const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].waitForEvent('page'))
  await page.getByRole('button', { name: /new note/iu }).first().waitFor({ timeout: 30_000 })
  const host = (await ask(`main ${app.pid}`)).hwnd

  // What the Rust side tells the page, gathered as it comes.
  await page.evaluate(async () => {
    const internals = window.__TAURI_INTERNALS__
    window.appsTold = []
    const handler = internals.transformCallback((event) => window.appsTold.push(event.payload))
    await internals.invoke('plugin:event|listen', { event: 'apps', target: { kind: 'Any' }, handler })
  })
  const told = () => page.evaluate(() => window.appsTold)
  const invoke = (command, args) =>
    page.evaluate(([command, args]) => window.__TAURI_INTERNALS__.invoke(command, args).then((value) => ({ value }), (error) => ({ error: String(error) })), [command, args])
  /**
   * Where a box of the page is on the screen: the page's origin plus the box, given in the screen's pixels (the page's
   * CSS box times its devicePixelRatio, which follows the page's zoom). Each box below is given so: a panel's element
   * at 100 % zoom and 125 % scale would give these numbers too.
   */
  const expected = async (area) => {
    const origin = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|inner_position', { label: 'main' }))
    const l = origin.x + Math.round(area.x)
    const t = origin.y + Math.round(area.y)
    return { l, t, r: l + Math.round(area.width), b: t + Math.round(area.height) }
  }

  const listed = (await invoke('apps_list')).value ?? []
  const mine = listed.find((w) => w.title === TITLE)
  check('the test window is listed, free to hold', mine?.id === test && mine.left_out === null, `${listed.length} windows; ${JSON.stringify(mine)}`)
  // Its icon for the list, as the taskbar shows it: 32 by 32 RGBA pixels, some of them seen.
  const icon = await page.evaluate(
    (id) =>
      window.__TAURI_INTERNALS__.invoke('apps_icon', { id }).then(
        (bytes) => {
          const all = new Uint8Array(bytes)
          let seen = 0
          for (let i = 3; i < all.length; i += 4) if (all[i] > 0) seen++
          return { bytes: all.length, seen }
        },
        (error) => ({ error: String(error) }),
      ),
    test,
  )
  check('its icon, as the taskbar shows it', icon.bytes === 32 * 32 * 4 && icon.seen > 0, JSON.stringify(icon))

  let area = { x: 420, y: 120, width: 520, height: 360 }
  const started = Date.now()
  const held = await invoke('apps_hold', { id: test, area, border: 0x466ea0 })
  const took = Date.now() - started
  await wait(300)
  let seen = await ask(`seen ${test}`)
  check('held: placed on the box', !held.error && off(seen, await expected(area)) === 0, `${held.error ?? 'held'} in ${took} ms; off by ${off(seen, await expected(area))} px`)
  // Its watcher, started with the first program held.
  const watchers = await watchersBecome(app.pid, 1)
  check('held: its watcher started, no child of ShellNote', watchers.length === 1 && watchers[0].parent !== app.pid, `${watchers.length} waiting on ShellNote; its parent ${watchers[0]?.parent}, ShellNote ${app.pid}`)
  check('held: owned by ShellNote', (await ask(`owner ${test}`)).owner === host)
  // The test window was opened before ShellNote, so it starts behind it, as a program the person picks from ShellNote.
  const centre = (box) => `${Math.round((box.l + box.r) / 2)} ${Math.round((box.t + box.b) / 2)}`
  const atFirst = (await ask(`at ${centre(await expected(area))}`)).hwnd
  check('held: seen on its box at once, above ShellNote', atFirst === test, atFirst === test ? 'the program' : atFirst === host ? 'shellnote' : String(atFirst))
  const again = await invoke('apps_hold', { id: test, area, border: null })
  check('held twice: refused', Boolean(again.error), again.error)

  // ShellNote's window moved, as the person drags it: the program follows, placed from the Rust side.
  let worst = 0
  for (let i = 0; i < 8; i++) {
    await ask(`nudge ${host} ${i % 2 === 0 ? 60 : -40} ${i % 4 < 2 ? 30 : -30}`)
    await wait(150)
    seen = await ask(`seen ${test}`)
    worst = Math.max(worst, off(seen, await expected(area)))
  }
  check("ShellNote's window moved 8 times: the program followed", worst <= 1, `off by ${worst} px at most, 150 ms after each move`)

  // The panel's box changed on the page.
  area = { x: 300, y: 90, width: 600, height: 420 }
  const placed = await invoke('apps_place', { id: test, area })
  await wait(200)
  seen = await ask(`seen ${test}`)
  check('the box changed: placed on the new one', !placed.error && off(seen, await expected(area)) === 0, `${placed.error ?? ''} off by ${off(seen, await expected(area))} px`)

  // ShellNote in front: the program still seen on its box, above it.
  const box = await expected(area)
  const front = await ask(`front ${host}`)
  await wait(300)
  const there = (await ask(`at ${centre(box)}`)).hwnd
  check('shellnote in front: the program seen on its box', front.front && there === test, `shellnote in front ${front.front}; seen there ${there === test ? 'the program' : there === host ? 'shellnote' : there}`)

  // Minimised with ShellNote, shown with it again.
  await ask(`show ${host} 6`)
  const hidden = !(await ask(`visible ${test}`)).visible
  await ask(`show ${host} 9`)
  await wait(400)
  const shown = (await ask(`visible ${test}`)).visible
  seen = await ask(`seen ${test}`)
  check('minimised with ShellNote, back with it', hidden && shown && off(seen, await expected(area)) <= 1, `hidden ${hidden}, shown again ${shown}, off by ${off(seen, await expected(area))} px`)

  // Covered by something of the page (a menu over the panel, stage 2): hidden, then shown on its box again.
  const cover = await invoke('apps_cover', { id: test, covered: true })
  await wait(200)
  const covered = !(await ask(`visible ${test}`)).visible
  const uncover = await invoke('apps_cover', { id: test, covered: false })
  await wait(300)
  const back = (await ask(`visible ${test}`)).visible
  seen = await ask(`seen ${test}`)
  check('covered by the page: hidden, then back on its box', !cover.error && !uncover.error && covered && back && off(seen, await expected(area)) === 0, `${cover.error ?? uncover.error ?? ''} hidden ${covered}, back ${back}, off by ${off(seen, await expected(area))} px`)

  // A program that stops answering while a menu of ShellNote opens over the panel: ShellNote must answer at once,
  // whatever the program does (9.5: ShowWindow waits for the program). Its window hidden and back once it answers.
  await ask('hang 4000')
  await wait(300)
  let since = Date.now()
  const hungCover = await invoke('apps_cover', { id: test, covered: true })
  const coverMs = Date.now() - since
  since = Date.now()
  const hungBack = await invoke('apps_cover', { id: test, covered: false })
  const backMs = Date.now() - since
  await wait(4500)
  seen = await ask(`seen ${test}`)
  const backAfter = (await ask(`visible ${test}`)).visible
  check('a hung program covered and back: ShellNote answers at once', !hungCover.error && !hungBack.error && coverMs < 500 && backMs < 500, `${hungCover.error ?? hungBack.error ?? ''} covered in ${coverMs} ms, back in ${backMs} ms`)
  check('the hung program, answering again: shown on its box', backAfter && off(seen, await expected(area)) <= 1, `shown ${backAfter}, off by ${off(seen, await expected(area))} px`)

  // Its title changed, and the person dragged it off: both told to the page; the program left where the person put it.
  await ask('retitle shellnote-apps-check, page 2')
  await wait(400)
  const before = await ask(`seen ${test}`)
  // Up to here every move was ShellNote's own (held, followed, the new box, minimised and back): none is told.
  const ownMoves = (await told()).filter((e) => e.kind === 'moved').length
  await ask('drag 90 40')
  await wait(500)
  const after = await ask(`seen ${test}`)
  const events = await told()
  const title = events.find((e) => e.kind === 'title')
  const moved = events.find((e) => e.kind === 'moved')
  check("its title change told to the page", title?.title === 'shellnote-apps-check, page 2', JSON.stringify(title))
  check('the person moved it: told, and left there (pick xd)', moved?.id === test && after.l - before.l === 90, `${JSON.stringify(moved)}; moved ${after.l - before.l} px`)
  check("none of ShellNote's own placings told as the person's", ownMoves === 0, `${ownMoves} told before the drag; ${events.filter((e) => e.kind === 'moved').length} after it (its left, then its top)`)

  // Let go: its owner removed, shown, not held any more.
  const gone = await invoke('apps_let_go', { id: test })
  await wait(400)
  const backHome = await ask(`seen ${test}`)
  check('let go: owner removed, shown, back in its own place and size', !gone.error && (await ask(`owner ${test}`)).owner === 0 && (await ask(`visible ${test}`)).visible && off(backHome, firstSeen) <= 1, `${gone.error ?? ''} off its own place by ${off(backHome, firstSeen)} px`)

  // Held again, then closed: told to the page, and gone from the list.
  await invoke('apps_hold', { id: test, area, border: null })
  await ask('close')
  await wait(800)
  const closed = (await told()).find((e) => e.kind === 'closed')
  const after2 = (await invoke('apps_list')).value ?? []
  check('it closed: told to the page', closed?.id === test && !after2.some((w) => w.id === test), JSON.stringify(closed))

  const own = await invoke('apps_hold', { id: host, area, border: null })
  check("a window of ShellNote itself: refused", Boolean(own.error), own.error)

  // Maximised before the panel: maximised again when let go (its state given back, not only its place).
  const big = (await ask('new')).hwnd
  await ask(`show ${big} 3`)
  const wasZoomed = (await ask(`zoomed ${big}`)).zoomed
  await invoke('apps_hold', { id: big, area, border: null })
  await wait(300)
  const zoomedOnPanel = (await ask(`zoomed ${big}`)).zoomed
  await invoke('apps_let_go', { id: big })
  await wait(500)
  const zoomedAfter = (await ask(`zoomed ${big}`)).zoomed
  check('maximised before the panel: maximised again when let go', wasZoomed && !zoomedOnPanel && zoomedAfter, `before ${wasZoomed}, on the panel ${zoomedOnPanel}, after ${zoomedAfter}`)
  await ask('close')
  // Let go without restore, as when the person drags it off by its title bar: it stays where it is.
  const dragged = (await ask('new')).hwnd
  await invoke('apps_hold', { id: dragged, area, border: null })
  await wait(300)
  const onBox = await ask(`seen ${dragged}`)
  await invoke('apps_let_go', { id: dragged, restore: false })
  await wait(400)
  const leftThere = await ask(`seen ${dragged}`)
  check('let go as dragged off: it stays where it is', off(leftThere, onBox) <= 1 && (await ask(`owner ${dragged}`)).owner === 0, `off by ${off(leftThere, onBox)} px from where it was`)
  await ask('close')

  // Its live picture (stage 3, without cropping, xq1). The page listens as desktop.ts does: the two
  // buffers WebView2 shares once, then each frame named; here the middle pixel of each, and when it came.
  await page.evaluate(() => {
    window.pictureCheck = { buffers: {}, frames: [] }
    window.chrome.webview.addEventListener('sharedbufferreceived', (event) => {
      const told = event.additionalData
      ;(window.pictureCheck.buffers[told.shellnotePicture] ??= [])[told.buffer] = event.getBuffer()
    })
    window.chrome.webview.addEventListener('message', (event) => {
      const told = event.data
      if (told?.shellnotePicture === undefined || told.width === undefined) return
      const bytes = new Uint8Array(window.pictureCheck.buffers[told.shellnotePicture]?.[told.buffer] ?? new ArrayBuffer(0))
      const i = ((told.height >> 1) * told.width + (told.width >> 1)) * 4
      window.pictureCheck.frames.push({ id: told.shellnotePicture, width: told.width, height: told.height, middle: [bytes[i], bytes[i + 1], bytes[i + 2]] })
    })
  })
  const frames = (id) => page.evaluate((id) => window.pictureCheck.frames.filter((frame) => frame.id === id), id)
  const near = (a, b) => Array.isArray(a) && a.every((v, i) => Math.abs(v - b[i]) <= 8)
  const processor = () => Number(spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CPU`], { encoding: 'utf8' }).stdout.trim())

  // Elsewhere: a window not held, pictured where it is, neither moved nor owned.
  const elsewhere = (await ask('new')).hwnd
  await ask('paint 30 160 90')
  await wait(300)
  const elsewhereWas = await ask(`seen ${elsewhere}`)
  const asked = Date.now()
  const pictured = await invoke('apps_picture', { id: elsewhere, width: 400, height: 300, seen: true })
  let first
  for (let i = 0; i < 40 && !first; i++) {
    first = (await frames(elsewhere))[0]
    if (!first) await wait(50)
  }
  const firstAfter = Date.now() - asked
  check('elsewhere: its picture on the page, the window neither moved nor owned', !pictured.error && near(first?.middle, [30, 160, 90]) && off(await ask(`seen ${elsewhere}`), elsewhereWas) === 0 && (await ask(`owner ${elsewhere}`)).owner === 0, `${pictured.error ?? ''} first frame in ${firstAfter} ms, ${first?.width}x${first?.height}, its middle ${JSON.stringify(first?.middle)}`)

  // While it changes, about 60 times a second: frames reaching the page, at most 30 a second; ShellNote's processor.
  const framesBefore = (await frames(elsewhere)).length
  const cpuBefore = processor()
  await ask('flicker 3000')
  await wait(3000)
  const cpuAfter = processor()
  const rate = ((await frames(elsewhere)).length - framesBefore) / 3
  check('while it changes: up to 30 frames a second reach the page', rate >= 15 && rate <= 31, `${rate.toFixed(1)} frames a second; ShellNote's own processor time ${(((cpuAfter - cpuBefore) / 3) * 100).toFixed(0)}% of one core`)
  // Still: no frame made.
  await wait(800)
  const stillBefore = (await frames(elsewhere)).length
  await wait(2000)
  const stillFrames = (await frames(elsewhere)).length - stillBefore
  check('still: no frames', stillFrames <= 1, `${stillFrames} in 2 s`)
  await invoke('apps_picture_stop', { id: elsewhere })
  await wait(800)
  const running = (await invoke('apps_pictures_running')).value
  check('stopped: no picture running', running === 0, `${running} running`)
  await ask('close')

  // Covered: a held window's picture kept at two frames a second while it is seen, so its last picture is there.
  const underneath = (await ask('new')).hwnd
  await invoke('apps_hold', { id: underneath, area, border: null })
  await invoke('apps_picture', { id: underneath, width: Math.round(area.width), height: Math.round(area.height), seen: false })
  await ask('paint 200 50 50')
  await wait(1400)
  await invoke('apps_cover', { id: underneath, covered: true })
  await wait(300)
  const lastFrame = (await frames(underneath)).at(-1)
  check('covered: its last picture is there, the window hidden', near(lastFrame?.middle, [200, 50, 50]) && !(await ask(`visible ${underneath}`)).visible, `the last frame's middle ${JSON.stringify(lastFrame?.middle)}`)
  await invoke('apps_cover', { id: underneath, covered: false })
  await invoke('apps_picture_stop', { id: underneath })
  await invoke('apps_let_go', { id: underneath })
  await ask('close')

  // A change of the page's # route (how the app goes between its screens) loads no page: the program stays held. A
  // reload (F5, Ctrl+R, the stroke recorder, a sample note) starts a new page that knows nothing of it: it is let go
  // (25 October 2026: it stayed held over ShellNote, and nothing on the new page could let it go).
  const third = (await ask('new')).hwnd
  await invoke('apps_hold', { id: third, area, border: 0x466ea0 })
  await wait(300)
  await page.evaluate(() => {
    location.hash = '#apps-check'
  })
  await wait(600)
  check("the page's # route changed: still held", (await ask(`owner ${third}`)).owner === host, `owner ${(await ask(`owner ${third}`)).owner === host ? 'shellnote' : 'none'}`)
  await invoke('apps_picture', { id: third, width: 300, height: 200, seen: false })
  await page.reload({ waitUntil: 'load' })
  await page.getByRole('button', { name: /new note/iu }).first().waitFor({ timeout: 30_000 })
  await wait(400)
  const afterReload = (await invoke('apps_pictures_running')).value
  check('the page reloaded: no picture running', afterReload === 0, `${afterReload} running`)
  const reloadedOwner = (await ask(`owner ${third}`)).owner
  const reloadedShown = (await ask(`visible ${third}`)).visible
  const relisted = ((await invoke('apps_list')).value ?? []).find((w) => w.id === third)
  check('the page reloaded: let go, shown, free to hold again', reloadedOwner === 0 && reloadedShown && relisted?.left_out === null, `owner ${reloadedOwner === 0 ? 'none' : reloadedOwner}; shown ${reloadedShown}; listed ${JSON.stringify(relisted)}`)
  // The helper's close is its newest window's: this one.
  await ask('close')
  await wait(300)

  // Private browser windows: never listed, held nor pictured.
  // Chrome's Incognito says so only in its own toolbar, read once through UI Automation. Two Chrome windows, each with an
  // empty profile of its own in the temporary folder (never the person's own), one Incognito; both closed after.
  const windowOf = async (pid) => {
    for (let i = 0; i < 40; i++) {
      const handle = Number(spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).MainWindowHandle.ToInt64()`], { encoding: 'utf8' }).stdout.trim())
      if (handle) return handle
      await wait(250)
    }
    return 0
  }
  const chromeFile = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((file) => existsSync(file))
  if (chromeFile) {
    const chromes = [true, false].map((incognito) => {
      const profile = mkdtempSync(join(tmpdir(), 'shellnote-apps-check-chrome-'))
      const proc = spawn(chromeFile, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...(incognito ? ['--incognito'] : []), '--new-window', 'about:blank'], { stdio: 'ignore' })
      return { incognito, profile, proc }
    })
    try {
      const [incognito, normal] = await Promise.all(chromes.map((chrome) => windowOf(chrome.proc.pid)))
      // The toolbar is read on a thread of its own: listed as being checked until then; read within 8 s.
      let seen = []
      for (let i = 0; i < 32; i++) {
        seen = (await invoke('apps_list')).value ?? []
        if (seen.some((w) => w.id === normal && w.left_out === null)) break
        await wait(250)
      }
      const incognitoListed = seen.find((w) => w.id === incognito)
      const normalListed = seen.find((w) => w.id === normal)
      check('a Chrome Incognito window: never listed; a normal one listed once read', incognito !== 0 && !incognitoListed && normalListed?.left_out === null, `Incognito ${incognito ? (incognitoListed ? `listed, ${incognitoListed.left_out}` : 'not listed') : 'not found'}; normal ${normalListed ? `listed, ${normalListed.left_out ?? 'free to hold'}` : 'not listed'}`)
      const holdPrivate = await invoke('apps_hold', { id: incognito, area, border: null })
      const picturePrivate = await invoke('apps_picture', { id: incognito, width: 300, height: 200, seen: true })
      check('a Chrome Incognito window: neither held nor pictured, even asked without the list', Boolean(holdPrivate.error) && Boolean(picturePrivate.error) && (await ask(`owner ${incognito}`)).owner === 0, `${holdPrivate.error}; ${picturePrivate.error}`)
    } finally {
      for (const chrome of chromes) spawnSync('taskkill', ['/PID', String(chrome.proc.pid), '/T', '/F'], { stdio: 'ignore' })
      await wait(1500)
      for (const chrome of chromes) rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    }
  } else {
    check('a Chrome Incognito window: never listed (Chrome not installed: not tried)', true, 'not tried')
  }

  // What a picture shows, read by Windows' own text reading, on this computer: a frame the page has, as it has it. A
  // size that does not fit the bytes is refused. VS Code and other programs give words only so.
  const readThe = (width, height, bytes) =>
    page.evaluate(
      ([width, height, bytes]) => {
        const canvas = document.createElement('canvas')
        canvas.width = 600
        canvas.height = 120
        const context = canvas.getContext('2d')
        context.fillStyle = '#fff'
        context.fillRect(0, 0, 600, 120)
        context.fillStyle = '#000'
        context.font = '40px Arial'
        context.fillText('Waves carry energy', 20, 70)
        const rgba = context.getImageData(0, 0, 600, 120).data
        return window.__TAURI_INTERNALS__
          .invoke('apps_read_picture', new Uint8Array(rgba.buffer, 0, bytes), { headers: { 'x-width': String(width), 'x-height': String(height) } })
          .then((value) => ({ value }), (error) => ({ error: String(error) }))
      },
      [width, height, bytes],
    )
  const pictureRead = await readThe(600, 120, 600 * 120 * 4)
  const pictureWrong = await readThe(600, 121, 600 * 120 * 4)
  check("a picture's words, read by Windows on this computer", /Waves\s+carry\s+energy/u.test(pictureRead.value ?? ''), JSON.stringify(pictureRead))
  check("a picture of the wrong size: refused", Boolean(pictureWrong.error), JSON.stringify(pictureWrong))

  // Stage 4, each family's place, as read when a line is written: a page's address and a PDF's page, in Chrome and in
  // Edge, each with an empty profile of its own in the temporary folder; PowerPoint's slide, in a deck of three made for
  // the check and closed after (PowerPoint left as it was). VS Code's file is read from its title alone (a unit test).
  const files = mkdtempSync(join(tmpdir(), 'shellnote-apps-check-place-'))
  writeFileSync(join(files, 'place.html'), '<!doctype html><title>A place</title><p>A page for the place check.</p><input type=password value=sekret>')
  writeFileSync(join(files, 'place.pdf'), tinyPdf(3))
  const fileUrl = (name) => pathToFileURL(join(files, name)).href
  const papers = createServer((_, answer) => {
    answer.writeHead(200, { 'content-type': 'application/pdf' })
    answer.end(tinyPdf(4))
  })
  await new Promise((resolve) => papers.listen(0, '127.0.0.1', resolve))
  const placeOf = async (id, want) => {
    let place
    for (let i = 0; i < 40; i++) {
      place = await invoke('apps_place_of', { id })
      if (want(place.value)) break
      await wait(250)
    }
    return place
  }
  const edgeFile = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((file) => existsSync(file))
  for (const [browser, file] of [['Chrome', chromeFile], ['Edge', edgeFile]]) {
    if (!file) {
      check(`${browser}: a page's address and a PDF's page (not installed: not tried)`, true, 'not tried')
      continue
    }
    const profile = mkdtempSync(join(tmpdir(), 'shellnote-apps-check-place-profile-'))
    const proc = spawn(file, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', fileUrl('place.html')], { stdio: 'ignore' })
    try {
      const id = await windowOf(proc.pid)
      // Listed first (a Chrome window once its toolbar is read): only a window the list offers has a place.
      for (let i = 0; i < 32 && !((await invoke('apps_list')).value ?? []).some((w) => w.id === id && w.left_out === null); i++) await wait(250)
      // Said when it is not: whether the browser's window was found at all, and what the list offers in its place (a
      // browser may hand over to another process as it starts, and then the one started has no window).
      const listed = (await invoke('apps_list')).value ?? []
      if (!listed.some((w) => w.id === id)) check(`${browser}: its window is on the list`, false, `the window asked for: ${id || 'none found for the process started'}; the list offers: ${JSON.stringify(listed.map((w) => `${w.program} "${w.title}" ${w.left_out ?? ''}`.trim()))}`)
      const address = await placeOf(id, (place) => place?.address === fileUrl('place.html'))
      check(`${browser}: a page's address`, address.value?.address === fileUrl('place.html'), JSON.stringify(address))
      // Its words, as a line is written there: the page's own, never a password box's.
      let pageWords
      for (let i = 0; i < 20 && !pageWords?.value?.includes('place check'); i++) {
        pageWords = await invoke('apps_words_of', { id })
        if (!pageWords.value) await wait(250)
      }
      check(`${browser}: a page's words, never a password's`, Boolean(pageWords?.value?.includes('A page for the place check')) && !pageWords?.value?.includes('sekret'), JSON.stringify(pageWords))
      // The PDF at its second page, in a new tab of the same window.
      spawn(file, [`--user-data-dir=${profile}`, `${fileUrl('place.pdf')}#page=2`], { stdio: 'ignore' })
      const pdf = await placeOf(id, (place) => place?.page === 2)
      check(`${browser}: a PDF's page, in its own viewer`, pdf.value?.page === 2 && pdf.value?.file === fileUrl('place.pdf'), JSON.stringify(pdf))
      // A small picture may be kept of a page, but never while it shows a password box (place.html has one).
      await invoke('apps_go_to', { id, place: { address: fileUrl('place.html') }, front: true })
      await placeOf(id, (place) => place?.address === fileUrl('place.html'))
      const withPassword = await invoke('apps_may_keep_picture', { id })
      await invoke('apps_go_to', { id, place: { page: 2, file: fileUrl('place.pdf') }, front: true })
      await placeOf(id, (place) => place?.page === 2)
      const noPassword = await invoke('apps_may_keep_picture', { id })
      check(`${browser}: a picture may be kept, never while a password box shows`, withPassword.value === false && noPassword.value === true, `${JSON.stringify(withPassword)} ${JSON.stringify(noPassword)}`)
      // A PDF gives its whole file, not its page: none, so what is seen of it is read from its picture.
      const pdfWords = await invoke('apps_words_of', { id })
      check(`${browser}: a PDF's words come from its picture, not its whole file`, pdfWords.value === null, JSON.stringify(pdfWords))
      // A PDF whose address does not end in ".pdf" (arXiv's do not), from a server of the check's own on this computer.
      const paper = `http://127.0.0.1:${papers.address().port}/pdf/1234.5678`
      spawn(file, [`--user-data-dir=${profile}`, `${paper}#page=3`], { stdio: 'ignore' })
      const unnamed = await placeOf(id, (place) => place?.page === 3)
      check(`${browser}: a PDF's page, its address without ".pdf"`, unnamed.value?.page === 3 && unnamed.value?.file === paper, JSON.stringify(unnamed))
      // A line's mark tapped: back to its page, and to its page of the PDF, each read back from the window. A note's other
      // schemes and switches never reach the browser. A page already there opens no new tab.
      const backPage = await invoke('apps_go_to', { id, place: { address: fileUrl('place.html') }, front: true })
      const backThere = await placeOf(id, (place) => place?.address === fileUrl('place.html'))
      check(`${browser}: a line's mark, back to its page`, backPage.value === true && backThere.value?.address === fileUrl('place.html'), `${JSON.stringify(backPage)} ${JSON.stringify(backThere)}`)
      const backPdf = await invoke('apps_go_to', { id, place: { page: 2, file: fileUrl('place.pdf') }, front: true })
      const backOnPage = await placeOf(id, (place) => place?.page === 2)
      check(`${browser}: a line's mark, back to its page of a PDF`, backPdf.value === true && backOnPage.value?.page === 2 && backOnPage.value?.file === fileUrl('place.pdf'), `${JSON.stringify(backPdf)} ${JSON.stringify(backOnPage)}`)
      const refused = await Promise.all(['--gpu-launcher=calc.exe', 'javascript:alert(1)', 'chrome://settings'].map((address) => invoke('apps_go_to', { id, place: { address }, front: true })))
      check(`${browser}: a note's other schemes and switches go nowhere`, refused.every((one) => one.value === false), JSON.stringify(refused))
      // Lines are written many times a minute: reading a place leaves no threads behind. Chrome only: one is enough.
      if (browser === 'Chrome') {
        const threads = () => Number(spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).Threads.Count`], { encoding: 'utf8' }).stdout.trim())
        const before = threads()
        const started = Date.now()
        for (let i = 0; i < 200; i++) await invoke('apps_place_of', { id })
        const each = (Date.now() - started) / 200
        const after = threads()
        check('200 places read: no threads left behind', after <= before + 3, `${before} threads before, ${after} after; ${each.toFixed(0)} ms a read`)
      }
    } finally {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
      await wait(1500)
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    }
    // DevTools docked: a page of the window too, listed first and larger than the tab (6 November 2026): the tab's
    // address is the place, never DevTools'.
    const toolsProfile = mkdtempSync(join(tmpdir(), 'shellnote-apps-check-place-profile-'))
    const tools = spawn(file, [`--user-data-dir=${toolsProfile}`, '--no-first-run', '--no-default-browser-check', '--new-window', '--auto-open-devtools-for-tabs', fileUrl('place.html')], { stdio: 'ignore' })
    try {
      const id = await windowOf(tools.pid)
      for (let i = 0; i < 32 && !((await invoke('apps_list')).value ?? []).some((w) => w.id === id && w.left_out === null); i++) await wait(250)
      await placeOf(id, (place) => place?.address === fileUrl('place.html'))
      // DevTools takes a moment to open and be read.
      await wait(4000)
      const docked = await invoke('apps_place_of', { id })
      check(`${browser}: DevTools docked, the tab's address all the same`, docked.value?.address === fileUrl('place.html'), JSON.stringify(docked))
    } finally {
      spawnSync('taskkill', ['/PID', String(tools.pid), '/T', '/F'], { stdio: 'ignore' })
      await wait(1500)
      rmSync(toolsProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    }
  }
  papers.close()
  // VS Code: the companion, packed here and installed by VS Code's own installer into an empty profile of the
  // check's own, tells the whole path and the line; a line's mark sends VS Code back; a file only named, or not there,
  // cannot. VS Code is never read through UI Automation.
  const codeFile = [join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/Code.exe'), 'C:/Program Files/Microsoft VS Code/Code.exe'].find((file) => existsSync(file))
  if (!codeFile) {
    check('VS Code: the companion (not installed: not tried)', true, 'not tried')
  } else {
    const code = mkdtempSync(join(tmpdir(), 'shellnote-apps-check-code-'))
    const project = join(code, 'project')
    mkdirSync(project)
    const waves = join(project, 'waves.ts')
    writeFileSync(waves, Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`).join('\n'))
    const vsix = join(code, 'companion.vsix')
    spawnSync(process.execPath, [join(here, '../vscode-companion/pack.mjs'), vsix], { stdio: 'ignore' })
    const profile = [`--user-data-dir=${join(code, 'profile')}`, `--extensions-dir=${join(code, 'extensions')}`]
    const installed = spawnSync('cmd.exe', ['/d', '/c', join(dirname(codeFile), 'bin/code.cmd'), ...profile, '--install-extension', vsix], { encoding: 'utf8' })
    check('VS Code: the companion installs, packed without a new package', /successfully installed/iu.test(installed.stdout + installed.stderr), (installed.stdout + installed.stderr).trim().split('\n').at(-1) ?? '')
    const vscode = spawn(codeFile, [...profile, '--disable-workspace-trust', '--skip-welcome', '--new-window', project, '--goto', `${waves}:20`], { stdio: 'ignore' })
    try {
      let id = 0
      for (let i = 0; i < 80 && !id; i++) {
        id = ((await invoke('apps_list')).value ?? []).find((w) => w.program.toLowerCase() === 'code.exe' && w.title.includes('waves.ts'))?.id ?? 0
        if (!id) await wait(250)
      }
      // VS Code writes the drive's letter small.
      const sameFile = (file) => file?.toLowerCase() === waves.toLowerCase()
      const at = await placeOf(id, (place) => sameFile(place?.file) && place?.line === 20)
      check('VS Code: its whole path and line, from the companion', sameFile(at.value?.file) && at.value?.line === 20, JSON.stringify(at))
      const backCode = await invoke('apps_go_to', { id, place: { file: waves, line: 42 }, front: true })
      const atBack = await placeOf(id, (place) => place?.line === 42)
      check("VS Code: a line's mark, back to its file and line", backCode.value === true && atBack.value?.line === 42, `${JSON.stringify(backCode)} ${JSON.stringify(atBack)}`)
      const named = await invoke('apps_go_to', { id, place: { file: 'waves.ts', line: 2 }, front: true })
      const absent = await invoke('apps_go_to', { id, place: { file: join(project, 'no-such-file.ts'), line: 2 }, front: true })
      const flag = await invoke('apps_go_to', { id, place: { file: '--install-extension=C:/evil.vsix', line: 2 }, front: true })
      check('VS Code: a file only named, not there, or a switch goes nowhere', named.value === false && absent.value === false && flag.value === false, JSON.stringify([named, absent, flag]))
      const codePicture = await invoke('apps_may_keep_picture', { id })
      check('VS Code: no picture kept, as it cannot be asked about password boxes', codePicture.value === false, JSON.stringify(codePicture))
      const codeWords = await invoke('apps_words_of', { id })
      check("VS Code: gives no words of its own, its picture's are read", codeWords.value === null, JSON.stringify(codeWords))
    } finally {
      spawnSync('taskkill', ['/PID', String(vscode.pid), '/T', '/F'], { stdio: 'ignore' })
      await wait(1500)
      rmSync(code, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
      // Its record, left by a VS Code ended outright, gone with its project.
      const records = join(process.env.LOCALAPPDATA ?? '', 'shellnote/vscode')
      for (const name of existsSync(records) ? readdirSync(records) : []) {
        if (readFileSync(join(records, name), 'utf8').includes('shellnote-apps-check-code-')) rmSync(join(records, name), { force: true })
      }
    }
  }

  const deck = join(files, 'place.pptx')
  const made = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference = 'Stop'; $pp = New-Object -ComObject PowerPoint.Application; $before = $pp.Presentations.Count; $p = $pp.Presentations.Add(-1); 1..3 | ForEach-Object { [void]$p.Slides.Add($_, 12) }; $p.SaveAs('${deck}'); $p.Windows.Item(1).View.GotoSlide(2); "$before $($p.Slides.Item(2).SlideID)"`], { encoding: 'utf8' })
  const [decksBefore, slideId] = made.stdout.trim().split(' ').map(Number)
  if (made.status !== 0 || !slideId) {
    check('PowerPoint: the slide shown (not installed or not started: not tried)', true, (made.stderr || made.stdout).trim().split('\n')[0] ?? '')
  } else {
    try {
      let id = 0
      for (let i = 0; i < 32 && !id; i++) {
        id = ((await invoke('apps_list')).value ?? []).find((w) => w.program.toLowerCase() === 'powerpnt.exe' && w.title.startsWith('place'))?.id ?? 0
        if (!id) await wait(250)
      }
      const slide = await placeOf(id, (place) => place?.slide === slideId)
      check('PowerPoint: the slide shown, by its id, its number and its deck', slide.value?.slide === slideId && slide.value?.n === 2 && slide.value?.deck === deck, JSON.stringify(slide))
      // A slide show in a window of its own (Reading view): matched by its deck's name, PowerPoint's windows having no
      // handle to ask for. At the deck's third slide, its id read from the deck.
      // Its words: the slide's own and its notes', through PowerPoint's own automation.
      spawnSync('powershell.exe', ['-NoProfile', '-Command', `$pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); $p = $pp.Presentations | Where-Object { $_.FullName -eq '${deck}' }; $s = $p.Slides.Item(2); $b = $s.Shapes.AddTextbox(1, 10, 10, 400, 50); $b.TextFrame.TextRange.Text = 'Waves carry energy'; $s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = 'Say this slowly'`], { stdio: 'ignore' })
      const slideWords = await invoke('apps_words_of', { id })
      check("PowerPoint: a slide's words and its notes'", Boolean(slideWords.value?.includes('Waves carry energy')) && Boolean(slideWords.value?.includes('Say this slowly')), JSON.stringify(slideWords))
      const shown = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference = 'Stop'; $pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); $p = $pp.Presentations | Where-Object { $_.FullName -eq '${deck}' }; $s = $p.SlideShowSettings; $s.ShowType = 2; $show = $s.Run(); Start-Sleep -Milliseconds 800; $show.View.GotoSlide(3); "$($p.Slides.Item(3).SlideID)"`], { encoding: 'utf8' })
      const third = Number(shown.stdout.trim())
      let showId = 0
      for (let i = 0; i < 32 && !showId; i++) {
        showId = ((await invoke('apps_list')).value ?? []).find((w) => w.program.toLowerCase() === 'powerpnt.exe' && w.id !== id && w.title.includes('place'))?.id ?? 0
        if (!showId) await wait(250)
      }
      const inShow = await placeOf(showId, (place) => place?.slide === third)
      check('PowerPoint: a slide show in a window, the slide it shows', third > 0 && inShow.value?.slide === third && inShow.value?.n === 3, `${(shown.stderr ?? '').split('\n')[0]} ${JSON.stringify(inShow)}`)
      // A line's mark tapped: the show back at the second slide, by its id, read back; then the show ended and the editing
      // window sent to the third, though its id's number has moved on; a slide gone, and a deck not open, cannot.
      const backInShow = await invoke('apps_go_to', { id: showId, place: { slide: slideId, n: 2, deck }, front: false })
      const showBack = await placeOf(showId, (place) => place?.slide === slideId)
      check("PowerPoint: a line's mark, the slide show back at its slide", backInShow.value === true && showBack.value?.n === 2, `${JSON.stringify(backInShow)} ${JSON.stringify(showBack)}`)
      spawnSync('powershell.exe', ['-NoProfile', '-Command', `$pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); $pp.SlideShowWindows.Item(1).View.Exit(); $p = $pp.Presentations | Where-Object { $_.FullName -eq '${deck}' }; $p.Slides.Item(3).MoveTo(1)`], { stdio: 'ignore' })
      await wait(500)
      const backMoved = await invoke('apps_go_to', { id, place: { slide: third, n: 3, deck }, front: false })
      const movedThere = await placeOf(id, (place) => place?.slide === third)
      check("PowerPoint: a line's mark, back to its slide though it has moved", backMoved.value === true && movedThere.value?.slide === third && movedThere.value?.n === 1, `${JSON.stringify(backMoved)} ${JSON.stringify(movedThere)}`)
      const noSlide = await invoke('apps_go_to', { id, place: { slide: 99999, n: 1, deck }, front: false })
      const noDeck = await invoke('apps_go_to', { id, place: { slide: third, n: 1, deck: 'C:/no/such/deck.pptx' }, front: false })
      check('PowerPoint: a slide gone or a deck not open cannot go back', noSlide.value === false && noDeck.value === false, `${JSON.stringify(noSlide)} ${JSON.stringify(noDeck)}`)
    } finally {
      spawnSync('powershell.exe', ['-NoProfile', '-Command', `$pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); foreach ($p in @($pp.Presentations)) { if ($p.FullName -eq '${deck}') { $p.Saved = -1; $p.Close() } }; if (${decksBefore} -eq 0 -and $pp.Presentations.Count -eq 0) { $pp.Quit() }`], { stdio: 'ignore' })
    }
  }
  rmSync(files, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })

  // ShellNote closes with a program on its panel: the program is let go first, still open and shown.
  const last = (await ask('new')).hwnd
  await invoke('apps_hold', { id: last, area, border: 0x466ea0 })
  await browser.close().catch(() => undefined)
  browser = undefined
  spawn('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`])
  for (let i = 0; i < 40 && app.exitCode === null; i++) await wait(150)
  const stillOpen = (await ask(`visible ${last}`)).visible
  check('shellnote closed: the program let go, still open and shown', app.exitCode !== null && stillOpen && (await ask(`owner ${last}`)).owner === 0, `shellnote ended ${app.exitCode !== null}; the program shown ${stillOpen}`)
  const stillWaiting = await watchersBecome(app.pid, 0)
  check('shellnote closed: its watcher ended too, with nothing to give back', stillWaiting.length === 0, `${stillWaiting.length} still waiting`)

  /** A copy of ShellNote of its own (its data folder, its developer port), ready when its library shows. */
  async function copyOf(dataFolder, port, more = {}) {
    const proc = spawn(exe, [], { env: { ...process.env, ...more, SHELLNOTE_BROWSER_ARGS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: dataFolder }, stdio: 'ignore' })
    let cdp
    for (const until = Date.now() + 30_000; !cdp; ) {
      cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch((error) => {
        if (Date.now() > until) throw error
        return wait(250).then(() => undefined)
      })
    }
    const ready = cdp.contexts()[0].pages()[0] ?? (await cdp.contexts()[0].waitForEvent('page'))
    await ready.getByRole('button', { name: /new note/iu }).first().waitFor({ timeout: 30_000 })
    return { proc, cdp, page: ready }
  }
  /** A copy closed as the person closes it, or ended after 6 s. */
  async function closeCopy(copy) {
    await copy.cdp.close().catch(() => undefined)
    spawn('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${copy.proc.pid}).CloseMainWindow() | Out-Null`])
    for (let i = 0; i < 40 && copy.proc.exitCode === null; i++) await wait(150)
    copy.proc.kill()
  }

  // ShellNote ended abruptly (a crash, or Task Manager's End task) while it holds a program, once shown and once covered
  // (9.5: never tried before 25 October; then the covered one stayed hidden until ShellNote started again). Its watcher
  // gives it back at once, shown, in its own place and size (the record beside its data), and ends; started
  // again, ShellNote finds nothing left to give back. A copy of its own, killed outright with all it started.
  for (const covered of [false, true]) {
    const crashData = mkdtempSync(join(tmpdir(), 'shellnote-apps-check-crash-'))
    const crashPort = CDP_PORT + 2
    let copy
    try {
      copy = await copyOf(crashData, crashPort)
      const victim = (await ask('new')).hwnd
      const victimOwn = await ask(`seen ${victim}`)
      const holdIt = await copy.page.evaluate(([id, area]) => window.__TAURI_INTERNALS__.invoke('apps_hold', { id, area, border: 0x466ea0, again: false }).then(() => '', String), [victim, area])
      if (covered) await copy.page.evaluate((id) => window.__TAURI_INTERNALS__.invoke('apps_cover', { id, covered: true }), victim)
      await wait(400)
      await copy.cdp.close().catch(() => undefined)
      const killedPid = copy.proc.pid
      spawn('taskkill', ['/F', '/T', '/PID', String(killedPid)], { stdio: 'ignore' })
      const killed = Date.now()
      // Given back by the watcher: shown in its own place, looked for over 3 s.
      let backAfter
      for (let i = 0; i < 30 && backAfter === undefined; i++) {
        if ((await ask(`visible ${victim}`)).visible && off(await ask(`seen ${victim}`), victimOwn) <= 1) backAfter = Date.now() - killed
        else await wait(100)
      }
      for (let i = 0; i < 20 && copy.proc.exitCode === null; i++) await wait(100)
      const alive = (await ask(`alive ${victim}`)).alive
      const shown = (await ask(`visible ${victim}`)).visible
      const now = await ask(`seen ${victim}`)
      const owner = (await ask(`owner ${victim}`)).owner
      const how = covered ? 'covered' : 'shown'
      check(`shellnote ended abruptly, the program ${how}: given back at once by its watcher`, holdIt === '' && copy.proc.exitCode !== null && alive && shown && off(now, victimOwn) <= 1 && owner === 0, `${holdIt} ShellNote ended ${copy.proc.exitCode !== null}; the program open ${alive}, shown ${shown}, off its own place by ${off(now, victimOwn)} px${backAfter === undefined ? '' : `, ${backAfter} ms after the kill`}; owner ${owner === 0 ? 'none' : `${owner} (gone)`}`)
      const record = join(crashData, 'programs-held.txt')
      const waiting = await watchersBecome(killedPid, 0)
      check(`…the program ${how}: the watcher ended after, the record gone`, waiting.length === 0 && !existsSync(record), `${waiting.length} still waiting; the record ${existsSync(record) ? 'kept' : 'gone'}`)
      copy = await copyOf(crashData, crashPort)
      await wait(500)
      const backShown = (await ask(`visible ${victim}`)).visible
      const backSeen = await ask(`seen ${victim}`)
      check(`started again after that, the program ${how}: nothing to give back, still in its own place`, alive && backShown && off(backSeen, victimOwn) <= 1 && (await ask(`owner ${victim}`)).owner === 0, `shown ${backShown}, off its own place by ${off(backSeen, victimOwn)} px`)
      if (alive) await ask('close')
    } finally {
      if (copy) await closeCopy(copy)
      await wait(1000)
      rmSync(crashData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    }
  }

  // Started as administrator (the research's rule, 3.9): no window listed nor held, and the page told why. The check
  // never runs ShellNote as administrator: SHELLNOTE_APPS_AS_ADMIN=1 makes it behave so (it can only switch the
  // panel off). A second copy, with a data folder and a developer port of its own.
  const adminData = mkdtempSync(join(tmpdir(), 'shellnote-apps-check-admin-'))
  const admin = spawn(exe, [], { env: { ...process.env, SHELLNOTE_APPS_AS_ADMIN: '1', SHELLNOTE_BROWSER_ARGS: `--remote-debugging-port=${CDP_PORT + 1}`, WEBVIEW2_USER_DATA_FOLDER: adminData }, stdio: 'ignore' })
  try {
    let second
    for (const until = Date.now() + 30_000; !second; ) {
      second = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT + 1}`).catch((error) => {
        if (Date.now() > until) throw error
        return wait(250).then(() => undefined)
      })
    }
    const adminPage = second.contexts()[0].pages()[0] ?? (await second.contexts()[0].waitForEvent('page'))
    await adminPage.getByRole('button', { name: /new note/iu }).first().waitFor({ timeout: 30_000 })
    const asked = (command, args) =>
      adminPage.evaluate(([command, args]) => window.__TAURI_INTERNALS__.invoke(command, args).then((value) => ({ value }), (error) => ({ error: String(error) })), [command, args])
    const listedAsAdmin = await asked('apps_list')
    const ready = (await ask('new')).hwnd
    const heldAsAdmin = await asked('apps_hold', { id: ready, area, border: null })
    check('started as administrator: no window listed, the reason told', Boolean(listedAsAdmin.error?.includes('administrator')) && listedAsAdmin.value === undefined, listedAsAdmin.error ?? `listed ${listedAsAdmin.value?.length}`)
    check('started as administrator: none held, even asked without the list', Boolean(heldAsAdmin.error?.includes('administrator')) && (await ask(`owner ${ready}`)).owner === 0, heldAsAdmin.error ?? 'held')
    const picturedAsAdmin = await asked('apps_picture', { id: ready, width: 300, height: 200, seen: true })
    check('started as administrator: no picture either', Boolean(picturedAsAdmin.error?.includes('administrator')), picturedAsAdmin.error ?? 'pictured')
    await ask('close')
    await second.close().catch(() => undefined)
  } finally {
    admin.kill()
    await wait(1000)
    rmSync(adminData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
} catch (error) {
  check('the check ran', false, String(error))
} finally {
  await browser?.close().catch(() => undefined)
  app.kill()
  helper.stdin.end()
  helper.kill()
  await wait(1500)
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}

console.table(results)
if (results.some((r) => r.result !== 'pass')) process.exitCode = 1
