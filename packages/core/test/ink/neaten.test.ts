// Tidy handwriting (stage 2): small fixes after each word, judged against the writing's own letter size; each
// line levelled; words and lines found in the order written. Made-up strokes for each fix and what it must leave
// alone, and the person's recorded writing for the stage's checks: the same strokes, in the same order, nothing
// moved, at most a millimetre taken off or added, a second tidy changing nothing, and quick.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_TIDY_RULES, bandOf, baselineOf, changes, createDoc, finish, isWriting, letterShifts, levelShifts, spacingShifts, tidyBoxOps, tidyStroke, penPoints, placeStroke, Recording, samePoints, tidied, tidyNoteOps, tidyOps, tidyWord, rowsOf, writingOn, type Doc, type Id, type LastStroke, type Stroke } from '../../src/index.js'
import { dist, MM, pointsOf, triplesOf, type Pt } from '../../src/ink/geometry.js'
import { step } from '../helpers.js'

/** A line through corners, a point every 0.1 mm. */
function line(corners: readonly { x: number; y: number }[]): Pt[] {
  const out: Pt[] = [{ ...corners[0]!, p: 128 }]
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1]!
    const b = corners[i]!
    const n = Math.max(1, Math.round(dist(a, b) / 10))
    for (let k = 1; k <= n; k++) out.push({ x: Math.round(a.x + ((b.x - a.x) * k) / n), y: Math.round(a.y + ((b.y - a.y) * k) / n), p: 128 })
  }
  return out
}
/** Around an ellipse, from `start` radians, `turn` of the way round. */
function arc(cx: number, cy: number, rx: number, ry: number, start: number, turn: number): { x: number; y: number }[] {
  return Array.from({ length: 61 }, (_, i) => {
    const t = start + (i / 60) * turn * 2 * Math.PI
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }
  })
}
const SIZE = 3 * MM

describe('tidying a word', () => {
  it('cuts a tail where the pen lifted, turning sharply back, and one where it landed', () => {
    // A downstroke 6 mm long, a 0.3 mm flick back up at its foot, and a 0.3 mm landing hook at its top.
    const stroke = line([{ x: 980, y: 1030 }, { x: 1000, y: 1000 }, { x: 1000, y: 1600 }, { x: 1020, y: 1575 }])
    const [tidy] = tidyWord([stroke], SIZE)
    expect(tidy!.from).toBeGreaterThan(0)
    expect(tidy!.to).toBeLessThan(stroke.length - 1)
    const after = tidied(stroke, tidy!)
    expect(after[0]).toEqual(expect.objectContaining({ x: 1000, y: 1000 }))
    expect(after.at(-1)).toEqual(expect.objectContaining({ x: 1000, y: 1600 }))
  })

  it('leaves alone a curl, a long flick that is part of a letter, a dot and a comma', () => {
    const curl = line(arc(2000, 2000, 400, 400, 0, 0.9))
    const flick = line([{ x: 1000, y: 1000 }, { x: 1000, y: 1600 }, { x: 1150, y: 1450 }])
    const dot = line([{ x: 500, y: 500 }, { x: 520, y: 510 }])
    const comma = line([{ x: 600, y: 600 }, { x: 610, y: 640 }, { x: 590, y: 690 }])
    for (const stroke of [curl, flick, dot, comma]) expect(changes(tidyWord([stroke], SIZE)[0]!, stroke.length)).toBe(false)
  })

  it('cuts an end running a little past a stroke written before it, at the crossing', () => {
    // A stem, then a bar starting 0.3 mm left of it.
    const stem = line([{ x: 1000, y: 1000 }, { x: 1000, y: 1600 }])
    const bar = line([{ x: 970, y: 1300 }, { x: 1400, y: 1300 }])
    const [, tidy] = tidyWord([stem, bar], SIZE)
    const after = tidied(bar, tidy!)
    expect(Math.abs(after[0]!.x - 1000)).toBeLessThanOrEqual(1)
    expect(after.at(-1)).toEqual(expect.objectContaining({ x: 1400 }))
  })

  it("keeps a t's stem above its bar (the bar written after) and a bar well across its stem", () => {
    const stem = line([{ x: 1000, y: 1250 }, { x: 1000, y: 1600 }])
    const bar = line([{ x: 850, y: 1300 }, { x: 1150, y: 1300 }])
    const tidy = tidyWord([stem, bar], SIZE)
    expect(changes(tidy[0]!, stem.length)).toBe(false)
    expect(changes(tidy[1]!, bar.length)).toBe(false)
  })

  it("never closes a gap: an i written up from the line and back down stays an i, an o left open stays open, two strokes stay apart", () => {
    const i = line([{ x: 1000, y: 1300 }, { x: 1050, y: 1000 }, { x: 1080, y: 1290 }])
    const o = line(arc(1000, 1000, 150, 150, -Math.PI / 2, 0.97))
    const left = line([{ x: 1000, y: 1000 }, { x: 1300, y: 1000 }])
    const right = line([{ x: 1640, y: 1000 }, { x: 1330, y: 1000 }])
    for (const word of [[i], [o], [left, right]]) expect(tidyWord(word, SIZE).every((t, k) => !changes(t, word[k]!.length))).toBe(true)
  })
})

