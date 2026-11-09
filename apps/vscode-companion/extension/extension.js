// The ShellNote companion: tells ShellNote which file and line this VS Code
// window is at, so a line of notes written beside it can go back there. It only writes a small file on this computer,
// for this window, while the window is open: %LOCALAPPDATA%\shellnote\vscode\<this window>.json. It uses no network and
// no port, reads none of your code, and ShellNote reads that file only as a line is written.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vscode = require('vscode')

/** At most this often, in milliseconds: moving the cursor is quick. */
const AT_MOST = 250

const folder = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'shellnote', 'vscode')
const record = path.join(folder, `${vscode.env.sessionId.replace(/[^\w-]/g, '_')}.json`)
let waiting

/** This window's file and line now, or none on a tab that is no file on this computer (Settings, Welcome, a remote one). */
function write() {
  waiting = undefined
  const editor = vscode.window.activeTextEditor
  const local = editor?.document.uri.scheme === 'file'
  const now = {
    workspace: vscode.workspace.name ?? null,
    file: local ? editor.document.uri.fsPath : null,
    line: local ? editor.selection.active.line + 1 : null,
    at: Date.now(),
  }
  try {
    fs.mkdirSync(folder, { recursive: true })
    // Whole or not at all: ShellNote may read it at any moment.
    fs.writeFileSync(`${record}.new`, JSON.stringify(now))
    fs.renameSync(`${record}.new`, record)
  } catch {
    // Not written: the line keeps the file's name from the window's title, as without the companion.
  }
}

const soon = () => {
  waiting ??= setTimeout(write, AT_MOST)
}

function activate(context) {
  write()
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(soon), vscode.window.onDidChangeTextEditorSelection(soon), vscode.window.onDidChangeWindowState(soon))
}

function deactivate() {
  clearTimeout(waiting)
  try {
    fs.rmSync(record, { force: true })
  } catch {
    // Left behind: ShellNote ignores a record older than a day.
  }
}

module.exports = { activate, deactivate }
