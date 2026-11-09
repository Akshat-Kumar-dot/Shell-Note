// The AI box, the side panel's AI chat and the scratch pad as commands (app
// control, step 3c, part 3): each does what its button does, and the buttons
// call them. The agent sending a request to the app's own AI is allowed under
// high review: marked in the terminal each time, and
// asked first with a paid model, whose money cannot be taken back.
import type { Id } from '@shellnote/core'
import { emptyPartInView, padOf, putMade, removeMade, type Made } from '../layout/side/pad.js'
import { showSideTab } from '../layout/sideTab.js'
import type { By, ChatMake, ChatPlace, Commands, Places } from './run.js'

const READ_ONLY = 'This note is read-only here: it is being edited in another window.'

/** A thing on the scratch pad, by its id or what it is of; left out, the latest. */
function madeOf(doc: Id, written: unknown): Made {
  const items = padOf(doc).value
  if (items.length === 0) throw new Error('The scratch pad is empty: chat.send with put=pad makes things onto it.')
  if (written === undefined) return items[0]!
  const text = String(written).trim().toLowerCase()
  const found = items.find((item) => item.id === String(written)) ?? items.filter((item) => item.about.trim().toLowerCase() === text)
  if (!Array.isArray(found)) return found
  if (found.length === 1) return found[0]!
  const all = items.map((item) => `"${item.about}" (${item.id})`).join(', ')
  throw new Error(found.length > 1 ? `${found.length} things on the scratch pad are of "${String(written)}": name one by its id: ${all}.` : `Nothing on the scratch pad is of "${String(written)}". On it: ${all}.`)
}

export function defineAi(commands: Commands): void {
  // ----- the AI box -----
  commands.define('ai.open', ['ai'], ({ mode }, { ai }) => ai.open(mode as 'edit' | 'ask' | undefined))
  commands.define('ai.close', ['ai'], (_, { ai }) => ai.close())
  commands.define('ai.stop', ['ai'], (_, { ai }) => ai.stop())
  commands.define('ai.send', ['ai'], ({ request, mode }, { ai }) => ai.send(String(request), mode as 'edit' | 'ask' | undefined), { asksWhen: (places) => places.ai?.paid() ?? false })
  commands.define('ai.instant', ['ai'], ({ request }, { ai }) => ai.instant(String(request)))
  commands.define('ai.undo', ['workspace'], (_, { workspace }) => workspace.undoAi())

  // ----- the side panel's AI chat: for the agent, its tab opened first -----
  const chatOf = (places: Places, by: By): ChatPlace | Promise<ChatPlace> => {
    if (places.chat) return places.chat
    if (by === 'person') throw new Error('shellnote: the AI chat is not showing')
    showSideTab('ai')
    return commands.until('chat')
  }
  const inChat = async (places: Places, by: By, act: (chat: ChatPlace) => string | Promise<string>): Promise<string> => act(await chatOf(places, by))
  const asChosen = (make: unknown): ChatMake | undefined => make as ChatMake | undefined
  const wherePut = (put: unknown): 'note' | 'pad' | undefined => put as 'note' | 'pad' | undefined
  commands.define('chat.send', ['workspace'], ({ request, make, put }, places, by) => inChat(places, by, (chat) => chat.send(request === undefined ? undefined : String(request), asChosen(make), wherePut(put))), {
    asksWhen: (places) => places.chat?.paid() ?? places.ai?.paid() ?? false,
  })
  commands.define('chat.choose', ['workspace'], ({ make, put }, places, by) => inChat(places, by, (chat) => chat.choose(asChosen(make), wherePut(put))))
  commands.define('chat.stop', ['workspace'], (_, places, by) => inChat(places, by, (chat) => chat.stop()))
  commands.define('chat.frame', ['workspace'], (_, places, by) => inChat(places, by, (chat) => chat.frame()))
  commands.define('chat.clearPicture', ['workspace'], (_, places, by) => inChat(places, by, (chat) => chat.clearPicture()))
  commands.define('chat.putAnswer', ['workspace'], (_, places, by) => inChat(places, by, (chat) => chat.putAnswer()))

  // ----- the scratch pad -----
  commands.define('pad.put', ['note', 'workspace'], ({ made }, { note: { store }, workspace }) => {
    if (!workspace.editing()) throw new Error(READ_ONLY)
    const item = madeOf(store.doc.id, made)
    const chosen = store.selection.blocks.length > 0 || store.selection.here !== undefined
    if (!putMade(store, item.text, chosen ? undefined : emptyPartInView(store))) throw new Error('There is no room for it on the page in view: choose where it goes first (select.blocks), then try again.')
    return `"${item.about}" put into the note, one undo step; it stays on the scratch pad`
  })
  commands.define('pad.remove', ['note', 'workspace'], ({ made }, { note: { store } }) => {
    const item = madeOf(store.doc.id, made)
    removeMade(store.doc.id, item.id)
    return `"${item.about}" taken off the scratch pad`
  })
}

/** The scratch pad's line of the app-state map, when it holds anything. */
export function padLine(doc: Id | undefined): string | undefined {
  if (doc === undefined) return undefined
  const items = padOf(doc).value
  return items.length === 0 ? undefined : `scratch pad: ${items.map((item) => `${item.kind === 'diagram' ? 'flowchart' : item.kind === 'text' ? 'summary' : 'table'} "${item.about}" (${item.id})`).join(', ')}`
}
