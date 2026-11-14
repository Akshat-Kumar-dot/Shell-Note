// App control's parity check (what Playwright can reach, a command can do): every visible
// control on every screen calls a command, marked data-command with a command of the table, or is on the list of
// what stays the person's, with the reason.
import { APP_COMMANDS } from '@shellnote/core'
import { expect, inApp, test, type Page } from './fixtures.js'
import { standInForYouTube } from './youtube.js'
import { chooseTool, openPart, openPenSettings, openVideoMenu, penRow, textRow } from './shell.js'

test.use({ viewport: { width: 1366, height: 900 } })

/** A control as the check sees it. */
interface Control {
  tag: string
  name: string
  cls: string
  command: string | undefined
  within: string
}

const CONTROLS = 'button, input, select, textarea, a[href], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"]'

/** Every control in sight, but the terminal's own. */
function controls(page: Page): Promise<Control[]> {
  return page.evaluate((selector) => {
    const seen = new Set<Element>()
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => {
        if (seen.has(el)) return false
        seen.add(el)
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && !el.closest('.nw-terminal') && (el as HTMLInputElement).type !== 'hidden'
      })
      .map((el) => {
        const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.closest('label')?.textContent ?? el.textContent ?? ''
        const holder = el.closest('[aria-label], [role="dialog"], [role="menu"], header, aside, section')
        return {
          tag: el.tagName.toLowerCase() + (el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''),
          name: label.replace(/\s+/gu, ' ').trim().slice(0, 60),
          cls: el.className && typeof el.className === 'string' ? el.className : '',
          command: el.dataset.command,
          within: holder?.getAttribute('aria-label') ?? holder?.className ?? '',
        }
      })
  }, CONTROLS)
}

const seen: Control[] = []
async function look(page: Page, screen: string): Promise<void> {
  for (const c of await controls(page)) seen.push({ ...c, within: `${screen} › ${c.within}` })
}

/** A line typed into the terminal, which is then closed, so it covers nothing. */
async function terminal(page: Page, ...lines: string[]): Promise<void> {
  await page.keyboard.press('Control+Shift+P')
  const box = page.getByRole('textbox', { name: 'Terminal line' })
  const outputs = page.locator('.nw-terminal-out')
  for (const line of lines) {
    const before = await outputs.count()
    await box.fill(line)
    await box.press('Enter')
    await expect(outputs).toHaveCount(before + 1)
  }
  await box.press('Escape')
}

