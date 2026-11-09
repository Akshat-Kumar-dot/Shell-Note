// How a numbered item's number is shown: 1. at the top level, a. one level
// in, i. the next, then numbers again, as word processors do, so a sub-list
// does not read as a broken list. Markdown export keeps plain numbers.

export function listMarker(level: number, number: number): string {
  switch (level % 3) {
    case 1:
      return letters(number)
    case 2:
      return roman(number)
    default:
      return String(number)
  }
}

/** 1 → a, 26 → z, 27 → aa. */
function letters(n: number): string {
  let out = ''
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) out = String.fromCharCode(97 + ((rest - 1) % 26)) + out
  return out
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

/** 1 → i, 4 → iv, 14 → xiv. */
function roman(n: number): string {
  let out = ''
  let rest = n
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      out += digits
      rest -= value
    }
  }
  return out
}
