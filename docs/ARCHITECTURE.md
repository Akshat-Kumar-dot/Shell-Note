# Architecture

A tour of the code for anyone opening ShellNote for the first time. It shows where things live, then follows five
actions through the code, from the hand to the saved note.

## The parts

| Folder | What it holds | What it may not do |
|---|---|---|
| `packages/core` | The note and everything worked out about it: its schema, its one way of changing, the AI's steps, the pen's maths, the commands | Touch a browser or Node: no DOM, no files. What differs by platform is passed in |
| `packages/editor` | The note on screen, in React and Tiptap: pages, frames, the pen layer, the toolbars, the panels, the command line | Know about Tauri: the app gives it what the system can do (`program/host.ts`) |
| `packages/providers` | The adapter that talks to OpenAI-compatible servers, such as LM Studio and OpenRouter (`openai.ts`) | |
| `apps/web` | The app itself: the library, settings, saving, and the workspace around the editor | |
| `apps/desktop` | The same app in a Tauri window, and the Rust side, chiefly other programs on a panel (`src-tauri/src`) | |
| `apps/vscode-companion` | A small VS Code extension that tells ShellNote the open file and line | |

## Three things to know first

**Only `apply(doc, ops)` changes a note** (`packages/core/src/apply.ts`). A `Doc` is never changed in place: `apply`
takes one, with a list of operations, and returns a new one, with the operations that would undo it. Typing, the pen,
undo and the AI all end there, so when something changes wrongly, there is one door to watch.

**`EditorStore` holds the open note** (`packages/editor/src/store.ts`). `store.apply(ops)` calls core's `apply`,
records the undo step and tells whoever listens. React components read the note with
`useSyncExternalStore(store.subscribe, ...)`.

**Numbers in a note are whole:** 1 unit is 0.01 mm, and there are no floats in a saved file. Every block has `r`, the
revision that last changed it, set by `apply` and never by hand: that is how an AI edit knows the block it read has
changed since.

## Five actions, followed through

### 1. A key typed

1. Tiptap, inside `frame/FrameEditor.tsx`, changes its own text. Tiptap owns what is inside a frame; React does not
   draw it.
2. Its update turns into the smallest set of operations: `draftsOf` reads the editor's text, and `frameOps`
   (`core/src/frame.ts`) compares it with the note.
3. `store.apply(ops, { origin: frameId, ... })`. The `origin` is how the frame knows not to redraw what it already
   shows. A change from elsewhere (undo, the AI) comes back into Tiptap as the smallest replacement, so the caret stays.
4. `overflow.ts` moves text that ran past the page's bottom margin onto the next page.
5. A moment later `apps/web/src/Workspace.tsx` saves through `library.save`, into IndexedDB
   (`library/indexeddb.ts`). The library works the same inside the desktop app.

### 2. A stroke of the pen

All in `packages/editor/src/ink/PenLayer.tsx`, the longest file in the project, with the maths in `core/src/ink/`.

1. `onDown` decides what the press is: a palm, fingers scrolling, the eraser, the wand's box, or a stroke
   (`startDrawing`).
2. `addSamples`, on every pen event: each sample goes through `PointFilter`, then `StrokeModel`
   (`core/src/ink/smooth.ts`), and each new piece is drawn once on a canvas over the pages (`render.ts`,
   `drawStroke`). Held still, `heldShape` (`core/src/ink/learn.ts`, `shapes.ts`) snaps it to a line or a shape.
3. `endDrawing`, on lifting: `placeStroke` (`core/src/ink/group.ts`) makes the operations, and the stroke goes in as
   drawn. Its correction, if any, is a second undo step. Otherwise the word is tidied (`tidy.ts`, `neaten.ts`).
4. The page draws the kept stroke the same way the live canvas did, so nothing moves when the pen lifts.

This path is what people feel most, so read `addSamples` with care before changing it: `pnpm perf:ui` and
`apps/web/e2e/pen.spec.ts` tell you if it got slower or changed.

### 3. An AI edit (Ctrl+K)

1. `editor/src/ai/AiLayer.tsx` is the box; `ai/run.ts`'s `aiEdit` sends the request with the note as it is at that
   moment.
