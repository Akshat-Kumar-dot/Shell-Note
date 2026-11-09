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

/** A diagram's source drawn as SVG markup. Rejects when Mermaid cannot read it. */
export function drawDiagram(src: string): Promise<string> {
  let svg = drawn.get(src)
  if (!svg) {
    svg = inTurn(async () => (await (await mermaid()).render(`nw-diagram-${++drawings}`, src)).svg)
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
