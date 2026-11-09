// The read-only views, rendered to HTML in Node with React's server renderer.
import { parseInline, type Frame, type Page } from '@shellnote/core'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MIXED, PHYSICS } from '../../core/test/fixtures/index.js'
import { FrameView, ImageView, InlineView, PageBox } from '../src/index.js'

const html = (element: ReactElement): string => renderToStaticMarkup(element)

describe('inline text', () => {
  it('draws every mark of the Markdown subset', () => {
    const out = html(<InlineView nodes={parseInline('**b** *i* ~~s~~ `c` ==h== $x^2$ [l](https://e.com/) [r]{color=red}')} />)
    for (const part of ['<strong>b</strong>', '<em>i</em>', '<s>s</s>', '<code>c</code>', '<mark>h</mark>', 'data-tex="x^2"', '<span data-color="red">r</span>']) {
      expect(out).toContain(part)
    }
    // Links open elsewhere and pass nothing back to the note.
    expect(out).toContain('<a href="https://e.com/" target="_blank" rel="noopener noreferrer">l</a>')
  })

  it('leaves prices as text', () => {
    expect(html(<InlineView nodes={parseInline('It costs $5, or $10.')} />)).toBe('It costs $5, or $10.')
  })
})

describe('a frame', () => {
  const frame = MIXED.block.fa as Frame
  const out = html(<FrameView frame={frame} doc={MIXED} assets={{}} />)

  it('sits where the document says, in millimetres', () => {
    expect(out).toMatch(/^<div class="nw-frame nw-free" data-id="fa" style="left:20mm;top:20mm;width:82.5mm">/)
  })

  it('draws each role, with its style tokens', () => {
    expect(out).toContain('<h1 class="nw-text" data-id="h1" data-role="h1" data-size="xl" data-color="blue"')
    expect(out).toContain('data-id="l2" data-role="li" data-indent="1"')
    expect(out).toMatch(/data-id="tk" data-role="todo" data-done=""/)
    expect(out).toMatch(/data-id="td" data-role="todo" style/)
  })

  it('numbers lists as the exports do', () => {
    expect(out).toContain('data-id="o1" data-role="oli" data-number="1"')
    expect(out).toContain('data-id="o2" data-role="oli" data-number="2"')
  })

  it('shows math, diagrams and images as placeholders for now', () => {
    expect(out).toContain('<div class="nw-math" data-id="mc"><code>\\sum_{x=1}^{10} x</code>')
    expect(out).toContain('<figure class="nw-diagram" data-id="dc"><pre>graph LR')
    expect(out).toContain('<span class="nw-image-missing">Sine wave with the period marked</span>')
  })
})

describe('a page', () => {
  it('draws its free blocks back to front, each in its box', () => {
    const out = html(<PageBox page={MIXED.page.w1 as Page} doc={MIXED} assets={{}} />)
    expect(out).toMatch(/^<div class="nw-page" data-page="w1" data-bg="ruled" style="width:210mm;height:297mm">/)
    const order = [...out.matchAll(/data-(?:free="(\w+)"|id="(fa|fb)")/g)].map((m) => m[1] ?? m[2])
    expect(order).toEqual(['fa', 'fb', 'math', 'diagram', 'ink'])
    expect(out).toContain('<div class="nw-free" data-free="ink" style="left:20mm;top:230mm;width:170mm;height:40mm">')
    // Each stroke a line through its points, in its colour, as wide as it was pressed (ink/render.ts).
    expect(out.match(/<g stroke="var\(--nw-\w+\)"><path d="M[^"]+" stroke-width="[\d.]+"/g)).toHaveLength(2)
  })

  it('shows an image from its URL once the app has its bytes', () => {
    const image = PHYSICS.block.g1 as Parameters<typeof ImageView>[0]['block']
    expect(html(<ImageView block={image} doc={PHYSICS} assets={{ a91f: 'blob:x' }} />)).toContain('<img src="blob:x" alt="Free-body diagram of a block on a slope" draggable="false"/>')
  })

  it('writes a caption under a picture, with its formatting', () => {
    const image = { ...(PHYSICS.block.g1 as Parameters<typeof ImageView>[0]['block']), caption: 'Forces on a **block**' }
    expect(html(<ImageView block={image} doc={PHYSICS} assets={{}} />)).toContain('<figcaption class="nw-caption">Forces on a <strong>block</strong></figcaption>')
  })

  it('draws a picture in a frame at its own size, no wider than the frame', () => {
    const image = MIXED.block.ic as Parameters<typeof ImageView>[0]['block']
    // 1600 pixels at 96 to the inch are 423.33 mm.
    expect(html(<ImageView block={image} doc={MIXED} assets={{}} />)).toContain('<div class="nw-image-pic" style="width:min(100%, 423.33mm);aspect-ratio:1600 / 1200">')
  })
})
