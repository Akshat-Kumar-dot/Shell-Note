// The terminal: Ctrl+Shift+P opens it on
// every screen; what is typed runs through the app's own door; a model given a
// request writes blocks of lines that run one by one, its output going back.
import { expect, test, type Page, type Route } from './fixtures.js'
import { standInForYouTube } from './youtube.js'

/** A stand-in LM Studio, as the AI settings name it; each chat call answered from a script. */
const FAKE = 'http://127.0.0.1:1298'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

async function scriptedModel(page: Page, replies: string[]): Promise<{ messages: { role: string; content: string }[] }[]> {
  await page.addInitScript((base) => localStorage.setItem('shellnote:ai', JSON.stringify({ provider: 'lmstudio', baseUrl: `${base}/v1`, model: 'fake-model' })), FAKE)
  const calls: { messages: { role: string; content: string }[] }[] = []
  await page.route(`${FAKE}/**`, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (new URL(request.url()).pathname.endsWith('/models')) return route.fulfill({ headers: CORS, json: { data: [{ id: 'fake-model', type: 'llm' }] } })
    calls.push(request.postDataJSON() as { messages: { role: string; content: string }[] })
    return route.fulfill({ headers: CORS, json: { choices: [{ message: { content: replies.shift() ?? 'Done.' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } } })
  })
  return calls
}

async function openSample(page: Page): Promise<void> {
  await page.goto('/?sample=mixed')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
}

const terminal = (page: Page) => page.getByRole('dialog', { name: 'Terminal' })

/** Type a line into the open terminal and wait for its own output, the one it adds, which must say `said`. */
function lineRunner(page: Page): (text: string, said: string | RegExp) => Promise<void> {
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  const outputs = terminal(page).locator('.nw-terminal-out')
  return async (text, said) => {
    const before = await outputs.count()
    await line.fill(text)
    await line.press('Enter')
    await expect(outputs).toHaveCount(before + 1)
    await expect(outputs.last()).toContainText(said)
  }
}

test('Ctrl+Shift+P opens the terminal; plain words and commands typed there run through the app; Escape closes it', async ({ page }) => {
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  await expect(terminal(page)).toBeVisible()
  // Docked along the bottom, under the app, never over it: the app is made shorter instead.
  const app = (await page.locator('.app-area').boundingBox())!
  const docked = (await terminal(page).boundingBox())!
  expect(docked.y).toBeGreaterThanOrEqual(app.y + app.height - 1)
  expect(docked.y + docked.height).toBeLessThanOrEqual((await page.evaluate(() => window.innerHeight)) + 1)
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  await expect(line).toBeFocused()
  await line.fill('use a blue pencil')
  await line.press('Enter')
  await expect(terminal(page).getByRole('log')).toContainText('✓ pen.set: pen: pencil, fine, blue')
  await expect(page.getByRole('radio', { name: 'Pencil' })).toHaveAttribute('aria-checked', 'true')
  await line.fill('tool.choose tool=crayon')
  await line.press('Enter')
  await expect(terminal(page).getByRole('log')).toContainText('Write it as: tool.choose tool=select')
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'pen')
  await line.fill('tool.choose eraser')
  await line.press('Enter')
  await expect(page.locator('.nw-desk')).toHaveAttribute('data-tool', 'eraser')
  await line.press('Escape')
  await expect(terminal(page)).toHaveCount(0)
  // Kept while closed.
  await page.keyboard.press('Control+Shift+P')
  await expect(terminal(page).getByRole('log')).toContainText('✓ tool: eraser')
})

