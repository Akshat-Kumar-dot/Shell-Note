// The library: what it holds (store.ts), the one kept in a folder of files
// (library.ts), and how those files are reached (files.ts). Its rules over
// entries are in ./tree, and how it lies in its folder in ./layout.
export { MemoryFiles, type FileInfo, type Files } from './files.js'
export { FolderLibrary, type FolderLibraryOptions } from './library.js'
export { EXTENSION, fileName } from './names.js'
export { KEPT_DAYS, type Exchanged, type ExchangedNote, type FileState, type FolderEntry, type ItemRef, type Library, type LibraryStore, type NoteEntry, type OpenedNote, type OutsideChange, type SavingNote } from './store.js'
