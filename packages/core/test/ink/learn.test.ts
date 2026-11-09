// The pen learning a person's hand (learn.ts): whatever their way of drawing
// a symbol, a shape or a line, it follows their own strokes, leaves their
// writing alone, learns from the corrections they undo, and judges a stroke
// at the size the hand drew it, whatever the zoom. Made-up hands here;
// recordings.test.ts checks real recordings.
import { describe, expect, it } from 'vitest'
import {
  apply,
  createDoc,
  described,
  exampleOf,
  heldShape,
  LEARN_MARGIN,
  Learner,
  MAX_UNDONE,
  onScreen,
  placeStroke,
  PenProfile,
  PointFilter,
  recognise,
  Recording,
  recordedStrokes,
  scratchTargets,
  scratchTest,
  straightLine,
  straightOnLift,
  symbolOf,
  taughtProfile,
  withUndone,
  type Doc,
  type Id,
  type InkLabel,
  type Pt,
  type Taught,
} from '../../src/index.js'
import { around, cursive, drawn } from './strokes.js'

const smoothed = (points: readonly Pt[]): Pt[] => {
  const filter = new PointFilter(1)
  return points.map((pt, i) => filter.add({ ...pt, t: i * 4 }))
}
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1)

/** Someone's plain writing: words of a few letters, at different places. */
const writing = (seed: number): Pt[] => smoothed(cursive(seed * 37, 2000 + seed * 11, 2 + (seed % 4), seed))

/** A learner from labelled strokes. */
const learner = (examples: readonly [InkLabel, Pt[]][]): Learner =>
  new Learner(examples.flatMap(([label, points]) => {
    const d = described(points)
    return d ? [{ label, d }] : []
  }))
const plainOnes = (count: number): [InkLabel, Pt[]][] => Array.from({ length: count }, (_, i) => ['none', writing(i + 100)])

describe('a symbol drawn in a person\'s own way', () => {
  // This person writes "(" as a sharp "<", which the general rules never take for a bracket.
  const vee = (seed: number): Pt[] => smoothed(drawn([{ x: 600, y: 0 }, { x: 0, y: 450 }, { x: 600, y: 900 }], { seed, jitter: 6, wobble: 0.01 }))

  it('is found once they have recorded a few, and their writing still left alone', () => {
    expect(SEEDS.filter((seed) => symbolOf(vee(seed), ['paren']) !== undefined)).toEqual([])
    const taught: Taught = { learner: learner([...[201, 202, 203, 204].map((seed): [InkLabel, Pt[]] => ['paren0', vee(seed)]), ...plainOnes(30)]), zoom: 1 }
    const found = SEEDS.filter((seed) => symbolOf(vee(seed), ['paren'], [], taught)?.kind === 'paren')
    expect(found.length).toBeGreaterThanOrEqual(9)
    expect(symbolOf(vee(1), ['paren'], [], taught)?.key[4]).toBe(0)
    expect(SEEDS.filter((seed) => symbolOf(writing(seed), ['paren', 'bracket', 'brace', 'comma', 'at'], [], taught))).toEqual([])
    // Switched off, it is never made.
    expect(symbolOf(vee(1), ['bracket'], [], taught)).toBeUndefined()
  })

  it('is never acted on without enough of their plain writing to know what is plain', () => {
    const taught: Taught = { learner: learner([...[201, 202, 203].map((seed): [InkLabel, Pt[]] => ['paren0', vee(seed)]), ...plainOnes(5)]), zoom: 1 }
    expect(symbolOf(vee(1), ['paren'], [], taught)).toBeUndefined()
  })

  it('is judged at the size the hand drew it, whatever the zoom', () => {
    // The same stroke on a page shown at 400 %: a quarter of the size in the page's units.
    const page = vee(3).map((pt) => ({ x: pt.x / 4, y: pt.y / 4, p: pt.p }))
    const a = described(vee(3))!
    const b = described(onScreen(page, 4))!
    expect(Math.max(...Array.from(b.f).map((v, i) => Math.abs(v - a.f[i]!)))).toBeLessThan(1e-6)
  })
})

