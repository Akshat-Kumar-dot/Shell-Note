// The finder test (the app control stage): how well steps 1 and 2 find the
// right command from requests written apart from the commands' own words, and
// the rule that matters most: a request is never found as a wrong command. A
// '-' or '!' request found as any command is wrong too. The rates are printed;
// they are measured, not chosen.
import { describe, expect, it } from 'vitest'
import { APP_COMMANDS, APP_LIMITS } from '../../src/command/app.js'
import { Finder, type FindResult } from '../../src/command/finder.js'
import { PHRASINGS } from './phrasings.js'

const finder = new Finder(APP_COMMANDS, APP_LIMITS)

/** What a result says, for the table: the command, '!' for a limit, '?' for unclear. */
const said = (result: FindResult): string => (result.kind === 'found' ? result.command : result.kind === 'impossible' ? '!' : '?')

describe('the finder on requests it was not written from', () => {
  const rows = PHRASINGS.map(([request, expected, input]) => ({ request, expected, input, result: finder.findNow(request) }))

  it('never finds a wrong command', () => {
    const wrong = rows.filter(({ expected, result }) => result.kind === 'found' && result.command !== expected)
    expect(wrong.map(({ request, expected, result }) => `"${request}": ${said(result)}, meant ${expected}`)).toEqual([])
  })

  it('never says a command is impossible, nor calls something impossible a command', () => {
    const wrong = rows.filter(({ expected, result }) => (result.kind === 'impossible' && expected !== '!') || (expected === '!' && result.kind === 'found'))
    expect(wrong.map(({ request, expected, result }) => `"${request}": ${said(result)}, meant ${expected}`)).toEqual([])
  })

  it('reads the inputs right when it finds the command', () => {
    const wrong = rows.filter(({ expected, input, result }) => input && result.kind === 'found' && result.command === expected && !Object.entries(input).every(([field, value]) => result.input[field] === value))
    expect(wrong.map(({ request, input, result }) => `"${request}": ${JSON.stringify(result.kind === 'found' ? result.input : {})}, meant ${JSON.stringify(input)}`)).toEqual([])
  })

  it('finds most commands with no model, and prints how (the measurement)', () => {
    const commands = rows.filter(({ expected }) => expected !== '-' && expected !== '!')
    const right = commands.filter(({ expected, result }) => result.kind === 'found' && result.command === expected)
    const byKey = right.filter(({ result }) => result.kind === 'found' && result.by === 'key').length
    const limits = rows.filter(({ expected }) => expected === '!')
    const limitsRight = limits.filter(({ result }) => result.kind === 'impossible').length
    const none = rows.filter(({ expected }) => expected === '-')
    const noneRight = none.filter(({ result }) => result.kind !== 'found').length
    const missed = commands.filter(({ result }) => result.kind !== 'found').map(({ request, expected, result }) => `  "${request}" (${expected}): ${result.kind === 'unclear' ? result.closest.map((c) => ('command' in c ? `${c.command} ${c.score}` : `! ${c.score}`)).join(', ') : said(result)}`)
    console.log(
      [
        `finder, steps 1 and 2, on ${rows.length} requests:`,
        `  commands found right: ${right.length} of ${commands.length} (${Math.round((100 * right.length) / commands.length)} %), ${byKey} by the exact form, ${right.length - byKey} by typos and overlap`,
        `  limits answered as limits: ${limitsRight} of ${limits.length}`,
        `  not commands, left unfound: ${noneRight} of ${none.length}`,
        `  wrong commands: 0`,
        `missed (for meaning, step 3, or more ways of saying):`,
        ...missed,
      ].join('\n'),
    )
    // A floor against a finder made worse; the measured rate is in the stage's record.
    expect(right.length / commands.length).toBeGreaterThan(0.5)
  })
})
