// The finder's word lists: the model names the area and says the
// operation in its own simple words; code picks the command inside that area. Two tables:
//   AREAS: for each area, a line telling the model what it holds, and the words that mean the area ("trash" is bin)
//   VERBS: for each command, the words and phrases that mean its operation inside its area ("get rid of" is
//          note.delete in note, bin.empty's "empty" in bin), as many as people and models use: the words most AI
//          models write, the phrasal verbs, the everyday words,
//          and the synonyms nomic-embed-text puts nearest (pnpm words:near), each read by a person.
// A phrase is matched by its words' roots, in order, other words between them allowed: "play from" matches "start
// playing it from". The same word in two commands of one area is meant to tie: the code then asks, never guesses.
import { stem, tokens } from './words.js'

export interface Area {
  /** One line for the model: what the area holds, and what it is not. */
  readonly hint: string
  /** Words that mean the area, when the model names it its own way ("trash" for bin). */
  readonly words: readonly string[]
}

export const AREAS: Readonly<Record<string, Area>> = {
  library: {
    hint: "the library's screen: every note and folder, opened, searched or sorted (not one note's own content)",
    words: ['library', 'home', 'home screen', 'main screen', 'main menu', 'start screen', 'all notes', 'my notes', 'notes list', 'list of notes', 'shelf', 'overview', 'dashboard', 'index', 'catalogue', 'catalog', 'top level', 'everything'],
  },
  bin: {
    hint: 'Recently deleted: deleted notes and folders wait there, to be restored or deleted for good',
    words: ['bin', 'trash', 'trash can', 'recycle bin', 'recycling bin', 'recently deleted', 'deleted', 'deleted notes', 'deleted items', 'garbage', 'rubbish', 'wastebasket', 'waste basket', 'wastebin', 'dustbin'],
  },
  note: {
    hint: 'a note as a whole: make, open, close, rename, move or delete it, list its blocks (not the words inside it; a folder is folder)',
    words: ['note', 'notes', 'document', 'doc', 'notebook', 'sheet', 'entry', 'memo', 'jotting', 'writeup', 'write-up', 'paper'],
  },
  folder: {
    hint: 'folders in the library, which hold notes: make, rename, move or delete a folder (a note is note)',
    words: ['folder', 'folders', 'directory', 'directories', 'category', 'categories', 'group', 'subfolder', 'section', 'collection', 'binder'],
  },
  file: {
    hint: '.shellnote files on the computer: save the open note to one, or open one into the library',
    words: ['file', 'files', 'disk', 'drive', 'computer', 'shellnote file', 'copy on disk', 'export', 'import', 'download', 'hard drive'],
  },
  tool: {
    hint: "the note's tool: type, select, free cursor, pen, highlighter or eraser (pen, highlighter and eraser have areas of their own for their settings)",
    words: ['tool', 'tools', 'mode', 'cursor', 'typing', 'keyboard', 'text mode', 'pointer'],
  },
  pen: {
    hint: "the pen: its kind (pen, pencil, fountain, marker), colour and width; and what it learned of the person's hand",
    words: ['pen', 'pencil', 'marker', 'fountain pen', 'fountain', 'ink', 'stylus', 'brush', 'nib', 'drawing', 'handwriting pen', 'biro'],
  },
  highlighter: {
    hint: "the highlighter's colour and width",
    words: ['highlighter', 'highlight', 'highlighting', 'highlighter pen', 'text marker'],
  },
  eraser: {
    hint: "the eraser: whole strokes or part of one, and its size",
    words: ['eraser', 'rubber', 'erasing', 'erase tool'],
  },
  tidy: {
    hint: 'tidying all the handwriting of the note at once',
    words: ['tidy', 'handwriting', 'writing', 'lines', 'neatness', 'scribbles', 'strokes'],
  },
  select: {
    hint: 'choosing blocks of the note, or an area of a page, or letting go of what is chosen',
    words: ['selection', 'selected', 'chosen', 'choice', 'area', 'region', 'box', 'blocks', 'select box', 'marquee'],
  },
  edit: {
    hint: 'undo and redo of changes to the note',
    words: ['change', 'changes', 'edit', 'edits', 'history', 'action', 'last step', 'mistake'],
  },
  // The person: view was this area's name, and both models wrote view:
  // for full view, which is the panel's. "view" is no word of it now.
  screen: {
    hint: 'zoom, which page is shown, and full screen (the whole screen; full view of one panel is panel)',
    // Not page or pages since note control's step 4 (24 October 2026): page is the note's area for adding and moving pages.
    words: ['zoom', 'full screen', 'fullscreen', 'size', 'scale', 'magnification', 'display'],
  },
  panel: {
    hint: "the side panel at the window's edge, with its tabs (description, transcript, web, timer, output, ai), and full view: one panel filling the workspace (the video's own panel is video)",
    words: ['side panel', 'sidebar', 'side bar', 'panel', 'pane', 'tab', 'tabs', 'full view', 'drawer', 'side'],
  },
  bar: {
    hint: 'the tools bar and the format bar: docked at an edge, or floating',
    words: ['bar', 'bars', 'toolbar', 'tool bar', 'tools bar', 'format bar', 'formatting bar', 'ribbon', 'menu bar', 'palette'],
  },
  layout: {
    hint: "the places of the panels and bars, all at once",
    words: ['layout', 'arrangement', 'positions', 'workspace', 'window layout'],
  },
  video: {
    hint: 'a video beside the note, in its own panel: add, show or hide it, play, pause, go to a time, mark a hard part, dock or float its panel, its times, remove it',
    words: ['video', 'videos', 'clip', 'movie', 'youtube', 'film', 'lecture', 'recording', 'player', 'footage', 'playback', 'stream', 'tutorial'],
  },
  transcript: {
    hint: "the video's transcript: keep one, find words in it, take it out",
    words: ['transcript', 'transcripts', 'subtitles', 'captions', 'subs', 'srt', 'vtt', 'script', 'transcription'],
  },
  web: {
    hint: 'a web page shown in the side panel',
    words: ['web', 'website', 'web page', 'webpage', 'site', 'link', 'url', 'browser', 'internet', 'online page'],
  },
  output: {
    hint: "the side panel's Output: the AI's answers and log, and what it made waiting on the scratch pad",
    words: ['output', 'answers', 'log', 'results', 'responses', 'history of answers'],
  },
  timer: {
    hint: 'the study timer: a countdown or a stopwatch, started, paused or stopped',
    words: ['timer', 'countdown', 'stopwatch', 'stop watch', 'clock', 'study timer', 'pomodoro', 'alarm', 'time'],
  },
  ai: {
    hint: "the AI box on what is chosen in the note: open it, send it a request to edit or to ask, undo its change, choose its model (the side panel's chat is chat)",
    words: ['ai', 'ai box', 'assistant', 'model', 'prompt', 'prompt box', 'request box', 'llm', 'copilot'],
  },
  chat: {
    hint: "the side panel's AI chat: ask, or make a table, a flowchart or a summary of the video's transcript, put into the note or onto the scratch pad",
    words: ['chat', 'conversation', 'chatbot', 'side chat', 'ai chat', 'messages', 'chat panel'],
  },
  pad: {
    hint: 'the scratch pad: what the AI made, waiting to be put into the note',
    words: ['pad', 'scratch pad', 'scratchpad', 'drafts', 'draft', 'staging', 'waiting area'],
  },
  settings: {
    hint: "the app's settings: open them, the theme, the pen's settings, developer mode, keeping the notes in storage",
    words: ['settings', 'setting', 'preferences', 'options', 'config', 'configuration', 'setup', 'theme', 'appearance', 'look', 'dark mode', 'light mode'],
  },
  recorder: {
    hint: 'the stroke recorder, which teaches the pen the person\'s hand',
    words: ['recorder', 'stroke recorder', 'training', 'handwriting samples', 'samples', 'teacher'],
  },
  // ----- the note's content (note control, step 2): a block named by its id or in words, new words on the lines under the line -----
  text: {
    hint: "the note's text: headings, paragraphs and quotes: add one, rewrite its words, its look, turn it into another kind, a level in or out, tick a to-do (the words on the lines under the line, then end)",
    words: ['text', 'paragraph', 'paragraphs', 'heading', 'headings', 'title', 'subtitle', 'sentence', 'sentences', 'quote', 'words', 'wording', 'content', 'body'],
  },
  list: {
    hint: 'lists in the note: points, numbered or to-dos: a new list, or items more (an item a line under the line, then end)',
    words: ['list', 'lists', 'bullets', 'bullet points', 'bullet list', 'points', 'checklist', 'to-do list', 'todo list', 'numbered list'],
  },
  block: {
    hint: 'any block of the note: move it after or before another, or to the top or end of a page, or take it out',
    words: ['block', 'element', 'piece'],
  },
  // ----- tables, maths, diagrams, pictures (note control, step 3) -----
  table: {
    hint: 'tables in the note: a new one as a Markdown table under the line, the whole table rewritten, rows and columns added or taken out, its look',
    // Not row, column or grid: an area's own words are left out of the operation, and "add row", "look grid" are operations.
    words: ['table', 'tables', 'spreadsheet', 'comparison table', 'data table'],
  },
  maths: {
    hint: 'formulas and equations in the note, in LaTeX under the line: a new one, or one rewritten',
    words: ['maths', 'math', 'formula', 'formulas', 'formulae', 'equation', 'equations', 'expression', 'latex', 'tex'],
  },
  diagram: {
    hint: 'diagrams in the note, in Mermaid under the line (flowchart, pie or xychart): a new one, or one rewritten',
    words: ['diagram', 'diagrams', 'flowchart', 'flowcharts', 'flow chart', 'chart', 'charts', 'pie chart', 'graph', 'mermaid'],
  },
  picture: {
    hint: "pictures in the note: one of another note put into this one, a picture's caption, its description (one this note has is moved with block)",
    words: ['picture', 'pictures', 'image', 'images', 'photo', 'photos', 'figure', 'illustration'],
  },  // ----- boxes and pages (note control, step 4) -----
  box: {
    hint: 'a box of text on the page, put where there is room: beside or below a block, or in a part of a page',
    words: ['box', 'boxes', 'text box', 'callout', 'side box', 'sidebar box', 'note box', 'frame'],
  },
  page: {
    hint: "the note's pages: add one, move one, take one out, or change its paper (going to a page is screen: page)",
    words: ['page', 'pages', 'paper'],
  },  // ----- recipes and the shape rules (note control, step 5) -----
  recipe: {
    hint: 'a known layout built from what you write under the line: questions and answers, a section, a summary, a comparison, steps, a definition',
    words: ['recipe', 'recipes', 'template', 'templates'],
  },
  write: {
    hint: 'content written under the line, its shape chosen by the app (a list, steps, a table, a definition, a formula, a diagram or paragraphs)',
    words: ['write'],
  },
}

