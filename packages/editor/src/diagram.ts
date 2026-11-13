// Diagrams are Mermaid: flowchart, pie and xychart, drawn
// in Mermaid's strict mode, which allows no HTML, scripts or clicks in a
// diagram. Mermaid is large, so it is loaded only when the first diagram is
// drawn or checked. Until then, and when a diagram cannot be drawn, its
// source shows instead.

type Mermaid = (typeof import('mermaid'))['default']

let loading: Promise<Mermaid> | undefined

/** What a person is told when Mermaid itself could not be loaded, as when the app was updated while it was open. */
export const NO_MERMAID = 'The diagram could not be checked: the app could not load its diagram drawer. Reload the page, then ask again. Nothing was changed.'

function mermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then(
    ({ default: loaded }) => {
      // The paper is always white, so the neutral theme suits it in a dark app too.
      loaded.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })
      return loaded
    },
    (error: unknown) => {
      // Not kept: the next diagram tries to load it again.
      loading = undefined
      throw error
    },
  )
  return loading
}

/**
 * Start loading Mermaid without waiting for it, as an AI edit is sent: it
 * loads while the model works, so a diagram the model writes is checked as
 * soon as it comes back. A failure is left for checkDiagram to report.
 */
export function prepareDiagrams(): void {
  mermaid().catch(() => {})
}

// Mermaid draws in the page's document, so one diagram at a time.
let queue: Promise<unknown> = Promise.resolve()
const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}

const drawn = new Map<string, Promise<string>>()
let drawings = 0

/** Where a drawing may point: a part of itself (`#arrowhead`), or bytes written into it (`data:`). Nowhere else. */
const stays = (address: string): boolean => /^\s*(?:#|data:)/iu.test(address)
/** A style's words without anything fetched from elsewhere: `url(#marker)` stays, `url(https://…)` becomes nothing. */
export const styleWithin = (css: string): string => css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/giu, (whole, _quote: string, address: string) => (stays(address) ? whole : 'none')).replace(/@import\b[^;]*;?/giu, '')

/**
 * A drawing with nothing in it that is fetched from elsewhere. Mermaid can draw a node as a picture at any web
 * address (`img:`), and a style can name one: drawn as it came, the page would ask that site for it at once, with no
 * click, telling it the note was opened and whatever the address carries. A note can be someone else's file, and an
 * AI writes diagrams into notes, so a drawing keeps to itself: what points outside it is taken out before the drawing
 * goes into the page. (The app's content security policy refuses such a request too: the second wall.)
 */
export function keptToItself(svg: string): string {
  // In a template nothing is fetched, drawn or run while it is looked through.
  const template = document.createElement('template')
  template.innerHTML = svg
  for (const element of template.content.querySelectorAll('*')) {
    // A link is left as Mermaid's strict mode leaves it: it goes nowhere without a click.
    if (element.localName !== 'a') {
      for (const name of ['href', 'xlink:href', 'src', 'srcset', 'poster', 'data', 'background']) {
        const address = element.getAttribute(name)
        if (address !== null && !stays(address)) element.removeAttribute(name)
      }
    }
    const style = element.getAttribute('style')
    if (style !== null && /url\(|@import/iu.test(style)) element.setAttribute('style', styleWithin(style))
    if (element.localName === 'style' && element.textContent && /url\(|@import/iu.test(element.textContent)) element.textContent = styleWithin(element.textContent)
  }
  return template.innerHTML
}

/** A picture of nothing: one clear pixel, in the place of a picture that would have been fetched. */
const NO_PICTURE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
/** An address on another site, or another computer: with a scheme that fetches, or starting with two slashes. */
const OUTSIDE = /^\s*(?:(?:[a-z][a-z0-9+.-]*:)?[/\\]{2}|(?:https?|ftp|wss?|file|blob):)/iu
/** A node's own settings, `@{ shape: …, img: "…" }`: to its closing brace, a brace inside quoted words passed over. */
const NODE_SETTINGS = /@\{(?:"[^"]*"|'[^']*'|[^}"'])*\}/gu
/** One setting: its name, then its value in either kind of quotes or bare. */
const SETTING = /(["']?[\w-]+["']?)(\s*:\s*)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s,}"'][^,}\n]*))/gu

/**
 * A diagram's source with no picture at an address outside it. Mermaid loads a node's picture (`img:`) while it
 * draws, to measure it: by then the request is made, whatever is done to the drawing after. So the address is
 * changed in the source Mermaid is given, never in the note: the node is drawn with its words and a clear picture.
 * A node's words (`label:`) stay as written, an address among them too: words fetch nothing.
 */
export function sourceKeptToItself(src: string): string {
  return src.replace(NODE_SETTINGS, (settings) =>
    settings.replace(SETTING, (whole: string, name: string, colon: string, double?: string, single?: string, bare?: string) => {
      const value = double ?? single ?? bare ?? ''
      return name.replace(/["']/gu, '').toLowerCase() !== 'label' && OUTSIDE.test(value) ? `${name}${colon}"${NO_PICTURE}"` : whole
    }),
  )
}

/** A diagram's source drawn as SVG markup, kept to itself. Rejects when Mermaid cannot read it. */
export function drawDiagram(src: string): Promise<string> {
  let svg = drawn.get(src)
  if (!svg) {
    svg = inTurn(async () => keptToItself((await (await mermaid()).render(`nw-diagram-${++drawings}`, sourceKeptToItself(src))).svg))
    // A diagram that could not be drawn is tried again the next time it is shown.
    svg.catch(() => drawn.delete(src))
    // The same diagram is shown in the page and in its thumbnail: kept for a while, not forever.
    if (drawn.size > 50) drawn.delete(drawn.keys().next().value!)
    drawn.set(src, svg)
  }
  return svg
}

/**
 * Whether Mermaid can read a diagram before it goes into a note: null when it
 * can, or else the reason, as a hint for the model's one rewrite. When
 * Mermaid itself cannot be loaded, the model is not to blame: the edit stops
 * with NO_MERMAID, and nothing is applied unchecked.
 */
export async function checkDiagram(src: string): Promise<string | null> {
  let m: Mermaid
  try {
    m = await mermaid()
  } catch {
    throw new Error(NO_MERMAID)
  }
  try {
    await inTurn(() => m.parse(src))
    return null
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return `Mermaid could not read it: ${reason.replace(/\s+/gu, ' ').slice(0, 300)}`
  }
}
