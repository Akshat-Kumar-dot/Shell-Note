// A note's pictures in the page: each is kept under a kind ShellNote takes, or as plain bytes. A note can be someone
// else's file, and the file says what each of its assets is.
import { describe, expect, it } from 'vitest'
import { AssetStore, PICTURE_TYPES, shownType, VIDEO_TYPES } from '../src/assets.js'

describe("the type a note's asset is kept under", () => {
  it('is its own for the pictures and videos ShellNote takes', () => {
    for (const type of [...PICTURE_TYPES, ...VIDEO_TYPES]) expect(shownType(type)).toBe(type)
  })

  it('is plain bytes for anything else a file may call a picture', () => {
    // Each of these, opened by its address, would be a page or a drawing with a script of its own.
    for (const type of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml', 'application/pdf', 'text/javascript', 'image/png2', 'IMAGE/PNG', '']) {
      expect(shownType(type), type).toBe('application/octet-stream')
    }
  })

  it('holds when a note is opened: the bytes get the safe type, whatever the file and the bytes say', async () => {
    const store = new AssetStore()
    const drawing = '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title = "ran"</script></svg>'
    // As a file would have it: an asset called an SVG picture, its bytes typed so too.
    await store.put('aaaa', new Blob([drawing], { type: 'image/svg+xml' }), 'image/svg+xml')
    await store.put('bbbb', new Blob(['<script>document.title = "ran"</script>']), 'text/html')
    await store.put('cccc', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'text/html' }), 'image/png')
    expect(store.blob('aaaa')?.type).toBe('application/octet-stream')
    expect(store.blob('bbbb')?.type).toBe('application/octet-stream')
    // A real picture keeps its kind, and its bytes are untouched.
    expect(store.blob('cccc')?.type).toBe('image/png')
    expect(await store.blob('aaaa')?.text()).toBe(drawing)
  })
})