/** Words for showing or opening something, shared by many commands. */
const SHOW = ['show', 'open', 'view', 'see', 'display', 'bring up', 'pull up', 'look at', 'reveal', 'present']
/** Words for closing or hiding a panel or a box. */
const HIDE = ['hide', 'close', 'collapse', 'dismiss', 'shut', 'put away', 'minimize', 'minimise', 'conceal', 'tuck away', 'fold away']
/** Words for deleting something to Recently deleted, or taking it out. */
const REMOVE = ['remove', 'delete', 'take out', 'get rid of', 'discard', 'drop', 'erase', 'eliminate', 'trash', 'throw away', 'throw out', 'scrap', 'ditch', 'dump', 'junk', 'toss', 'chuck', 'bin', 'cut', 'wipe', 'kill', 'clear away']
/** Words for making something new. */
const MAKE = ['new', 'create', 'make', 'add', 'start', 'begin', 'set up', 'build', 'generate', 'produce', 'form', 'establish', 'spin up', 'open a new', 'start a new', 'start a fresh', 'fresh', 'another', 'blank', 'initialize', 'initialise']
/** Words for renaming. */
const RENAME = ['rename', 'retitle', 'call', 'name', 'title', 'change the name', 'change the title', 'change its name', 'relabel', 'label', 'give a new name', 'give it the name', 're-name', 'rechristen', 'dub', 'entitle']
/** Words for moving into a folder. */
const MOVE = ['move', 'put in', 'put into', 'put inside', 'file under', 'file into', 'relocate', 'transfer', 'shift', 'place in', 'place into', 'send to', 'store in', 'organize into', 'organise into', 'drag into', 'nest', 'tuck into', 'carry to', 'migrate']
/** Words for choosing a tool or a setting. */
const PICK = ['use', 'pick', 'choose', 'select', 'switch to', 'switch', 'change to', 'change', 'set', 'take', 'grab', 'get', 'give me', 'turn to', 'go to', 'start using', 'swap to', 'swap', 'want', 'need', 'activate', 'equip', 'opt for', 'make']
/** Words for switching something on or off. */
const SWITCH = ['turn on', 'turn off', 'switch on', 'switch off', 'enable', 'disable', 'toggle', 'activate', 'deactivate', 'on', 'off', 'start', 'stop', 'allow', 'forbid', 'set']
/** Words for stopping a request while it runs. */
const ABORT = ['stop', 'abort', 'cancel the request', 'cancel', 'halt', 'interrupt', 'kill', 'end', 'terminate', 'quit', 'never mind']

