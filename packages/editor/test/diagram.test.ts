// A diagram's drawing keeps to itself: nothing in it is fetched from elsewhere (diagram.ts). The drawing as a whole
// is checked in the browser tests (apps/web/e2e/outside.spec.ts); here, its styles' words.
import { describe, expect, it } from 'vitest'
import { sourceKeptToItself, styleWithin } from '../src/diagram.js'

describe("a diagram's source, as Mermaid is given it", () => {
  const clear = /"data:image\/gif;base64,[A-Za-z0-9+/=]+"/u

  it('names no picture at an address outside it, however the address is written', () => {
    for (const address of ['"https://outside.example/a.png?words=the-notes-words"', "'http://outside.example/a.png'", 'https://outside.example/a.png', '"//outside.example/a.png"', '"HTTPS://OUTSIDE.EXAMPLE/a.png"', '"file://server/share/a.png"', '"ftp://outside.example/a.png"', '" https://outside.example/a.png"', '"https:outside.example/a.png"']) {
      const src = `flowchart LR\n  A@{ img: ${address}, label: "Start", w: 60, h: 60 }\n  A --> B[End]`
      const given = sourceKeptToItself(src)
      expect(given, address).not.toContain('outside.example')
      expect(given, address).toMatch(clear)
      // The rest of the node, and of the diagram, as written.
      expect(given).toContain('label: "Start", w: 60, h: 60 }\n  A --> B[End]')
    }
  })

  it('finds the picture whatever comes before it in the node, a brace in its words too, and on lines of its own', () => {
    expect(sourceKeptToItself('flowchart LR\n  A@{ label: "a } b", img: "https://outside.example/a.png" }')).not.toContain('outside.example')
    expect(sourceKeptToItself('flowchart LR\n  A@{ "img" : "https://outside.example/a.png" }')).not.toContain('outside.example')
    expect(sourceKeptToItself('flowchart LR\n  A@{\n    shape: rect\n    img: "https://outside.example/a.png"\n  }\n  B@{ img: "https://outside.example/b.png" }')).not.toContain('outside.example')
  })

  it('leaves everything else as written', () => {
    for (const src of [
      'flowchart LR\n  A[Start] --> B{Is it?}\n  B -->|yes| C[End]',
      'flowchart LR\n  A@{ shape: diamond, label: "Is it?" }',
      // A node's words may hold an address: words fetch nothing.
      'flowchart LR\n  A@{ label: "https://example.com/page" }',
      'flowchart LR\n  A@{ label: "see https://example.com", shape: rect }',
      // A picture written into the diagram itself, and an icon by its name.
      'flowchart LR\n  A@{ img: "data:image/png;base64,AAAA", label: "x" }',
      'flowchart LR\n  A@{ icon: "fa:user", form: "square", label: "x" }',
      'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85',
      'flowchart LR\n  A["a link is words here: https://example.com"]',
    ]) {
      expect(sourceKeptToItself(src)).toBe(src)
    }
  })
})

describe("a drawing's styles", () => {
  it('keep what points into the drawing itself, or holds its own bytes', () => {
    for (const css of ['marker-end: url(#arrowhead)', 'fill: url("#gradient-1")', "background: url('data:image/png;base64,AAAA')", '.node rect { fill: #eee; stroke: #333 }']) {
      expect(styleWithin(css)).toBe(css)
    }
  })

  it('lose whatever would be fetched from elsewhere', () => {
    expect(styleWithin('background: url(https://outside.example/a.png?words=x)')).toBe('background: none')
    expect(styleWithin('background: URL( "http://outside.example/a.png" ) no-repeat')).toBe('background: none no-repeat')
    expect(styleWithin("list-style: url('//outside.example/a.png')")).toBe('list-style: none')
    expect(styleWithin('fill: url(/a.png); marker-end: url(#arrowhead)')).toBe('fill: none; marker-end: url(#arrowhead)')
    // A style sheet pulled in from elsewhere, with all it could name.
    expect(styleWithin('@import url(https://outside.example/a.css); .node { fill: red }').trim()).toBe('.node { fill: red }')
    expect(styleWithin('@import "https://outside.example/a.css";.a{}')).toBe('.a{}')
  })
})
