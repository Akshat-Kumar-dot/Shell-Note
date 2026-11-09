// The pen's editor side that needs no page: palm rules on recorded sequences,
// how a stroke is outlined, the pen switches, and the pen profile.
import { createDoc, exampleOf, keptIndexes, Learner, PEN_SIZE, shifted, sizeOf, strokeWidths, type Pt, type Stroke, type TimedPt } from '@shellnote/core'
import { describe, expect, it, vi } from 'vitest'
import { LiveLine } from '../src/ink/live.js'
import { LOOKS, stepped, Stretches, stretchesOf, strokeRuns, strokeSignature, Widths } from '../src/ink/render.js'
import { AFTER_PEN, LATE_CANCEL, PALM_SIZE, PalmRules } from '../src/ink/palm.js'
import { forgetUndone, PEN_DEFAULTS, penLearner, penProfile, penSettingsFor, teachUndone } from '../src/ink/settings.js'

const finger = (timeStamp: number, size = 12) => ({ width: size, height: size, timeStamp })

describe('palm rules', () => {
  it('lets fingers draw until a pen is seen, in the automatic mode; then they scroll', () => {
    const rules = new PalmRules('auto')
    expect(rules.fingerDraws(finger(0))).toBe(true)
    rules.pen('down', 1000)
    rules.pen('up', 1200)
    expect(rules.fingerDraws(finger(5000))).toBe(false)
    expect(rules.isPalm(finger(5000))).toBe(false)
  })

  it('never lets fingers draw with "always", and always with "off" when no pen is busy', () => {
    expect(new PalmRules('always').fingerDraws(finger(0))).toBe(false)
    const off = new PalmRules('off')
    off.pen('up', 0)
    expect(off.fingerDraws(finger(AFTER_PEN + 1))).toBe(true)
  })

  it('ignores every touch while the pen is down or near, and just after it lifts', () => {
    const rules = new PalmRules('off')
    rules.pen('down', 1000)
    expect(rules.isPalm(finger(1100))).toBe(true)
    // Down a long time, with no event: still down.
    expect(rules.isPalm(finger(60_000))).toBe(true)
    rules.pen('up', 61_000)
    expect(rules.isPalm(finger(61_000 + AFTER_PEN - 1))).toBe(true)
    expect(rules.isPalm(finger(61_000 + AFTER_PEN + 1))).toBe(false)
    // Hovering: near while it sends, and no longer once it has been quiet a moment.
    rules.pen('move', 70_000)
    expect(rules.isPalm(finger(70_100))).toBe(true)
    expect(rules.isPalm(finger(70_000 + AFTER_PEN + 1))).toBe(false)
  })

  it('takes a big contact for a palm', () => {
    const rules = new PalmRules('off')
    expect(rules.isPalm(finger(0, PALM_SIZE + 1))).toBe(true)
    expect(rules.isPalm(finger(0, 20))).toBe(false)
  })

  it('takes back a finger stroke the pen follows at once', () => {
    expect(PalmRules.lateCancel(1000, 1000 + LATE_CANCEL)).toBe(true)
    expect(PalmRules.lateCancel(1000, 1000 + LATE_CANCEL + 1)).toBe(false)
    expect(PalmRules.lateCancel(1000, 900)).toBe(false)
  })
})

