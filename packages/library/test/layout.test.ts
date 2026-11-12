import { describe, expect, it } from 'vitest'
import { isClutter, isNote, safeName, titleStem } from '../src/layout.js'

describe('names in the library folder', () => {
  it('a folder name never ends in a dot or a space, which Windows would drop', () => {
    expect(safeName('Unit 2. ')).toBe('Unit 2')
    expect(safeName('...')).toBe('Untitled folder')
    // Cut at a hundred characters, on a space: the space goes too.
    const long = `${'a'.repeat(99)} b`
    expect(safeName(long)).toBe('a'.repeat(99))
    expect(safeName(`${'a'.repeat(99)}.b`)).toBe('a'.repeat(99))
  })

  it("a name is never a device's, and never one Windows cannot hold", () => {
    expect(safeName('CON')).toBe('Folder CON')
    expect(safeName('nul.txt')).toBe('Folder nul.txt')
    expect(safeName('a/b:c*d')).toBe('a-b-c-d')
    expect(titleStem('aux')).toBe('Note aux')
    expect(titleStem('.plans')).toBe('plans')
  })

  it('a note is a .shellnote file in no hidden folder', () => {
    expect(isNote('Folder/a.shellnote')).toBe(true)
    expect(isNote('.shellnote/a.shellnote')).toBe(false)
    expect(isNote('Folder/~$a.shellnote')).toBe(false)
    expect(isNote('Folder/a.docx')).toBe(false)
    expect(isClutter('desktop.ini')).toBe(true)
    expect(isClutter('.a.shellnote.tmp-12-3')).toBe(true)
    expect(isClutter('Thesis.docx')).toBe(false)
  })
})
