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
- In the Windows app, the library in a folder you choose (Settings): each note one `.shellnote` file, folders as real
  folders, Recently deleted a folder of its own. A cloud service that copies the folder keeps the notes the same on
  every device. A note changed on two devices is merged block by block, and a paragraph whose same words both changed
  is kept twice; a service's "conflicted copy" is merged in and moved to Recently deleted; a half-copied file never
  replaces a note. Notes already in the app are copied into the folder, and nothing is removed from the app.
- A change from another device goes into the open note beside what is being typed; Undo still takes back only what
  you did.
- An MCP server for AI assistants on your own computer ([docs/mcp.md](docs/mcp.md)): with the library kept in a
  folder, an assistant can list your notes, read them and edit them by block, and you see each edit in the open note a
  moment later. It reaches that one folder and nothing else, has no network code, and cannot delete a note. An edit
  made with an out-of-date view of a block is refused. Each edit shows in the note's AI log with an Undo, and the note
  as it was is kept before a run of edits, to be brought back from the command line.

### Changed

- ShellNote is now licensed under the Apache License 2.0 alone, in place of a choice of MIT or Apache-2.0.

### Security

- The website carries a content security policy in its own page, and both the website and the Windows app take
  scripts from ShellNote alone. YouTube's player is spoken to through its frame: no script of YouTube's runs in
  ShellNote's page any more.
- A picture or video in a note file is kept only as one of the kinds ShellNote takes; anything else a file calls a
  picture is plain bytes, which a browser neither shows nor runs.
- A diagram never fetches a picture from the web: a node that names one is drawn with its words and no picture, and
  the app's policy loads no picture from another site. A picture so fetched would tell its site that the note was
  opened, with no click.
- The website draws nothing when another site shows it in a frame.
- The YouTube Data API key is sent to Google as a header, never in the address.
- In the Windows app, the library's folder commands reach notes and the library's own files, and no other file of the
  folder you chose; a folder is removed only once it holds no file, and a rename never takes another file's place.
- In the Windows app: only a window offered in the list can be put on a panel; a place kept with a line opens a file
  on this computer only; the app's window stays on the app's own pages; the microphone opens only for the window in
  front; Windows' own libraries are loaded from Windows' folder.
- In the Windows app, a note removed for good from a library kept in a folder goes to Windows' Recycle Bin, so one
  removed by mistake can be brought back as any file can.
- The Windows app reads none of the checks' switches from its environment (a debugging port for its web view, a
  window's size, a folder for the library): only a copy built for the checks does (`pnpm desktop:build:check`).
- A note holds at most 50,000 blocks: a file with more is refused before it can hold the app up.
- The build's GitHub Actions are named by commit, and each job has only the permissions it needs.

### Fixed

- Full screen in the desktop app fills the whole screen from a maximised window, keeps the window buttons, and Esc
  leaves it.
- Deleting a page also removes the video marks placed on it, so the note still opens.
- The window is titled ShellNote again after a note is closed.
- Every open-source package the app is built on now has its licence notice shipped with the app, not only a few.
- The window no longer gains a scrollbar, and its content no longer jumps sideways, for the moment a note's diagram is
  being drawn.
