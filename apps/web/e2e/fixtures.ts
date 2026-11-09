// The browser tests run in Edge, or, with SHELLNOTE_APP set to the desktop
// app's program, inside the app itself, to check that it matches every feature the browser has.
// There each test opens a
// fresh copy of the app, with a data folder of its own, reaches into its web
// view through WebView2's developer port, and loads the test server's pages
// into the app's own window: the system's web view, Tauri's window and what
// Tauri adds to every page, as a person gets them. Every spec imports test and
// expect from here, so one suite checks both.
//
//   corepack pnpm e2e              in Edge
//   corepack pnpm desktop:e2e      inside the desktop app (apps/desktop/run.mjs)
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export { expect } from '@playwright/test'
export type { Locator, Page, Route } from '@playwright/test'

/** The desktop app's program, when the tests run inside it. */
const app = process.env.SHELLNOTE_APP

/** Whether the tests run inside the desktop app, for the few that test what only a browser tab has. */
export const inApp = app !== undefined

/**
 * Whether the pages come under the desktop app's content security policy: inside the app (but with SHELLNOTE_CSP=0),
 * and in Edge with SHELLNOTE_CSP=1 (playwright.config.ts, vite.config.ts).
 */
export const underPolicy = process.env.SHELLNOTE_CSP === '1' || (inApp && process.env.SHELLNOTE_CSP !== '0')

/**
 * Write down whatever the policy refuses on any page the test opens, and in its frames of the same origin, as
 * "directive: what (where)". A frame of another site (YouTube's player, a web page) has a policy of its own, not the
 * app's. A test fails when anything was refused; one that refuses something on purpose takes it out of the list.
 */
async function watchPolicy(page: Page, refused: string[]): Promise<void> {
  await page.exposeBinding('__shellnoteRefused', (_source, what: string) => void refused.push(what))
  await page.addInitScript(() => {
    try {
      void top!.location.href
    } catch {
      return
    }
    addEventListener('securitypolicyviolation', (event) => {
      const tell = (window as unknown as { __shellnoteRefused?: (what: string) => Promise<void> }).__shellnoteRefused
      void tell?.(`${event.effectiveDirective}: ${event.blockedURI || 'inline'} (${event.sourceFile}:${event.lineNumber})`).catch(() => undefined)
    })
  })
}

/**
 * What Playwright gives the Edge it starts, given to the app's web view too: a window covered by another test's goes on
 * drawing, its timers at full speed. The tests run eight apps at once, one over another; a person has one in front.
 */
const UNTHROTTLED = '--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling'

/** Each worker's own developer port: the app of one test closes before the next opens. */
const portOf = (worker: number): number => 9400 + worker

async function connect(port: number): Promise<Browser> {
  const until = Date.now() + 30_000
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch (error) {
      if (Date.now() > until) throw error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}

/** Close the app and all WebView2 processes it started, then let go of its data folder. */
async function close(child: ChildProcess, data: string): Promise<void> {
  if (child.pid !== undefined) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve()
    else child.once('exit', () => resolve())
    setTimeout(resolve, 5000)
  })
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}

/**
 * The person's own LM Studio, at its usual address, is never reached by a test: the terminal's finder would ask its
 * embedding model, and an AI test its chat model. A test that wants a model routes a stand-in of its own, which comes
 * after this one and so wins.
 */
const apart = base.extend<{ refused: string[] }>({
  // What the content security policy refused during the test (underPolicy only).
  // eslint-disable-next-line no-empty-pattern -- Playwright reads what a fixture needs from this pattern: nothing here.
  refused: async ({}, use) => use([]),
  page: async ({ page, refused }, use) => {
    await page.route('http://127.0.0.1:1234/**', (route) => route.abort())
    if (underPolicy) await watchPolicy(page, refused)
    await use(page)
    expect(refused, 'refused by the content security policy').toEqual([])
  },
})

export const test = !app
  ? apart
  : apart.extend({
      context: async ({ viewport, baseURL }, use, testInfo) => {
        const port = portOf(testInfo.workerIndex)
        const data = mkdtempSync(join(tmpdir(), 'shellnote-e2e-'))
        const child = spawn(app, [], {
          env: {
            ...process.env,
            // SHELLNOTE_TEST_BROWSER_ARGS: switches of a check's own, such as the graphics chip to draw with.
            SHELLNOTE_BROWSER_ARGS: `--remote-debugging-port=${port} ${UNTHROTTLED} ${process.env.SHELLNOTE_TEST_BROWSER_ARGS ?? ''}`.trim(),
            WEBVIEW2_USER_DATA_FOLDER: data,
            // The window made at the size the spec asks for, as Edge's is; at the screen's own scale (125 % on a
            // test laptop), as a person sees it.
            SHELLNOTE_WINDOW_SIZE: `${viewport?.width ?? 1280}x${viewport?.height ?? 720}`,
            // A link that would open the person's browser is written down instead.
            SHELLNOTE_OPENED_LOG: join(data, 'opened.txt'),
          },
          stdio: 'ignore',
        })
        let browser: Browser | undefined
        try {
          browser = await connect(port)
          const context: BrowserContext = browser.contexts()[0]!
          const page = context.pages()[0] ?? (await context.waitForEvent('page'))
          // The app opens its own built pages first: wait for them, or a test's first page may be replaced by them.
          await page.waitForURL(/^http:\/\/tauri\.localhost\//u, { waitUntil: 'load', timeout: 30_000 })
          // Each page counts as the one in front, as Playwright makes its own pages: eight windows share one screen and
          // one keyboard focus, so a caret or a focused field would otherwise be in one test's window only.
          const session = await context.newCDPSession(page)
          await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
          // The window is made the size asked, taller than the screen if need be (the app allows it for the tests);
          // should it still come out smaller, the page is made that size inside it, at the screen's own scale.
          const wanted = viewport ?? { width: 1280, height: 720 }
          const got = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }))
          const emulate = ({ width, height }: { width: number; height: number }) => session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: got.scale, mobile: false })
          // (A point either way is the screen's scale rounding.)
          const emulated = got.width < wanted.width - 1 || got.height < wanted.height - 1
          if (emulated) await emulate(wanted)
          // A test that resizes the page midway resizes the app's window, as Playwright resizes Edge's (size_for_tests).
          page.setViewportSize = async ({ width, height }) => {
            if (emulated) return void (await emulate({ width, height }))
            await page.evaluate(([w, h]) => (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke('size_for_tests', { width: w, height: h }), [width, height] as const)
            await page.waitForFunction(([w, h]) => Math.abs(innerWidth - w) <= 1 && Math.abs(innerHeight - h) <= 1, [width, height] as const)
          }
          // The app's window has no base address of the tests' own: pages opened by path go to the test server, as in Edge.
          const goto = page.goto.bind(page)
          page.goto = (url, options) => goto(baseURL ? new URL(url, baseURL).toString() : url, options)
          await use(context)
        } finally {
          await browser?.close().catch(() => undefined)
          await close(child, data)
        }
      },
      page: async ({ context, refused }, use) => {
        const page = context.pages()[0]!
        await page.route('http://127.0.0.1:1234/**', (route) => route.abort())
        if (underPolicy) await watchPolicy(page, refused)
        await use(page)
        expect(refused, 'refused by the content security policy').toEqual([])
      },
    })