describe('how a stroke is drawn', () => {
  const stroke = (pts: number[], extra: Partial<Stroke> = {}): Stroke => ({ pts, color: 'ink', width: 'm', ...extra })
  const widthsOf = (s: Stroke): number[] => strokeRuns(s).map((run) => run.width)

  it('draws a stroke at its width at normal pressure, wider when pressed harder, never past twice', () => {
    expect(widthsOf(stroke([0, 0, 128, 2000, 0, 128]))).toEqual([PEN_SIZE.pen.m])
    const hard = widthsOf(stroke([0, 0, 255, 2000, 0, 255]))[0]!
    expect(hard).toBeGreaterThan(PEN_SIZE.pen.m * 1.9)
    expect(hard).toBeLessThanOrEqual(PEN_SIZE.pen.m * 2 + 1)
    // Never thinner than a quarter.
    expect(widthsOf(stroke([0, 0, 0, 2000, 0, 0]))[0]).toBeGreaterThanOrEqual(PEN_SIZE.pen.m / 4 - 1)
  })

  it('keeps a marker and a highlighter at one width, whatever the pressure', () => {
    for (const tool of ['marker', 'highlighter'] as const) expect(widthsOf(stroke([0, 0, 40, 1000, 0, 250], { tool }))).toEqual([PEN_SIZE[tool].m])
    expect(LOOKS.highlighter.under).toBe(true)
  })

  it('leans a pencil wider', () => {
    const upright = widthsOf(stroke([0, 0, 128, 2000, 0, 128], { tool: 'pencil', tilt: [0, 0] }))[0]!
    const flat = widthsOf(stroke([0, 0, 128, 2000, 0, 128], { tool: 'pencil', tilt: [80, 80] }))[0]!
    expect(flat).toBeGreaterThan(upright * 1.3)
  })

  it('draws straight between points, so a rectangle keeps its corners, as one path of one width', () => {
    const rect = stroke([0, 0, 128, 1000, 0, 128, 1000, 500, 128, 0, 500, 128, 0, 0, 128], { shape: { kind: 'rect', key: [0, 0, 1000, 0, 1000, 500, 0, 500] } })
    // Straight sides through their middles, and each corner a sharp turn, never a curve.
    expect(strokeRuns(rect)).toEqual([{ width: PEN_SIZE.pen.m, d: 'M0 0L500 0L1000 0L1000 250L1000 500L500 500L0 500L0 250L0 0' }])
  })

  it('draws a curve as curves through its kept points, so no small corners show when zoomed in', () => {
    const pts: number[] = []
    for (let i = 0; i <= 12; i++) pts.push(Math.round(1000 * Math.cos((i / 12) * Math.PI)), Math.round(1000 * Math.sin((i / 12) * Math.PI)), 128)
    const [run] = strokeRuns(stroke(pts))
    expect(run!.d.match(/Q/g)).toHaveLength(11)
    expect(run!.d).not.toMatch(/L[\d.-]+ [\d.-]+L/)
  })

  it('puts the pieces of each width in one path, however long the stroke', () => {
    const pts: number[] = []
    for (let i = 0; i < 400; i++) pts.push(i * 10, 0, i < 200 ? 128 : 192)
    const runs = strokeRuns(stroke(pts))
    expect(runs.length).toBeLessThanOrEqual(3)
    expect(runs.map((run) => run.d.split('M').length - 1).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3)
  })

  it('draws a dot for a stroke of one point, and works each stroke out once', () => {
    const dot = stroke([500, 500, 128])
    expect(strokeRuns(dot)).toEqual([{ width: PEN_SIZE.pen.m, d: 'M500 500h0' }])
    expect(strokeRuns(dot)).toBe(strokeRuns(dot))
  })

  it('never flickers between two width steps when the width rests between them', () => {
    // Pressure jittering ±3 % round a width halfway between two steps.
    const widths = Array.from({ length: 200 }, (_, i) => 60 + 60 / 32 + (i % 2 === 0 ? 1.5 : -1.5))
    const level = new Widths(60)
    const drawn = new Set(widths.slice(1).map((_, i) => level.next(widths, i + 1)))
    expect(drawn.size).toBe(1)
    const pts: number[] = []
    for (let i = 0; i < 200; i++) pts.push(i * 10, 0, Math.round(128 * (widths[i]! / 60)))
    expect(strokeRuns(stroke(pts))).toHaveLength(1)
  })

  it("draws a stroke in page units: the same path when its block's corner moves and it moves the other way", () => {
    const pts: number[] = []
    for (let i = 0; i < 40; i++) pts.push(300 + i * 25, 200 + Math.round(80 * Math.sin(i / 5)), 128 + (i % 7))
    const drawn = stroke(pts)
    // The block's corner at (5000, 7000); then moved 600 left and 250 up, its strokes moved the other way.
    expect(strokeRuns(shifted(drawn, 600, 250), 5000 - 600, 7000 - 250)).toEqual(strokeRuns(drawn, 5000, 7000))
  })

  it('builds stretches a point at a time exactly as all at once, and carries on from a copy without changing it', () => {
    const points = Array.from({ length: 600 }, (_, i) => ({ x: i * 7, y: Math.round(300 * Math.sin(i / 30)) }))
    const widths = points.map((_, i) => 60 * (0.6 + 0.8 * Math.abs(Math.sin(i / 17))))
    const whole = stretchesOf(points, widths, 60)
    const built = new Stretches(60)
    points.forEach((pt, i) => built.add(pt, widths[i]!))
    expect(built.done()).toEqual(whole)
    // The live layer: the settled part once, then the rest each move from a copy.
    const settled = new Stretches(60)
    points.slice(0, 256).forEach((pt, i) => settled.add(pt, widths[i]!))
    const before = JSON.stringify(settled.done())
    for (const end of [300, 450, 600]) {
      const move = settled.copy()
      points.slice(256, end).forEach((pt, k) => move.add(pt, widths[256 + k]!))
      expect(move.done()).toEqual(stretchesOf(points.slice(0, end), widths.slice(0, end), 60))
    }
    expect(JSON.stringify(settled.done())).toBe(before)
    // One point: a dot.
    const dot = new Stretches(60)
    dot.add({ x: 5, y: 5 }, 60)
    expect(dot.done()).toEqual(stretchesOf([{ x: 5, y: 5 }], [60], 60))
  })

  it('draws the live line, move after move of a long stroke, exactly as the stroke will be kept', () => {
    // A long pencil scrawl (tilt counts for a pencil), its pressure rising and falling: several of the chunks it is kept in.
    const look = { tool: 'pencil' as const, width: 'm' as const }
    const points: TimedPt[] = Array.from({ length: 900 }, (_, i) => ({ x: 5000 + 3000 * Math.cos(i / 45) + 30 * Math.sin(i / 3), y: 5000 + 2000 * Math.sin(i / 45) + i, p: 128 + 60 * Math.sin(i / 70), t: i * 4 }))
    const tilts = points.map((_, i) => Math.round(30 + 20 * Math.sin(i / 90)))
    /** The stroke kept from these points, as the pen layer keeps it on lifting, cut into stretches as the page draws it. */
    const kept = (pts: readonly TimedPt[], tilt: readonly number[]) => {
      const at = keptIndexes(pts)
      const stroke = { pts: at.flatMap((i) => [Math.round(pts[i]!.x), Math.round(pts[i]!.y), Math.max(0, Math.min(255, Math.round(pts[i]!.p)))]), ...look, tilt: at.map((i) => tilt[i]!) }
      const xy = at.map((_, k) => ({ x: stroke.pts[k * 3]!, y: stroke.pts[k * 3 + 1]! }))
      return stretchesOf(xy, strokeWidths(stroke), sizeOf(look))
    }
    const line = new LiveLine(look)
    for (const m of [3, 60, 128, 129, 200, 257, 400, 555, 640, 899, 900]) {
      // The end as lifting would leave it: a few more points, at the pen's tilt now.
      const end = Array.from({ length: 6 }, (_, k) => ({ ...points[m - 1]!, x: points[m - 1]!.x + 20 * (k + 1), t: points[m - 1]!.t + k }))
      expect(line.stretches(points.slice(0, m), tilts.slice(0, m), [], tilts[m - 1]!), `after ${m} points`).toEqual(kept(points.slice(0, m), tilts))
      expect(line.stretches(points.slice(0, m), tilts.slice(0, m), end, 77), `after ${m} points and the end`).toEqual(kept([...points.slice(0, m), ...end], [...tilts.slice(0, m), ...end.map(() => 77)]))
    }
  })

  it('knows a stroke moved with its block for the same ink: the same key, and its drawing not worked out again', () => {
    const pts: number[] = []
    for (let i = 0; i < 40; i++) pts.push(300 + i * 25, 200 + Math.round(80 * Math.sin(i / 5)), 128 + (i % 7))
    const drawn = stroke(pts)
    const moved = shifted(drawn, 600, 250)
    expect(strokeSignature(moved, 5000 - 600, 7000 - 250)).toBe(strokeSignature(drawn, 5000, 7000))
    const runs = strokeRuns(drawn, 5000, 7000)
    expect(strokeRuns(moved, 5000 - 600, 7000 - 250)).toBe(runs)
    // Other ink, or the same ink somewhere else, or in another colour: another key.
    expect(strokeSignature(drawn, 5000, 7001)).not.toBe(strokeSignature(drawn, 5000, 7000))
    expect(strokeSignature({ ...drawn, color: 'red' }, 5000, 7000)).not.toBe(strokeSignature(drawn, 5000, 7000))
    const other = stroke(pts.map((v, i) => (i === 61 ? v + 1 : v)))
    expect(strokeSignature(other, 5000, 7000)).not.toBe(strokeSignature(drawn, 5000, 7000))
    expect(strokeRuns(other, 5000, 7000)).not.toBe(runs)
  })

  it('rounds widths to steps too small to see', () => {
    expect(stepped(61, 60)).toBe(stepped(60, 60))
    expect(Math.abs(stepped(73, 60) - 73)).toBeLessThanOrEqual(60 / 32 + 0.001)
  })
})