async function walk(page: Page): Promise<void> {
  await standInForYouTube(page)
  // The library: empty, then with a folder and a note; a card's menu, the move dialog, Settings.
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  await look(page, 'library, empty')
  await terminal(page, 'folder.new name=Physics', 'folder.new name=Maths')
  await look(page, 'library')
  // The library column's menu.
  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: 'Sort and place' }).click()
  await look(page, 'library, the column menu')
  await page.keyboard.press('Escape')
  await page.locator('.card').first().hover()
  await page.locator('.card-more').first().click()
  await look(page, 'library, a card menu')
  await page.getByRole('menuitem', { name: 'Move to…' }).click()
  await look(page, 'library, move dialog')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings' }).click()
  await look(page, 'library, Settings')
  await page.keyboard.press('Escape')
  // Recently deleted: a card's menu, the question before deleting for good, the toast's Undo.
  await terminal(page, 'folder.delete folder=Maths', 'bin.open')
  await look(page, 'Recently deleted')
  await page.locator('.card-more').first().click()
  await look(page, 'Recently deleted, a card menu')
  await page.getByRole('menuitem', { name: 'Delete for good' }).click()
  // The question comes once the library is read: looked at when it shows.
  await expect(page.getByRole('dialog', { name: 'Delete for good?' })).toBeVisible()
  await look(page, 'Recently deleted, asked first')
  await page.keyboard.press('Escape')
  // A question answered before going on: the walk leaves no click of the person's half done.
  await expect(page.getByRole('dialog', { name: 'Delete for good?' })).toHaveCount(0)
  // A note: its rows, their menus, the pen and its settings, the highlighter, the eraser, the wand.
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await look(page, 'note')
  // A second note: the first one's tab stays in the row, with its own close.
  await terminal(page, 'note.new name=Second')
  await expect(page.getByRole('button', { name: /^Close the tab of /u })).toBeVisible()
  await look(page, 'note, a second tab')
  for (const menu of ['Style', 'Font and size', 'Align and indent', 'More']) {
    await textRow(page).getByRole('button', { name: menu, exact: true }).click()
    await look(page, `note, ${menu} menu`)
    await page.keyboard.press('Escape')
  }
  await page.getByRole('button', { name: 'This note', exact: true }).click()
  await look(page, "note, the note's menu")
  await page.keyboard.press('Escape')
  await page.locator('.sh-status').getByRole('button', { name: 'Zoom', exact: true }).click()
  await look(page, 'note, the zoom menu')
  await page.keyboard.press('Escape')
  for (const tool of ['pen', 'highlighter', 'eraser', 'select'] as const) {
    await chooseTool(page, tool)
    await look(page, `note, ${tool}`)
  }
  await chooseTool(page, 'pen')
  await penRow(page).getByRole('button', { name: 'Pen', exact: true }).click()
  await look(page, 'note, the pen menu')
  await page.keyboard.press('Escape')
  await penRow(page).getByRole('button', { name: 'Width', exact: true }).click()
  await look(page, 'note, the width menu')
  await page.keyboard.press('Escape')
  await chooseTool(page, 'eraser')
  await penRow(page).getByRole('button', { name: 'Eraser', exact: true }).click()
  await look(page, 'note, the eraser menu')
  await page.keyboard.press('Escape')
  await openPenSettings(page)
  await look(page, 'note, pen settings')
  await page.getByRole('group', { name: 'Pen settings' }).getByRole('checkbox', { name: 'Developer mode' }).check()
  await page.getByRole('button', { name: 'What is the stroke recorder?' }).click()
  await look(page, 'note, pen settings, developer mode, the recorder')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Tidy handwriting' }).click()
  await look(page, 'note, the wand')
  await page.keyboard.press('Escape')
  // The tool bar's grip menu.
  await page.getByRole('button', { name: 'Move the tool bar' }).click()
  await look(page, 'note, the tool bar menu')
  await page.keyboard.press('Escape')
  // A video, inside Beside: the video menu, the panel, where it sits.
  await terminal(page, 'video.add link=https://youtu.be/aircAruvnKk')
  await openVideoMenu(page)
  await look(page, 'note, Video menu')
  await page.keyboard.press('Escape')
  await look(page, 'note, video inside Beside')
  await page.getByRole('button', { name: 'Where the video sits' }).click()
  await look(page, 'note, where the video sits')
  await page.keyboard.press('Escape')
  // The panel beside the note, each part.
  for (const part of ['Description', 'Transcript', 'Timer', 'Web page', 'Chat', 'Changes', 'Scratch pad'] as const) {
    await openPart(page, part)
    await look(page, `note, side panel, ${part}`)
  }
  await terminal(page, 'transcript.paste transcript="0:00 Hello\\n0:05 Waves"', 'output.made')
  await look(page, 'note, side panel, Output made')
  await terminal(page, 'panel.show transcript')
  await look(page, 'note, side panel, a transcript')
  // The video taken out, in a panel of its own.
  await terminal(page, 'video.place place=left')
  await look(page, 'note, the video in its own panel')
  await terminal(page, 'panel.hide')
  // The AI box on what is chosen.
  await page.locator('.nw-page').first().click({ position: { x: 200, y: 120 } })
  await page.keyboard.type('Waves carry energy')
  await terminal(page, 'select.area page=1 x=10 y=10 w=180 h=40', 'ai.open mode=edit')
  await look(page, 'note, AI box')
  await terminal(page, 'ai.close', 'settings.open')
  await look(page, 'note, Settings')
  await page.keyboard.press('Escape')
  // The stroke recorder.
  await page.goto('/?record=strokes')
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible()
  await look(page, 'stroke recorder')
}


/**
 * What stays the person's, each with the reason: a control here has no command on purpose. Every entry must still
 * match a control, so the list cannot go stale.
 */