describe('a held shape drawn in a person\'s own way', () => {
  // A cloud of three bumps: the rules want five, and take it for something else or nothing.
  const cloud = (seed: number): Pt[] => {
    const points = Array.from({ length: 161 }, (_, i) => {
      const t = (i / 160) * 2 * Math.PI * 1.04
      const r = 1500 + 300 * Math.abs(Math.sin(1.5 * t))
      return { x: 3000 + r * Math.cos(t), y: 3000 + r * Math.sin(t) }
    })
    return smoothed(drawn(points, { seed, jitter: 10 }))
  }
  const oval = (seed: number): Pt[] => smoothed(drawn(around(3000, 3000, 1800, 1100, seed), { seed, jitter: 10 }))

  it('snaps to the shape they recorded, and their ovals stay ovals', () => {
    expect(recognise(cloud(1), true)?.kind).not.toBe('cloud')
    const taught: Taught = {
      learner: learner([...[301, 302, 303, 304].map((seed): [InkLabel, Pt[]] => ['cloud', cloud(seed)]), ...[305, 306, 307].map((seed): [InkLabel, Pt[]] => ['ellipse', oval(seed)]), ...plainOnes(30)]),
      zoom: 1,
    }
    expect(SEEDS.filter((seed) => heldShape(cloud(seed), taught)?.kind === 'cloud').length).toBeGreaterThanOrEqual(9)
    expect(SEEDS.filter((seed) => heldShape(oval(seed), taught)?.kind === 'ellipse').length).toBeGreaterThanOrEqual(9)
  })
})

describe('lines straightened as the pen lifts', () => {
  // This person's l is one long straight stroke down.
  const ell = (seed: number): Pt[] => smoothed(drawn([{ x: seed * 50, y: 0 }, { x: seed * 50 + 60, y: 1500 }], { seed, jitter: 6 }))
  const line = (seed: number): Pt[] => smoothed(drawn([{ x: 0, y: seed * 100 }, { x: 5000, y: seed * 100 + 200 }], { seed, jitter: 8 }))

  it('leaves their letter strokes alone and still straightens their lines', () => {
    expect(SEEDS.every((seed) => straightLine(ell(seed)) !== undefined)).toBe(true)
    const taught: Taught = { learner: learner([...[401, 402, 403, 404, 405].map((seed): [InkLabel, Pt[]] => ['none', ell(seed)]), ...[406, 407, 408].map((seed): [InkLabel, Pt[]] => ['line', line(seed)]), ...plainOnes(25)]), zoom: 1 }
    expect(SEEDS.filter((seed) => straightOnLift(ell(seed), taught))).toEqual([])
    expect(SEEDS.every((seed) => straightOnLift(line(seed), taught) !== undefined)).toBe(true)
  })
})

