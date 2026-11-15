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

- A note says what it is for, Text, Sketch or Mixed, and how its pages show: one below another, or as one sheet with
  no page breaks. The pages are the same either way, so changing the view changes nothing in the note, and it prints as
  its pages. Its size, A4, A5, A6 or Letter, and which way up, upright or across, are chosen in its menu, and what each
  page holds is fitted to a new size. The note file is version 5 ([docs/file-format.md](docs/file-format.md)).
- What is placed on a page (ink, a picture, a formula, a diagram) never lies across the line to the next page: a thing
  that would moves whole to the top of the next page, with what touches it and the ink on its line, and what is in its
  way there moves down together, just enough. Only ink taller than a whole page is cut at the line, its two parts
  meeting exactly. Typed text flows on as before. One undo takes back the change and the move together, and the same
  rule follows a change merged from another device.
- The note's own menu, at the end of the tabs: its kind, its pages, its paper, a cover picture of your own kept in the
  note's file, and Export: print it, or save it as a PDF from the print window, each page on its own sheet at its real
  size.
- Dark paper in the dark theme, chosen in Settings, Appearance, with its ink in colours that read on it; printing is
  always on white. A text note shown with no page breaks has no paper at all: its words sit on the app's own surface,
  under its title and a line saying its folder and when it was last edited.
- A Sketch note opens with the pen in hand, says in the status line that its sheet grows, and grows as you write near
  its end. The pen's own touch chooses for itself: a stroke writes, whatever tool is in hand, and a tap on typed words
  puts the caret there. The Hand, in the pen's row, moves the sheet. More has a Diagram that starts a flowchart under
  the caret's line.

### Changed

- ShellNote is now licensed under the Apache License 2.0 alone, in place of a choice of MIT or Apache-2.0.
- The app's surfaces are plain greys in light and in dark, and its buttons black or white, in place of the violet it
  had. Settings, Appearance offers a colour for the buttons and for what is chosen: graphite, which is none, or blue,
  teal, green, amber, rose or red. The choice is kept on the device, and has its command, `settings.accent`.
- A new frame round every screen. A rail of the app's places down the left edge: the library, a search of its names,
  the AI, what is beside the note, the terminal, where your notes are kept, and Settings. The library's column beside
  every screen, to search, sort, hide or move to the other side, with Recently deleted at its foot. Tabs of the open
  notes, the Library first, each note renamed in its tab. On a phone or an upright tablet the rail lies along the
  bottom.
- One slim row of tools on a note in place of the two bars: undo, redo, the block's style, font and size, bold, italic,
  underline, colour, alignment and indent, link, picture, table, and More for the rest (the other marks, the paper, the
  Select box and the free cursor). With the pen, highlighter or eraser in hand, the pen's row takes its place: select,
  the pen and its kinds, highlighter, eraser, four colours and more, one width, undo, redo, tidy, type and picture.
  More can show both rows at once. The row sits under the tabs, down either side, along the bottom, or floats as a
  pill; narrower than its tools, it scrolls sideways.
- A status line under the note: how safe it is, where it is kept, its pages and words, and the zoom. Save, open a file,
  the note's full view and what the AI changed are in the note's own menu, at the end of the tabs.
- One panel beside the note, from the window's top: the AI (its chat, what it changed, the scratch pad) or Beside (a
  video, a web page, or in the Windows app another program). A video shows inside Beside with its name and time under
  it, its description, transcript and a timer below; it can be taken out into a panel of its own, beside, above or
  below the note or floating, and put back with its menu or the new command `video.inside`. A program has the same,
  by its own buttons alone. A panel moved about gives its room back to the note.
- What the stroke recorder is for, and the way to it, are in the pen's settings, under Your hand.
- The AI's box in the panel beside the note: Ask, Table, Flowchart and Summarise above it, a picture's clip and the send
  button on its line, and the model in use named in the panel's head.

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
- In the Windows app, the OpenRouter key is kept by Windows, sealed for your account, and no longer as plain text in
  the app's own storage; a key kept before moves over the first time the app starts.
- KaTeX, minimatch and tokio are at versions past known faults, and a workflow looks for new ones every week.
- A private browser window is known in the browser's own words in other languages too: Firefox's, Chrome's and
  Brave's in their twenty-two most used languages beside English (Edge's word is the same in all). Before, a private
  window of a browser set to another language could be listed for the panel.
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
