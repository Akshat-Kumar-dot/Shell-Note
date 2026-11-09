// The note's commands (note control, step 2, piece 2; the of 21 October 2026 of 24 October): writing and changing
// the text inside a note, in the same form as the app's commands (app.ts): area.verb, inputs from the one vocabulary
// (command/spec.ts), the words people use for each (lexicon.ts), so the area router finds them as it finds the
// app's. Each is made into the note's own operations by compile.ts, and runs through the same door; blocks are named
// in words (refer.ts), words go on the lines under the command up to a line `end`, and a block's words are rewritten
// by diff. Step 3 (24 October 2026) adds tables, maths, diagrams and pictures; boxes and pages come with step 4.
import { inputs, type CommandSpec } from '../command/spec.js'

/** Where a new block goes: after or before a block, or at the top or the end of a page. */
const PLACE = ['after', 'before', 'at', 'page'] as const

export const NOTE_COMMANDS: readonly CommandSpec[] = [
  // ----- text: headings, paragraphs, quotes -----
  {
    name: 'text.add',
    does: 'Write a heading, a paragraph or a quote into the note, after or before a block or at the top or end of a page; its words on the lines under the line, then end',
    says: ['add a heading', 'write a paragraph', 'add a {role}', 'put a title above', 'insert a sentence after', 'write this under the heading'],
    input: inputs(['words'], ['role', 'level', ...PLACE]),
    example: { role: 'heading', level: 2, after: 'p2', words: 'Summary' },
  },
  {
    name: 'text.rewrite',
    does: "Rewrite a block's words: the new words on the lines under the line, then end; what stayed keeps its marks",
    says: ['rewrite the paragraph', 'reword the heading', 'make the paragraph shorter', 'fix the wording of', 'rephrase this sentence'],
    input: inputs(['block', 'words']),
    example: { block: 'the second paragraph', words: 'A wave carries energy from place to place.' },
  },
  {
    name: 'text.look',
    does: "Change how a block of text looks: its size, colour, font or alignment",
    says: ['make the heading {colour}', 'make the text {size}', 'center the title', 'use the {font} font for', 'colour the paragraph'],
    input: inputs(['block'], ['size', 'colour', 'font', 'align']),
    example: { block: 'h1', colour: 'blue', size: 'large' },
  },
  {
    name: 'text.role',
    does: 'Make a block of text another kind: a paragraph, a heading (level 1 to 3), a quote, or an item of a list',
    says: ['make it a heading', 'turn the paragraph into a {role}', 'change the heading to a paragraph', 'make this a quote'],
    input: inputs(['block'], ['role', 'level']),
    example: { block: 'p1', role: 'heading', level: 2 },
  },
  {
    name: 'text.indent',
    does: "Move a block of text one level in: a list's item under the one above it",
    says: ['indent the item', 'nest this under the one above', 'move the point in', 'make it a sub point'],
    input: inputs(['block']),
    example: { block: 'l2' },
  },
  {
    name: 'text.outdent',
    does: 'Move a block of text one level out',
    says: ['outdent the item', 'unindent the point', 'move it out a level', 'take the item out of the nesting'],
    input: inputs(['block']),
    example: { block: 'l2' },
  },
  {
    name: 'text.tick',
    does: 'Tick a to-do as done, or untick it (on=off)',
    says: ['tick the to-do', 'mark the task done', 'check off the item', 'untick the to-do'],
    input: inputs(['block'], ['on']),
    example: { block: 'td' },
  },
  // ----- lists -----
  {
    name: 'list.add',
    does: 'Write a list into the note: points, numbered or to-dos, an item a line under the line, then end; after or before a block, or at the top or end of a page',
    says: ['add a list', 'make a {style} list', 'write a checklist', 'list the points under', 'add bullet points'],
    input: inputs(['words'], ['style', ...PLACE]),
    example: { style: 'bullet', after: 'p2', words: 'Agents learn by reward\nQ-learning is one way' },
  },
  {
    name: 'list.addItem',
    does: "Add items to a list: at its end (block= any of its items) or after one (after=); an item a line under the line, then end",
    says: ['add an item to the list', 'add one more point', 'add a step after', 'append to the list'],
    input: inputs(['words'], ['block', 'after']),
    example: { block: 'l1', words: 'Surface waves' },
  },
  // ----- any block -----
  {
    name: 'block.move',
    does: 'Move a block: after or before another, or to the top or end of a page, in the text; or onto the page, to a part of it (to=top right…), beside= or below= a block (a picture, formula, diagram, box or handwriting)',
    says: ['move the paragraph after', 'put the heading before', 'move this to the end of page {page}', 'move the list up', 'put the photo in the {to} of the page', 'place the formula beside'],
    input: inputs(['block'], [...PLACE, 'to', 'beside', 'below']),
    example: { block: 'p2', before: 'p1' },
  },
  {
    name: 'block.resize',
    does: 'Make a block placed on the page, a box or a table wider or narrower: span=half, third or full width, or wider, narrower (one in the text: move it onto the page first)',
    says: ['make the picture {span}', 'resize the diagram', 'make the box wider', 'shrink the table to half width', 'make the photo full width'],
    input: inputs(['block', 'span']),
    example: { block: 'the picture', span: 'half' },
  },
  // ----- boxes and pages (step 4) -----
  {
    name: 'box.new',
    does: 'Make a box of text on the page, where there is room: beside= or below= a block, or to= a part of a page; its words under the line, then end',
    says: ['add a box beside', 'put a text box at the {to}', 'make a note box below', 'add a side box', 'create a callout box'],
    input: inputs(['words'], ['beside', 'below', 'to', 'page']),
    example: { beside: 'the first paragraph', words: 'Remember: waves carry energy, not matter.' },
  },
  {
    name: 'page.add',
    does: 'Add a page to the note, with room for text: after or before a page (after=2), or at the end',
    says: ['add a page', 'insert a new page after page {page}', 'make another page', 'add a blank page at the end', 'new page before'],
    input: inputs([], ['after', 'before', 'at']),
    example: { after: '1' },
  },
  {
    name: 'page.move',
    does: 'Move a page of the note: to= its new number, or after= or before= another page',
    says: ['move page {page} to the front', 'put page {page} after', 'reorder the pages', 'make page {page} the first', 'swap the pages'],
    input: inputs(['page'], ['to', 'after', 'before', 'at']),
    example: { page: 3, to: 1 },
  },
  {
    name: 'page.remove',
    does: 'Take a page out of the note, with everything on it (Undo brings it back)',
    says: ['delete page {page}', 'remove the last page', 'get rid of the empty page', 'take out page {page}'],
    input: inputs(['page']),
    example: { page: 3 },
    asks: 'It takes everything on the page with it.',
  },
  {
    name: 'page.paper',
    does: "Change a page's paper: blank, ruled, squares or dots (left out page=: the page the request is about)",
    says: ['make the page {paper}', 'use squared paper', 'change the paper to ruled', 'give page {page} dots', 'lined paper'],
    input: inputs(['paper'], ['page']),
    example: { paper: 'ruled', page: 2 },
  },
  {
    name: 'block.remove',
    does: 'Take a block out of the note (Undo brings it back)',
    says: ['delete the paragraph', 'remove the heading', 'take out the empty line', 'get rid of the quote'],
    input: inputs(['block']),
    example: { block: 'the quote' },
  },
  // ----- recipes and the shape rules (step 5;) -----
  {
    name: 'recipe.qa',
    does: 'Write questions and answers: Q: and A: lines under the line (or a question ending in ?, its answer under it), then end; each question a heading 3, its answer a paragraph',
    says: ['make a q and a', 'write questions and answers', 'turn these into a q&a', 'add a quiz of questions', 'write a faq'],
    input: inputs(['words'], PLACE),
    example: { after: 'p2', words: 'Q: What does a wave carry?\nA: Energy, not matter.' },
  },
  {
    name: 'recipe.section',
    does: 'Write a section: its title on the first line under the line, then a point a line, then end; a heading 2 with its points as a list',
    says: ['add a section on', 'write a section about', 'make a section with points', 'start a new section', 'add a part on'],
    input: inputs(['words'], PLACE),
    example: { at: 'end', words: 'Kinds of waves\nTransverse\nLongitudinal' },
  },
  {
    name: 'recipe.summary',
    does: 'Write a summary: a point a line under the line, then end; a heading 2 "Summary" with the points as a list',
    says: ['add a summary', 'summarise this as points', 'write a short summary', 'sum up the page', 'add the key points'],
    input: inputs(['words'], PLACE),
    example: { at: 'end', words: 'Waves carry energy, not matter\nf = 1/T' },
  },
  {
    name: 'recipe.compare',
    does: 'Write a comparison: a Markdown table under the line, or Thing: a; b; c lines (the first the header), then end; a table with a header row, banded',
    says: ['compare these', 'make a comparison of', 'write a table comparing', 'set them side by side', 'contrast the two'],
    input: inputs(['words'], PLACE),
    example: { after: 'p2', words: 'Wave: Speed; Medium\nSound: 343 m/s; air\nLight: 3e8 m/s; none' },
  },
  {
    name: 'recipe.steps',
    does: 'Write steps in order: a step a line under the line, then end; a numbered list (a flowchart is diagram: add)',
    says: ['write the steps', 'list the steps to', 'make a how to', 'write the method as steps', 'number the steps'],
    input: inputs(['words'], PLACE),
    example: { after: 'p2', words: 'Measure the period\nCompute the frequency' },
  },
  {
    name: 'recipe.definition',
    does: 'Write a definition: the term on the first line under the line and its meaning under it (or Term: its meaning), then end; a quote, the term in bold',
    says: ['define', 'add a definition of', 'write what it means', 'add the meaning of', 'explain the term'],
    input: inputs(['words'], PLACE),
    example: { after: 'p2', words: 'Wavelength\nThe distance between two crests.' },
  },
  {
    name: 'write.add',
    does: 'Write content and let the app choose its shape (a list, steps, a table, a definition, a formula, a diagram or paragraphs) and say which: the content under the line, then end',
    says: ['write this in the best shape', 'put this in', 'add this content', 'write it as you see fit', 'add these notes'],
    input: inputs(['words'], PLACE),
    example: { after: 'p2', words: 'Measure the period\nCompute the frequency\nCheck the units' },
  },
  // ----- tables (step 3;: the whole table rewritten, rows and columns by commands) -----
  {
    name: 'table.add',
    does: 'Write a table into the note: a Markdown table on the lines under the line (a row a line, the cells between | signs, a line of dashes under the header row), then end; after or before a block, or at the top or end of a page',
    says: ['add a table', 'make a table of', 'insert a table after', 'put a comparison table', 'create a table with'],
    input: inputs(['words'], PLACE),
    example: { after: 'p2', words: '| Wave | Speed |\n| --- | --- |\n| Sound | 343 m/s |' },
  },
  {
    name: 'table.rewrite',
    does: 'Rewrite a table: the whole table again as a Markdown table under the line, then end; cells that stayed keep their marks, the columns their widths',
    says: ['rewrite the table', 'change the numbers in the table', 'fix the table', 'update the table', 'edit a cell of the table'],
    input: inputs(['block', 'words']),
    example: { block: 'the table', words: '| Wave | Speed |\n| --- | --- |\n| Sound | 340 m/s |' },
  },
  {
    name: 'table.addRow',
    does: "Add rows to a table: each a line of cells between | signs under the line, then end; after the row named (row=: its number or its first cell's words), or at the end",
    says: ['add a row', 'add a row for', 'insert a row after', 'one more row', 'add rows to the table'],
    input: inputs(['block', 'words'], ['row']),
    example: { block: 'the table', row: 'Sound', words: '| Light | 300,000 km/s |' },
  },
  {
    name: 'table.addColumn',
    does: "Add a column to a table: its cells under the line, one a line from the header down, then end; after the column named (column=: its number or its header's words), or at the end",
    says: ['add a column', 'add a column for', 'insert a column after', 'one more column', 'add columns to the table'],
    input: inputs(['block', 'words'], ['column']),
    example: { block: 'the table', words: 'Kind\nlongitudinal\ntransverse' },
  },
  {
    name: 'table.removeRow',
    does: "Take a row out of a table: row= its number or its first cell's words",
    says: ['remove the row', 'delete the row', 'take out the row', 'drop the last row', 'get rid of the row'],
    input: inputs(['block', 'row']),
    example: { block: 'the table', row: 'Light' },
  },
  {
    name: 'table.removeColumn',
    does: "Take a column out of a table: column= its number or its header's words",
    says: ['remove the column', 'delete the column', 'take out the column', 'drop the last column', 'get rid of the column'],
    input: inputs(['block', 'column']),
    example: { block: 'the table', column: 'Speed' },
  },
  {
    name: 'table.look',
    does: "How a table looks: a grid, lines between the rows, banded rows or a header row (design=), and whether its first row is a header (head=on|off)",
    says: ['make the table {design}', 'use banded rows', 'give the table a header row', 'style the table', 'change the look of the table'],
    input: inputs(['block'], ['design', 'head']),
    example: { block: 'the table', design: 'banded' },
  },
  // ----- maths (step 3;: the LaTeX checked in core, the app draws no formula until phase 4) -----
  {
    name: 'maths.add',
    does: 'Write a formula into the note: its LaTeX on the lines under the line, alone (no $ signs), then end; after or before a block, or at the top or end of a page',
    says: ['add the formula for', 'write an equation', 'insert the equation', 'put a formula under', 'add the maths for'],
    input: inputs(['words'], PLACE),
    example: { after: 'p2', words: 'E_k = \\frac{1}{2} m v^2' },
  },
  {
    name: 'maths.rewrite',
    does: 'Rewrite a formula: its new LaTeX under the line, then end',
    says: ['rewrite the formula', 'change the equation', 'fix the formula', 'correct the equation', 'edit the maths'],
    input: inputs(['block', 'words']),
    example: { block: 'the formula', words: 'v = f \\lambda' },
  },
  // ----- diagrams (step 3: Mermaid, the three kinds the AI box writes) -----
  {
    name: 'diagram.add',
    does: 'Draw a diagram into the note: its Mermaid under the line (a flowchart, a pie or an xychart), then end; after or before a block, or at the top or end of a page',
    says: ['add a flowchart of', 'draw a diagram of', 'make a pie chart of', 'insert a chart', 'put a flow chart under'],
    input: inputs(['words'], PLACE),
    example: { after: 'p2', words: 'flowchart LR\n  A[Source] --> B[Medium] --> C[Receiver]' },
  },
  {
    name: 'diagram.rewrite',
    does: 'Rewrite a diagram: its new Mermaid under the line, then end; it keeps the kind it has',
    says: ['rewrite the diagram', 'change the flowchart', 'fix the diagram', 'add a step to the flowchart', 'update the chart'],
    input: inputs(['block', 'words']),
    example: { block: 'the diagram', words: 'flowchart LR\n  A[Source] --> B[Medium] --> C[Receiver]' },
  },
  // ----- pictures (step 3;: only pictures of the person's other notes; this note's are moved)
  // -----
  {
    name: 'picture.add',
    does: "Put a picture of another note into this one: picture= its description, caption or note; after or before a block, or at the top or end of a page; a caption under the line, then end, if wanted (one this note has: block: move)",
    says: ['add the picture of', 'put the photo from', 'insert the image of', 'bring in the picture from my other note', 'use the picture from'],
    input: inputs(['picture'], [...PLACE, 'words']),
    example: { picture: 'the circuit photo from my Electronics note', after: 'p2' },
  },
  {
    name: 'picture.caption',
    does: "Write a picture's caption, shown under it: the words under the line, then end",
    says: ['caption the picture', 'add a caption to', 'write a caption under the photo', 'change the caption', 'label the image'],
    input: inputs(['block', 'words']),
    example: { block: 'the picture', words: 'A ripple tank, from above' },
  },
  {
    name: 'picture.describe',
    does: "Write a picture's description, for screen readers and the AI: the words under the line, then end",
    says: ['describe the picture', 'write a description of the photo', 'add alt text to', 'change the description of the image', 'say what the picture shows'],
    input: inputs(['block', 'words']),
    example: { block: 'the picture', words: 'Ripples spreading from a dipper in a shallow tank' },
  },
]