export const VERBS: Readonly<Record<string, readonly string[]>> = {
  'library.open': [...SHOW, 'go to', 'go back to', 'back to', 'return to', 'take me to', 'browse', 'visit', 'enter', 'head to', 'navigate to', 'list', 'show all', 'switch to', 'jump to', 'get back to', 'return'],
  'library.search': ['search', 'find', 'look for', 'look up', 'hunt for', 'locate', 'where is', 'filter', 'query', 'search for', 'seek', 'track down', 'dig up', 'fetch', 'which note'],
  'library.sort': ['sort', 'order', 'arrange', 'rank', 'organize', 'organise', 'reorder', 'list by', 'sort by', 'order by', 'arrange by', 'newest first', 'oldest first', 'latest first', 'recent first', 'reverse the order', 'put first'],

  'bin.open': [...SHOW, 'check', 'browse', 'go to', 'list', 'what is in', 'what did i delete', 'look in', 'go into', 'inspect'],
  'bin.restore': ['restore', 'recover', 'bring back', 'undelete', 'get back', 'retrieve', 'put back', 'unarchive', 'rescue', 'revive', 'reinstate', 'salvage', 'regain', 'return', 'pull out', 'take back out', 'save from'],
  'bin.deleteForever': ['delete forever', 'delete for good', 'permanently delete', 'delete permanently', 'erase forever', 'remove forever', 'remove for good', 'remove permanently', 'destroy', 'shred', 'wipe out', 'get rid of for good', 'purge'],
  'bin.empty': ['empty', 'empty the bin', 'empty the trash', 'clear out', 'clean out', 'clear', 'wipe', 'flush', 'delete everything', 'delete all', 'remove everything', 'remove all', 'get rid of everything', 'take out the trash', 'clear everything', 'empty out', 'purge all'],

  'note.new': [...MAKE, 'write a new', 'draft', 'compose', 'jot down', 'start writing', 'take a note', 'take notes', 'note down'],
  'note.open': [...SHOW, 'go to', 'load', 'read', 'access', 'switch to', 'jump to', 'enter', 'launch', 'resume', 'continue', 'edit', 'work on', 'get', 'fetch', 'bring back up', 'reopen', 'pick up'],
  'note.editHere': ['edit here', 'take over', 'edit in this window', 'use here', 'take control', 'claim', 'unlock', 'make editable', 'edit it here'],
  'note.close': [...HIDE.filter((word) => word !== 'hide'), 'exit', 'leave', 'done with', 'finish', 'finished with', 'go back', 'back', 'return', 'stop editing', 'get out of', 'close out', 'end', 'put down', 'step out'],
  'note.rename': RENAME,
  'note.move': MOVE,
  'note.delete': REMOVE,
  'note.blocks': ['list blocks', 'list the blocks', 'list', 'show blocks', 'show the blocks', 'outline', 'contents', 'structure', 'what is in', 'what blocks', 'ids', 'list ids', 'show ids', 'inventory', 'enumerate', 'map', 'breakdown', 'overview', 'table of contents'],
  'note.block': ['show block', 'inspect', 'detail', 'details', 'examine', 'describe', 'info', 'information', 'look at block', 'show the block', 'block info', 'everything about', 'all about'],

  'folder.new': [...MAKE],
  'folder.rename': RENAME,
  'folder.move': MOVE,
  'folder.delete': REMOVE,

  'file.save': ['save', 'store', 'keep', 'write', 'write to disk', 'persist', 'back up', 'backup', 'save changes', 'save it', 'save the file', 'save my work', 'record'],
  'file.saveAs': ['save as', 'save a copy', 'save to a new file', 'export', 'save under', 'save elsewhere', 'save it as', 'copy to a file', 'save to a file', 'save as a new file', 'export as'],
  'file.open': ['open', 'load', 'import', 'read', 'bring in', 'upload', 'open a file', 'add from a file', 'load a file', 'pull in'],

  'tool.choose': PICK,
  'pen.set': [...PICK, 'write with', 'draw with', 'set up', 'adjust', 'thicker', 'thinner', 'wider', 'finer', 'colour', 'color', 'make it', 'make the pen'],
  'pen.forget': ['forget', 'unlearn', 'forget my hand', 'forget my handwriting', 'reset what it learned', 'clear what it learned', 'wipe what it learned', 'erase what it learned', 'start learning again', 'delete what it learned', 'reset learning'],
  'highlighter.set': [...PICK, 'highlight', 'highlight with', 'mark', 'thicker', 'thinner', 'wider', 'finer', 'colour', 'color'],
  'eraser.set': [...PICK, 'erase', 'rub out', 'rub', 'bigger', 'smaller', 'larger'],
  'tidy.note': ['tidy', 'tidy up', 'neaten', 'clean up', 'straighten', 'level', 'align', 'line up', 'fix', 'beautify', 'smooth', 'organize', 'organise', 'make neat', 'make neater', 'even out', 'square up'],
  'recorder.open': [...SHOW, 'start', 'launch', 'teach', 'train', 'record', 'go to', 'begin', 'learn my hand', 'learn my handwriting', 'teach the pen'],

  'settings.open': [...SHOW, 'go to', 'access', 'launch', 'enter', 'edit'],
  'settings.theme': [...PICK, 'turn', 'toggle', 'apply', 'go', 'make it', 'switch the theme', 'change the theme', 'dark', 'light'],
  'settings.keepStorage': ['keep', 'protect', 'persist', 'save permanently', 'preserve', 'stop clearing', 'never clear', 'guard', 'secure', 'keep safe', 'hold on to', 'stop deleting', 'make permanent'],
  'settings.pen': [...PICK, 'turn', 'adjust', 'configure', 'toggle', 'enable', 'disable', 'turn on', 'turn off', 'allow', 'stop'],
  'settings.penReset': ['reset', 'restore defaults', 'use my defaults', 'use my own settings', 'clear the note settings', 'go back to my settings', 'revert', 'undo the note settings', 'default', 'back to default'],
  'settings.developer': SWITCH,
  'settings.tidyRule': SWITCH,

  'select.area': ['select area', 'choose area', 'select an area', 'draw a box', 'box', 'mark an area', 'outline', 'select region', 'pick area', 'frame', 'select a region', 'drag a box', 'select the space', 'grab the area'],
  'select.blocks': ['select', 'choose', 'pick', 'mark', 'grab', 'take', 'tick', 'check', 'highlight', 'pick out', 'single out', 'focus on'],
  'select.none': ['deselect', 'unselect', 'clear', 'let go', 'drop', 'cancel', 'release', 'select nothing', 'clear the selection', 'unmark', 'forget the selection', 'nothing', 'none', 'unchoose', 'escape'],

  'edit.undo': ['undo', 'revert', 'go back', 'back', 'reverse', 'take back', 'cancel the last', 'roll back', 'step back', 'oops', 'restore the previous', 'undo that', 'take that back', 'put it back', 'unmake'],
  'edit.redo': ['redo', 'do again', 'repeat', 'reapply', 'undo undo', 'undo the undo', 'un-undo', 'restore the undone', 'again', 'do it again', 'redo that', 'forward'],

  'screen.zoom': ['zoom', 'zoom in', 'zoom out', 'enlarge', 'magnify', 'bigger', 'smaller', 'shrink', 'scale', 'resize', 'fit', 'actual size', 'grow', 'make bigger', 'make smaller', 'increase', 'decrease', 'larger', 'reduce', 'blow up'],
  'screen.page': ['go to', 'jump to', 'turn to', 'show page', 'open page', 'flip to', 'scroll to', 'move to', 'navigate to', 'skip to', 'take me to', 'see page', 'next', 'previous', 'last', 'first'],
  'screen.fullscreen': ['full screen', 'fullscreen', 'maximize', 'maximise', 'enter full screen', 'leave full screen', 'exit full screen', 'go full screen', 'whole screen', 'entire screen', 'f11', 'kiosk', 'immersive'],

  'panel.show': [...SHOW.filter((word) => word !== 'reveal'), 'reveal', 'unhide', 'switch to', 'go to', 'expand the side'],
  'panel.hide': [...HIDE, 'get rid of', 'remove', 'close the side'],
  'panel.full': ['full view', 'focus', 'focus on', 'fill', 'fill the window', 'take over', 'full window', 'only', 'alone', 'spotlight', 'zoom in on', 'maximize', 'maximise', 'expand', 'enlarge the panel', 'leave full view', 'exit full view', 'one panel'],

  'bar.place': ['dock', 'place', 'put', 'move', 'pin', 'attach', 'snap', 'position', 'stick', 'send to', 'park'],
  'bar.float': ['float', 'undock', 'detach', 'unpin', 'free', 'pop out', 'loose', 'let it float', 'make it float'],
  'bar.turn': ['turn', 'rotate', 'flip', 'vertical', 'horizontal', 'sideways', 'upright', 'stand up', 'lay down', 'change direction'],
  'layout.reset': ['reset', 'restore', 'default', 'put back', 'back to normal', 'start over', 'rearrange', 'fix', 'undo the layout', 'tidy up', 'clean up', 'reset the layout', 'original'],

  'video.add': ['add', 'insert', 'attach', 'embed', 'put in', 'link', 'paste a link', 'load', 'bring in', 'include', 'open a link', 'add a video', 'put a video'],
  'video.show': [...SHOW, 'switch to', 'watch', 'reopen', 'unhide', 'select'],
  'video.hide': HIDE,
  'video.play': ['play', 'resume', 'start', 'go', 'continue', 'run', 'unpause', 'roll', 'keep playing', 'carry on', 'start playing', 'press play'],
  'video.pause': ['pause', 'stop', 'halt', 'freeze', 'hold', 'wait', 'interrupt', 'suspend', 'hold on', 'stop playing'],
  'video.seek': ['seek', 'jump to', 'go to', 'skip to', 'move to', 'scrub to', 'set the time', 'rewind to', 'fast forward to', 'forward', 'rewind', 'skip', 'jump', 'go back to', 'take me to', 'advance'],
  'video.playFrom': ['play from', 'start from', 'start at', 'play at', 'resume from', 'start playing from', 'begin at', 'begin from', 'watch from', 'continue from', 'play starting at', 'restart from', 'play again from'],
  'video.mark': ['mark', 'flag', 'bookmark', 'tag', 'mark a hard part', 'mark the start', 'mark the end', 'hard part', 'difficult part', 'note the time', 'pin this moment'],
  'video.place': ['dock', 'place', 'put', 'move', 'position', 'beside', 'above', 'below', 'attach', 'snap', 'arrange', 'move the panel'],
  'video.float': ['float', 'undock', 'detach', 'pop out', 'picture in picture', 'overlay', 'hover', 'make it float', 'mini player'],
  'video.times': ['show times', 'hide times', 'timestamps', 'times', 'show when', 'time stamps', 'toggle times', 'show the times', 'when written'],
  'video.remove': REMOVE,

  'transcript.paste': ['paste', 'add', 'put', 'attach', 'insert', 'load', 'give', 'import', 'upload', 'keep', 'use', 'set', 'store'],
  'transcript.find': ['find', 'search', 'look for', 'look up', 'locate', 'where', 'search for', 'seek', 'grep', 'filter', 'which line'],
  'transcript.remove': REMOVE,

  'web.open': [...SHOW, 'visit', 'load', 'go to', 'browse', 'navigate to', 'surf to', 'pull up a page'],

  'output.answers': ['show answers', 'answers', 'log', 'show the log', 'see the answers', 'open output', 'show output', 'results', 'what did the ai say', 'history', 'responses', 'read the answer'],
  'output.made': ['show made', 'made', 'what was made', 'drafts', 'pending', 'waiting', 'what it made', 'show what was made', 'show the scratch pad'],

  'timer.start': ['start', 'begin', 'go', 'resume', 'continue', 'run', 'kick off', 'launch', 'set going', 'unpause', 'restart', 'start a countdown', 'start countdown', 'begin countdown', 'begin a countdown', 'set off', 'get going'],
  'timer.pause': ['pause', 'hold', 'freeze', 'halt', 'wait', 'suspend', 'break', 'take a break', 'pause the timer'],
  'timer.stop': ['stop', 'reset', 'end', 'cancel', 'clear', 'finish', 'zero', 'kill', 'quit', 'terminate', 'set back', 'stop the timer'],
  'timer.countdown': ['countdown', 'count down', 'set for', 'set to', 'set a', 'timer for', 'alarm in', 'remind me in', 'set the timer', 'make it count down'],
  'timer.stopwatch': ['stopwatch', 'stop watch', 'count up', 'time me', 'measure', 'track time', 'elapsed', 'how long', 'make it count up'],

  'ai.open': [...SHOW, 'start', 'launch', 'call up', 'summon', 'pop up', 'activate', 'bring up'],
  'ai.send': ['send', 'ask', 'request', 'tell', 'submit', 'run', 'prompt', 'query', 'have it', 'get it to', 'make it', 'instruct', 'edit', 'rewrite', 'change', 'improve', 'fix'],
  'ai.instant': ['instant', 'quick', 'at once', 'now', 'immediately', 'without the model', 'lightning', 'fast', 'right away'],
  'ai.undo': ['undo', 'revert', 'take back', 'reverse', 'roll back', 'cancel the change', 'undo the ai', 'undo its change', 'put it back'],
  'ai.close': [...HIDE, 'exit', 'cancel'],
  'ai.stop': ABORT,
  'ai.useModel': ['use', 'switch', 'switch to', 'choose', 'pick', 'select', 'change model', 'set model', 'load', 'swap', 'change to', 'use the model'],

  'chat.send': ['send', 'ask', 'request', 'tell', 'submit', 'make', 'create', 'generate', 'write', 'draw', 'summarize', 'summarise', 'explain', 'chart', 'produce', 'build', 'diagram', 'tabulate'],
  'chat.choose': ['choose', 'set', 'pick', 'switch', 'select', 'change mode', 'prepare', 'get ready', 'set up'],
  'chat.stop': ABORT,
  'chat.frame': ['take the frame', 'grab the frame', 'capture', 'screenshot', 'snapshot', 'frame', 'still', 'take a picture', 'grab a picture', 'snap'],
  'chat.clearPicture': ['clear the picture', 'remove the picture', 'discard the picture', 'drop the picture', 'delete the picture', 'take away the picture', 'clear the image', 'remove the image', 'no picture'],
  'chat.putAnswer': ['put the answer', 'insert the answer', 'paste the answer', 'add the answer', 'use the answer', 'put into the note', 'put it in', 'copy the answer', 'place the answer', 'put in the note', 'insert'],

  'pad.put': ['put', 'insert', 'place', 'paste', 'add', 'use', 'move into the note', 'drop in', 'bring in', 'put in'],
  'pad.remove': [...REMOVE, 'take off'],

  // ----- the note's content (note control, step 2) -----
  'text.add': [...MAKE, 'write', 'insert', 'put', 'type', 'enter', 'append', 'place', 'write down', 'put in', 'add in'],
  'text.rewrite': ['rewrite', 'reword', 'rephrase', 'edit', 'change the words', 'replace the words', 'shorten', 'simplify', 'fix', 'correct', 'improve', 'expand', 'revise', 'update', 'redo', 'make shorter', 'make clearer', 'condense', 'paraphrase', 'replace'],
  'text.look': ['look', 'style', 'format', 'colour', 'color', 'recolour', 'recolor', 'bigger', 'smaller', 'larger', 'resize', 'align', 'center', 'centre', 'font', 'make bigger', 'make smaller', 'make larger', 'paint', 'tint'],
  'text.role': ['turn into', 'change into', 'convert', 'convert to', 'role', 'change to', 'make into', 'promote', 'demote', 'transform into', 'switch to'],
  'text.indent': ['indent', 'nest', 'move in', 'tab', 'push in', 'deeper', 'sub item', 'sub point', 'level in', 'indent more'],
  'text.outdent': ['outdent', 'unindent', 'dedent', 'move out', 'unnest', 'un-nest', 'pull out', 'level out', 'indent less', 'shallower'],
  'text.tick': ['tick', 'check', 'check off', 'mark done', 'mark as done', 'complete', 'cross off', 'untick', 'uncheck', 'tick off'],
  'list.add': [...MAKE, 'write', 'insert', 'put', 'make a list', 'write down', 'put in'],
  'list.addItem': ['add item', 'add an item', 'add a point', 'add point', 'add to', 'append', 'one more', 'another item', 'add another', 'add a step', 'extend', 'add more', 'add to the end'],
  'block.move': [...MOVE, 'move up', 'move down', 'put after', 'put before', 'reorder', 'shift up', 'shift down', 'bring up', 'push down', 'place after', 'place before', 'put', 'place', 'position', 'put beside', 'put below', 'move to the corner'],
  'block.remove': REMOVE,

  // ----- tables, maths, diagrams, pictures (note control, step 3) -----
  'table.add': [...MAKE, 'write', 'insert', 'put', 'draw', 'put in', 'tabulate', 'make a table'],
  'table.rewrite': ['rewrite', 'change', 'edit', 'update', 'fix', 'correct', 'replace', 'revise', 'redo', 'fill in', 'change the cell', 'edit the cell', 'set the cell', 'rename the column', 'rename the row'],
  'table.addRow': ['add row', 'add a row', 'insert row', 'insert a row', 'new row', 'another row', 'one more row', 'append a row', 'append row', 'add rows', 'extra row'],
  'table.addColumn': ['add column', 'add a column', 'insert column', 'insert a column', 'new column', 'another column', 'one more column', 'append a column', 'append column', 'add columns', 'extra column'],
  'table.removeRow': ['remove row', 'remove the row', 'delete row', 'delete the row', 'take out the row', 'drop row', 'drop the row', 'get rid of the row', 'cut the row', 'remove rows', 'delete rows'],
  'table.removeColumn': ['remove column', 'remove the column', 'delete column', 'delete the column', 'take out the column', 'drop column', 'drop the column', 'get rid of the column', 'cut the column', 'remove columns', 'delete columns'],
  'table.look': ['look', 'style', 'format', 'design', 'banded', 'band', 'stripe', 'striped', 'shade', 'lines', 'grid', 'header row', 'borders', 'appearance'],
  'maths.add': [...MAKE, 'write', 'insert', 'put', 'put in', 'type', 'enter'],
  'maths.rewrite': ['rewrite', 'change', 'edit', 'update', 'fix', 'correct', 'replace', 'revise', 'redo', 'simplify'],
  'diagram.add': [...MAKE, 'draw', 'write', 'insert', 'put', 'put in', 'sketch', 'chart', 'plot', 'map out'],
  'diagram.rewrite': ['rewrite', 'change', 'edit', 'update', 'fix', 'correct', 'replace', 'revise', 'redo', 'redraw', 'add a step', 'add a node'],
  'picture.add': [...MAKE, 'insert', 'put', 'put in', 'place', 'bring in', 'use', 'copy', 'paste', 'include', 'embed'],
  'picture.caption': ['caption', 'add a caption', 'write a caption', 'set the caption', 'change the caption', 'label', 'title', 'subtitle'],
  'picture.describe': ['describe', 'description', 'alt', 'alt text', 'add alt text', 'write a description', 'set the description', 'say what it shows', 'explain'],

  // ----- places on a page, boxes and pages (note control, step 4) -----
  'block.resize': ['resize', 'scale', 'widen', 'narrow', 'shrink', 'enlarge', 'stretch', 'make wider', 'make narrower', 'make bigger', 'make smaller', 'bigger', 'smaller', 'wider', 'narrower', 'full width', 'half width', 'size'],
  'box.new': [...MAKE, 'put', 'insert', 'place', 'write', 'draw', 'put in'],
  'page.add': [...MAKE, 'insert', 'append', 'add a page', 'new page', 'another page', 'extra page'],
  'page.move': ['move', 'reorder', 'shift', 'put', 'place', 'swap', 'bring to the front', 'send to the back', 'make first', 'make last', 'rearrange'],
  'page.remove': REMOVE,
  'page.paper': ['paper', 'background', 'ruled', 'lined', 'squared', 'squares', 'grid', 'dots', 'dotted', 'blank', 'plain', 'change the paper', 'set the paper', 'lines'],

  // ----- recipes and the shape rules (note control, step 5) -----
  'recipe.qa': ['qa', 'q and a', 'q&a', 'questions', 'questions and answers', 'question and answer', 'quiz', 'faq', 'flashcards'],
  'recipe.section': ['section', 'add a section', 'new section', 'part', 'chapter', 'topic'],
  'recipe.summary': ['summary', 'summarise', 'summarize', 'sum up', 'key points', 'recap', 'overview', 'tldr', 'takeaways'],
  'recipe.compare': ['compare', 'comparison', 'contrast', 'side by side', 'versus', 'vs', 'differences', 'pros and cons'],
  'recipe.steps': ['steps', 'how to', 'method', 'procedure', 'instructions', 'process', 'step by step'],
  'recipe.definition': ['define', 'definition', 'meaning', 'what it means', 'glossary', 'term', 'explain the term'],
  'write.add': [...MAKE, 'write', 'put', 'insert', 'put in', 'note down', 'jot down', 'type'],
}

