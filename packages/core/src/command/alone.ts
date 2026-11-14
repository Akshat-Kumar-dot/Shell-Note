// No call to the model at all: a request the finder knows word for word, as one of a command's own ways of being said
// with its values in their places, runs with no model, when the command only changes the view or the tools in hand.
// Anything else goes to the model as before. Measured before it was used: on 900 requests Gemma 4 E4B wrote, the
// finder's word-for-word matches were 8 right and 2 wrong, both changing data ("Deleted notes" read as note.delete,
// "Undo my undo" as edit.undo), so no command that changes a note, a folder, a file or the history runs alone; its
// loose matches (by letters) were 27 right and 10 wrong, so none of them does.
import type { Finder } from './finder.js'

/**
 * The commands that may run with no model: each changes only how the app looks or which tool is in hand, and another
 * command puts it back. Never one that changes a note, the library, a file, the history, the AI or the pen's learning.
 */
export const ALONE: ReadonlySet<string> = new Set([
  'library.open', 'library.sort', 'bin.open',
  'tool.choose', 'pen.set', 'highlighter.set', 'eraser.set',
  'screen.zoom', 'screen.page', 'screen.fullscreen',
  'panel.show', 'panel.hide', 'panel.full', 'bar.place', 'bar.float', 'bar.turn',
  'video.show', 'video.hide', 'video.play', 'video.pause', 'video.times',
  'output.answers', 'output.made',
  'timer.start', 'timer.pause', 'timer.stop',
  'settings.open', 'settings.theme', 'settings.accent',
  'ai.open', 'ai.close',
])

/** A request that asks for an answer, not a change ("Can you…?" asks for a change). */
export const QUESTION = /^(?:what|which|who|whose|where|when|why|how|is|are|am|was|were|does|did|has|have|isn't|aren't|doesn't)\b/iu

/**
 * A request to put words, headings or drawings into the note itself: a writing verb first, then words in quotes or a
 * thing of the note's content.
 */
export const CONTENT = /^(?:please\s+)?(?:write|type|insert|add|put|draw|enter)\b.*(?:["'“‘][^"'”’]+["'”’]|\b(?:text|words?|heading|sentence|paragraph|line|bullet|drawing|sketch)\b)/iu

/** The command a request runs with no model, and its inputs; undefined when the model is to be asked. */
export function aloneOf(finder: Finder, request: string): { command: string; input: Record<string, unknown> } | undefined {
  const said = request.trim()
  if (QUESTION.test(said) || CONTENT.test(said)) return undefined
  const found = finder.findNow(said)
  if (found.kind !== 'found' || found.by !== 'key' || found.missing.length > 0 || !ALONE.has(found.command)) return undefined
  return { command: found.command, input: found.input }
}