const dir = join(import.meta.dirname, 'fixtures')
const recordings = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => [name, Recording.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')))] as const) : []

describe.skipIf(recordings.length === 0).each(recordings)('tidying the writing in %s', (_name, recording) => {
  const plain = (kind: string): boolean => /^(glyph|pair|letter|digit)-/.test(kind) || kind === 'word' || kind === 'sentence'
  // Each item's strokes as the pen keeps them (finish), grouped into words.
  const items = recording.items.flatMap((item) => (plain(item.kind) && item.strokes.length > 0 ? [{ kind: item.kind, strokes: item.strokes.map((s) => finish(penPoints(s.samples, 1))) }] : []))
  const words = items.flatMap((item) => rowsOf(item.strokes).flatMap((l) => l.map((w) => w.map((k) => item.strokes[k]!))))

  it('keeps every stroke, in order; moves no point; takes off or adds at most 1 mm; and a second tidy changes nothing', () => {
    let changed = 0
    const times: number[] = []
    for (const word of words) {
      const t0 = performance.now()
      const tidy = tidyWord(word)
      times.push(performance.now() - t0)
      expect(tidy).toHaveLength(word.length)
      const after = word.map((s, i) => tidied(s, tidy[i]!))
      word.forEach((s, i) => {
        const t = tidy[i]!
        if (changes(t, s.length)) changed++
        // The points kept are the very points drawn.
        expect(after[i]!.slice(t.before ? 1 : 0, (t.before ? 1 : 0) + t.to - t.from + 1)).toEqual(s.slice(t.from, t.to + 1))
        let cut = 0
        for (let k = 0; k < t.from; k++) cut += dist(s[k]!, s[k + 1]!)
        for (let k = t.to; k < s.length - 1; k++) cut += dist(s[k]!, s[k + 1]!)
        expect(cut).toBeLessThanOrEqual(2 * MM)
        if (t.before) expect(dist(t.before, s[t.from]!)).toBeLessThanOrEqual(1 * MM)
        if (t.after) expect(dist(t.after, s[t.to]!)).toBeLessThanOrEqual(1 * MM)
      })
      expect(tidyWord(after).every((t, i) => !changes(t, after[i]!.length))).toBe(true)
    }
    times.sort((a, b) => a - b)
    // Small fixes: most strokes stay exactly as written.
    expect(changed / words.flat().length).toBeLessThan(0.35)
    expect(times[times.length >> 1]!).toBeLessThan(2)
  })

  it('finds the words of a name and a sentence on one line', () => {
    for (const item of items.filter((i) => i.kind === 'word')) {
      const lines = rowsOf(item.strokes)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toHaveLength(2)
    }
    for (const item of items.filter((i) => i.kind === 'sentence')) expect(rowsOf(item.strokes)).toHaveLength(1)
  })
})

describe('lines and words from the order written', () => {
  const letter = (x: number, y: number): Pt[] => line(arc(x, y, 120, 150, 0, 1))
  it('starts a new word at a gap wider than a letter, and a new line below; a dot over a word is that word', () => {
    const strokes = [letter(1000, 1000), letter(1300, 1000), letter(2400, 1000), letter(1000, 2200), line([{ x: 1300, y: 700 }, { x: 1305, y: 705 }])]
    expect(rowsOf(strokes)).toEqual([[[0, 1, 4], [2]], [[3]]])
  })

  it("keeps a letter with a long tail on its line, its middle far below the line's (a g's loop, found 17 October 2026)", () => {
    const tail = line([{ x: 2000, y: 950 }, { x: 2050, y: 1100 }, { x: 2000, y: 2100 }, { x: 1900, y: 1800 }])
    const strokes = [letter(1000, 1000), letter(1300, 1000), letter(1600, 1000), tail]
    expect(rowsOf(strokes)).toEqual([[[0, 1, 2, 3]]])
  })

  it('keeps on its line a word written high after it, and starts a new line where the pen goes back left and down', () => {
    // Two words, a third 3 letters high at the end (recorded "is"), then the next line.
    const strokes = [letter(1000, 1000), letter(1300, 1000), letter(2400, 1000), letter(2700, 1000), letter(3800, 100), letter(1000, 2500)]
    expect(rowsOf(strokes)).toEqual([[[0, 1], [2, 3], [4]], [[5]]])
  })

  it('makes each short line of a list its own line, though it starts where the one above did', () => {
    const strokes = [letter(1000, 1000), letter(1300, 1000), letter(1000, 1900), letter(1300, 1900), letter(1000, 2800)]
    expect(rowsOf(strokes)).toEqual([[[0, 1]], [[2, 3]], [[4]]])
  })

  it('keeps a sloping line one line, each word a little lower', () => {
    const strokes = [0, 1, 2, 3, 4, 5].flatMap((k) => [letter(1000 + 1100 * k, 1000 + 120 * k), letter(1300 + 1100 * k, 1000 + 120 * k)])
    const rows = rowsOf(strokes)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(6)
  })

  it('keeps apart a word written back over another at another height (an i under a raised can), and joins a letter written before the one beside it', () => {
    const can = [letter(1000, 700), letter(1300, 700)]
    const i = line([{ x: 1150, y: 850 }, { x: 1150, y: 1150 }])
    const rows = rowsOf([letter(0, 1000), letter(300, 1000), ...can, i])
    expect(rows).toEqual([[[0, 1], [2, 3], [4]]])
    // A letter written first, then the one left of it, touching: one word.
    expect(rowsOf([letter(1300, 1000), letter(1000, 1000)])).toEqual([[[0, 1]]])
  })

  it("takes an i's dot drawn as a little circle for a dot, by where it is: over the stem written just before it; a short i or a small c is a letter", () => {
    // Hello i am: the i a short stem, its dot a circle 1.2 mm across over it.
    const stem = line([{ x: 2000, y: 1100 }, { x: 2000, y: 1300 }])
    const dot = line(arc(2000, 950, 60, 60, 0, 1))
    const am = [letter(2300, 1150), letter(2600, 1150)]
    const rows = rowsOf([line([{ x: 0, y: 800 }, { x: 0, y: 1300 }]), letter(300, 1150), letter(600, 1150), stem, dot, ...am])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.find((w) => w.includes(4))).toContain(3)
    // A small c, written after the word before it and beside it, not over it: a letter of its own word.
    const c = line(arc(1400, 1250, 60, 60, 0.5, 0.75))
    expect(rowsOf([letter(300, 1150), letter(600, 1150), c, letter(1600, 1150)]).flat()).toContainEqual(expect.arrayContaining([2]))
  })

  it("puts an i's dot with the stem written just before it, though the next letter is as near", () => {
    const stem = line([{ x: 1000, y: 900 }, { x: 1000, y: 1150 }])
    const dot = line([{ x: 1080, y: 700 }, { x: 1090, y: 705 }])
    const s = line(arc(1200, 1050, 80, 100, 0, 1))
    expect(rowsOf([letter(0, 1000), letter(300, 1000), stem, dot, s]).flat().find((w) => w.includes(3))).toContain(2)
  })
})

