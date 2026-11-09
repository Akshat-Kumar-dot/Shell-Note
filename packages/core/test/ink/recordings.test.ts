// Real people's strokes (recorded on the app's ?record=strokes page, saved in
// fixtures/), against the pen's exit checks, for every recording alike: whoever
// records, the pen learns their hand (learn.ts). Each
// stroke is left out in turn and judged by a pen taught with the rest of its
// recording, as a new stroke would be. Its margins are worked out as Teach my
// pen works them out (tune), from the other half of the recording's items, so
// no stroke helps set the margin it is judged by. The general rules alone are
// reported beside, for comparison. Without a recording, the checks are skipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { arrowOfTwo, arrowOnLift, described, pointsOf, FAMILY, heldShape, isScratch, LEARN_MARGIN, Learner, recognise, Recording, recordedStrokes, scratchTest, SHAPE_LABELS, straightLine, straightOnLift, SYMBOL_LABELS, symbolOf, tune, type InkLabel, type Known, type SymbolKind, type Taught, type TimedPt } from '../../src/index.js'

const dir = join(import.meta.dirname, 'fixtures')
const recordings = existsSync(dir)
  ? readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => [name, Recording.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')))] as const)
  : []

const ALL_SYMBOLS: SymbolKind[] = ['paren', 'bracket', 'brace', 'comma', 'at']
const SYMBOLS = Object.keys(SYMBOL_LABELS) as InkLabel[]
const share = (part: number, whole: number): string => `${part}/${whole} (${whole === 0 ? 0 : Math.round((100 * part) / whole)} %)`

describe.skipIf(recordings.length === 0).each(recordings)('the strokes in %s', (_name, recording) => {
  const strokes = recordedStrokes(recording).flatMap((stroke) => {
    const d = described(stroke.points)
    return d ? [{ ...stroke, d }] : []
  })
  const known: (Known & { item: number })[] = strokes.map(({ label, d, item }) => ({ label, d, item }))
  // Margins from the odd items for the even ones, and from the even for the odd.
  const margins = [0, 1].map((half) => tune(strokes.filter((s) => s.item % 2 !== half)) ?? LEARN_MARGIN)
  // A pen taught with everything but the item a stroke came from.
  const learners = new Map<number, Learner>()
  const taughtWithout = (item: number): Taught => {
    let learner = learners.get(item)
    if (!learner) learners.set(item, (learner = new Learner(known.filter((k) => k.item !== item), margins[item % 2])))
    return { learner, zoom: 1 }
  }
  const of = (labels: readonly InkLabel[]) => strokes.filter((s) => labels.includes(s.label))
  const plain = of(['none'])
  const report: Record<string, string> = {}
  report['margins'] = margins.map((m) => Object.entries(m).map(([task, v]) => `${task} ${(v as number).toFixed(2)}`).join(', ')).join(' | ')

  it('neatens symbols it has been taught, at least 90 % of them, never as another symbol, and under 1 % of plain writing', () => {
    const symbol = (points: TimedPt[], taught?: Taught): string => {
      const shape = symbolOf(points, ALL_SYMBOLS, [], taught)
      return shape ? `${shape.kind}${shape.key[4] ?? ''}` : 'none'
    }
    const symbols = of(SYMBOLS)
    if (symbols.length === 0) return
    const got = symbols.map((s) => symbol(s.points, taughtWithout(s.item)))
    const right = got.filter((g, i) => g === symbols[i]!.label).length
    const wrong = got.filter((g, i) => g !== 'none' && g !== symbols[i]!.label)
    const misread = plain.filter((s) => symbol(s.points, taughtWithout(s.item)) !== 'none').length
    report['symbols, taught'] = `${share(right, symbols.length)} right; ${wrong.length} wrong; plain writing taken: ${share(misread, plain.length)}`
    report['symbols, rules'] = `${share(symbols.filter((s) => symbol(s.points) === s.label).length, symbols.length)} right; plain writing taken: ${share(plain.filter((s) => symbol(s.points) !== 'none').length, plain.length)}`
    expect(right / symbols.length, report['symbols, taught']).toBeGreaterThanOrEqual(0.9)
    expect(wrong, report['symbols, taught']).toEqual([])
    expect(misread / Math.max(1, plain.length), report['symbols, taught']).toBeLessThanOrEqual(0.01)
  })

  it('snaps held shapes to what was drawn at least 95 % of the time, at most 2 % to another', () => {
    const shapes = of(SHAPE_LABELS)
    if (shapes.length === 0) return
    const family = (points: TimedPt[], taught?: Taught): string => {
      const shape = taught ? heldShape(points, taught) : recognise(points, true)
      return shape ? (FAMILY[shape.kind] ?? shape.kind) : 'none'
    }
    const got = shapes.map((s) => family(s.points, taughtWithout(s.item)))
    const right = got.filter((g, i) => g === shapes[i]!.label).length
    // An arc is a smooth curve too: either for the other is not right, but no wrong snap either.
    const smooth = (a: string, b: string): boolean => (a === 'arc' || a === 'curve') && (b === 'arc' || b === 'curve')
    const wrong = got.filter((g, i) => g !== 'none' && g !== shapes[i]!.label && !smooth(g, shapes[i]!.label)).length
    const misses = [...new Set(shapes.map((s) => s.label))].map((label) => {
      const mine = shapes.flatMap((s, i) => (s.label === label ? [got[i]!] : []))
      return `${label} ${mine.filter((g) => g === label).length}/${mine.length}`
    })
    const wrongs = got.flatMap((g, i) => (g !== 'none' && g !== shapes[i]!.label ? [`${shapes[i]!.label}→${g}`] : []))
    report['held shapes, taught'] = `${share(right, shapes.length)} right, ${share(wrong, shapes.length)} wrong (${wrongs.join(' ')}): ${misses.join(', ')}`
    report['held shapes, rules'] = `${share(shapes.filter((s) => family(s.points) === s.label).length, shapes.length)} right`
    expect(right / shapes.length, report['held shapes, taught']).toBeGreaterThanOrEqual(0.95)
    expect(wrong / shapes.length, report['held shapes, taught']).toBeLessThanOrEqual(0.02)
  })

  it('keeps straightening the lines the rules straighten, and straightens under 1 % of letter strokes', () => {
    const lines = of(['line']).filter((s) => straightLine(s.points))
    const kept = lines.filter((s) => straightOnLift(s.points, taughtWithout(s.item))).length
    const letters = plain.filter((s) => straightOnLift(s.points, taughtWithout(s.item))).length
    report['lines, taught'] = `lines kept straight ${share(kept, lines.length)}; letter strokes straightened ${share(letters, plain.length)} (rules: ${plain.filter((s) => straightLine(s.points)).length})`
    if (lines.length > 0) expect(kept / lines.length, report['lines, taught']).toBeGreaterThanOrEqual(0.95)
    expect(letters / Math.max(1, plain.length), report['lines, taught']).toBeLessThanOrEqual(0.01)
  })

  it('takes arrows as the pen lifts, at least 90 % of them, and under 1 % of everything else; joins a head drawn apart', () => {
    const arrows = of(['arrow'])
    if (arrows.length === 0) return
    const taken = arrows.filter((s) => arrowOnLift(s.points, taughtWithout(s.item))?.kind === 'arrow').length
    const others = strokes.filter((s) => s.label !== 'arrow')
    const misread = others.filter((s) => arrowOnLift(s.points, taughtWithout(s.item)) !== undefined)
    // Two strokes, as they were not recorded: each arrow cut where its shaft leaves the line for the head, the line
    // then drawn on to the tip, as a hand drawing the line alone would.
    const joined = arrows.filter((s) => {
      const start = s.points[0]!
      const reach = (pt: TimedPt): number => Math.hypot(pt.x - start.x, pt.y - start.y)
      const tip = s.points.reduce((far, pt) => (reach(pt) > reach(far) ? pt : far))
      const length = reach(tip)
      const off = (pt: TimedPt): number => Math.abs((tip.x - start.x) * (pt.y - start.y) - (tip.y - start.y) * (pt.x - start.x)) / length
      let cut = 0
      while (cut + 1 < s.points.length && off(s.points[cut + 1]!) <= Math.max(50, 0.05 * length) && Math.hypot(s.points[cut + 1]!.x - tip.x, s.points[cut + 1]!.y - tip.y) > 0.06 * length) cut++
      return arrowOfTwo([...s.points.slice(0, cut + 1), tip], s.points.slice(cut + 1)) !== undefined
    }).length
    // Every two strokes written one after the other in an item (the arms of a K, the bar of a T, a Y): none an arrow.
    const pairs = strokes.flatMap((s, i) => (i > 0 && strokes[i - 1]!.item === s.item && s.label !== 'arrow' ? [[strokes[i - 1]!, s] as const] : []))
    const wrongJoins = pairs.filter(([a, b]) => arrowOfTwo(a.points, b.points) !== undefined).length
    report['arrows on lift'] = `${share(taken, arrows.length)} taken; others taken: ${share(misread.length, others.length)} (${misread.map((s) => s.label).join(' ')}); heads apart joined ${share(joined, arrows.length)}; strokes one after another joined: ${share(wrongJoins, pairs.length)}`
    expect(taken / arrows.length, report['arrows on lift']).toBeGreaterThanOrEqual(0.9)
    expect(misread.length / others.length, report['arrows on lift']).toBeLessThanOrEqual(0.01)
    expect(joined / arrows.length, report['arrows on lift']).toBeGreaterThanOrEqual(0.9)
    expect(wrongJoins / Math.max(1, pairs.length), report['arrows on lift']).toBeLessThanOrEqual(0.01)
  })

  it("with quick arrows taught as theirs, takes at least 70 % of them, and still under 1 % of everything else", () => {
    const file = join(import.meta.dirname, 'pages', 'quick-arrows.json')
    if (!existsSync(file)) return
    const quick = (JSON.parse(readFileSync(file, 'utf8')) as { arrows: number[][] }).arrows.flatMap((pts, i) => {
      const points = pointsOf(pts)
      const d = described(points)
      return d ? [{ points, d, item: 100000 + i }] : []
    })
    const all = [...known, ...quick.map(({ d, item }) => ({ label: 'arrow' as const, d, item }))]
    const withQuick = new Map<number, Learner>()
    const taught = (item: number): Taught => {
      let learner = withQuick.get(item)
      if (!learner) withQuick.set(item, (learner = new Learner(all.filter((k) => k.item !== item), margins[item % 2])))
      return { learner, zoom: 1 }
    }
    const taken = quick.filter((a) => arrowOnLift(a.points, taught(a.item))?.kind === 'arrow').length
    const others = strokes.filter((s) => s.label !== 'arrow')
    const misread = others.filter((s) => arrowOnLift(s.points, taught(s.item)) !== undefined)
    report['quick arrows, taught'] = `${share(taken, quick.length)} taken (rules alone: ${quick.filter((a) => arrowOnLift(a.points) !== undefined).length}); others taken: ${share(misread.length, others.length)} (${misread.map((s) => s.label).join(' ')})`
    expect(taken / quick.length, report['quick arrows, taught']).toBeGreaterThanOrEqual(0.7)
    expect(misread.length / others.length, report['quick arrows, taught']).toBeLessThanOrEqual(0.01)
  })

  it('takes scratch-outs for what they are at least 90 % of the time, and under 1 % of plain writing', () => {
    const scratches = of(['scratch'])
    if (scratches.length === 0) return
    const found = scratches.filter((s) => scratchTest(taughtWithout(s.item))(s.points)).length
    const misread = plain.filter((s) => scratchTest(taughtWithout(s.item))(s.points)).length
    report['scratch-outs, taught'] = `${share(found, scratches.length)} found; plain writing taken: ${share(misread, plain.length)} (rules: ${plain.filter((s) => isScratch(s.points)).length})`
    console.table(report)
    expect(found / scratches.length, report['scratch-outs, taught']).toBeGreaterThanOrEqual(0.9)
    // Writing that zigzags as much still deletes nothing unless it crosses ink (scratchTargets, group.test.ts).
    expect(misread / Math.max(1, plain.length), report['scratch-outs, taught']).toBeLessThanOrEqual(0.01)
  })
})