2. `runEdit` (`core/src/ai/edit.ts`) is the whole method, its steps listed at the top of that file:
   - `chooseByKind` turns "all headings" into a selection, and `makeAliases` gives the blocks short names for the
     model;
   - `instantEdit` (`instant.ts`) answers with no model at all when code understands the request;
   - otherwise the model picks operations under a JSON Schema (`schema/protocol.ts`), `parseReply` reads them, and a
     content step writes any words, through `model.complete` (`providers/src/openai.ts`);
   - `compile.ts` turns each operation into `apply`'s operations; `scope.ts` checks nothing outside the selection
     changed.
3. One failure gets one retry, told in plain words what was wrong. Back in `aiEdit`,
   `store.apply(outcome.applied, { baseRev })` refuses the edit if a block it touched changed while the model worked.

The reply schema, the prompt and the rulebook are versioned ([the protocol](protocol.md)). A change to any of them
changes what every model sees, so measure it against several models before it ships.

### 4. A line in the command line (Ctrl+Shift+P)

1. `editor/src/terminal/Terminal.tsx` takes the line; `stepsOf` and `parseLine` (`core/src/command/terminal.ts`) read
   it.
2. `runLines` (`terminal/run.ts`) makes each line ready. `video: start seconds=120` goes to `route`
   (`command/router.ts`), which picks the command inside that area; plain words go to `Finder` (`command/finder.ts`).
3. The command is a function in `editor/src/commands/`, and any change to the note goes through `store.apply`.
4. With Ctrl+Enter, `agentRun` (`terminal/agent.ts`) sends the request to the model, which writes such lines; they
   run the same way. The note's own commands are compiled by `core/src/note/compile.ts`.

By design, no command, agent or line in the command line ever controls the program panel: other programs are moved
only by the person's own hand. A unit test holds this (`packages/core/test/command/spec.test.ts`).

### 5. Another program on a panel (the desktop app, on Windows)

1. `editor/src/program/ProgramPanel.tsx` asks `programHost` (`host.ts`) to hold a window. The editor knows no Tauri:
   `apps/web/src/desktop.ts` gives it a host that calls `invoke('apps_hold', ...)`.
2. `src-tauri/src/apps.rs` makes the real window sit over the panel and follow it, owned by ShellNote's window, and
   gives it back exactly as it was when let go. `picture.rs` makes its live picture, for when the window itself cannot
   be seen on the panel: something of ShellNote covers it, or the program was left where it is, elsewhere.
3. A line written beside it: `momentNow` at pen-down and `kept` at the lift (`program/moment.ts`) ask `place.rs` where
   the program is, and that goes on the stroke as `pm`, in the stroke's own undo step. A tap on its mark calls
   `apps_go_to`.

`place.rs` reads another program only through its normal doors (its address bar, PowerPoint's own COM interface, the
companion's small file), and what it reads is data, never instructions.

## Where to look when

| You want to | Start at |
|---|---|
| Add a kind of change to a note | `core/src/schema/ops.ts`, then `apply.ts` |
| See what a saved file holds | [the file format](file-format.md), `core/src/schema/doc.ts`, `core/src/io/container.ts` |
| Change what a pen stroke does | `PenLayer.tsx`, `core/src/ink/` |
| Add a command | `core/src/command/app.ts` (what it takes and how it is said), `editor/src/commands/` (what it does) |
| Change the panels | `editor/src/layout/tree.ts` (the layout, no React), `layout/DockArea.tsx` |
| Change where a menu opens, or how a bar fits down a side | `editor/src/popover.ts`, `layout/stripFit.ts` |
| Follow a Rust call | `apps/web/src/desktop.ts` (the page's side), `src-tauri/src/lib.rs` (the list of commands) |

## Running and testing

The [README](../README.md#development) lists every command. The ones used most:

```bash
pnpm check
```

runs the typecheck, the linter and the unit tests. `pnpm dev` serves the app at http://localhost:5190, and `pnpm e2e`
runs the browser tests. Tests live next to what they test: `packages/*/test/`, `apps/web/test/` and `apps/web/e2e/`.
`pnpm desktop:smoke` and `pnpm desktop:apps` check the built desktop app.
