// The desktop app's content security policy (apps/desktop/src-tauri/tauri.conf.json), checked where the pages come
// under it: inside the app (corepack pnpm desktop:e2e), or in Edge with SHELLNOTE_CSP=1. Every other test fails on
// whatever the policy refuses while it runs (fixtures.ts), so what the app needs is allowed; these check that it
// refuses what it is there for: a script that got into the page cannot run, nor one from another site load.
import { expect, test, underPolicy } from './fixtures.js'

test.skip(!underPolicy, 'only where the pages come under the desktop app’s policy')

test('a script written into the page does not run, and the policy says so', async ({ page, refused }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const ran = await page.evaluate(async () => {
    const shown = window as unknown as { __ran?: string }
    // As a bug or a pasted note could write it: a handler in a tag, and a script element with words of its own.
    document.body.insertAdjacentHTML('beforeend', '<img alt="" src="data:," onerror="window.__ran = \'handler\'">')
    const script = document.createElement('script')
    script.textContent = "window.__ran = 'script'"
    document.body.append(script)
    await new Promise((resolve) => setTimeout(resolve, 500))
    return shown.__ran ?? 'nothing'
  })
  expect(ran).toBe('nothing')
  await expect.poll(() => refused.map((what) => what.split(':')[0]).sort()).toEqual(['script-src-attr', 'script-src-elem'])
  refused.length = 0
})

test('a script from a site the policy does not name is not loaded', async ({ page, refused }) => {
  let asked = false
  await page.route('https://example.com/**', (route) => {
    asked = true
    return route.fulfill({ contentType: 'text/javascript', body: "window.__ran = 'loaded'" })
  })
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  const ran = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const script = document.createElement('script')
        script.src = 'https://example.com/tracker.js'
        script.onload = () => resolve((window as unknown as { __ran?: string }).__ran ?? 'loaded, did nothing')
        script.onerror = () => resolve('refused')
        document.body.append(script)
      }),
  )
  expect(ran).toBe('refused')
  expect(asked).toBe(false)
  await expect.poll(() => refused).toEqual([expect.stringMatching(/^script-src-elem: https:\/\/example\.com\/tracker\.js /u)])
  refused.length = 0
})
