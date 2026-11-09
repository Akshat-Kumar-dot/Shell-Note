// The app's state in plain sentences, for the small models' page (the prompt by the model's size). Written as the
// state line is, "tool pen · pen pencil, fine, red", a small model took it for a list of things to do: Gemma 4 E2B,
// asked for a red pencil, set the highlighter, the eraser, the zoom and the timer again, and made a note named after
// the open one. In sentences it reads as what is so. A line of a kind not known here is kept as it is.

/** "pencil, fine, red" as "a fine red pencil"; ink is "ink". */
const penWords = (kind: string, width: string, colour: string): string => `${/^[aeiou]/iu.test(width) ? 'an' : 'a'} ${width} ${colour} ${kind}`

function toolsSentences(line: string): string {
  const parts = Object.fromEntries(line.split(' · ').map((part) => [part.split(' ')[0]!, part.slice(part.indexOf(' ') + 1)]))
  const out: string[] = []
  if (parts.tool) out.push(`The tool in use is ${parts.tool}.`)
  const pen = parts.pen?.split(', ')
  if (pen?.length === 3) out.push(`The pen is ${penWords(pen[0]!, pen[1]!, pen[2]!)}.`)
  const highlighter = parts.highlighter?.split(', ')
  if (highlighter?.length === 2) out.push(`The highlighter is ${highlighter[0]} and ${highlighter[1]}.`)
  const eraser = /^(whole|part) strokes, (\w+)$/u.exec(parts.eraser ?? '')
  if (eraser) out.push(`The eraser takes ${eraser[1] === 'whole' ? 'whole strokes' : 'part of a stroke'} and is ${eraser[2]}.`)
  const history = /^undo (yes|no), redo (yes|no)$/u.exec(line.split(' · ').at(-1) ?? '')
  if (history) out.push(`${history[1] === 'yes' ? 'There is a change to undo' : 'There is nothing to undo'}, and ${history[2] === 'yes' ? 'one to redo' : 'nothing to redo'}.`)
  return out.join(' ')
}

function viewSentences(line: string): string {
  const out: string[] = []
  for (const part of line.split(' · ')) {
    const zoom = /^zoom (\d+) %$/u.exec(part)
    const side = /^side panel (closed|open on (\w+))$/u.exec(part)
    const bars = /^bars tools (\w+), format (\w+)$/u.exec(part)
    const full = /^full view (\w+)$/u.exec(part)
    const screen = /^full screen (on|off)$/u.exec(part)
    const at = (place: string): string => (place === 'float' ? 'floating' : `at the ${place}`)
    if (zoom) out.push(`Zoom is ${zoom[1]} %.`)
    else if (side) out.push(side[2] ? `The side panel is open, on its ${side[2]} tab.` : 'The side panel is closed.')
    else if (bars) out.push(`The tools bar is ${at(bars[1]!)}, the format bar ${at(bars[2]!)}.`)
    else if (full) out.push(full[1] === 'off' ? 'Full view is off.' : `Full view is on: the ${full[1]} alone.`)
    else if (screen) out.push(`Full screen is ${screen[1]}.`)
    else out.push(`${part}.`)
  }
  return out.join(' ')
}

function videoSentences(line: string): string {
  const [list, shown, times] = line.replace(/^videos: /u, '').split(' · ')
  const out = [`The note's videos: ${list}.`]
  if (shown) out.push(shown === 'none shown' ? 'None is shown.' : `${shown.replace(/^shown: /u, 'Shown: ')}.`)
  const on = /times beside the lines (on|off)/u.exec(times ?? '')
  if (on) out.push(`The times beside the lines are ${on[1]}.`)
  return out.join(' ')
}

/** One line of the state as sentences. */
function sentences(line: string): string {
  let at: RegExpExecArray | null
  if ((at = /^screen: (.*)$/u.exec(line))) return `The screen shows ${at[1]}.`
  if (line.startsWith('tool ')) return toolsSentences(line)
  if (line.startsWith('zoom ')) return viewSentences(line)
  if (line.startsWith('videos: ')) return videoSentences(line)
  if ((at = /^timer: (.*)$/u.exec(line))) return `The timer is ${/^(countdown|stopwatch)/u.test(at[1]!) ? 'a ' : ''}${at[1]}.`
  if ((at = /^note (".*" \(\w+\))(?: · (.*))?$/u.exec(line))) return `The open note is ${at[1]}${at[2] ? `, with ${at[2]}` : ''}.`
  if ((at = /^library: ([^·]+) · ([^·]+) · (.*)$/u.exec(line))) return `The library shows ${at[1]!.trim()}, sorted by ${at[2]!.trim()}; it holds ${at[3]}.`
  if ((at = /^library: (.*)$/u.exec(line))) return `The library shows ${at[1]!.replaceAll(' · ', ', ')}.`
  if ((at = /^AI chat: (\d+) turns? · next: (.*)$/u.exec(line))) return `The AI chat has had ${at[1]} ${at[1] === '1' ? 'turn' : 'turns'}; next it makes: ${at[2]}.`
  if ((at = /^AI box open, to (\w+)$/u.exec(line))) return `The AI box is open, to ${at[1]}.`
  if ((at = /^side panel, ([^:]+): (.*)$/u.exec(line))) return `The side panel's ${at[1]} tab: ${at[2]}.`
  if ((at = /^scratch pad: (.*)$/u.exec(line))) return `The scratch pad holds ${at[1]}.`
  return line
}

/** The whole state as sentences, a paragraph a line. */
export function plainState(state: string): string {
  return state
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(sentences)
    .join('\n')
}