describe("the recorded Hi i am akshat (Untitled 36, 17 October 2026)", () => {
  const file = join(import.meta.dirname, 'pages', 'hi-line.json')
  const strokes = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { strokes: number[][] }).strokes.map((pts) => pointsOf(pts)) : []

  it("puts a 5 on its bowl, not the corner where its stroke turns, as the line's other words sit; a lone y on its join, with no line", () => {
    // A 5 in one stroke, 6 mm high on the line at 1000: down from 400 to the corner at 700, round the bowl to 1000.
    const five = line([{ x: 1000, y: 400 }, { x: 980, y: 700 }, { x: 1100, y: 640 }, { x: 1200, y: 760 }, { x: 1180, y: 960 }, { x: 1050, y: 1000 }, { x: 960, y: 950 }])
    expect(baselineOf([five], 300, 1000)).toBeCloseTo(1000, -1)
    // A y alone: its join at 1000 and its tail at 1300; with no line, the join.
    const y = line([{ x: 1000, y: 700 }, { x: 1020, y: 1000 }, { x: 1150, y: 700 }, { x: 1100, y: 1300 }, { x: 1000, y: 1250 }])
    expect(baselineOf([y], 300)).toBeCloseTo(1000, -1)
    expect(baselineOf([y], 300, 1010)).toBeCloseTo(1000, -1)
  })

  it("puts a 7 on its foot, not on the bar it starts with (a written z's waist comes after its diagonal)", () => {
    // The person's 7: a bar 9 mm across, sloping down 1.3 mm, then down to its foot 8 mm under
    // it.
    const seven = line([{ x: 1000, y: 570 }, { x: 1890, y: 700 }, { x: 1890, y: 760 }, { x: 1650, y: 1500 }])
    expect(baselineOf([seven], 330)).toBeCloseTo(1500, -1)
    // Developer mode, that rule off: the bar is taken for a waist, as before.
    expect(baselineOf([seven], 330, undefined, { ...ALL_TIDY_RULES, waist: false })).toBeLessThan(800)
  })

  it('finds where a word sits on its letters, not on a dot drawn as a short dash over them', () => {
    // An i 3 mm high on the line at 1000, its dot a dash 1.6 mm long and 0.3 mm high, 1.5 mm over it.
    const i = line([{ x: 1000, y: 700 }, { x: 1000, y: 1000 }, { x: 1080, y: 950 }])
    const dash = line([{ x: 950, y: 550 }, { x: 1030, y: 530 }, { x: 1110, y: 520 }])
    expect(baselineOf([i, dash], 270)).toBeCloseTo(1000, -1)
  })

  it.skipIf(strokes.length === 0)('tidied, puts the i of Hi back on the line with its dot over it, and tidied again changes nothing', () => {
    let doc = createDoc()
    const page = doc.pages[0]!
    let n = 0
    const ids = (): Id => `hii${String(n++).padStart(5, '0')}`
    let last: LastStroke | undefined
    let now = 1000
    for (const points of strokes) {
      const placed = placeStroke(doc, page, { pts: triplesOf(points), color: 'ink', width: 'm' }, { now, last, newId: ids })
      doc = step(doc, placed.ops).doc
      last = { block: placed.block, at: now + 200 }
      now += 500
    }
    doc = step(doc, tidyNoteOps(doc)).doc
    const after = writingOn(doc, page).map((ref) => ref.page)
    const bottom = (k: number) => Math.max(...after[k]!.map((p) => p.y))
    const top = (k: number) => Math.min(...after[k]!.map((p) => p.y))
    // The i of Hi on the line, as the H and the other i; its dot over it.
    expect(Math.abs(bottom(2) - bottom(0))).toBeLessThanOrEqual(30)
    expect(Math.abs(bottom(2) - bottom(4))).toBeLessThanOrEqual(30)
    expect(bottom(3)).toBeLessThan(top(2))
    expect(tidyNoteOps(doc)).toEqual([])
  })
})

