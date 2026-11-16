// The sample documents, checked and frozen so no test can change them by accident.
import { validateDoc, type Doc } from '../../src/index.js'
import { deepFreeze } from '../helpers.js'
import board from './board.json' with { type: 'json' }
import empty from './empty.json' with { type: 'json' }
import mixed from './mixed.json' with { type: 'json' }
import physics from './physics.json' with { type: 'json' }

const load = (raw: unknown): Doc => deepFreeze(validateDoc(structuredClone(raw)))

/** The example document from : one page, one frame, an image and a stroke. */
export const PHYSICS = load(physics)
/** Every block type and role, two columns, three pages, and a frame continued on the next page. */
export const MIXED = load(mixed)
/** A new document: one page with one empty frame. */
export const EMPTY = load(empty)

/** A board: four nodes joined into a flowchart with a way back, a box of text beside it, and ink on a node. */
export const BOARD = load(board)

export const FIXTURES = { physics: PHYSICS, mixed: MIXED, empty: EMPTY, board: BOARD } as const