describe('a correction undone', () => {
  const paren = (seed: number): Pt[] => smoothed(drawn([{ x: 250, y: 0 }, { x: 40, y: 250 }, { x: 0, y: 450 }, { x: 40, y: 650 }, { x: 250, y: 900 }], { seed, jitter: 6 }))

  it('teaches the pen to leave that stroke alone next time, by the rules too', () => {
    const stroke = paren(1)
    expect(symbolOf(stroke, ['paren'])?.kind).toBe('paren')
    const profile = withUndone(undefined, stroke, new Date(0))
    const taught: Taught = { learner: Learner.of(profile), zoom: 1 }
    expect(symbolOf(stroke, ['paren'], [], taught)).toBeUndefined()
    // The other bracket, ")", is still found.
    const closing = paren(2).map((pt) => ({ ...pt, x: 250 - pt.x }))
    expect(symbolOf(closing, ['paren'], [], taught)?.key[4]).toBe(1)
  })

  it('teaches the pen even for a line, which the profile keeps as its two ends', () => {
    // A long, nearly straight stroke at an even pressure, as a mouse draws the arm of a K: the rule straightens it.
    const arm = (y: number): Pt[] => smoothed(drawn([{ x: 1000, y }, { x: 4000, y: y + 30 }], { seed: 4, jitter: 2 }).map((pt) => ({ ...pt, p: 128 })))
    expect(straightOnLift(arm(1000))).toBeDefined()
    const profile = withUndone(undefined, arm(1000), new Date(0))
    // Kept within 0.05 mm, it is its two ends; the learner still has it.
    expect(profile.examples[0]!.xy).toHaveLength(4)
    const learner = Learner.of(profile)
    expect(learner.count('none')).toBe(1)
    expect(straightOnLift(arm(5000), { learner, zoom: 1 })).toBeUndefined()
  })

  it('changes the learner as the profile changes, the same as making it again, without describing every stroke', () => {
    let profile: PenProfile = { v: 1, updated: '2026-10-16T00:00:00.000Z', examples: [exampleOf('comma', [{ x: 5, y: 5, p: 0 }, { x: 0, y: 300, p: 0 }, { x: -40, y: 420, p: 0 }], 'recorder')!] }
    for (let i = 0; i < MAX_UNDONE; i++) profile = withUndone(profile, [{ x: 0, y: 0, p: 128 }, { x: 300 + i, y: 50, p: 128 }, { x: 600, y: 120 + i, p: 128 }], new Date(i))
    let learner = Learner.of(profile)
    // Past MAX_UNDONE: the oldest undone goes as the newest comes.
    const next = withUndone(profile, [{ x: 0, y: 0, p: 128 }, { x: 500, y: 300, p: 128 }, { x: 900, y: 100, p: 128 }], new Date(999))
    const kept = new Set(next.examples)
    const old = new Set(profile.examples)
    learner = learner.edited((known) => known.from !== undefined && kept.has(known.from), next.examples.filter((e) => !old.has(e)))
    const again = Learner.of(next)
    for (const label of ['none', 'comma'] as const) expect(learner.count(label)).toBe(again.count(label))
    const probe = described([{ x: 0, y: 0, p: 128 }, { x: 480, y: 290, p: 128 }, { x: 880, y: 120, p: 128 }])!
    expect(learner.plain(probe, 'line', 1.5)).toBe(again.plain(probe, 'line', 1.5))
  })

  it('keeps at most MAX_UNDONE of them, the newest, and a new recording keeps them all', () => {
    let profile: PenProfile | undefined
    for (let i = 0; i < MAX_UNDONE + 5; i++) profile = withUndone(profile, [{ x: i, y: 0, p: 128 }, { x: i + 100, y: 50, p: 128 }], new Date(i))
    expect(profile!.examples).toHaveLength(MAX_UNDONE)
    expect(profile!.examples[0]!.xy).toEqual([0, 0, 100, 50])
    const recorded = [exampleOf('comma', [{ x: 5, y: 5, p: 0 }, { x: 0, y: 300, p: 0 }], 'recorder')!]
    const again = taughtProfile(taughtProfile(profile, recorded, new Date(1)), recorded, new Date(2))
    expect(again.examples.filter((e) => e.from === 'recorder')).toHaveLength(1)
    expect(again.examples.filter((e) => e.from === 'undo')).toHaveLength(MAX_UNDONE)
    expect(PenProfile.parse(again)).toEqual(again)
  })
})

