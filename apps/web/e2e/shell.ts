// The app's controls as a person reaches them on the note's screen: a tool in hand, the pen's settings, the video's
// menu, the panel beside the note (AI or Beside), the zoom and the way back to the library. In one place, so a
// control that moves moves its tests with it here.
import { expect, type Locator, type Page } from './fixtures.js'

export type Tool = 'type' | 'free' | 'select' | 'pen' | 'highlighter' | 'eraser'

/** The row for words, and the pen's row, while each shows. */
export const textRow = (page: Page): Locator => page.getByRole('toolbar', { name: 'Formatting' })
export const penRow = (page: Page): Locator => page.getByRole('toolbar', { name: /^(Pen|Highlighter|Eraser)$/u })

/** The tool in hand, from the desk. */
const inHand = (page: Page): Promise<string | null> => page.locator('.nw-desk[data-tool]').first().getAttribute('data-tool')

/** Choose from the row for words' More menu: the ways a press on the page works. */
async function fromMore(page: Page, name: 'Type' | 'Free cursor' | 'Select'): Promise<void> {
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
}

/**
 * Take a tool in hand as a person does: the pen from the row for words (its Pen), the highlighter and the eraser from
 * the pen's row; Type, the free cursor and Select from either row (the pen's has Select and Type, the words' row has
 * them all under More).
 */
export async function chooseTool(page: Page, tool: Tool): Promise<void> {
  const desk = page.locator('.nw-desk[data-tool]').first()
  await expect(desk).toBeVisible()
  if ((await inHand(page)) === tool) return
  const ink = (await penRow(page).count()) > 0
  if (tool === 'pen' || tool === 'highlighter' || tool === 'eraser') {
    // The pen's row first: the words' row has the Pen; in the pen's row the Pen is a menu once it is in hand.
    if (!ink) await textRow(page).getByRole('button', { name: 'Pen', exact: true }).click()
    else if (tool === 'pen') await penRow(page).getByRole('button', { name: 'Pen', exact: true }).click()
    if (tool !== 'pen') await penRow(page).getByRole('button', { name: tool === 'highlighter' ? 'Highlighter' : 'Eraser', exact: true }).click()
  } else if (ink && tool !== 'free') {
    await penRow(page).getByRole('button', { name: tool === 'select' ? 'Select' : 'Type', exact: true }).click()
  } else {
    if (ink) await penRow(page).getByRole('button', { name: 'Type', exact: true }).click()
    if ((await inHand(page)) !== tool) await fromMore(page, tool === 'free' ? 'Free cursor' : tool === 'select' ? 'Select' : 'Type')
  }
  await expect(desk).toHaveAttribute('data-tool', tool)
}

/** The pen's settings, opened from the pen's menu (the pen taken in hand first). Escape closes them. */
export async function openPenSettings(page: Page): Promise<Locator> {
  await chooseTool(page, 'pen')
  await penRow(page).getByRole('button', { name: 'Pen', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pen settings' }).click()
  const panel = page.getByRole('group', { name: 'Pen settings' })
  await expect(panel).toBeVisible()
  return panel
}

/** The rail's button for one of the panel's two sections. */
const railButton = (page: Page, section: 'ai' | 'beside'): Locator => page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: section === 'ai' ? 'AI panel' : 'Beside the note', exact: true })

/** The panel beside the note, open on its AI section. */
export async function openAi(page: Page): Promise<Locator> {
  const button = railButton(page, 'ai')
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  const panel = page.getByRole('region', { name: 'Side panel' })
  await expect(panel).toHaveAttribute('data-section', 'ai')
  return panel
}

/** The panel beside the note, open on Beside, and on one of its parts. */
export async function openBeside(page: Page, part: 'video' | 'web' = 'video'): Promise<Locator> {
  const button = railButton(page, 'beside')
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  const panel = page.getByRole('region', { name: 'Side panel' })
  await expect(panel).toHaveAttribute('data-section', 'beside')
  const radio = panel.getByRole('radio', { name: part === 'video' ? 'Video' : 'Web page', exact: true })
  if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click()
  await expect(radio).toHaveAttribute('aria-checked', 'true')
  return panel
}