const PERSON: { why: string; name?: RegExp; cls?: RegExp; within?: RegExp }[] = [
  { why: "Note control: what is inside the note, the row for words' and the page's own", name: /^(Bold|Italic|Underline|Strikethrough|Code|Highlight|Subscript|Superscript|Link|Small|Normal size|Large|Extra large|Align left|Centre|Align right|Indent less|Indent more|Ticked|Picture|Table|Paragraph|Heading [123]|Bullet list|Numbered list|To-do list|Quote|Sans|Serif|Mono|Handwriting|More fonts…|Blank|Lines|Squares|Dots|All pages|This page)$/u },
  { why: 'Note control: adding and deleting pages is what is inside the note', cls: /nw-add-page|nw-page-insert|nw-page-delete/u },
  { why: 'Where the person looks: the library column shown or hidden, on either side, sorted, its folders opened, its search (the rail’s too); its notes open with note.open', cls: /tree-(folder|clear)|sh-tabs-tree|rail-find/u },
  { why: 'Where the person looks: the library column’s search box, and its sort and place', name: /^(Search the library|Name|Last edited, newest first|Move the library to the (left|right)|Hide the library)$/u },
  { why: 'Where the person looks: a tab of a note not on screen closed, the note itself untouched', name: /^Close the tab of /u },
  { why: 'Where the person looks: both rows of tools at once, or the one in hand', name: /^Show both rows$/u },
  { why: "Opens a menu, a field or a dialog, whose own controls carry the commands (the pen's colours, a bar's places, a card's actions, the name typed, the folder chosen)", name: /^(Actions for .*|Pen settings|Video|Move the tool bar|Colour|More colours|Move to…|Rename|Paste again|Style|Font and size|Align and indent|More|Width|This note|Zoom|Sort and place|Where the video sits|Description)$/u },
  { why: "The pen and the eraser: a press takes it in hand (tool.choose, from the words' row's Pen); in hand, a press opens its kinds or its ways", name: /^(Pen|Eraser)$/u, within: /Pen|Highlighter|Eraser/u },
  { why: "In Recently deleted a card's click opens its menu, whose Restore and Delete for good carry the commands", name: /^(Folder|Note): .*Deleted /u },
  { why: "The terminal is where the agent's lines run: the person opens and closes it, from the rail or with Ctrl+Shift+P", cls: /rail-terminal/u },
  { why: 'Help: what the stroke recorder is, shown and put away', name: /^What is the stroke recorder\?$/u },
  { why: "The person's own: a voice, a file picked, a screen chosen to record, a box dragged over the writing (the wand)", name: /^(Speak|Add a picture|Add a video file \(MP4, WebM\)|Records the note, pages and pen.*|Tidy handwriting)$/u },
  { why: 'A key is typed by the person, never the agent (the YouTube key)', name: /^(YouTube Data API key|Keep the key)$/u },
  { why: "The AI's server, its address and its operations stay the person's: only the model is the agent's", name: /^(LM Studio, on this computer|OpenRouter, hosted|Address.*|Operations|Terminal page)$/u },
  { why: 'Which settings the pen panel shows; the commands take scope instead', name: /^(My defaults|This note)$/u },
  { why: 'Where to move to is chosen here; Move here carries the command', cls: /move-place/u },
  { why: "A dialog's answers, Cancel and Close: the app's own question to the person (the agent's call is asked in the terminal), or nothing done", name: /^(Cancel|Close|Delete for good|Empty it)$/u },
  { why: "The stroke recorder records the person's own hand, with their pen", within: /^stroke recorder/u },
  // Only in the app on Windows, where the panel is.
  ...(inApp
    ? [
        { why: "Other programs on a panel stay the person's: no command reaches them, for safety", name: /^Program panel/u },
        { why: "The window's own minimise, maximise and close, as Windows' title bar's", name: /^(Minimise|Maximise|Restore|Close window)$/u },
        { why: "Where the notes are kept is the person's alone to choose, in the system's own dialog: no command moves the library", name: /^(Keep them in a folder…|Keep them in the app instead)$/u },
      ]
    : []),
]

const label = (c: Control): string => `${c.within} | ${c.tag} "${c.name}"`

test('every control on every screen calls a command of the table, or is on the list of what stays the person\'s', async ({ page }) => {
  await walk(page)
  const known = new Set(APP_COMMANDS.map((c) => c.name))
  expect(seen.length).toBeGreaterThan(200)
  // Each mark names a command of the table.
  expect([...new Set(seen.filter((c) => c.command !== undefined && !known.has(c.command)).map(label))]).toEqual([])
  const used = new Set<number>()
  const left = seen.filter((c) => {
    if (c.command !== undefined) return false
    const at = PERSON.findIndex((p) => (!p.name || p.name.test(c.name)) && (!p.cls || p.cls.test(c.cls)) && (!p.within || p.within.test(c.within)) && (p.name || p.cls || p.within))
    if (at < 0) return true
    used.add(at)
    return false
  })
  // None left without a command or a reason; and every reason still has its controls.
  expect([...new Set(left.map(label))]).toEqual([])
  expect(PERSON.filter((_, i) => !used.has(i)).map((p) => p.why)).toEqual([])
  const marked = new Set(seen.flatMap((c) => (c.command ? [c.command] : [])))
  console.log(`parity: ${seen.length} controls seen over the screens, ${new Set(seen.map((c) => c.within.split(' › ')[0])).size} screens; ${marked.size} commands on buttons; ${PERSON.length} reasons for the rest`)
})
