// The desktop app's smoke test: opens the app as built for release, reaches
// into its web view (WebView2's developer port, as Playwright does for any
// Chromium), and checks that the library opens, that a note opens with its
// editor, that the Rust side answers where the app runs, that the pages come
// under the content security policy, which refuses a script written into the
// page and nothing the app does, and that nothing is logged as an error. The
// app runs with a data folder of its own in the
// temporary folder, so the library the person keeps in the app is never
// touched.
//
//   node run.mjs smoke [--keep]     (--keep: leave the app open afterwards, for perf:ui --cdp)
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = fileURLToPath(new URL('.', import.meta.url))
const exe = process.env.SHELLNOTE_EXE ?? join(here, 'src-tauri/target/release/shellnote.exe')
/** WebView2's developer port while the smoke test runs: no other server of the project uses it. */
export const CDP_PORT = 9333
const keep = process.argv.includes('--keep')

if (!existsSync(exe)) {
  console.error(`No built app at ${exe}. Build it first: corepack pnpm desktop:build`)
  process.exit(1)
}

const data = mkdtempSync(join(tmpdir(), 'shellnote-smoke-'))
// A link the app would open in the person's browser is written to opened.txt instead.
const env = { ...process.env, SHELLNOTE_BROWSER_ARGS: `--remote-debugging-port=${CDP_PORT}`, WEBVIEW2_USER_DATA_FOLDER: data, SHELLNOTE_OPENED_LOG: join(data, 'opened.txt') }
const app = spawn(exe, [], { env, stdio: 'ignore', detached: keep })
/** The app opened a second time, with the same data, by the closing check. */
let again

/** Whether a program has ended within `ms`. */
const exited = (child, ms) =>
  new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(true)
    const timer = setTimeout(() => resolve(false), ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })

