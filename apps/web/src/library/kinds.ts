// What a note is for, as the library, the tabs and the library column show it: an icon and a word for each kind. A
// note of no kind, made before notes had one, is a mixed note: pages that hold both writing and drawing.
import type { NoteKind } from '@shellnote/core'
import { FileText, Layers, PenLine, Workflow, type LucideIcon } from 'lucide-react'

export const KIND_ICON: Readonly<Record<NoteKind, LucideIcon>> = { text: FileText, sketch: PenLine, mixed: Layers, board: Workflow }
export const KIND_WORD: Readonly<Record<NoteKind, string>> = { text: 'Text', sketch: 'Sketch', mixed: 'Mixed', board: 'Board' }

/** A note's kind, a mixed note's when it has none. */
export const kindOf = (note: { kind?: NoteKind | undefined }): NoteKind => note.kind ?? 'mixed'