/** Words that say nothing of the operation: a, the, please. Prepositions stay: "play from", "go to", "turn on". */
const FILLER = new Set('a an the this that these those my your our its it please pls kindly me i we us you just now some current currently'.split(' '))

/**
 * Some words' roots, filler gone, hyphens split, a name's joined words apart (deleteForever, never an id as w9Q52aDQ): what phrases are matched
 * on. `leaveOut`: words taken out as written, before their roots are made ("settings", whose root is "set").
 */
export const rootsOf = (text: string, leaveOut?: ReadonlySet<string>): string[] =>
  tokens(text.replace(/\b[a-z]+(?:[A-Z][a-z]+)+\b/gu, (name) => name.replace(/([a-z])([A-Z])/gu, '$1 $2')))
    .flatMap((word) => word.split('-'))
    .filter((word) => word !== '' && !FILLER.has(word) && !leaveOut?.has(word))
    .map(stem)

/** Each area's words as roots, the area's own name first. */
export const AREA_WORDS: ReadonlyMap<string, readonly string[][]> = new Map(Object.entries(AREAS).map(([area, about]) => [area, [area, ...about.words].map((text) => rootsOf(text))]))

/**
 * Each command's operation as the instruction page gives it: its name's verb in
 * words ("play from" for playFrom), or, where two names share a root, words of its own that find it alone.
 */
