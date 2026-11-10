// Public API of @shellnote/core.
export * from './schema/doc.js'
export { migrate } from './schema/migrate.js'
export { ID_LENGTH, idTaken, newId } from './ids.js'
export * from './units.js'
export { createDoc, type NewDoc } from './create.js'
export { FONT_LIBRARY, FONT_STYLES, fontStyleOf, libraryFont, type FontStyle, type LibraryFont } from './fonts.js'
export { ValidationError, type ErrorCode } from './validate/errors.js'
export { canonicalBlock, checkBlock, checkDocShape, checkPage } from './validate/shape.js'
export { structureProblems } from './validate/refs.js'
export { parseDoc, validateDoc } from './validate/doc.js'
export { checkOp, MoveTo, Op, type OpName, type OpOf } from './schema/ops.js'
export { apply, type Applied, type ApplyOptions } from './apply.js'
export { CONTENT_FIELDS, type ContentField, type ContentValidators } from './validate/content.js'
export {
  checkInline,
  exportMarkdown,
  normalize,
  parseInline,
  plainText,
  serializeInline,
  strip,
  type Inline,
  type Mark,
  type ReadOptions,
  type Size,
} from './markdown/inline.js'
export { lettersOf, markRange, replaceMatches, replaceRange, textLength, type MarkChange } from './markdown/range.js'
export { fromRuns, sameRuns, toRuns, type Marks, type Run } from './markdown/runs.js'
export { parsePipeTable, pipeTable, type PipeTable } from './markdown/table.js'
export { columnShares, equalShares, SHARE_TOTAL } from './shares.js'
export { frameOps, type ChildDraft } from './frame.js'
export * from './schema/protocol.js'
export { parseReply } from './ai/parse.js'
export type { Here, Selection, WordRange } from './select/selection.js'
export { boxAnchor, boxPlace, inBox, letters, makeAliases, piecesOf, type Aliases, type Near, type Selected } from './ai/alias.js'
export { blockLine, prefixFor, refersBack, systemPrompt, textOf, userPrompt, wordsLine, type CallInput, type PrefixOptions, type Prompt } from './ai/context.js'
export { cleanContent, colourIn, contentTask, linkIn, type ContentKind, type ContentTask } from './ai/content.js'
export { RULEBOOK } from './ai/rulebook.generated.js'
export { compile, type CompileInput } from './ai/compile.js'
export { spliceFor } from './splice.js'
export { cutWords, removalOps, type Cut } from './select/remove.js'
export { besideFree, freeSpace, GAP, type Spot } from './select/place.js'
export { currentPage, isKind, selectByKind, type ByKind } from './select/kind.js'
export { swapOf, swapOps, type Swap } from './ai/swap.js'
export { tableEditOps } from './ai/tableEdit.js'
export { tier0 } from './ai/tier0.js'
export { chooseByKind, instantEdit, instantPreview, type Instant, type InstantInput } from './ai/instant.js'
export { readRequest, type Band, type Reading } from './ai/intent.js'
export type { Caps, CompleteRequest, CompleteResult, Message, Model, Part, Progress, StepProgress, StopSignal } from './ai/model.js'
export { LogEntry, logLine } from './schema/log.js'
export { GRAPHS_LATER, NO_PICTURE, NO_VISION, plotsEquation, runEdit, type EditOutcome, type EditRequest } from './ai/edit.js'
export { askPrompt, runAsk, type AskOutcome, type AskRequest } from './ai/ask.js'
export { answerBlocks, answerOps, type AnswerBlock } from './ai/answer.js'
export { DIAGRAM_KINDS, diagramHint, diagramKind, mendFlowchart } from './ai/mermaid.js'
export { outsideScope, sameOutside } from './ai/scope.js'
export { linearise, type Item } from './linearise.js'
export { line, outline, type OutlineOptions } from './outline.js'
export { listNumbering, type ListMark } from './export/common.js'
export { toMarkdown, type MarkdownExport, type MarkdownOptions } from './export/markdown.js'
export { toText } from './export/text.js'
export { fromFiles, pack, toFiles, unpack, type Opened } from './io/container.js'
export { hashBytes } from './io/hash.js'
export { become, difference, same, sameBlock, sameContent } from './sync/diff.js'
export { idFrom, merge, type Merged, type MergeOptions } from './sync/merge.js'
export { mergeList, mergeText } from './sync/text.js'
export { rebase } from './sync/rebase.js'
export { compare, contentId, includes, Lineage, lineageText, mergeOptions, readLineage, Seen, seenByBoth } from './sync/lineage.js'
export {
  emptyHistory,
  HISTORY_LIMIT,
  MERGE_WINDOW_MS,
  record,
  redo,
  undo,
  type History,
  type Moved,
  type RecordOptions,
  type Step,
} from './history.js'
export { boxOf, boxOfFlat, diagonal, grown, insidePolygon, overlaps, pathLength, pointsOf, resample, respace, segmentDistance, simplify, triplesOf, type Box, type Pt } from './ink/geometry.js'
export { finish, heldBack, KEEP_CHUNK, KEEP_PRESSURE, KEEP_TOLERANCE, keptIndexes, OneEuro, PointFilter, predict, SMOOTHING, SPRINGS, StrokeModel, type TimedPt } from './ink/smooth.js'
export { ARROW_MIN, arrowShape, drawShape, FAMILY, fitAs, LINE_MIN, movedKey, ONE_BARB_MIN, recognise, scaledKey, scaledShape, SMALL_ARROW_MIN, snapAngle, straightLine, twoStrokeArrow, type RecognisedShape, type ShapeFamily } from './ink/shapes.js'
export { symbolOf } from './ink/symbols.js'
export { keepsWidth, NORMAL_PRESSURE, PEN_SIZE, pointWidth, reachOf, sizeOf, strokeWidths } from './ink/pens.js'
export { inkBlocks, inkBox, segmentsDistance, strokeBox, strokesAlong, strokesAt, strokesInBox, strokesInLoop, type StrokeRef } from './ink/hit.js'
export { editInk, JOIN_GAP, JOIN_TIME, joinedBlock, placeStroke, shifted, type InkEdit, type LastStroke } from './ink/group.js'
export { cutOps, cutStroke, eraseOps, hull, isScratch, scratchTargets } from './ink/erase.js'
export { arrowOfTwo, arrowOnLift, described, describedOn, exampleOf, heldShape, LEARN_MARGIN, Learner, MAX_UNDONE, onScreen, pointsOfExample, scratchTest, SHAPE_LABELS, straightOnLift, SYMBOL_LABELS, taughtProfile, tune, withUndone, type Described, type Known, type Margins, type SymbolLabel, type Taught } from './ink/learn.js'
export { penPoints, Recording, recordedExamples, recordedStrokes, type RecordedStroke } from './ink/recording.js'
export { bandOf, baselineOf, changes, letterShifts, levelShifts, spacingShifts, tidied, tidiedTilt, tidyStroke, tidyWord, WORD_GAP, rowsOf, ALL_TIDY_RULES, type BaselineRules, type InkBand, type LineAnchor, type TidyRules, type WordGapChoice, type LevelWord, type StrokeTidy } from './ink/neaten.js'
export { isWriting, pagePoints, samePoints, tidyBoxOps, tidyNoteOps, tidyOps, tidyStrokeOps, writingOn, type InkRef, type LineChoices } from './ink/tidy.js'
export { InkLabel, PenExample, PenMargins, PenProfile } from './schema/profile.js'
export { APP_COMMANDS, APP_LIMITS } from './command/app.js'
export { ALONE, aloneOf, CONTENT, QUESTION } from './command/alone.js'
export { COMMANDS } from './command/all.js'
export { NOTE_COMMANDS } from './note/commands.js'
export { compileNote, itemsOf, paragraphsOf, type Compiled, type NoteContext, type NoteInput } from './note/compile.js'
export { aboutTheText, namedIn, referTo, wordsInFull, type ReferContext, type Referred } from './note/refer.js'
export { rewriteBlocks, rewriteMd, type Rewritten } from './note/rewrite.js'
export { tableOf, tableWords } from './note/table.js'
export { texHint, texOf } from './note/maths.js'
export { pictureFrom, type PictureFound, type PictureSource } from './note/pictures.js'
export { featuresOf, shapeOf, type Features, type Shape as ContentShape } from './note/recipes.js'
export { AREAS, areaOf, operationOf, STRICT, VERBS, type Area } from './command/lexicon.js'
export { FIRST_WORDS, kindOf, pageFacts, pagePicture, quoted, type Drawn, type PageFacts, type Placed } from './note/picture.js'
export { changeReport } from './note/report.js'
export { route, ROUTE_RULES, type Routed, type RouteRules } from './command/router.js'
export { CLEAR_GAP, Finder, MEANING_CUTOFF, MEANING_GAP, OVERLAP_CUTOFF, type By, type Candidate, type Embedder, type FindResult, type Found, type Impossible, type Meaning, type Unclear } from './command/finder.js'
export { checkInput, COMMAND_NAME, describe as describeCommand, FIELDS, inputs, valuesOf, type CommandInput, type CommandSpec, type Field, type Limit } from './command/spec.js'
export { blockDetail, blockOf, blocksList } from './command/page.js'
export { areaLine, areaNames, argsOf, blocksOf, commandLine, exampleLine, FENCE, linesOf, parseLine, POSITIONAL, stepsOf, terminalGuide, typed, WORD_AREAS, type Line, type TerminalStep } from './command/terminal.js'