describe("shading and scratch-outs taught apart", () => {
  /** Back and forth across a region: `passes` strokes of hatching, slanted, as when colouring in a drawing. */
  const hatch = (x0: number, x1: number, y0: number, y1: number, passes: number, seed: number): Pt[] => {
    const corners: { x: number; y: number }[] = []
    for (let k = 0; k <= passes; k++) {
      const y = y0 + ((y1 - y0) * k) / passes
      corners.push(k % 2 === 0 ? { x: x0, y } : { x: x1, y: y + 400 })
    }
    return smoothed(drawn(corners, { seed, jitter: 6 }))
  }
  /** A dense zigzag over a word, as this person recorded their scratch-outs. */
  const scratch = (seed: number): Pt[] => smoothed(drawn(Array.from({ length: 9 }, (_, i) => ({ x: 1000 + (i % 2) * 2500, y: 1000 + i * 60 })), { seed, jitter: 6 }))
  const shade = (seed: number): Pt[] => hatch(0, 5000, 0, 4000, 8, seed)
  const profile = (shading: InkLabel): Taught => {
    const examples = [...[2, 3, 4].map((seed) => exampleOf('scratch', scratch(seed), 'recorder')!), ...[5, 6, 7, 8].map((seed) => exampleOf(shading, shade(seed), 'recorder')!), ...Array.from({ length: 20 }, (_, k) => exampleOf('none', writing(k + 1), 'recorder')!)]
    return { learner: Learner.of({ v: 1, updated: '2026-10-16T00:00:00.000Z', examples }), zoom: 1 }
  }
  const taught = profile('shade')

  it("leaves the person's shading alone, and still takes their scratch-outs", () => {
    // By the rules alone, shading goes back and forth enough to be a scratch-out.
    expect(scratchTest()(shade(1))).toBe(true)
    expect(SEEDS.filter((seed) => scratchTest(taught)(shade(seed + 10)))).toEqual([])
    expect(SEEDS.every((seed) => scratchTest(taught)(scratch(seed + 10)))).toBe(true)
  })

  it('still takes a quick zigzag over a word, fewer and wider passes than recorded', () => {
    // Six passes side to side, 30 mm wide: by the rules a scratch-out.
    const quick = (seed: number): Pt[] => smoothed(drawn(Array.from({ length: 7 }, (_, i) => ({ x: 1000 + (i % 2) * 3000, y: 900 + i * 100 + (i % 2) * 150 })), { seed, jitter: 8 }))
    expect(SEEDS.every((seed) => scratchTest()(quick(seed)))).toBe(true)
    expect(SEEDS.every((seed) => scratchTest(taught)(quick(seed)))).toBe(true)
    // Over a word on the page, it deletes the word.
    const { doc, page } = written([cursive(1200, 1400, 5, 3)])
    expect(scratchTargets(doc, page, on(quick(1)), scratchTest(taught))).toHaveLength(1)
  })

  it('keeps a drawing that shading crosses', () => {
    // A circle 50 mm across, hatched inside and over its edge.
    const circle = smoothed(drawn(around(2500, 2000, 2500, 2500, 0, 0.04), { seed: 3, jitter: 6 }))
    const { doc, page } = written([circle])
    const hatching = hatch(-300, 5300, 200, 4200, 8, 21)
    // The premise: by the rules alone, the shading deletes the circle.
    expect(scratchTargets(doc, page, on(hatching))).toHaveLength(1)
    expect(scratchTargets(doc, page, on(hatching), scratchTest(taught))).toEqual([])
  })

  it('with no shading recorded, judges as before', () => {
    const none: Taught = { learner: Learner.of({ v: 1, updated: '2026-10-16T00:00:00.000Z', examples: [...[2, 3, 4].map((seed) => exampleOf('scratch', scratch(seed), 'recorder')!), ...Array.from({ length: 20 }, (_, k) => exampleOf('none', writing(k + 1), 'recorder')!)] }), zoom: 1 }
    expect(SEEDS.every((seed) => scratchTest(none)(scratch(seed + 10)))).toBe(true)
  })
})

/** Points moved 50 mm into the page. */
const on = (points: readonly Pt[]): Pt[] => points.map((pt) => ({ ...pt, x: pt.x + 5000, y: pt.y + 5000 }))