describe("the recorded digits (Untitled 37, 17 October 2026)", () => {
  const file = join(import.meta.dirname, 'pages', 'digits.json')
  const strokes = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { strokes: number[][] }).strokes.map((pts) => pointsOf(pts)) : []

  it.skipIf(strokes.length === 0)('puts every digit on its base, its lowest point, the 5 on its bowl and the 4 on its foot, none under the line', () => {
    let doc = createDoc()
    const page = doc.pages[0]!
    let n = 0
    const ids = (): Id => `dig${String(n++).padStart(5, '0')}`
    let last: LastStroke | undefined
    let now = 1000
    for (const points of strokes) {
      const placed = placeStroke(doc, page, { pts: triplesOf(points), color: 'ink', width: 'm' }, { now, last, newId: ids })
      doc = step(doc, placed.ops).doc
      last = { block: placed.block, at: now + 200 }
      now += 500
    }
    const after = writingOn(step(doc, tidyNoteOps(doc)).doc, page).map((ref) => ref.page)
    // Digits 1 to 7: strokes 0 to 3, the 5 as 4 and 5, 6, 7; each one's lowest point, its flag left out.
    const lows = [[0], [1], [2], [3], [5], [6], [7]].map((ks) => Math.max(...ks.flatMap((k) => after[k]!.map((p) => p.y))))
    for (const low of lows) expect(Math.abs(low - lows[0]!)).toBeLessThanOrEqual(30)
  })
})

describe("the recorded second test (Untitled 34, 17 October 2026)", () => {
  const file = join(import.meta.dirname, 'pages', 'three-lines.json')
  const strokes = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { strokes: number[][] }).strokes.map((pts) => pointsOf(pts)) : []

  it.skipIf(strokes.length === 0)('finds its three lines, "is" on the second and "can" on the third, and "can", "i" and "help" as words', () => {
    const rows = rowsOf(strokes)
    expect(rows).toHaveLength(3)
    // "is", written high at the end of the second line, is on it: strokes 28 to 31.
    expect(rows[1]!.flat()).toEqual(expect.arrayContaining([28, 29, 30, 31]))
    // The third line: How, can (written small and high over the i), i, help (one stroke written before its h), you.
    expect(rows[2]).toEqual([[33, 34, 35], [36, 37], [38], [39, 40, 41], [42, 43]])
  })

  it.skipIf(strokes.length === 0)('levels each line as one, every word on its first word, and moves apart the words written over each other', () => {
    let doc = createDoc()
    const page = doc.pages[0]!
    let n = 0
    const ids = (): Id => `own${String(n++).padStart(5, '0')}`
    let last: LastStroke | undefined
    let now = 1000
    for (const points of strokes) {
      const placed = placeStroke(doc, page, { pts: triplesOf(points), color: 'ink', width: 'm' }, { now, last, newId: ids })
      doc = step(doc, placed.ops).doc
      last = { block: placed.block, at: now + 200 }
      now += 500
    }
    const after = writingOn(step(doc, tidyNoteOps(doc)).doc, page).map((ref) => ref.page)
    for (const row of rowsOf(strokes)) {
      const size = bandOf(row.flat().map((k) => after[k]!))!.size
      const bases = row.flatMap((word) => {
        const base = baselineOf(word.map((k) => after[k]!), size)
        return base === undefined ? [] : [base]
      })
      for (const base of bases) expect(Math.abs(base - bases[0]!)).toBeLessThanOrEqual(0.35 * size)
    }
    // "can" and the i under it are side by side now.
    const span = (word: number[]) => {
      const xs = word.flatMap((k) => after[k]!.map((p) => p.x))
      return [Math.min(...xs), Math.max(...xs)] as const
    }
    expect(span([38])[0]).toBeGreaterThan(span([36, 37])[1])
  })
})

