// How fast the editor is, in Edge: the performance pass of 12 October 2026,
// as a command. Opening the app and a note, typing (script time, renders and
// layouts per key), saving while typing, moving and resizing a picture and a
// diagram, and what the app's own code adds to an AI edit (with a fake model
// that answers at once). Each run has a browser profile of its own, so the
// library in your own browser is never touched.
//
//   pnpm perf:ui [--url http://localhost:5190] [--runs 3]
//   pnpm perf:ui --cdp http://127.0.0.1:9333 [--runs 3]
//
// Start the app first: `pnpm app` (as people get it) or `pnpm dev`. With --cdp,
// the desktop app instead, through its web view's developer port (`pnpm
// desktop:smoke -- --keep` leaves it open so, with a data folder of its own):
// the same steps in its one window, run after run.
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'

const { values: args } = parseArgs({ options: { url: { type: 'string', default: 'http://localhost:5190' }, runs: { type: 'string', default: '3' }, cdp: { type: 'string' } } })
const RUNS = Number(args.runs)

/** What the page counts, from before any of its own code runs. */
interface Watched {
  __long: number[]
  __events: { name: string; d: number; p: number }[]
  __commits: number
  __saves: { store: string; t: number }[]
}
const watched = (page: Page): Promise<Watched> =>
  page.evaluate(() => {
    const w = window as unknown as Watched
    return { __long: w.__long, __events: w.__events, __commits: w.__commits, __saves: w.__saves }
  })

/**
 * Counted in the page from before any of its own code runs: long tasks, slow
 * keys, React's renders (React tells the developer tools' hook of each one it
 * commits) and writes to the browser's storage. Plain JavaScript in a string,
 * as the compiler running this file would wrap a function with helpers the
 * page does not have.
 */
const WATCH = `
  window.__long = []; window.__events = []; window.__commits = 0; window.__saves = [];
  new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__events.push({ name: e.name, d: Math.round(e.duration), p: e.processingEnd - e.processingStart }))).observe({ type: 'event', durationThreshold: 16, buffered: true });
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject: () => 1, onCommitFiberRoot: () => { window.__commits++ }, onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {}, onScheduleFiberRoot: () => {}, checkDCE: () => {} };
  for (const name of ['put', 'add', 'delete']) {
    const real = IDBObjectStore.prototype[name];
    IDBObjectStore.prototype[name] = function (...a) { window.__saves.push({ store: this.name, t: Math.round(performance.now()) }); return real.apply(this, a) };
  }
`

const TEXT = ' the quick brown fox jumps over the lazy dog again and again'
const MERMAID = /deps\/mermaid|mermaid\.core|mermaid-[\w-]+\.js|cytoscape|dagre|flowDiagram|katex/iu
const FAKE = 'http://127.0.0.1:59999'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