/** Strokes written on a new note's first page, moved 50 mm in (on). */
function written(strokes: readonly Pt[][]): { doc: Doc; page: Id } {
  let doc = createDoc()
  const page = doc.pages[0]!
  let n = 0
  for (const points of strokes) {
    const placed = placeStroke(doc, page, { pts: on(points).flatMap((pt) => [Math.round(pt.x), Math.round(pt.y), 128]), color: 'ink', width: 'm' }, { now: 1000 + n * 300, newId: () => `ink${String(n++).padStart(5, '0')}` })
    doc = apply(doc, placed.ops).doc
  }
  return { doc, page }
}

describe("margins worked out from the person's own strokes", () => {
  const examples = [...Array.from({ length: 25 }, (_, k) => exampleOf('none', writing(k + 1), 'recorder')!)]

  it('are kept with the profile at Teach my pen, and kept as corrections are undone', () => {
    const profile = taughtProfile(undefined, examples, new Date(0))
    expect(profile.tuned).toBeDefined()
    expect(Learner.of(profile).margin.symbol).toBe(profile.tuned!.symbol / 1000)
    expect(withUndone(profile, writing(99), new Date(1)).tuned).toEqual(profile.tuned)
    expect(PenProfile.parse(profile)).toEqual(profile)
  })

  it('fall back to the fixed ones for a profile made before, or with too little writing to say', () => {
    expect(Learner.of({ v: 1, updated: 'x', examples }).margin).toEqual(LEARN_MARGIN)
    expect(taughtProfile(undefined, examples.slice(0, 5), new Date(0)).tuned).toBeUndefined()
  })
})

describe('a profile', () => {
  it('keeps each stroke as whole numbers from its box\'s corner, and rejects anything else', () => {
    expect(exampleOf('at', [{ x: 1000.4, y: 2000.6, p: 0 }, { x: 1500, y: 2600, p: 0 }], 'recorder')).toEqual({ label: 'at', xy: [0, 0, 500, 599], from: 'recorder' })
    expect(PenProfile.safeParse({ v: 1, updated: 'x', examples: [{ label: 'at', xy: [0, 0.5, 1, 1], from: 'recorder' }] }).success).toBe(false)
    expect(PenProfile.safeParse({ v: 1, updated: 'x', examples: [{ label: 'smile', xy: [0, 0, 1, 1], from: 'recorder' }] }).success).toBe(false)
  })
})

describe('a recording', () => {
  const stroke = (x: number, n = 6) => ({ type: 'pen', samples: Array.from({ length: n }, (_, i) => [x + i * 200, i * 150, 0.5, 0, 0, i * 8, 1, 1]) })
  const recording = Recording.parse({
    v: 1,
    items: [
      { kind: 'comma', strokes: [stroke(0, 3), stroke(100, 9)] },
      { kind: 'glyph-k', strokes: [stroke(0), stroke(500)] },
      { kind: 'scratch', strokes: [stroke(0), stroke(800)] },
      { kind: 'interval', strokes: [stroke(0)] },
      { kind: 'circle', strokes: [] },
      { kind: 'shade', strokes: [stroke(0), stroke(300)] },
      { kind: 'arrow-small', strokes: [stroke(0)] },
    ],
  })

  it('labels each usable stroke: a one-stroke ask by its longest, writing as plain, shading as shading, a scratch-out by its last, a small arrow as an arrow', () => {
    expect(recordedStrokes(recording).map((s) => `${s.item}:${s.label}`)).toEqual(['0:comma', '1:none', '1:none', '2:none', '2:scratch', '5:shade', '5:shade', '6:arrow'])
    // The comma's longer stroke, smoothed as the pen smooths it: it ends near its last sample.
    const end = recordedStrokes(recording)[0]!.points.at(-1)!
    expect(Math.hypot(end.x - 1700, end.y - 1200)).toBeLessThan(60)
  })

  it('refuses a file that is not one', () => {
    expect(Recording.safeParse({ v: 1, items: [{ kind: 'comma', strokes: [{ type: 'pen', samples: [[1, 2]] }] }] }).success).toBe(false)
  })
})