/** The web view's developer port, once it answers (the window takes a moment to start). */
async function connect() {
  const until = Date.now() + 30_000
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
    } catch (error) {
      if (Date.now() > until) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

const results = []
const check = (name, ok, detail = '') => results.push({ check: name, result: ok ? 'pass' : 'FAIL', detail })
let browser
try {
  const started = Date.now()
  browser = await connect()
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.getByRole('button', { name: /new note/iu }).first().waitFor({ timeout: 30_000 })
  check('the window opens on the library', true, `${Date.now() - started} ms from start; title "${await page.title()}"; ${page.url()}`)

  const where = await page.evaluate("window.__TAURI_INTERNALS__.invoke('where_running')")
  check('the Rust side says where the app runs', where?.os === 'windows' && ['x86_64', 'aarch64'].includes(where?.arch), JSON.stringify(where))
  // Other programs on a panel (src/apps.rs): the list only, nothing held or moved. Titles are not written down.
  const apps = await page.evaluate("window.__TAURI_INTERNALS__.invoke('apps_list')")
  check('the Rust side lists the windows a panel could hold', Array.isArray(apps) && apps.every((a) => typeof a.id === 'number' && typeof a.title === 'string'), `${apps?.length} windows, ${apps?.filter((a) => a.left_out).length} left out`)

  // The content security policy (tauri.conf.json), as Tauri sends it with the app's own pages: watched from here on,
  // the library opened again under watch. Whatever it refuses is written down; nothing the app does may be refused.
  const refused = []
  await page.exposeBinding('__shellnoteRefused', (_source, what) => void refused.push(what))
  await page.addInitScript(() => {
    // In a frame of another site, its own policy speaks, not the app's.
    try {
      void top.location.href
    } catch {
      return
    }
    addEventListener('securitypolicyviolation', (event) => {
      void window.__shellnoteRefused?.(`${event.effectiveDirective}: ${event.blockedURI || 'inline'} (${event.sourceFile}:${event.lineNumber})`).catch(() => undefined)
    })
  })
  await page.reload()
  await page.getByRole('button', { name: /new note/iu }).first().waitFor({ timeout: 30_000 })
  const policy = await page.evaluate(async () => (await fetch(location.href, { cache: 'no-store' })).headers.get('content-security-policy') ?? '')
  const directive = (name) => policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? ''
  // Tauri adds a hash of each of the app's scripts to script-src; one added to style-src would switch off the
  // 'unsafe-inline' that Mermaid's and KaTeX's styles need.
  check(
    'the page comes under the content security policy',
    directive('script-src').startsWith("script-src 'self' 'sha256-") && !/'unsafe-|https?:/u.test(directive('script-src')) && directive('frame-ancestors') === "frame-ancestors 'none'" && directive('style-src') === "style-src 'self' 'unsafe-inline'" && directive('object-src') === "object-src 'none'",
    `${directive('style-src')}; script-src with ${directive('script-src').match(/'sha256-/gu)?.length ?? 0} hashes of the app's scripts`,
  )
  // A script that got into the page, as a bug or a pasted note could write one: a handler in a tag, a script element.
  const errorsBefore = errors.length
  const ran = await page.evaluate(async () => {
    document.body.insertAdjacentHTML('beforeend', `<img id="smoke-handler" alt="" src="data:," onerror="window.__ran = 'handler'">`)
    const script = document.createElement('script')
    script.textContent = "window.__ran = 'script'"
    document.body.append(script)
    await new Promise((resolve) => setTimeout(resolve, 500))
    document.getElementById('smoke-handler')?.remove()
    script.remove()
    return window.__ran ?? 'nothing'
  })
  const writtenIn = refused.splice(0).map((what) => what.split(':')[0]).sort().join(', ')
  // WebView2 logs the two refusals asked for as errors: they are not the app's.
  errors.push(...errors.splice(errorsBefore).filter((error) => !/Content Security Policy/u.test(error)))
  check('a script written into the page does not run', ran === 'nothing' && writtenIn === 'script-src-attr, script-src-elem', `ran: ${ran}; refused: ${writtenIn}`)

  const origin = new URL(page.url()).origin
  const opening = Date.now()
  await page.goto(`${origin}/?sample=mixed`)
  await page.locator('.nw-desk[data-tool]').waitFor({ timeout: 30_000 })
  check('a note opens with its editor', true, `${Date.now() - opening} ms`)

  // ShellNote's own title bar: the page's minimise, maximise and close, and, for Windows' snap layouts, the
  // window over the maximise button answering as one (HTMAXBUTTON, 9), as Windows asks it. Asked of ShellNote's own
  // windows: another program in front on the screen (often the person's browser) is not ShellNote's affair.
  const max = await page.evaluate(() => {
    const box = document.querySelector('.window-controls button:nth-child(2)')?.getBoundingClientRect()
    return box && { x: box.x + box.width / 2, y: box.y + box.height / 2, scale: devicePixelRatio, buttons: document.querySelectorAll('.window-controls button').length }
  })
  const inner = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|inner_position', { label: 'main' }))
  const point = max ? { x: Math.round(inner.x + max.x * max.scale), y: Math.round(inner.y + max.y * max.scale) } : { x: 0, y: 0 }
  // Asked a few times: the page tells the app where the button is just after it is drawn.
  const hitTest = () => spawnSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Hit {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int l, t, r, b; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string w);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  // ShellNote's own windows only, whatever other program is in front on the screen: the snap window is its top child,
  // shown, over the point, and answers Windows' hit test as a maximise button.
  public static string Snap(long top, int x, int y) {
    SetProcessDPIAware();
    var h = FindWindowEx((IntPtr)top, IntPtr.Zero, "shellnote-snap", null);
    if (h == IntPtr.Zero) return "no snap window";
    R r; GetWindowRect(h, out r);
    var over = x >= r.l && x < r.r && y >= r.t && y < r.b;
    var first = GetWindow((IntPtr)top, 5) == h;
    return "top " + first + ", shown " + IsWindowVisible(h) + ", over the button " + over + ", answers " + SendMessage(h, 0x84, IntPtr.Zero, (IntPtr)((y << 16) | (x & 0xFFFF)));
  }
}
"@; [Hit]::Snap((Get-Process -Id ${app.pid}).MainWindowHandle, ${point.x}, ${point.y})`], { encoding: 'utf8' }).stdout.trim()
  let answer = hitTest()
  for (let i = 0; i < 4 && answer !== 'top True, shown True, over the button True, answers 9'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    answer = hitTest()
  }
  check("ShellNote's own title bar, Windows' snap layouts on its maximise", max?.buttons === 3 && answer === 'top True, shown True, over the button True, answers 9', `${max?.buttons ?? 0} buttons; the snap window: ${answer}`)

  // The window's title follows the note's, as a browser tab's does.
  const titleOf = () => spawnSync('powershell.exe', ['-NoProfile', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-Process -Id ${app.pid}).MainWindowTitle`], { encoding: 'utf8' }).stdout.trim()
  let title = ''
  for (let i = 0; i < 20 && !title.includes('Waves'); i++) {
    title = titleOf()
    if (!title.includes('Waves')) await new Promise((resolve) => setTimeout(resolve, 150))
  }
  check("the window's title is the note's", title === 'Chapter 3: Waves – ShellNote', `"${title}"`)

  // A link asking for a window of its own, as links in notes do, goes to the person's browser, not into the app.
  const pagesBefore = context.pages().length
  await page.evaluate(() => {
    const a = document.createElement('a')
    Object.assign(a, { href: 'https://example.com/shellnote-smoke', target: '_blank', rel: 'noopener noreferrer', id: 'smoke-link', textContent: 'link' })
    Object.assign(a.style, { position: 'fixed', left: '8px', top: '200px', zIndex: '99999', padding: '6px', background: '#fff' })
    document.body.append(a)
  })
  await page.locator('#smoke-link').click()
  const log = join(data, 'opened.txt')
  for (let i = 0; i < 20 && !existsSync(log); i++) await new Promise((resolve) => setTimeout(resolve, 100))
  const opened = existsSync(log) ? readFileSync(log, 'utf8') : ''
  check("a link opens in the person's browser, the app stays", opened === 'https://example.com/shellnote-smoke' && context.pages().length === pagesBefore && page.url().includes('sample=mixed'), `opened "${opened}", pages ${context.pages().length}`)
  await page.evaluate(() => document.getElementById('smoke-link')?.remove())

  // Inside the app the pen draws its own trail ahead of it: the system's, in WebView2, stays over the whole window
  //.
  await page.getByRole('radio', { name: 'Pen', exact: true }).click()
  const trail = await page.locator('canvas.nw-live-ink').first().getAttribute('data-trail')
  check("the pen draws its own trail, not the system's", trail === 'own', `data-trail="${trail}"`)

  // Windows' handwriting into text fields is off in the app: with it on, the pen near the note's words was taken by
  // Windows, its grey ink typed into the words. Read from WebView2's own
  // command line, as Windows has it.
  const folder = data.split(/[\\/]/u).pop()
  const commandLine = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${folder}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.CommandLine }`], { encoding: 'utf8' }).stdout
  const off = commandLine.match(/--disable-features=(\S+)/u)?.[1]?.split(',') ?? []
  check("Windows' handwriting into text fields is off", off.includes('msAbydos') && off.includes('StylusHandwritingWin'), off.join(','))

  await page.goto(`${origin}/licences/third-party-rust.txt`)
  check("the Rust packages' licence notices ship with the app", (await page.content()).includes('Unicode-3.0'))

  check('nothing the app did was refused by the policy', refused.length === 0, refused.slice(0, 3).join(' | '))
  check('no errors logged', errors.length === 0, errors.slice(0, 3).join(' | '))
  if (keep) await page.goto(`${origin}/`)
  else {
    // Closing as the window's ✕ does: words typed a moment before are kept (desktop.ts, lib.rs), then opened again.
    await page.goto(`${origin}/#/new`)
    await page.locator('.nw-frame .ProseMirror').first().click()
    await page.keyboard.type('Kept as the window closed')
    const asked = Date.now()
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`])
    const gone = await exited(app, 5000)
    const took = Date.now() - asked
    await browser.close().catch(() => undefined)
    again = spawn(exe, [], { env, stdio: 'ignore' })
    browser = await connect()
    const reopened = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].waitForEvent('page'))
    await reopened.getByRole('button', { name: /new note/iu }).first().waitFor({ timeout: 30_000 })
    await reopened.locator('.card-open').first().click()
    await reopened.locator('.nw-desk[data-tool]').waitFor({ timeout: 30_000 })
    const text = (await reopened.locator('.nw-frame .ProseMirror').first().textContent()) ?? ''
    check('words typed just before closing are kept', gone && text.includes('Kept as the window closed'), `the window closed in ${took} ms; opened again: "${text.slice(0, 40)}"`)
  }
} catch (error) {
  check('the app could be reached', false, String(error))
} finally {
  await browser?.close().catch(() => undefined)
  if (!keep) {
    app.kill()
    again?.kill()
    // WebView2 lets go of its folder a moment after the app closes.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  } else {
    app.unref()
    console.log(`The app stays open, its developer port on ${CDP_PORT}: corepack pnpm perf:ui --cdp http://127.0.0.1:${CDP_PORT}`)
  }
}

console.table(results)
if (results.some((r) => r.result !== 'pass')) process.exitCode = 1
