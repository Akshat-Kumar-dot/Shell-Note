# Changelog

All notable changes to ShellNote are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- The first public testing version.
- Pages built from blocks: text, headings, lists, to-dos, tables, equations, pictures and Mermaid diagrams, with
  editing like a word processor and a Select box for any part of a page.
- Handwriting with a pen: smooth ink with pressure, lines and shapes straightened, handwriting tidied as you write, an
  eraser for whole or part strokes, and a pen that learns how you draw.
- AI edits that change only the selection, as one undo step, with local models through LM Studio or hosted models
  through OpenRouter; simple requests run instantly with no model.
- A command line for every action, with an AI agent that writes commands for a request.
- Notes beside a YouTube video or a video file, each line remembering its moment.
- A library of notes and folders kept on the device, and notes saved as single `.shellnote` files.
- A Windows desktop app, with other programs (a browser, a PDF reader, PowerPoint, VS Code) on a panel beside the
  note, and a VS Code companion extension.
- Pages added between two pages, before the first or at the end, and deleted, each one step to undo.
- The library beside a note: folders and notes, a search by name, a new note or folder, on the left or the right, hidden
  or shown with its arrow.

### Changed

- ShellNote is now licensed under the Apache License 2.0 alone, in place of a choice of MIT or Apache-2.0.

### Fixed

- Full screen in the desktop app fills the whole screen from a maximised window, keeps the window buttons, and Esc
  leaves it.
- Deleting a page also removes the video marks placed on it, so the note still opens.
- The window is titled ShellNote again after a note is closed.
