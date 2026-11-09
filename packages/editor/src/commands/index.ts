// The app's commands, one door for everyone (app control; the person's plan of
// 19 October 2026). Each area gives its commands their code here, and a line to
// the app-state map the agent reads.
import { defineAi, padLine } from './ai.js'
import { defineContent } from './content.js'
import { definePen } from './pen.js'
import { Commands } from './run.js'
import { defineSide, sideLine } from './side.js'
import { defineTimer, timerLine } from './timer.js'
import { defineTools, toolsLine } from './tools.js'
import { defineVideo, videoLine } from './video.js'
import { defineView, viewLine } from './view.js'

/** The one door: buttons call commands.do, the agent commands.run. */
export const commands = new Commands()

defineTools(commands)
defineView(commands)
defineVideo(commands)
defineTimer(commands)
defineSide(commands)
defineAi(commands)
definePen(commands)
defineContent(commands)
commands.describe('app', () => commands.places.app?.where())
commands.describe('library', () => commands.places.home?.showing())
commands.describe('tools', () => toolsLine(commands.places.note?.store))
commands.describe('view', () => viewLine(commands.places.workspace?.zoom()))
commands.describe('video', () => (commands.places.workspace ? videoLine(commands.places.note?.store) : undefined))
commands.describe('timer', () => (commands.places.workspace ? timerLine() : undefined))
commands.describe('side', () => (commands.places.workspace ? sideLine(commands.places.note?.store) : undefined))
commands.describe('ai', () => commands.places.ai?.line())
commands.describe('chat', () => commands.places.chat?.line())
commands.describe('pad', () => (commands.places.workspace ? padLine(commands.places.note?.store.doc.id) : undefined))

export { Commands, type AiPlace, type AppPlace, type By, type ChatMake, type ChatPlace, type DoerOptions, type Doer, type HomePlace, type ItemRef, type LibraryAt, type Need, type NewNote, type Places, type PicturesPlace, type Ran, type WorkspacePlace } from './run.js'
export { chooseTool } from './tools.js'
export { beginNoteRequest } from './content.js'
export { setChoiceLog, type ChoiceEntry } from './choices.js'
export { NO_TIMES } from './side.js'
export { NOT_YOUTUBE } from './video.js'
