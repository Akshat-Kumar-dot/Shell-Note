// Formulas in note control (step 3;, 24 October 2026): the LaTeX written under the line, the delimiters a model puts
// around it taken off, and a light check that it holds together, in core with no package: braces, \left with \right,
// \begin with \end. The app draws no formula yet (phase 4 brings MathLive, whose own check replaces this one then): a
// math block shows its LaTeX until then, so a broken one is caught here or not at all.

/** The LaTeX of a formula written under a line: $$…$$, $…$, \[…\] or \(…\) around it taken off, and a fence's lines. */
export function texOf(words: string): string {
  let tex = words.trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/u.exec(tex)
  if (fenced) tex = fenced[1]!.trim()
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']] as const) {
    if (tex.length > open.length + close.length && tex.startsWith(open) && tex.endsWith(close)) {
      tex = tex.slice(open.length, -close.length).trim()
      break
    }
  }
  return tex
}

/** The formula with what LaTeX does not read as maths taken out: comments (% to the end of a line) and escaped characters. */
function bare(tex: string): string {
  return tex
    .split('\n')
    .map((line) => line.replace(/(?<!\\)%.*$/u, ''))
    .join('\n')
    .replace(/\\[\\{}$%&#_^ ]/gu, '  ')
}

/** Null when a formula holds together, else what is wrong with it, in words the model can act on. */
export function texHint(tex: string): string | null {
  if (tex.trim() === '') return 'No formula: write its LaTeX on the lines under the line, then end.'
  const plain = bare(tex)
  // Braces: every { closed, none closed that was not opened.
  let depth = 0
  for (const char of plain) {
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth < 0) return 'A } closes a { that was never opened: write the formula again with its braces in pairs.'
    }
  }
  if (depth > 0) return `${depth === 1 ? 'A {' : `${depth} {`} ${depth === 1 ? 'is' : 'are'} never closed: write the formula again with its braces in pairs.`
  // \left and \right in pairs (\middle may stand between them).
  const lefts = plain.match(/\\left(?![A-Za-z])/gu)?.length ?? 0
  const rights = plain.match(/\\right(?![A-Za-z])/gu)?.length ?? 0
  if (lefts !== rights) return `The formula has ${lefts} \\left and ${rights} \\right: each \\left( needs its \\right).`
  // Each \begin{…} closed by its own \end{…}, in order.
  const open: string[] = []
  for (const match of plain.matchAll(/\\(begin|end)\s*\{([^}]*)\}/gu)) {
    const name = match[2]!.trim()
    if (match[1] === 'begin') open.push(name)
    else {
      const last = open.pop()
      if (last === undefined) return `\\end{${name}} closes nothing: it needs a \\begin{${name}} before it.`
      if (last !== name) return `\\begin{${last}} is closed by \\end{${name}}: close it with \\end{${last}}.`
    }
  }
  if (open.length > 0) return `\\begin{${open.at(-1)!}} is never closed: end it with \\end{${open.at(-1)!}}.`
  // A $ left inside: the formula is written alone, with no $ signs.
  if (plain.includes('$')) return 'Write the formula alone, in LaTeX, with no $ signs inside it (write \\$ for a dollar sign).'
  return null
}