describe('levelling a line', () => {
  it("moves each word onto the first word's baseline, left to right, so a sloping line comes level; changes nothing the second time", () => {
    // Written as a line drifting down: each word 30 to 60 units lower than the one before.
    const words = [
      { x: 0, baseline: 1000, size: 300 },
      { x: 2000, baseline: 1090, size: 300 },
      { x: 1000, baseline: 1040, size: 300 },
      { x: 3000, baseline: 1140, size: 300 },
      { x: 4000, baseline: 1005, size: 300 },
    ]
    const shifts = levelShifts(words)
    // The last, 5 units off (under 5 % of the size), is already level.
    expect(shifts).toEqual([0, -90, -40, -140, 0])
    expect(levelShifts(words.map((w, i) => ({ ...w, baseline: w.baseline + shifts[i]! })))).toEqual([0, 0, 0, 0, 0])
  })

  it("moves a word with no baseline (an i's dot set apart, a dash) as the word nearest it, never onto the line by its bottom", () => {
    const words = [
      { x: 0, x1: 900, baseline: 1000, size: 300 },
      { x: 1000, x1: 1050, size: 300 },
      { x: 1100, x1: 1900, baseline: 1100, size: 300 },
    ]
    expect(levelShifts(words)).toEqual([0, -100, -100])
  })

  it('puts the words on the line the person chooses: the first word (as picked), the one most words sit on, or the last word', () => {
    const words = [
      { x: 0, baseline: 1000, size: 300 },
      { x: 1000, baseline: 1100, size: 300 },
      { x: 2000, baseline: 1100, size: 300 },
      { x: 3000, baseline: 1300, size: 300 },
    ]
    expect(levelShifts(words)).toEqual([0, -100, -100, -300])
    expect(levelShifts(words, 'most')).toEqual([100, 0, 0, -200])
    expect(levelShifts(words, 'last')).toEqual([300, 200, 200, 0])
  })

  it("brings every word of the line onto it, however high or low it was written (Kumar, are, is and can)", () => {
    const words = [
      { x: 0, baseline: 1000, size: 300 },
      { x: 1000, baseline: 1000, size: 300 },
      { x: 2000, baseline: 650, size: 300 },
      { x: 3000, baseline: 1000, size: 300 },
      { x: 4000, baseline: 100, size: 300 },
    ]
    expect(levelShifts(words)).toEqual([0, 0, 350, 0, 900])
  })

  it("finds where letters sit: not on the tails of f, g, j, p, y and a written z", () => {
    // An o, and a p: its stem down to a tail, its bowl closing on the line.
    const o = line(arc(1000, 1150, 150, 150, 0, 1))
    const stem = line([{ x: 1400, y: 1000 }, { x: 1400, y: 1600 }])
    const bowl = line(arc(1550, 1150, 150, 150, Math.PI, 1))
    expect(Math.abs(baselineOf([o, stem, bowl], 300)! - 1300)).toBeLessThanOrEqual(10)
    // A p alone: its bowl's line, not its tail.
    expect(Math.abs(baselineOf([stem, bowl], 300)! - 1300)).toBeLessThanOrEqual(10)
    // An l, drawn down: where it ends.
    expect(baselineOf([line([{ x: 0, y: 700 }, { x: 0, y: 1300 }])], 300)).toBe(1300)
    // A dash: nothing goes down and up.
    expect(baselineOf([line([{ x: 0, y: 1000 }, { x: 600, y: 1005 }])], 300)).toBeUndefined()
  })

  it("puts a written z, small or capital, on its waist, not its loop, and a p written in one stroke where its bowl closes; a capital P on its stem's foot", () => {
    // The person's picture of a written z, the line at 1300 and the loop down to 1600 (x-height 0 to 100, times
    // 3).
    const at = (c: [number, number][], ox: number): { x: number; y: number }[] => c.map(([x, y]) => ({ x: ox + 3 * x, y: 1000 + 3 * y }))
    const z = line(at([[0, 35], [15, 5], [55, 0], [70, 25], [55, 75], [40, 100], [60, 100], [72, 120], [70, 160], [55, 198], [38, 175], [48, 125], [65, 102], [100, 92]], 1000))
    const capitalZ = line(at([[0, -60], [30, -95], [80, -90], [90, -60], [60, 0], [35, 80], [30, 100], [55, 98], [68, 125], [62, 170], [45, 198], [30, 175], [42, 120], [70, 100], [110, 92]], 2000))
    for (const [name, stroke] of [['z', z], ['Z', capitalZ]] as const) expect(Math.abs(baselineOf([stroke], bandOf([stroke])!.size)! - 1300), name).toBeLessThanOrEqual(20)
    // A p written in one stroke, after an o: the line under the o and the p's bowl, not its tail. (Alone, a written p
    // and a capital P are the same shape, a stem and a bowl at its top; only the letters beside it tell which.)
    const o = line(arc(3150, 1150, 150, 150, 0, 1))
    const p = line(at([[0, 40], [20, 0], [25, 60], [25, 200], [25, 110], [40, 20], [80, 10], [95, 55], [75, 100], [40, 100], [28, 90]], 3400))
    expect(Math.abs(baselineOf([o, p], 300)! - 1300)).toBeLessThanOrEqual(20)
    // A capital P: its stem down to the line, then up and round its bowl, back to the stem halfway up.
    const capitalP = line(at([[0, -100], [0, 100], [0, -100], [60, -95], [80, -50], [60, -5], [5, 0]], 4000))
    expect(Math.abs(baselineOf([capitalP], bandOf([capitalP])!.size)! - 1300)).toBeLessThanOrEqual(20)
  })

  it('knows the band of some writing: its size and middle', () => {
    const band = bandOf([line([{ x: 0, y: 1000 }, { x: 1000, y: 1000 }]), line([{ x: 0, y: 1300 }, { x: 1000, y: 1300 }])])!
    expect(band.size).toBeGreaterThanOrEqual(0.5 * MM)
    expect(Math.abs(band.middle - 1150)).toBeLessThanOrEqual(150)
  })
})

