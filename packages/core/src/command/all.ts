// Every command the terminal knows: the app's (app control) and the note's (note control, step 2), one table for the
// router, the reader, the finder and the door.
import { NOTE_COMMANDS } from '../note/commands.js'
import { APP_COMMANDS } from './app.js'
import type { CommandSpec } from './spec.js'

export const COMMANDS: readonly CommandSpec[] = [...APP_COMMANDS, ...NOTE_COMMANDS]
