// Pasted transcripts read into timed lines.
import { describe, expect, it } from 'vitest'
import { transcriptOf } from '../src/video/transcript.js'

describe('a pasted transcript', () => {
  it('reads YouTube’s own copy: a time on its own line, then the words', () => {
    expect(transcriptOf('0:00\nWelcome to the course\n0:05\nToday: neural networks,\nand why\n1:02:03\nThe end')).toEqual([
      { t: 0, text: 'Welcome to the course' },
      { t: 50, text: 'Today: neural networks, and why' },
      { t: 37230, text: 'The end' },
    ])
  })

  it('reads a time and the words on one line, with or without brackets', () => {
    expect(transcriptOf('[0:12] First\n0:15 Second\nnot timed')).toEqual([
      { t: 120, text: 'First' },
      { t: 150, text: 'Second' },
    ])
  })

  it('reads subtitle files, SRT and WebVTT, markup out and rolling repeats said once', () => {
    const srt = '1\n00:00:01,500 --> 00:00:04,000\nHello <i>there</i>\n\n2\n00:00:04,000 --> 00:00:06,000\nHello there\n\n3\n00:01:00,000 --> 00:01:02,000\nA minute in'
    expect(transcriptOf(srt)).toEqual([
      { t: 15, text: 'Hello there' },
      { t: 600, text: 'A minute in' },
    ])
    const vtt = 'WEBVTT\nKind: captions\n\n00:00.000 --> 00:02.000\n<c.yellow>Hi</c>\n\n00:02.500 --> 00:05.000\nagain'
    expect(transcriptOf(vtt)).toEqual([
      { t: 0, text: 'Hi' },
      { t: 25, text: 'again' },
    ])
  })

  it('finds nothing in text with no times, and does not take 99:99 for a time', () => {
    expect(transcriptOf('just some words\nand more')).toEqual([])
    expect(transcriptOf('1:99 no')).toEqual([])
  })
})