describe('tidying ink in a note', () => {
  /** A plain-pen stroke through points, on the page. */
  const stroke = (points: readonly Pt[]): Stroke => ({ pts: triplesOf(points), color: 'ink', width: 'm' })
  let counter = 0
  const ids = (): Id => `tdy${String(counter++).padStart(5, '0')}`
  /** Write strokes one after another, as the editor would. */
  function write(strokes: readonly Stroke[]): { doc: Doc; page: Id } {
    let doc = createDoc()
    const page = doc.pages[0]!
    let last: LastStroke | undefined
    let now = 1000
    for (const s of strokes) {
      const placed = placeStroke(doc, page, s, { now, last, newId: ids })
      doc = step(doc, placed.ops).doc
      last = { block: placed.block, at: now + 200 }
      now += 500
    }
    return { doc, page }
  }
  // Two words on a line, the second 1 mm lower; the first's downstroke with a 0.2 mm tail as the pen lifted.
  const word = (x: number, y: number, tail: boolean): Pt[][] => [
    line([{ x, y }, { x, y: y + 600 }, ...(tail ? [{ x: x + 12, y: y + 584 }] : [])]),
    line(arc(x + 300, y + 450, 150, 150, 0, 1)),
  ]
  const strokes = [...word(2000, 3000, true), ...word(3400, 3100, false)].map(stroke)

  it('tidies each word and levels the line as one set of operations; one undo gives it all back; tidying again finds nothing', () => {
    const { doc, page } = write(strokes)
    const before = writingOn(doc, page)
    expect(before).toHaveLength(4)
    const ops = tidyNoteOps(doc)
    expect(ops.length).toBeGreaterThan(0)
    // Developer mode, every rule off: nothing changes.
    expect(tidyNoteOps(doc, { anchor: 'first', wordGap: 'usual', rules: { ends: false, letters: false, level: false, gaps: false, margin: false, marks: false, once: false, ties: false, base: false, waist: false, rest: false } })).toEqual([])
    const { doc: after } = step(doc, ops)
    const now = writingOn(after, page)
    // The same strokes, in the same order: the tail cut off the first, and the two words on one level.
    expect(now).toHaveLength(4)
    expect(now[0]!.page.at(-1)!.x).toBe(2000)
    const middle = (refs: typeof now) => bandOf(refs.map((r) => r.page))!.middle
    expect(Math.abs(middle(before.slice(0, 2)) - middle(before.slice(2)))).toBeGreaterThan(90)
    expect(Math.abs(middle(now.slice(0, 2)) - middle(now.slice(2)))).toBeLessThan(10)
    expect(tidyNoteOps(after)).toEqual([])
  })

  it('tidies the words it is given, by their points on the page, and leaves a stroke changed since', () => {
    const { doc, page } = write(strokes)
    const refs = writingOn(doc, page)
    const firstWord = refs.slice(0, 2)
    const { ops, moved } = tidyOps(doc, [firstWord], false)
    expect(ops.length).toBeGreaterThan(0)
    const after = step(doc, ops).doc
    expect(samePoints(writingOn(after, page)[0]!.page, moved.get(firstWord[0]!)!.page)).toBe(true)
    // Seen as it was before the tidy: no longer there, so nothing is done.
    expect(tidyOps(after, [firstWord], false).ops).toEqual([])
    expect(isWriting(stroke([]))).toBe(true)
  })
})

