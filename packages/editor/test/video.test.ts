// The ⏱ beside lines written beside a video: lines of writing only, never a dot, a line
// or an arrow; each with when it was written, from and to, a rest of 4 s ending it.
import type { InkBlock, Stroke } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { LINE_REST, marksOf, runsOf } from '../src/video/VideoMarks.js'

const at = (...xy: number[]): number[] => xy.flatMap((v, i) => (i % 2 === 1 ? [v, 128] : [v]))
/** A letter 3 mm tall, written up and down as a hand writes. */
const letter = (x: number, y: number, t: number, e: number): Stroke => ({ pts: at(x, y, x + 50, y + 300, x + 100, y, x + 150, y + 300), color: 'black', width: 'm', vt: { m: 'Vid00001', t, e } })
const block = (strokes: Stroke[]): InkBlock => ({ id: 'ink00001', r: 0, type: 'ink', page: 'p1', x: 1000, y: 2000, w: 2000, h: 1500, strokes }) as InkBlock

describe('when each line was written', () => {
  it('runs on while the pen rests less than 4 s, and a longer rest begins another run', () => {
    expect(LINE_REST).toBe(40)
    expect(runsOf([{ t: 140, e: 170 }, { t: 100, e: 130 }, { t: 250 }])).toEqual([
      { from: 100, to: 170 },
      { from: 250, to: 250 },
    ])
    expect(runsOf([{ t: 100, e: 130 }, { t: 170 }])).toEqual([{ from: 100, to: 170 }])
  })

  it('gives a line of letters one mark, from its first letter to its last, a dot added later not stretching it', () => {
    const dot: Stroke = { pts: at(210, -100, 214, -100), color: 'black', width: 'm', vt: { m: 'Vid00001', t: 900 } }
    const marks = marksOf(block([letter(0, 0, 100, 120), letter(200, 0, 130, 150), letter(400, 0, 160, 180), dot]))
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ media: 'Vid00001', runs: [{ from: 100, to: 180 }], x: 1000, y: 2150 })
  })

  it('gives none to an arrow or a line on its own, nor to a lone dot', () => {
    const arrow: Stroke = { pts: at(0, 1000, 1500, 1000, 1400, 950, 1500, 1000, 1400, 1050), color: 'black', width: 'm', vt: { m: 'Vid00001', t: 300 } }
    const line: Stroke = { pts: at(0, 1400, 1500, 1400), color: 'black', width: 'm', straight: true, vt: { m: 'Vid00001', t: 320 } }
    const marks = marksOf(block([letter(0, 0, 100, 120), letter(200, 0, 130, 150), arrow, line]))
    expect(marks.map((mark) => mark.runs)).toEqual([[{ from: 100, to: 150 }]])
    expect(marksOf(block([{ pts: at(0, 0, 4, 0), color: 'black', width: 'm', vt: { m: 'Vid00001', t: 50 } }]))).toEqual([])
  })
})
