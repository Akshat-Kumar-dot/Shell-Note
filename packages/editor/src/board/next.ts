// A step added after the chosen one, by Tab or the row's Add a step after: core's stepOps puts it (between the step
// and its next, the rest moving along; after a decision, one more branch), through the board's own command, so a key, a
// button and the terminal do the same. The new step is chosen, the caret in its words.
import type { Id } from '@shellnote/core'
import { commands } from '../commands/index.js'
import type { EditorStore } from '../store.js'
import { typingStep } from './active.js'

/** Add a step after the one step chosen; its id, or undefined when none was added (the reason told the person). */
export async function addStepAfter(store: EditorStore): Promise<Id | undefined> {
  const before = new Set(Object.keys(store.doc.block))
  try {
    // board.add with no place named goes after the one step chosen (commands/content.ts).
    await commands.do('board.add', {})
  } catch (error) {
    window.alert(error instanceof Error ? error.message.replace(/^shellnote: /u, '') : String(error))
    return undefined
  }
  const made = Object.keys(store.doc.block).find((id) => !before.has(id) && store.doc.block[id]?.type === 'node')
  if (made === undefined) return undefined
  store.select({ blocks: [made] }, 'objects')
  typingStep.set(made)
  return made
}
