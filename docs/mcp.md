# The MCP server: an AI assistant in your notes

**Status: new, for the desktop app with the library kept in a folder.** The code is [apps/mcp-server](../apps/mcp-server); what an assistant may rely on is written down in [contract.json](../apps/mcp-server/contract.json).

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is the common way an AI app calls tools that another program offers. ShellNote's server offers your notes: an assistant can list them, read them, and edit them, and you see each edit in the open app a moment later.

## What it can do, and what it cannot

| It can | It cannot |
|---|---|
| List the notes and folders of one library | Reach any file outside that library's folder, or anything in it that is not a note |
| Read a note: its outline, its blocks in full, or the whole of it as Markdown or text | Read the pen's learned hand, thumbnails, your settings or an API key |
| Change blocks: style, mark, rewrite, insert, delete, move, convert | Make, rename, move or delete a note, or change its title |
| Add text, formulas, diagrams and tables | Add pictures, or write handwriting |
| | Reach the internet: the server has no network code at all |
| | Touch other programs, or the program panel |

Everything an assistant changes is kept twice over, on this computer only: each edit is written in the note's log with what undoes it, and the note as it was is kept before a run of edits (the last 20 for each note, for 30 days).

## Setting it up

1. In ShellNote, keep your library in a folder: Settings, "Where your notes are kept", "Keep them in a folder…". The server works only in a folder ShellNote has made a library.
2. Build the server once. It becomes one file, `apps/mcp-server/dist/shellnote-mcp.mjs`, run with [Node](https://nodejs.org) 22 or later:

   ```
   corepack pnpm install
   corepack pnpm mcp:build
   ```

3. Tell your AI app to start it, with the library's folder. Most apps take the same few lines, in a file they call `mcp.json` or in their settings:

   ```json
   {
     "mcpServers": {
       "shellnote": {
         "command": "node",
         "args": ["D:\\ShellNote\\apps\\mcp-server\\dist\\shellnote-mcp.mjs", "--library", "D:\\Notes"]
       }
     }
   }
   ```

   Where an app takes a command line instead, it is the same three parts: `node`, the file, then `--library` and the folder. For example, with Claude's command-line app: `claude mcp add shellnote -- node D:\ShellNote\apps\mcp-server\dist\shellnote-mcp.mjs --library D:\Notes`.

Only an app that runs on your computer can start the server. A website cannot: an assistant in a browser tab needs a server on the internet, which ShellNote does not have.

## The tools

| Tool | What it gives |
|---|---|
| `list_notes` | Each note's id, title, folder, pages and when it was last edited. `query` narrows by the title's words |
| `read_outline` | One line for each block of a note, in reading order: its id, its kind, its first words. And the note's `rev` |
| `read_blocks` | The whole content of the blocks named, in the form an edit takes it |
| `edit_note` | Changes blocks by id, with the `rev` that was read. Answers the new `rev` and what changed |
| `get_guide` | How to work with notes: `index`, `operations`, and how to write `text`, `math`, `diagram` and `table` |
| `export_note` | A whole note as Markdown or plain text |

An edit is a list of the [edit protocol](protocol.md)'s operations, with two differences from what a model sends inside the app: blocks are named by their own ids, as the outline shows them, and the content is attached.

```json
{
  "note": "n8fk2",
  "rev": 41,
  "ops": [
    { "op": "style", "ids": ["t1"], "set": [{ "color": "blue" }] },
    { "op": "insert", "at": "after", "ref": "t2", "kind": "diagram", "content": "flowchart LR\n  A[Force] --> B[Acceleration]" }
  ]
}
```

- **All or nothing.** The operations of one edit apply together, as one change, or none does.
- **Only what is named.** An edit changes the blocks it names, and adds new blocks only next to the block it gives as `ref`. This is checked on the whole note after the edit is worked out, whatever was sent.
- **You may be writing too.** An edit names the `rev` the assistant read. If a block it names changed since then, the edit is refused as `stale` and nothing changes; the assistant reads again. Blocks you did not touch can still be edited, and what you type in other blocks is merged with the edit, as with a change from another of your devices.
- **Mistakes are answered, not guessed at.** A wrong call comes back as a teaching error that says what to fix: `{"error":"unknown_id","got":"t9","hint":"There is no block \"t9\" in this note. Use a block id that the outline of this note gives."}`

## How it reaches your notes

The server is one more device on the library's folder, as another of your computers would be ([the library in a folder](ARCHITECTURE.md#the-library-in-a-folder-and-sync)). It keeps its own copy of each note in a place of its own, outside the folder, and brings each note together with its file by the same rules as the app. So an assistant's edit is never lost to a cloud service's overwrite, and never overwrites what you wrote.

The app need not be open. When it is, it sees the edit the next time it looks at the folder, about two seconds later.

## Safety

- **One folder.** The server is told one folder as it starts, and every path is held to it: no `..`, drive, link, junction or short name leads out, and inside it only notes and the library's own small files are read or written. The rules are the desktop app's own ([apps/mcp-server/src/nodeFiles.ts](../apps/mcp-server/src/nodeFiles.ts)).
- **No way out.** The server never opens a port: only the app that started it can reach it. It makes no network request, runs no other program, and is never run as administrator.
- **A note's words are content.** The server says so to every assistant as it connects, and no words from a note ever appear in a tool's name or description. It cannot decide what an assistant does with what it reads; it can make sure an edit changes only what it names, and that every edit can be taken back.
- **Reading and changing are marked apart.** Only `edit_note` changes anything, and it says so, so an AI app can ask you before each edit and not before each read. Leaving that question switched on is a good habit.
- **Nothing is deleted for good.** There is no tool for it.

## For contributors: adding to it without breaking it

Assistants, and the settings people wrote for them, depend on the tools staying as they are. So:

- **Add, never change.** A tool is never renamed, moved or taken away; an argument is never taken away, made required or narrowed. New abilities arrive inside the tools (a new operation, a new kind of block, a new guide topic), or as a new tool at the end. [contract.test.ts](../apps/mcp-server/test/contract.test.ts) refuses anything else, and says how to write an addition down.
- **Core is asked, not copied.** The server knows no kind of block itself. A new kind needs, in core: its line in the outline (`outline.ts`), its content in full (`read.ts`), what each operation does with it (`ai/compile.ts`), and a sample in `packages/core/test/byId.test.ts`, whose tests then hold it to the rules of the others. The guide's lists come from core's own constants, so they follow by themselves.
- **Three parts that do not know each other.** The tools ([tools/](../apps/mcp-server/src/tools)) are plain code over a `NoteHost`; where notes come from is a host ([folderHost.ts](../apps/mcp-server/src/folderHost.ts)); how calls arrive is [serve.ts](../apps/mcp-server/src/serve.ts), the only file that uses the MCP package. Another place for notes, or another way in, is one new file.
- **Standard output is the protocol.** Nothing else may print there: the lint rule forbids `console.log` in the server, and a test reads every line the real program prints.