const browser = args.cdp ? await chromium.connectOverCDP(args.cdp) : await chromium.launch({ channel: 'msedge', headless: true })
/** The desktop app's one window (--cdp): its context and page, used run after run. */
const app = args.cdp ? browser.contexts()[0] : undefined
const BASE = app ? new URL(app.pages()[0]!.url()).origin : args.url!.replace(/\/+$/u, '')
if (app) await app.addInitScript({ content: WATCH })
const results: Record<string, number>[] = []
for (let run = 0; run < RUNS; run++) {
  const context = app ?? (await browser.newContext({ viewport: { width: 1280, height: 1000 } }))
  if (!app) await context.addInitScript({ content: WATCH })
  const page = app ? app.pages()[0]! : await context.newPage()
  if (app) await page.setViewportSize({ width: 1280, height: 1000 })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async (): Promise<Record<string, number>> => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const r: Record<string, number> = {}
  const open = async (path: string): Promise<number> => {
    const t = Date.now()
    await page.goto(`${BASE}${path}`)
    await page.locator('.nw-desk[data-tool]').waitFor({ timeout: 60_000 })
    return Date.now() - t
  }

  // Opening the app: the library's home page.
  let t = Date.now()
  await page.goto(`${BASE}/`)
  await page.getByRole('button', { name: /new note/iu }).first().waitFor({ timeout: 60_000 })
  r['home ready, ms'] = Date.now() - t
  const opened = await page.evaluate(() => ({
    paint: performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? 0,
    scripts: performance.getEntriesByType('resource').filter((e) => /\.(m?js|ts|tsx)(\?|$)/u.test(e.name)).map((e) => ({ name: e.name, kb: ((e as PerformanceResourceTiming).encodedBodySize || (e as PerformanceResourceTiming).transferSize) / 1024 })),
  }))
  r['first paint, ms'] = Math.round(opened.paint)
  r['code files on opening'] = opened.scripts.length
  r['code on opening, KB'] = Math.round(opened.scripts.reduce((sum, s) => sum + s.kb, 0))
  r['Mermaid files on opening'] = opened.scripts.filter((s) => MERMAID.test(s.name)).length

  // A note with no diagram, and the long note.
  r['note ready, ms'] = await open('/?sample=physics')
  await page.waitForTimeout(1500)
  r['Mermaid files, note without a diagram'] = await page.evaluate((re) => performance.getEntriesByType('resource').filter((e) => new RegExp(re, 'iu').test(e.name)).length, MERMAID.source)
  r['long note (30 pages) ready, ms'] = await open('/?sample=long')

  // Typing 60 keys: at the end of page 1's heading in the long note, then in a busy frame (14 blocks).
  for (const [label, path, id] of [['typing', '/?sample=long', 't1'], ['typing, busy frame', '/?sample=mixed', 'p2']] as const) {
    await open(path)
    await page.locator(`.nw-page [data-id="${id}"]`).click()
    await page.keyboard.press('End')
    await page.waitForTimeout(800)
    await page.evaluate(() => {
      const w = window as unknown as Watched
      w.__long = []
      w.__events = []
      w.__commits = 0
    })
    const before = await metrics()
    t = Date.now()
    await page.keyboard.type(TEXT)
    await page.waitForFunction(([x, block]) => document.querySelector(`.nw-page [data-id="${block}"]`)?.textContent?.includes(x.trim()) === true, [TEXT, id] as const)
    r[`${label}: 60 keys, ms`] = Date.now() - t
    await page.waitForTimeout(1000)
    const after = await metrics()
    const seen = await watched(page)
    r[`${label}: script per key, ms`] = +((((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000) / TEXT.length).toFixed(2)
    r[`${label}: renders per key`] = +(seen.__commits / TEXT.length).toFixed(2)
    r[`${label}: layouts per key`] = +(((after.LayoutCount ?? 0) - (before.LayoutCount ?? 0)) / TEXT.length).toFixed(2)
    r[`${label}: keys over 50 ms`] = seen.__events.filter((e) => /key|input/u.test(e.name) && e.d > 50).length
  }

  // Saving to the browser's storage while typing in a note of the library.
  await open('/#/new')
  await page.locator('.nw-frame .ProseMirror').first().click()
  await page.waitForTimeout(1500)
  await page.evaluate(() => ((window as unknown as Watched).__saves = []))
  await page.keyboard.type(TEXT, { delay: 50 })
  await page.waitForTimeout(3000)
  r['saves while typing 60 keys'] = (await watched(page)).__saves.length

  // Moving a picture and a diagram placed on the page, and resizing the diagram, in 30 steps of the mouse.
  for (const [label, path, selector] of [['picture', '/?sample=physics', '.nw-free[data-free="image"]'], ['diagram', '/?sample=mixed', '.nw-free[data-free="diagram"]']] as const) {
    await open(path)
    if (label === 'diagram') await page.locator('.nw-diagram[data-drawn]').first().waitFor({ timeout: 60_000 })
    await page.waitForTimeout(500)
    const box = (await page.locator(selector).first().boundingBox())!
    t = Date.now()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 80, { steps: 30 })
    await page.mouse.up()
    r[`moving a ${label}: per mouse step, ms`] = +((Date.now() - t) / 30).toFixed(1)
  }
  const corner = await page.locator('.nw-free[data-free="diagram"] .nw-handle[data-corner="se"]').boundingBox()
  if (corner) {
    t = Date.now()
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2)
    await page.mouse.down()
    await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 30 })
    await page.mouse.up()
    r['resizing a diagram: per mouse step, ms'] = +((Date.now() - t) / 30).toFixed(1)
  }
  if (!app) await context.close()

  // What the app's own code adds to an AI edit, with a fake model answering at once.
  const ai = app ?? (await browser.newContext({ viewport: { width: 1280, height: 1000 } }))
  const settings = (base: string): void => localStorage.setItem('shellnote:ai', JSON.stringify({ provider: 'lmstudio', baseUrl: `${base}/v1`, model: 'fake-model', known: { vision: false } }))
  if (app) {
    await page.goto(`${BASE}/`)
    await page.evaluate(settings, FAKE)
  } else {
    await ai.addInitScript(settings, FAKE)
  }
  const aiPage = app ? page : await ai.newPage()
  const stamps: { what: string; t: number }[] = []
  await aiPage.route(`${FAKE}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (new URL(request.url()).pathname.endsWith('/models')) return route.fulfill({ headers: CORS, json: { data: [{ id: 'fake-model', type: 'llm' }] } })
    const body = request.postDataJSON() as { response_format?: unknown; messages: { content: string }[] }
    const choosing = body.response_format !== undefined
    stamps.push({ what: choosing ? 'choose sent' : 'write sent', t: Date.now() })
    const text = choosing ? JSON.stringify({ ops: [{ op: 'rewrite', id: /SELECTED\n(\S+)/u.exec(body.messages.at(-1)!.content)?.[1] ?? 'a' }] }) : 'An object keeps still or keeps moving until a force acts on it.'
    await route.fulfill({ headers: CORS, json: { choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 20 } } })
    stamps.push({ what: choosing ? 'choose answered' : 'write answered', t: Date.now() })
  })
  const totals: number[] = []
  for (let i = 0; i < 3; i++) {
    stamps.length = 0
    await aiPage.goto(`${BASE}/?sample=physics`)
    await aiPage.locator('.nw-desk[data-tool]').waitFor({ timeout: 60_000 })
    await aiPage.getByRole('radio', { name: 'Select' }).click()
    const box = (await aiPage.locator('.nw-page [data-id="t2"]').boundingBox())!
    await aiPage.mouse.move(box.x - 8, box.y - 3)
    await aiPage.mouse.down()
    await aiPage.mouse.move(box.x + box.width + 8, box.y + box.height + 2, { steps: 6 })
    await aiPage.mouse.up()
    await aiPage.waitForTimeout(400)
    await aiPage.getByRole('button', { name: 'AI', exact: true }).click()
    const prompt = aiPage.getByRole('dialog', { name: 'AI' }).getByRole('textbox')
    await prompt.fill(`say it more simply ${i}`)
    const enter = Date.now()
    await prompt.press('Enter')
    await aiPage.waitForFunction(() => document.querySelector('.nw-page [data-id="t2"]')?.textContent?.includes('keeps still') === true)
    const shown = Date.now()
    const at = (what: string): number => stamps.find((s) => s.what === what)?.t ?? enter
    // The model's own time here is nil: what is left is the app's.
    totals.push(shown - enter - (at('choose answered') - at('choose sent')) - (at('write answered') - at('write sent')))
  }
  r["the app's own time per AI edit, ms"] = totals.sort((a, b) => a - b)[1]!
  if (app) await aiPage.unrouteAll()
  else await ai.close()
  results.push(r)
  console.log(`run ${run + 1} of ${RUNS} done`)
}
await browser.close()

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
console.log(`\n${BASE}: medians of ${RUNS} runs`)
console.log('| What | Measured |')
console.log('|---|---|')
for (const key of Object.keys(results[0]!)) console.log(`| ${key} | ${median(results.map((r) => r[key]!))} |`)
