# ShellNote

**Notes you can type, write by hand and draw on, with an AI that changes only what you select.**

ShellNote is a page-based notes app. Every page is built from small pieces (text, equations, tables, pictures,
diagrams and handwriting), so you can select exactly the part you mean, say what you want in plain words, and have
just that part change. It runs in the browser and as a Windows desktop app, and it keeps your notes on your own device.

> **Status: early testing version.** Expect rough edges. The file format may still change before 1.0.

## Features

**Pages and blocks**
- Text, headings, lists, to-dos, tables, equations (LaTeX), pictures and Mermaid diagrams on real pages.
- Editing that feels like a word processor: fonts, colours, sizes, a table grid, and a Select box you drag over any
  part of a page, like a snipping tool.
- Add a page anywhere, between two pages or at the end, and delete one, with Undo.

**A pen that keeps up**
- Smooth ink with pressure, drawn as fast as the pen moves.
- Lines, shapes and arrows straightened when you hold the pen or lift it; a quick scribble over a word deletes it.
- Handwriting tidied as you write: words levelled onto their line and evenly spaced, each change its own undo step.
- An eraser for whole strokes or just the part it passes over, and a pen that learns how you draw.

**AI that edits only what you choose** (Ctrl+K)
- Select something, type what you want ("make the heading blue", "turn this into a flowchart"), and only that changes,
  as one step you can undo.
- Simple requests ("bold", "make it red", "delete this") run instantly, with no model at all.
- Works with small models on your own computer through [LM Studio](https://lmstudio.ai), or with hosted models through
  [OpenRouter](https://openrouter.ai).

**A command line for the app** (Ctrl+Shift+P)
- Every action has a command you can type. Ctrl+Enter asks an AI agent to write the commands for a request.

**Notes beside a video**
- Play a YouTube video or a video file next to your notes. Every line you write remembers its moment in the video;
  tap it to jump back.

**Other programs beside your notes** (Windows desktop app)
- Put a browser, a PDF reader, PowerPoint or VS Code on a panel next to the page. Lines written beside it remember the
  page, slide, or file and line ([VS Code companion](apps/vscode-companion)); tap one to go back there.
- Private browser windows are never listed, shown or pictured, and no command or agent can control these programs.

**Yours**
- A library of notes and folders, kept on your device, and beside the note you are writing in: open another note in
  one click. It sits on the left or the right, and hides with its arrow.
- Save and open notes as single `.shellnote` files.
- In the Windows app, keep the library in a folder of your choice, where each note is a `.shellnote` file and folders
  are folders. Choose a folder inside OneDrive, Dropbox, Google Drive or iCloud Drive, and the same folder on your
  other computers, and your notes are the same on all of them: what two of them wrote apart is merged, and nothing is
  lost. A change from another computer goes into the note you have open as you type.
- Nothing is sent anywhere unless you choose a hosted AI model.

## Getting started

You need [Node.js](https://nodejs.org) 22.12 or later. The pnpm version is pinned in `package.json`; Corepack, which
comes with Node, provides it.

```bash
corepack enable
pnpm install
pnpm dev
```

Then open http://localhost:5190. Add `?sample=mixed`, `?sample=physics` or `?sample=long` to open a sample note.

For everyday use, `pnpm app` builds the app for production and serves it at the same address. Typing is much lighter
than in the development server.

### Desktop app (Windows)

The desktop app is built with [Tauri 2](https://tauri.app) and uses the WebView2 runtime that comes with Windows.
You also need the [Rust toolchain](https://rustup.rs).

```bash
pnpm desktop          # the app in a window, reloading as the code changes
pnpm desktop:build    # a release build: apps/desktop/src-tauri/target/release/shellnote.exe
```

### Setting up the AI

The AI is optional; everything else works without it. Open the AI settings in the app and choose one of these:

- **LM Studio, on your computer:** install [LM Studio](https://lmstudio.ai), download a model (one of about 4B
  parameters or larger works well), and start its local server at `http://127.0.0.1:1234`.
- **OpenRouter, hosted:** paste your OpenRouter key into the settings. It is kept on your device only.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+K | Ask the AI about the selection |
| Ctrl+Shift+P | Open the command line |
| Ctrl+S, Ctrl+Shift+S | Save, save as a new file |
| Ctrl+O | Open a `.shellnote` file |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+B, Ctrl+I, Ctrl+U | Bold, italic, underline |
| Ctrl+E, Ctrl+Shift+X, Ctrl+Shift+H | Code, strikethrough, highlight |

On a Mac, use ⌘ in place of Ctrl.

## Project layout

| Folder | What it holds |
|---|---|
| [`packages/core`](packages/core) | The note itself: its schema, the one function that changes it, the AI's steps, the pen's maths and the commands. No DOM and no Node APIs, so it runs anywhere |
| [`packages/editor`](packages/editor) | The note on screen, in React and Tiptap: pages, frames, the pen layer, toolbars, panels and the command line |
| [`packages/providers`](packages/providers) | The adapter for OpenAI-compatible servers (LM Studio, OpenRouter) |
| [`apps/web`](apps/web) | The app: the library, settings, saving, and the workspace around the editor |
| [`apps/desktop`](apps/desktop) | The same app in a Tauri window, with the Rust side for what a browser cannot do |
| [`apps/vscode-companion`](apps/vscode-companion) | A small VS Code extension that tells ShellNote the open file and line |
| [`docs`](docs) | [Architecture](docs/ARCHITECTURE.md), the [file format](docs/file-format.md) and the [AI protocol](docs/protocol.md) |

## Development

| Command | What it does |
|---|---|
| `pnpm check` | Typecheck, lint and run the unit tests |
| `pnpm test` | The unit tests (Vitest) |
| `pnpm e2e` | The browser tests (Playwright, in Microsoft Edge locally and Chromium on CI) |
| `pnpm build` | Build the web app |
| `pnpm desktop:smoke` | Open the built desktop app and check that it works |
| `pnpm desktop:e2e` | Run the browser tests inside the built desktop app |
| `pnpm licences` | Check every dependency's licence and rewrite the notices file |

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

ShellNote is licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Akshat Kumar; see [NOTICE](NOTICE).

ShellNote is built on open-source packages, each under its own licence. Their notices ship with every copy of the app
and are listed in [`apps/web/public/licences`](apps/web/public/licences) and
[`apps/desktop/licences`](apps/desktop/licences).