describe('the pen switches', () => {
  it('are the plan\'s defaults, with a note\'s own on top', () => {
    const doc = createDoc()
    expect(penSettingsFor(doc)).toEqual(PEN_DEFAULTS)
    expect(penSettingsFor({ ...doc, pen: { shapes: 'off', smoothing: 3 } })).toEqual({ ...PEN_DEFAULTS, shapes: 'off', smoothing: 3 })
  })
})

describe('the pen profile', () => {
  const hook: Pt[] = [{ x: 0, y: 0, p: 128 }, { x: 300, y: 400, p: 128 }, { x: 200, y: 900, p: 128 }]

  it('is learned from once for each profile, and an undone correction adds to it without starting again', () => {
    penProfile.set(undefined)
    expect(penLearner()).toBeUndefined()
    penProfile.set({ v: 1, updated: '2026-10-16T00:00:00.000Z', examples: [exampleOf('comma', hook, 'recorder')!] })
    const first = penLearner()!
    expect(penLearner()).toBe(first)
    teachUndone(hook)
    expect(penProfile.value!.examples.map((e) => `${e.label} ${e.from}`)).toEqual(['comma recorder', 'none undo'])
    const after = penLearner()!
    expect(after).not.toBe(first)
    expect([after.count('comma'), after.count('none')]).toEqual([1, 1])
    penProfile.set(undefined)
  })

  it('forgets what an undo taught when the undo is redone, and never makes the learner again for either', () => {
    penProfile.set({ v: 1, updated: '2026-10-16T00:00:00.000Z', examples: [exampleOf('comma', hook, 'recorder')!] })
    expect(penLearner()!.count('none')).toBe(0)
    const making = vi.spyOn(Learner, 'of')
    const example = teachUndone(hook)!
    expect(example.label).toBe('none')
    expect(penLearner()!.count('none')).toBe(1)
    forgetUndone(example)
    expect(penProfile.value!.examples.map((e) => e.label)).toEqual(['comma'])
    expect(penLearner()!.count('none')).toBe(0)
    expect(making).not.toHaveBeenCalled()
    making.mockRestore()
    penProfile.set(undefined)
  })

  it('starts from nothing when a correction is undone before anything was recorded', () => {
    penProfile.set(undefined)
    teachUndone(hook)
    expect(penProfile.value!.examples).toHaveLength(1)
    expect(penLearner()!.count('none')).toBe(1)
    penProfile.set(undefined)
  })
})