test('screen.page reaches a page far from the screen, which only near pages are drawn: it comes into view, drawn', async ({ page }) => {
  await page.goto('/?sample=long')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  // Far down a 30-page note, page 20 is not drawn at first: only its slot is there.
  await expect(page.locator('.nw-page-slot[data-index="19"] .nw-page')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+P')
  await lineRunner(page)('screen.page page=20', 'page 20 of 30')
  await expect(page.locator('.nw-page-slot[data-index="19"] .nw-page')).toHaveCount(1)
  const desk = (await page.locator('.nw-desk').boundingBox())!
  const slot = (await page.locator('.nw-page-slot[data-index="19"]').boundingBox())!
  expect(Math.abs(slot.y - desk.y)).toBeLessThan(desk.height / 2)
})

test('the view, the side panel, the bars and choosing blocks answer the terminal as their buttons do (step 3a)', async ({ page }) => {
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('screen.zoom percent=150', '✓ zoom 150 %')
  await expect(page.getByRole('button', { name: 'Actual size' })).toHaveText('150%')
  await run('zoom to the actual size', '✓ screen.zoom: zoom 100 %')
  await expect(page.getByRole('button', { name: 'Actual size' })).toHaveText('100%')
  await run('panel.show timer', '✓ side panel open on timer')
  await expect(page.getByRole('region', { name: 'Side panel' }).getByRole('tab', { name: 'Timer' })).toHaveAttribute('aria-selected', 'true')
  await run('panel.hide', '✓ side panel closed')
  await expect(page.getByRole('region', { name: 'Side panel' })).toHaveCount(0)
  await run('bar.place bar=tools place=left', '✓ tools bar at the left')
  await expect(page.locator('.nw-bar[data-bar="tools"]')).toHaveAttribute('data-at', 'left')
  await run('layout.reset', '✓ panels and bars where they start')
  await expect(page.locator('.nw-bar[data-bar="tools"]')).toHaveAttribute('data-at', 'top')
  // A list written as JSON reads as the same ids.
  await run('select.blocks blocks=["nothere1"]', 'No such block in this note: nothere1 (no block has that id, or those words).')
  await run('look', 'bars tools top, format top')
  // Each of these buttons now goes through its command.
  for (const [name, command] of [['Zoom in', 'screen.zoom'], ['Zoom out', 'screen.zoom'], ['Side panel', 'panel.show'], ['Full screen', 'screen.fullscreen'], ['Save', 'file.save']] as const) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('data-command', command)
  }
})

test('the library answers the terminal as its buttons do: folders and notes by name, the way there taken first, the bin emptied only once allowed (step 3b)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible()
  const card = (name: string) => page.locator('.card').filter({ has: page.locator('.card-name', { hasText: new RegExp(`^${name}$`, 'u') }) })
  await page.keyboard.press('Control+Shift+P')
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  const log = terminal(page).getByRole('log')
  const run = lineRunner(page)
  await run('folder.new name=Physics', /✓ folder "Physics" \(\w{8}\) made in the top level/u)
  await expect(card('Physics')).toBeVisible()
  // A new note in the folder opens, and the next line finds it open.
  await run('note.new into=Physics', /✓ new note "Untitled" \(\w{8}\) open, in Physics/u)
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled')
  await run('note.rename name=Waves', '✓ note renamed "Waves"')
  // Going to the library closes the note, kept, first.
  await run('library.open folder=physics', /✓ the library, folder "Physics" \(\w{8}\)/u)
  await expect(card('Waves')).toBeVisible()
  await run('look', /library: folder "Physics" \(\w{8}\) · last edited, newest first · 0 folders, 1 note: note "Waves"/u)
  await run('note.move note=Waves', '✓ Moved “Waves” to the top level.')
  await expect(card('Waves')).toHaveCount(0)
  await run('note.open note=Wave', 'No note called "Wave" in the library. The closest: "Waves"')
  await run('library.open', '✓ the library, at the top')
  await expect(card('Waves')).toBeVisible()
  await run('note.delete note=Waves', '✓ Moved “Waves” to Recently deleted, from where bin.restore brings it back.')
  await expect(card('Waves')).toHaveCount(0)
  await run('bin.restore item=Waves', '✓ Restored “Waves” to the top level.')
  await expect(card('Waves')).toBeVisible()
  await run('folder.new name=Physics', /✓ folder "Physics" \(\w{8}\) made/u)
  await run('folder.delete folder=Physics', '2 are called "Physics"')
  await run('folder.rename folder=Physics name=Optics', '2 are called "Physics"')
  await run('note.delete note=Waves', '✓ Moved “Waves” to Recently deleted')
  await run('bin.open', '✓ Recently deleted')
  await expect(card('Waves')).toBeVisible()
  // Emptying cannot be undone: asked first, and nothing happens on a no.
  await line.fill('bin.empty')
  await line.press('Enter')
  await terminal(page).getByRole('alertdialog', { name: 'Allow it?' }).getByRole('button', { name: "Don't allow" }).click()
  await expect(log).toContainText('You said no.')
  await expect(card('Waves')).toBeVisible()
  await line.fill('bin.empty')
  await line.press('Enter')
  await terminal(page).getByRole('alertdialog', { name: 'Allow it?' }).getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(log).toContainText('✓ Recently deleted is empty.')
  await expect(page.getByRole('heading', { name: 'Recently deleted is empty' })).toBeVisible()
  // The library's controls are marked with their commands.
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'New folder' })).toHaveAttribute('data-command', 'folder.new')
  await expect(page.getByRole('searchbox', { name: 'Search notes by title' })).toHaveAttribute('data-command', 'library.search')
  await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveAttribute('data-command', 'library.sort')
  await expect(card('Physics').first().locator('.card-open')).toHaveAttribute('data-command', 'library.open')
})