const LABELS: Record<string, string> = {
  'note.blocks': 'list blocks',
  'note.block': 'inspect',
  // Only set, not started: "countdown" alone read as starting one to both models (the po run, 20 October 2026). The
  // stopwatch keeps its name: never misread, and "set stopwatch" is not decisive ("set" is the countdown's too).
  'timer.countdown': 'set countdown',
  // "role" is no word a person says for it: the page gives it as they do.
  'text.role': 'turn into',
  // "look" is the terminal's own line for reading: asked to make the title red, Qwen3-VL-8B wrote text: look block=h1,
  // and wrote it again and again until its reply ran out (the note test's baseline, 25 October 2026).
  'text.look': 'style',
  'table.look': 'style',
}
export const operationOf = (name: string): string => LABELS[name] ?? name.split('.')[1]!.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase()

/**
 * The area a name means: the area itself, or one whose words it is ("trash" is bin, "youtube" video). Undefined when
 * it means none.
 */
export function areaOf(name: string): string | undefined {
  const plain = name.trim().toLowerCase()
  if (AREAS[plain]) return plain
  const roots = rootsOf(plain)
  if (roots.length === 0) return undefined
  for (const [area, words] of AREA_WORDS) if (words.some((word) => word.length === roots.length && word.every((root, i) => root === roots[i]))) return area
  return undefined
}

/** Commands that run only on a phrase matched whole: what cannot be undone, or opens a web page. */
export const STRICT: ReadonlySet<string> = new Set(['bin.deleteForever', 'bin.empty', 'file.saveAs', 'pen.forget', 'web.open'])