describe('as the pen lifts, and a finished line', () => {
  it('tidies one stroke as it lifts, the strokes before it in its word as they are', () => {
    // An l's foot flicking back up 0.2 mm, then a bar written past an earlier stem.
    const ell = line([{ x: 1000, y: 1000 }, { x: 1000, y: 1600 }, { x: 1012, y: 1584 }])
    const tidy = tidyStroke(ell, [], 300)
    expect(tidied(ell, tidy).at(-1)).toEqual(expect.objectContaining({ x: 1000, y: 1600 }))
    const stem = line([{ x: 2000, y: 1000 }, { x: 2000, y: 1600 }])
    const bar = line([{ x: 1970, y: 1300 }, { x: 2400, y: 1300 }])
    expect(Math.abs(tidied(bar, tidyStroke(bar, [stem], 300))[0]!.x - 2000)).toBeLessThanOrEqual(1)
    // Nothing to do: nothing changes, and again after.
    expect(changes(tidyStroke(stem, [], 300), stem.length)).toBe(false)
  })

  it("moves each separate letter onto its word's baseline, an i's dot with it, a p's stem left on its tail", () => {
    // An i (stem and dot) 40 units high, an o on the line at 1300, a p: stem to its tail, bowl closing on the line.
    const stem = line([{ x: 1000, y: 1060 }, { x: 1000, y: 1260 }])
    const dot = line([{ x: 1000, y: 980 }, { x: 1004, y: 984 }])
    const o = line(arc(1250, 1150, 150, 150, 0, 1))
    const pStem = line([{ x: 1500, y: 1000 }, { x: 1500, y: 1600 }])
    const bowl = line(arc(1650, 1150, 150, 150, Math.PI, 1))
    const shifts = letterShifts([stem, dot, o, pStem, bowl], 300)
    expect(shifts).toEqual([40, 40, 0, 0, 0])
  })

  it('brings a word drifting upward letter by letter onto its line, together', () => {
    const letters = [0, 1, 2, 3].map((k) => line(arc(1000 + 350 * k, 1150 - 30 * k, 150, 150, 0, 1)))
    const shifts = letterShifts(letters, 300)
    // Four o's, each 30 units higher: the word's line is the middle of them, and every o comes onto it.
    const base = baselineOf(letters, 300)!
    expect(shifts.map((v, k) => Math.round(1300 - 30 * k + v - base))).toEqual([0, 0, 0, 0])
  })

  it("spaces the words of a line evenly, every gap the same, the first staying, a narrow gap (maybe inside a word) left", () => {
    // Gaps of 1000, 600 and 1000: the 600 is widened to 1000. A gap of 300 would be left.
    expect(spacingShifts([{ x0: 0, x1: 1000 }, { x0: 2000, x1: 3000 }, { x0: 3600, x1: 4500 }, { x0: 5500, x1: 6000 }], 300)).toEqual([0, 0, 400, 400])
    // Two words just touching (an i and its s, the i's dot over the s's start): left as they are.
    expect(spacingShifts([{ x0: 0, x1: 1000 }, { x0: 2000, x1: 2130 }, { x0: 2110, x1: 2400 }, { x0: 3400, x1: 4000 }], 300)).toEqual([0, 0, 0, 0])
    // Spaced, the line would end at 6400; kept to 6200, its gaps are narrowed evenly until it fits.
    const kept = spacingShifts([{ x0: 0, x1: 1000 }, { x0: 2000, x1: 3000 }, { x0: 3600, x1: 4500 }, { x0: 5500, x1: 6000 }], 300, 6200)
    expect(6000 + kept[3]!).toBeLessThanOrEqual(6200)
    expect(Math.abs(2000 + kept[1]! - 1000 - (3600 + kept[2]! - 3000 - kept[1]!))).toBeLessThanOrEqual(2)
    // A word written under another at the line's end, no room to move it out even at half a word's gap: left as written.
    expect(spacingShifts([{ x0: 0, x1: 1000 }, { x0: 1100, x1: 2000 }, { x0: 1200, x1: 1400 }], 300, 2000)).toEqual([0, 0, 0])
    // The gap the person chooses: gaps of 1000, 600 and 1000 (usual 1000).
    const line = [{ x0: 0, x1: 1000 }, { x0: 2000, x1: 3000 }, { x0: 3600, x1: 4500 }, { x0: 5500, x1: 6000 }]
    expect(spacingShifts(line, 300, undefined, 'wider')).toEqual([0, 400, 1200, 1600])
    expect(spacingShifts(line, 300, undefined, 'tighter')).toEqual([0, -300, -200, -500])
    // The first gap between words, 1000 here as the usual; as written, only words over each other moved apart.
    expect(spacingShifts(line, 300, undefined, 'first')).toEqual([0, 0, 400, 400])
    expect(spacingShifts(line, 300, undefined, 'written')).toEqual([0, 0, 0, 0])
    expect(spacingShifts([{ x0: 0, x1: 1000 }, { x0: 2000, x1: 3000 }, { x0: 2200, x1: 2400 }, { x0: 3400, x1: 4000 }], 300, undefined, 'written')).toEqual([0, 0, 1800, 1800])
    // The person's digits: two gaps far under the others but far over a word's (1.4 and 2.8 letter sizes) are gaps
    // between words too, and every gap is made the same.
    const digits = [{ x0: 0, x1: 500 }, { x0: 1080, x1: 1800 }, { x0: 4110, x1: 5000 }, { x0: 7310, x1: 8000 }, { x0: 10310, x1: 11500 }, { x0: 12640, x1: 13500 }]
    const shifted = spacingShifts(digits, 410)
    const after = digits.map((d, i) => ({ x0: d.x0 + shifted[i]!, x1: d.x1 + shifted[i]! }))
    const gaps = after.slice(1).map((d, i) => d.x0 - after[i]!.x1)
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(2)
    // Gaps of 900, 1000 and 1100: each made 1000.
    expect(spacingShifts([{ x0: 0, x1: 1000 }, { x0: 1900, x1: 3000 }, { x0: 4000, x1: 4500 }, { x0: 5600, x1: 6000 }], 300)).toEqual([0, 100, 100, 0])
    expect(spacingShifts([{ x0: 0, x1: 1000 }, { x0: 2000, x1: 3000 }, { x0: 3300, x1: 4000 }, { x0: 5000, x1: 6000 }], 300)).toEqual([0, 0, 0, 0])
    // A word lying over the one before it (written over or under it) is moved to a word's gap after it, and the rest with it.
    expect(spacingShifts([{ x0: 0, x1: 1000 }, { x0: 2000, x1: 3000 }, { x0: 2200, x1: 2400 }, { x0: 3400, x1: 4000 }], 300)).toEqual([0, 0, 1800, 1800])
  })

  it('tidies only the writing in a box dragged over it', () => {
    let doc = createDoc()
    const page = doc.pages[0]!
    const ids = (() => {
      let n = 0
      return (): Id => `box${String(n++).padStart(5, '0')}`
    })()
    let last: LastStroke | undefined
    let now = 1000
    // A line of two words, the second 1 mm low, and below it, out of the box, another such line.
    for (const [x, y] of [[2000, 3000], [3400, 3100], [2000, 6000], [3400, 6100]] as const) {
      for (const points of [line([{ x, y }, { x, y: y + 600 }]), line(arc(x + 300, y + 450, 150, 150, 0, 1))]) {
        const placed = placeStroke(doc, page, { pts: triplesOf(points), color: 'ink', width: 'm' }, { now, last, newId: ids })
        doc = step(doc, placed.ops).doc
        last = { block: placed.block, at: now + 200 }
        now += 500
      }
    }
    const before = writingOn(doc, page)
    const after = writingOn(step(doc, tidyBoxOps(doc, page, { x: 1500, y: 2500, w: 3000, h: 1500 })).doc, page)
    // The top line levelled; the bottom one, outside the box, as it was.
    const middle = (refs: typeof after) => bandOf(refs.map((r) => r.page))!.middle
    expect(Math.abs(middle(after.slice(0, 2)) - middle(after.slice(2, 4)))).toBeLessThan(15)
    expect(after.slice(4).map((r) => r.page)).toEqual(before.slice(4).map((r) => r.page))
  })
})