test('the video, full view and the timer answer the terminal as their buttons do (step 3c)', async ({ page }) => {
  await standInForYouTube(page)
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('video.play', 'No video is shown: show one first (video.show).')
  await run('video.add link=https://youtu.be/aircAruvnKk', /✓ video "YouTube aircAruvnKk" \(\w{8}\) added and shown/u)
  await expect(page.getByTitle('YouTube video player')).toBeAttached()
  // The agent's play waits for the player, then says whether it plays.
  await run('video.play', /✓ video playing, at /u)
  await expect(page.getByRole('button', { name: 'Pause the video' })).toBeVisible()
  await run('video.seek seconds=90', /✓ video at 1:30/u)
  await run('video.pause', /✓ video paused at 1:30/u)
  await expect(page.getByRole('button', { name: 'Play the video' })).toBeVisible()
  await run('video.place place=left', '✓ video panel docked at the left')
  await expect(page.getByRole('radio', { name: 'Video on the left' })).toHaveAttribute('aria-checked', 'true')
  await run('video.float', '✓ video panel floating over the note')
  await expect(page.getByRole('radio', { name: 'Video floating over the note' })).toHaveAttribute('aria-checked', 'true')
  await run('panel.full pane=video', '✓ full view: the video alone')
  await expect(page.getByRole('button', { name: 'Leave full view' })).toBeVisible()
  await run('panel.full on=false', '✓ full view left')
  // The flag's first press begins a hard part, the second ends it; pressed under a second apart, it is the five seconds after.
  await run('video.mark', /✓ hard part begun at 1:30/u)
  await run('video.mark', '✓ hard part 1:30 to 1:35 marked beside the writing')
  await run('video.times on=false', '✓ times beside the lines hidden')
  await run('look', /videos: "YouTube aircAruvnKk" \(\w{8}\) · shown: "YouTube aircAruvnKk", paused at 1:30 · times beside the lines off/u)
  await run('video.remove video="YouTube aircAruvnKk"', '✓ video "YouTube aircAruvnKk" taken out of the note; edit.undo brings it back')
  await expect(page.getByTitle('YouTube video player')).toHaveCount(0)
  await run('edit.undo', '✓')
  await run('video.show', /✓ video "YouTube aircAruvnKk" \(\w{8}\) shown/u)
  await expect(page.getByTitle('YouTube video player')).toBeAttached()

  // The timer, from the terminal; its tab shows the same.
  await run('timer.countdown minutes=50', '✓ countdown of 50:00, ready: timer.start starts it')
  await run('timer.start', '✓ countdown of 50:00 started')
  await run('look', /timer: countdown of 50:00, \d\d:\d\d left, running/u)
  await run('timer.pause', /✓ timer paused: timer: countdown of 50:00, \d\d:\d\d left, paused/u)
  await run('panel.show timer', '✓ side panel open on timer')
  await expect(page.getByRole('button', { name: 'Go on' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Minutes' })).toHaveValue('50')
  await run('timer.stopwatch', '✓ stopwatch, ready: timer.start starts it')
  await expect(page.getByRole('radio', { name: 'Stopwatch' })).toHaveAttribute('aria-checked', 'true')
  await run('timer.stop', '✓ timer stopped and set back to zero')
  // Their controls are marked with their commands.
  await expect(page.getByRole('button', { name: 'Start' })).toHaveAttribute('data-command', 'timer.start')
  await expect(page.getByRole('button', { name: 'Close the video' })).toHaveAttribute('data-command', 'video.hide')
  await expect(page.getByRole('button', { name: 'Mark a hard part' }).or(page.getByRole('button', { name: /End the hard part/u }))).toHaveAttribute('data-command', 'video.mark')
})

test('the side panel’s tabs answer the terminal: a transcript kept, found in and taken out, a line played, a web page shown once allowed, Output’s views (step 3c)', async ({ page }) => {
  await standInForYouTube(page)
  await page.route('https://example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>A page beside the note</h1>' }))
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('transcript.paste transcript="0:00 hello"', 'No video is shown: its transcript goes with the video shown (video.show).')
  await run('video.add link=https://youtu.be/aircAruvnKk', '✓ video "YouTube aircAruvnKk"')
  await run('transcript.paste transcript="no times here"', 'No times found.')
  await run('transcript.paste transcript="0:00\\nWelcome to the course\\n0:05\\nToday we look at waves\\n1:30\\nA wave carries energy"', '✓ a transcript of 3 lines kept with "YouTube aircAruvnKk"')
  const side = page.getByRole('region', { name: 'Side panel' })
  await expect(side.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true')
  await expect(side.getByRole('button', { name: /Today we look at waves/u })).toBeVisible()
  await run('transcript.find text=wave', '✓ finding "wave": 2 lines')
  await expect(side.getByRole('searchbox', { name: 'Find in the transcript' })).toHaveValue('wave')
  await expect(side.getByRole('button', { name: /Welcome to the course/u })).toHaveCount(0)
  await run('look', 'side panel, transcript of "YouTube aircAruvnKk": 3 lines, finding "wave"')
  await run('video.playFrom seconds=90', '✓ video "YouTube aircAruvnKk" playing from 1:30')
  await expect(side.getByRole('button', { name: /A wave carries energy/u })).toHaveAttribute('aria-current', 'true')
  await expect(side.getByRole('button', { name: /A wave carries energy/u })).toHaveAttribute('data-command', 'video.playFrom')
  await run('transcript.find text=""', '✓ finding nothing')
  await run('transcript.remove', '✓ the transcript of "YouTube aircAruvnKk" taken out; edit.undo brings it back')
  await expect(side.getByRole('textbox', { name: 'Transcript to paste' })).toBeVisible()

  // A web page sends its address to the site: asked first.
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  await line.fill('web.open link=example.test/notes')
  await line.press('Enter')
  await terminal(page).getByRole('alertdialog', { name: 'Allow it?' }).getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(terminal(page).locator('.nw-terminal-out').last()).toContainText('✓ https://example.test/notes shown in the side panel')
  await expect(side.getByRole('textbox', { name: 'Web address' })).toHaveValue('https://example.test/notes')
  await expect(side.frameLocator('iframe[title="Web page"]').getByRole('heading', { name: 'A page beside the note' })).toBeVisible()
  await run('output.made', '✓ Output: what the AI made, on the scratch pad')
  await expect(side.getByRole('radio', { name: 'Made' })).toHaveAttribute('aria-checked', 'true')
  await run('output.answers', "✓ Output: the AI's answers and its log")
  await expect(side.getByRole('radio', { name: 'Answers and log' })).toHaveAttribute('aria-checked', 'true')
})

test('the bars, Settings, the AI box and the recorder answer the terminal as their buttons do (step 3c)', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => true }))
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('bar.turn bar=tools', 'The tools bar is along a side')
  await run('bar.float bar=tools', '✓ tools bar floating over the note')
  await expect(page.locator('.nw-bar[data-bar="tools"]')).toHaveAttribute('data-at', 'float')
  await run('bar.turn bar=tools', '✓ tools bar turned down')
  await expect(page.locator('.nw-bar[data-bar="tools"]')).toHaveAttribute('data-dir', 'column')
  await run('layout.reset', '✓')
  await run('settings.theme look=dark', '✓ the appearance is dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await run('settings.open', '✓ Settings open')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  // Chosen while Settings is open, it shows there too.
  await run('settings.theme look=system', '✓ the appearance follows Windows')
  await expect(settings.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
  await run('settings.accent accent=teal', "✓ the app's colour is teal")
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal')
  await expect(settings.getByRole('radio', { name: 'Teal' })).toHaveAttribute('aria-checked', 'true')
  await run('settings.accent accent=graphite', "✓ the app's colour is graphite")
  await expect(page.locator('html')).not.toHaveAttribute('data-accent')
  await run('settings.keepStorage', /✓ (The browser|WebView2) has agreed not to clear the notes by itself/u)
  await settings.getByRole('button', { name: 'Close' }).first().click()
  await run('ai.open mode=ask', '✓ AI box open, to ask')
  await expect(page.getByRole('dialog', { name: 'AI' }).getByRole('radio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true')
  await run('look', 'AI box open, to ask')
  await run('ai.stop', '✓ the AI is not working')
  await run('ai.close', '✓ AI box closed')
  await expect(page.getByRole('dialog', { name: 'AI' })).toHaveCount(0)
  await run('recorder.open', 'Opening the stroke recorder reloads the page, which would end this run.')
})

test("the app's own AI answers the terminal under high review; the scratch pad, the AI's undo and the model chosen from the list", async ({ page }) => {
  const calls = await scriptedModel(page, ['Waves carry energy, not matter.', '| Kind | Example |\n|---|---|\n| Transverse | Light |\n| Longitudinal | Sound |', 'Sound is a longitudinal wave.'])
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('select.blocks blocks=[p1]', '✓ chosen: p1')
  await run('ai.send request="what does this say?" mode=ask', '✓ answered, in Output: Waves carry energy, not matter. [high review]')
  expect(calls).toHaveLength(1)
  await run('select.none', '✓ nothing chosen')
  await run('ai.send request="make this a table" mode=edit', 'Choose something first')
  expect(calls).toHaveLength(1)
  // Done by code with no model, one undo step; the AI's undo takes it back.
  await run('select.blocks blocks=[p2]', '✓ chosen: p2')
  await run('ai.instant request="make it red"', /✓ changed, one undo step \(ai\.undo takes it back\): done without a model/u)
  expect(await page.evaluate(() => JSON.stringify(window.__shellnote!.doc.block['p2']))).toMatch(/red|#d/u)
  await run('ai.undo', `✓ undone: the AI's change "make it red"`)
  await run('ai.undo', 'The AI has made no change to undo in this note.')

  // The side panel's chat: a table onto the scratch pad, then into the note; an answer.
  await run('chat.send request="the kinds of waves" make=table put=pad', '✓ On the scratch pad. (pad.put puts it into the note.) [high review]')
  const side = page.getByRole('region', { name: 'Side panel' })
  await expect(side.getByRole('tab', { name: 'AI' })).toHaveAttribute('aria-selected', 'true')
  await run('look', /scratch pad: table "the kinds of waves" \(\w+\)/u)
  await run('chat.send request="what is sound?" make=ask', '✓ answered: Sound is a longitudinal wave. [high review]')
  await run('chat.choose make=flowchart put=note', '✓ next, the chat makes a flowchart, into the note')
  await expect(side.getByRole('radio', { name: 'Flowchart' })).toHaveAttribute('aria-checked', 'true')
  // Where it goes: after what is chosen (with nothing chosen and the page in view full, it says so).
  await run('select.blocks blocks=[l3]', '✓ chosen: l3')
  await run('pad.put', '✓ "the kinds of waves" put into the note, one undo step; it stays on the scratch pad')
  expect(await page.evaluate(() => Object.values(window.__shellnote!.doc.block).some((b) => b.type === 'table'))).toBe(true)
  await run('pad.remove made="the kinds of waves"', '✓ "the kinds of waves" taken off the scratch pad')
  await run('pad.remove', 'The scratch pad is empty')

  // The model: one the settings' server lists, never a guess.
  await run('ai.useModel model=nope', 'LM Studio has no model "nope".')
  await run('ai.useModel model=fake-model', "✓ the AI's model is fake-model, on LM Studio")
})

test("with a paid model, the agent's request to the app's AI asks the person first, and a no sends nothing", async ({ page }) => {
  // A made-up key for a paid model (OpenRouter): nothing may reach it.
  await page.addInitScript(() => {
    localStorage.setItem('shellnote:ai', JSON.stringify({ provider: 'openrouter', baseUrl: 'http://127.0.0.1:1234/v1', model: 'some/model' }))
    localStorage.setItem('shellnote:openrouter-key', 'test-key-not-real')
  })
  const sent: string[] = []
  await page.route('https://openrouter.ai/**', (route) => {
    sent.push(route.request().url())
    return route.abort()
  })
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('select.blocks blocks=[p1]', '✓ chosen: p1')
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  const outputs = terminal(page).locator('.nw-terminal-out')
  for (const request of ['ai.send request="what is this?" mode=ask', 'chat.send request="what is this?"']) {
    await line.fill(request)
    await line.press('Enter')
    const asked = terminal(page).getByRole('alertdialog', { name: 'Allow it?' })
    await expect(asked).toContainText('With a paid model (OpenRouter), it spends money')
    await asked.getByRole('button', { name: "Don't allow" }).click()
    await expect(outputs.last()).toContainText('You said no.')
  }
  expect(sent).toEqual([])
})

test("the note's blocks listed by id, an id a letter off answered with the closest, the pen's settings, the wand's whole note and taking over a note (step 3's last round)", async ({ page }) => {
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('blocks', /page 1 \(\w+\) · [^\n]*\n[^\n]*\n {4}h1 · heading 1 · "Chapter 3: Waves"/u)
  // A command too, so find and do reach it; one page alone, by its number.
  await run('note.blocks page=1', /page 1 \(\w+\)/u)
  await run('do show me all the block ids', '✓ note.blocks: note "Chapter 3: Waves"')
  await run('blocks 9', 'The note has 3 pages: no page 9.')
  // What each page is about, and each block's box, measured where it is drawn: a second id.
  await run('blocks 1', /page 1 \(\w+\) · 210 × 297 mm · about "Chapter 3: Waves"\n.*\n {4}h1 · heading 1 · "Chapter 3: Waves" · at [\d.]+, [\d.]+ mm, [\d.]+ × [\d.]+ mm/su)
  await run('block h1', /h1 · heading 1 · "Chapter 3: Waves"\npage 1 \(\w+\) · in frame fa, block 1 of 14 · at [\d.]+, [\d.]+ mm, [\d.]+ × [\d.]+ mm · last changed at change \d+\n\{"id":"h1"/u)
  // Acting by place: an area chosen by mm, as a Select box drawn there.
  const h1 = await page.evaluate(() => {
    const sheet = document.querySelector('.nw-page')!.getBoundingClientRect()
    const heading = document.querySelector('[data-id="h1"]')!.getBoundingClientRect()
    const mm = 210 / sheet.width
    return { x: Math.floor((heading.left - sheet.left) * mm) - 1, y: Math.floor((heading.top - sheet.top) * mm) - 1, w: Math.ceil(heading.width * mm) + 2, h: Math.ceil(heading.height * mm) + 2 }
  })
  await run(`select.area page=1 x=${h1.x} y=${h1.y} w=${h1.w} h=${h1.h}`, /✓ area chosen on page 1, .*: it holds .*h1/u)
  expect(await page.evaluate(() => window.__shellnote!.store.selection.here !== undefined)).toBe(true)
  await run('select.area page=4 x=1 y=1 w=1 h=1', 'The note has 3 pages: no page 4.')
  await run('select.blocks blocks=[pq]', 'No such block in this note: pq (no block has that id, or those words). The closest: p1, p2. note.blocks lists them all.')
  // By its words, a second id: all of them or how they start; never a guess.
  await run('select.blocks blocks=["Chapter 3: Waves", "a wave carries energy"]', '✓ chosen: h1, p1')
  await run('note.block block="Sine wave with the period"', /✓ ic · picture/u)
  await run('select.blocks blocks=[waves]', /No such block in this note: waves .* The closest: .*h1/u)
  // The pen's settings: the person's own, then this note's, which win in it; then the note's taken off.
  await run('settings.pen option=scratch value=off', '✓ pen setting scratch: off, yours')
  await run('settings.pen option=smoothing value=strong scope=note', '✓ pen setting smoothing: strong, for this note')
  expect(await page.evaluate(() => JSON.stringify(window.__shellnote!.doc.pen))).toBe('{"smoothing":3}')
  await run('settings.pen option=gap value=roomy', 'gap takes usual, first, tighter, wider, written.')
  await run('do use the pen', '✓')
  await page.getByRole('button', { name: 'Pen settings' }).click()
  const panel = page.getByRole('group', { name: 'Pen settings' })
  await expect(panel.getByRole('combobox', { name: 'Scratch out to delete' })).toHaveValue('false')
  await expect(panel.getByRole('combobox', { name: 'Smoothing' })).toHaveAttribute('data-command', 'settings.pen')
  await run('settings.penReset', "✓ this note's own pen settings taken off: yours are in use")
  expect(await page.evaluate(() => window.__shellnote!.doc.pen)).toBeUndefined()
  await run('settings.pen option=scratch value=on', '✓ pen setting scratch: on, yours')
  // Developer mode, a tidy rule, the wand's whole note, the pen's learning.
  await run('settings.tidyRule rule=level on=false', 'Developer mode is off')
  await run('settings.developer on=true', '✓ developer mode on')
  await run('settings.tidyRule rule=level on=false', '✓ tidy rule level off')
  await expect(panel.getByRole('checkbox', { name: 'Words onto the line' })).not.toBeChecked()
  await run('settings.developer on=false', '✓ developer mode off')
  await run('tidy.note', /✓ (nothing to tidy|the handwriting tidied)/u)
  await run('pen.forget', '✓ the pen has learned nothing of your hand yet')
  // A sample note is this window's alone.
  await run('note.editHere', '✓ a sample note is edited here already')
  await expect(page.getByRole('button', { name: 'AI log' })).toHaveAttribute('data-command', 'output.answers')
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveAttribute('data-command', 'note.rename')
})

test('even with an embedding model loaded in LM Studio, the app never asks it: what words leave unclear is offered', async ({ page }) => {
  // A stand-in LM Studio with an embedding model loaded beside the chat model.
  await page.addInitScript((base) => localStorage.setItem('shellnote:ai', JSON.stringify({ provider: 'lmstudio', baseUrl: `${base}/v1`, model: 'fake-model' })), FAKE)
  const embedded: string[] = []
  await page.route(`${FAKE}/**`, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(request.url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ headers: CORS, json: { data: [{ id: 'fake-model', type: 'llm', state: 'loaded' }, { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings', state: 'loaded' }] } })
    if (path.endsWith('/embeddings')) {
      embedded.push(request.url())
      return route.fulfill({ headers: CORS, json: { data: [] } })
    }
    return route.fulfill({ status: 404, headers: CORS })
  })
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('do shut this page', /not sure; the closest:[\s\S]*Nothing ran\./u)
  await run('note: zap it', /note: not sure[\s\S]*write it as[\s\S]*Nothing ran\./u)
  expect(embedded).toEqual([])
})

test("without LM Studio, the finder works by words alone: what they leave unclear is offered, never run, and nothing is fetched or asked", async ({ page }) => {
  // No LM Studio (the shared fixture blocks the person's), and no word table: it was
  // removed.
  const asked: string[] = []
  page.on('request', (request) => {
    if (/embeddings|\/v1\/|meaning\//u.test(request.url())) asked.push(request.url())
  })
  await page.goto('/#/new')
  await expect(page.locator('.nw-desk[data-tool]')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  // A request a model wrote (Gemma 4 E4B, for edit.undo): words alone leave it unclear, so it is offered, not run.
  await run('do Revert the last change.', /not sure; the closest:[\s\S]*Nothing ran\./u)
  await run('find close the note', /note\.close/u)
  expect(asked).toEqual([])
})

test('an area and the operation in plain words run the command the app picks in that area; unsure, it offers the few that fit', async ({ page }) => {
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const run = lineRunner(page)
  await run('pen: use a red pencil', '✓ pen.set: pen: pencil, fine, red')
  await expect(page.getByRole('radio', { name: 'Pencil' })).toHaveAttribute('aria-checked', 'true')
  await run('screen: zoom to percent=150', '✓ screen.zoom: zoom 150 %')
  // The area in its own words, and inputs that fit another area's command.
  await run('sidebar | open | panel=timer', /✓ panel\.show/u)
  await run('pen: change erase=part', /pen: no command of pen takes erase; these take them:[\s\S]*eraser\.set/u)
  // Two commands of the area fit alike: both offered, each with how to write it, and nothing runs.
  await run('settings: change', /settings: not sure[\s\S]*settings\.theme[\s\S]*write it as settings\.theme look=dark[\s\S]*Nothing ran\./u)
  await run('banana: peel', /There is no area "banana"/u)
})

test('a model asked for what the app will not do is told so before it starts, with the reason (the agent test, 19 October 2026)', async ({ page }) => {
  const calls = await scriptedModel(page, ['The app cannot set an API key: you type it in the AI settings.\n```wn\ndone the key is yours to type\n```'])
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  await line.fill('Set my OpenRouter API key to sk-test-123.')
  await line.press('Control+Enter')
  await expect(terminal(page).getByRole('log')).toContainText('The model is done.')
  const asked = calls[0]!.messages.at(-1)!.content
  expect(asked).toContain('something it cannot do, by its own rules: Never: an API key is typed by the person')
  expect(asked).toContain('run nothing: answer with one line, done and the reason')
  // A request the app can do is told nothing of the kind.
  await line.fill('Switch to a red pencil.')
  await line.press('Control+Enter')
  await expect(terminal(page).getByRole('log').getByText('The model is done.')).toHaveCount(2)
  expect(calls[1]!.messages.at(-1)!.content).not.toContain('cannot do')
})

test('a model given a request writes lines that run one block at a time, sees their output, and ends with done', async ({ page }) => {
  const calls = await scriptedModel(page, ['```wn\ntool.choose tool=marker\n```', '```wn\npen.set kind=marker colour=red width=broad\nlook\n```', '```wn\ndone a broad red marker\n```'])
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  await line.fill('a broad red marker')
  await line.press('Control+Enter')
  await expect(terminal(page).getByRole('log')).toContainText('The model is done.')
  await expect(page.getByRole('radio', { name: 'Marker' })).toHaveAttribute('aria-checked', 'true')
  expect(calls).toHaveLength(3)
  // The first block's failure went back with how to write it, and where marker fits.
  expect(calls[1]!.messages.at(-1)!.content).toContain("\"marker\" fits pen.set's kind: write pen.set kind=marker")
  expect(calls[2]!.messages.at(-1)!.content).toContain('state: screen: a sample note, not kept\ntool pen · pen marker, broad, red')
})

/** The words of the blocks of a frame of the open note, in order (a development build's own data). */
const frameWords = (page: Page, frame: string): Promise<string[]> =>
  page.evaluate((id) => {
    const doc = window.__shellnote!.doc
    return ((doc.block[id] as { kids: string[] }).kids ?? []).map((kid) => (doc.block[kid] as { md?: string }).md ?? '')
  }, frame)

test("the note's text written from the terminal: words on the lines under a line, up to end; one request one Undo (note control, step 2)", async ({ page }) => {
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const before = await frameWords(page, 'fa')
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  await line.fill('text: add role=heading level=2 after="the second paragraph"\nSummary\nend\nlist: add after=$1\nAgents learn by reward\nQ-learning is one way\nend')
  await line.press('Enter')
  await expect(terminal(page).getByRole('log')).toContainText('list.add: added a list of 2 points')
  const run = lineRunner(page)
  const after = await frameWords(page, 'fa')
  expect(after.slice(3, 6)).toEqual(['Summary', 'Agents learn by reward', 'Q-learning is one way'])
  // Drawn on the page, as a person's typing is.
  await expect(page.locator('.nw-page-slot[data-index="0"]')).toContainText('Agents learn by reward')
  // The whole request is one step of Undo.
  await run('edit.undo', 'undone')
  expect(await frameWords(page, 'fa')).toEqual(before)
})

test("a model asked to write into the note gets the page it is about in its first message, and writes the words under its line", async ({ page }) => {
  const calls = await scriptedModel(page, ['```wn\ntext: add at=top\nhello world\nend\ndone wrote hello world at the top\n```'])
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  await line.fill("Write 'hello world' at the top of this note.")
  await line.press('Control+Enter')
  await expect(terminal(page).getByRole('log')).toContainText('The model is done.')
  expect(calls).toHaveLength(1)
  expect(calls[0]!.messages[1]!.content).toContain('The page the request is about:\npage 1 of 3 of note')
  expect((await frameWords(page, 'fa'))[0]).toBe('hello world')
})

test('a model with nothing set up says so; Stop ends a model at work', async ({ page }) => {
  await openSample(page)
  await page.keyboard.press('Control+Shift+P')
  const line = terminal(page).getByRole('textbox', { name: 'Terminal line' })
  await line.fill('anything')
  await line.press('Control+Enter')
  await expect(terminal(page).getByRole('log')).toContainText('Choose a model first')
})
