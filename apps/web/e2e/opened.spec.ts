// A note's pictures get addresses of the page's own (blob:), so they show with nothing loaded from the web. A note
// can be someone else's file, and its file says what each asset is: one called an SVG drawing must not become a
// drawing with a script, at an address of ShellNote's own, for the first "Open image in new tab" to run.
import { expect, test, underPolicy } from './fixtures.js'

const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>document.documentElement.setAttribute("data-ran", location.origin)</script></svg>'

test('a note’s asset called an SVG drawing runs nothing when opened by its address', async ({ page, context, refused }) => {
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()

  /** What happens when an address of the page's is opened in a tab of its own: 'ran' with a script's mark, else what was shown. */
  const opened = async (address: string): Promise<string> => {
    const tab = await context.newPage()
    try {
      // Bytes with no kind a browser shows are offered as a download, never drawn: the tab goes nowhere.
      const went = await tab.goto(address, { timeout: 10_000 }).then(
        () => true,
        () => false,
      )
      if (!went) return 'not shown'
      await tab.waitForTimeout(500)
      return (await tab.evaluate(() => document.documentElement.getAttribute('data-ran'))) === null ? 'shown, nothing ran' : 'ran'
    } finally {
      await tab.close()
    }
  }

  // Why it matters: the same bytes under the name of a drawing, at an address of the page's own, run their script as
  // the page. (Under the app's policy the script is refused: the second wall, behind this one.)
  if (!underPolicy) {
    const byHand = await page.evaluate((drawing) => URL.createObjectURL(new Blob([drawing], { type: 'image/svg+xml' })), DRAWING)
    expect(await opened(byHand)).toBe('ran')
  }

  // As a note's file brings it: the asset's kind as the file says, its bytes typed so too.
  const address = await page.evaluate(async (drawing) => {
    const assets = window.__shellnote!.store.assets
    await assets.put('feedfacefeedface', new Blob([drawing], { type: 'image/svg+xml' }), 'image/svg+xml')
    return assets.url('feedfacefeedface')!
  }, DRAWING)
  expect(address).toMatch(/^blob:/u)
  expect(await opened(address)).not.toBe('ran')
  expect(await page.evaluate(() => window.__shellnote!.store.assets.blob('feedfacefeedface')!.type)).toBe('application/octet-stream')
  refused.length = 0
})