/** A part of the panel: the AI's Chat, Changes or Scratch pad, or the video's Description, Transcript or Timer. */
export async function openPart(page: Page, part: 'Chat' | 'Changes' | 'Scratch pad' | 'Description' | 'Transcript' | 'Timer' | 'Web page'): Promise<Locator> {
  const panel = part === 'Chat' || part === 'Changes' || part === 'Scratch pad' ? await openAi(page) : await openBeside(page, part === 'Web page' ? 'web' : 'video')
  if (part !== 'Web page') await panel.getByRole('tab', { name: part, exact: true }).click()
  return panel
}

/** The video's menu: a YouTube link, a video file, the note's videos; at the head of Beside. */
export async function openVideoMenu(page: Page): Promise<Locator> {
  const panel = await openBeside(page, 'video')
  await panel.getByRole('button', { name: 'Video', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Videos' })
  await expect(menu).toBeVisible()
  return menu
}

/** A YouTube video added from the video's menu, shown inside Beside. */
export async function addYouTube(page: Page, link: string): Promise<void> {
  const menu = await openVideoMenu(page)
  await menu.getByLabel('YouTube link').fill(link)
  await menu.getByRole('button', { name: 'Add', exact: true }).click()
}

/** Zoom from the status line's menu, which closes with the choice. */
export async function zoom(page: Page, step: 'in' | 'out' | 'actual'): Promise<void> {
  await page.locator('.sh-status').getByRole('button', { name: 'Zoom', exact: true }).click()
  await page.getByRole('menuitem', { name: step === 'in' ? 'Zoom in' : step === 'out' ? 'Zoom out' : 'Actual size', exact: true }).click()
}

/** Back to the library from a note: its tab, first in the row. */
export async function toLibrary(page: Page): Promise<void> {
  await page.getByRole('tablist', { name: 'Open notes' }).getByRole('tab', { name: 'Library' }).click()
}

/** A choice of the note's own menu, at the tabs' end: save, open a file, the notes alone, what the AI changed. */
export async function noteMenu(page: Page, item: 'Save' | 'Save as' | 'Open file' | 'AI log' | 'Full view: the notes alone' | 'Leave full view'): Promise<void> {
  await page.getByRole('button', { name: 'This note', exact: true }).click()
  await page.getByRole(item === 'Full view: the notes alone' || item === 'Leave full view' ? 'menuitemcheckbox' : 'menuitem', { name: item, exact: true }).click()
}

/** The words' style, size or font, from the row for words. */
export async function textStyle(page: Page, style: 'Paragraph' | 'Heading 1' | 'Heading 2' | 'Heading 3' | 'Bullet list' | 'Numbered list' | 'To-do list' | 'Quote'): Promise<void> {
  await textRow(page).getByRole('button', { name: 'Style', exact: true }).click()
  await page.getByRole('menuitemradio', { name: style, exact: true }).click()
}
export async function textSize(page: Page, size: 'Small' | 'Normal size' | 'Large' | 'Extra large'): Promise<void> {
  await textRow(page).getByRole('button', { name: 'Font and size', exact: true }).click()
  await page.getByRole('menu', { name: 'Font and size' }).getByRole('radio', { name: size, exact: true }).click()
  await page.keyboard.press('Escape')
}
export async function textFont(page: Page, font: string): Promise<void> {
  await textRow(page).getByRole('button', { name: 'Font and size', exact: true }).click()
  await page.getByRole('menu', { name: 'Font and size' }).getByRole('menuitemradio', { name: font, exact: true }).click()
}

/** The eraser's way, from its menu (the eraser taken in hand first). */
export async function eraserWay(page: Page, way: 'Whole strokes' | 'Part of a stroke'): Promise<void> {
  await chooseTool(page, 'eraser')
  await penRow(page).getByRole('button', { name: 'Eraser', exact: true }).click()
  await page.getByRole('menuitemradio', { name: way, exact: true }).click()
}

/** The pen's kind, from its menu (the pen taken in hand first). */
export async function penKind(page: Page, kind: 'Plain pen' | 'Pencil' | 'Fountain pen' | 'Marker'): Promise<void> {
  await chooseTool(page, 'pen')
  await penRow(page).getByRole('button', { name: 'Pen', exact: true }).click()
  await page.getByRole('menuitemradio', { name: kind, exact: true }).click()
  await page.keyboard.press('Escape')
}

/** The width of what is in hand, from the Width menu. */
export async function penWidth(page: Page, width: 'Extra fine' | 'Fine' | 'Medium' | 'Broad' | 'Extra broad'): Promise<void> {
  await penRow(page).getByRole('button', { name: 'Width', exact: true }).click()
  await page.getByRole('menuitemradio', { name: width, exact: true }).click()
  await page.keyboard.press('Escape')
}

/** A mark kept under the row for words' More: strikethrough, highlight, code, subscript, superscript. The menu stays open. */
export async function moreMark(page: Page, mark: 'Strikethrough' | 'Highlight' | 'Code' | 'Subscript' | 'Superscript'): Promise<Locator> {
  await textRow(page).getByRole('button', { name: 'More', exact: true }).click()
  const item = page.getByRole('menuitemcheckbox', { name: mark, exact: true })
  await item.click()
  return item
}

/** The row for words' font and size menu, open. */
export async function fontAndSize(page: Page): Promise<Locator> {
  await textRow(page).getByRole('button', { name: 'Font and size', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Font and size' })
  await expect(menu).toBeVisible()
  return menu
}

/** Which kind of pen is in hand, read from the pen's menu (opened, read, and closed again by its button). */
export async function expectPenKind(page: Page, kind: 'Plain pen' | 'Pencil' | 'Fountain pen' | 'Marker'): Promise<void> {
  const pen = penRow(page).getByRole('button', { name: 'Pen', exact: true })
  await pen.click()
  await expect(page.getByRole('menuitemradio', { name: kind, exact: true })).toHaveAttribute('aria-checked', 'true')
  await pen.click()
}

/** Where the video sits, read from its menu (opened, read, and closed again by its button). */
export async function expectVideoAt(page: Page, where: 'Video inside the Beside panel' | 'Video on the left' | 'Video on the right' | 'Video above' | 'Video below' | 'Video floating over the note'): Promise<void> {
  const button = page.getByRole('button', { name: 'Where the video sits', exact: true })
  await button.click()
  await expect(page.getByRole('menuitemradio', { name: where, exact: true })).toHaveAttribute('aria-checked', 'true')
  await button.click()
}

/** The block's alignment, from the row for words' Align and indent menu. */
export async function textAlign(page: Page, align: 'Align left' | 'Centre' | 'Align right'): Promise<void> {
  await textRow(page).getByRole('button', { name: 'Align and indent', exact: true }).click()
  await page.getByRole('menuitemradio', { name: align, exact: true }).click()
  await page.keyboard.press('Escape')
}

/** Where the video sits, chosen from its menu: inside Beside, beside the note on either side, above or below it, or floating. */
export async function videoPlace(page: Page, where: 'Video inside the Beside panel' | 'Video on the left' | 'Video on the right' | 'Video above' | 'Video below' | 'Video floating over the note'): Promise<void> {
  await page.getByRole('button', { name: 'Where the video sits', exact: true }).click()
  await page.getByRole('menuitemradio', { name: where, exact: true }).click()
}

/** The zoom as the status line shows it, on its button. */
export const zoomShown = (page: Page): Locator => page.locator('.sh-status').getByRole('button', { name: 'Zoom', exact: true })
