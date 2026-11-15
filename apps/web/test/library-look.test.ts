// The library's look: Home is its top's own; cards or a list are the top's and the folders' alike, but chosen inside a
// folder while the top shows as Home, the folders' alone; and back as it started, everything shows as cards.
import { beforeEach, describe, expect, it } from 'vitest'
import { folderLook, libraryLook, listLookOf, resetLibraryLook, setLibraryLook, showingFolder } from '../src/library/look.js'

const both = (): [string, string] => [libraryLook.value, folderLook.value]

describe("the library's look", () => {
  beforeEach(() => {
    showingFolder(false)
    resetLibraryLook()
  })

  it('cards or a list are the top and the folders alike, chosen at the top or in a folder', () => {
    expect(setLibraryLook('list')).toBe('all')
    expect(both()).toEqual(['list', 'list'])
    showingFolder(true)
    expect(setLibraryLook('cards')).toBe('all')
    expect(both()).toEqual(['cards', 'cards'])
  })

  it("Home is the top's alone; a folder under it shows as cards or a list, as last chosen in one", () => {
    setLibraryLook('list')
    expect(setLibraryLook('home')).toBe('top')
    expect(both()).toEqual(['home', 'list'])
    expect(listLookOf(libraryLook.value, folderLook.value)).toBe('list')
    showingFolder(true)
    expect(setLibraryLook('cards')).toBe('folders')
    expect(both()).toEqual(['home', 'cards'])
    expect(listLookOf(libraryLook.value, folderLook.value)).toBe('cards')
  })

  it('cards or a list chosen at the top leave Home', () => {
    setLibraryLook('home')
    expect(setLibraryLook('list')).toBe('all')
    expect(both()).toEqual(['list', 'list'])
  })

  it('goes back to cards, the top and the folders alike', () => {
    setLibraryLook('home')
    showingFolder(true)
    setLibraryLook('list')
    resetLibraryLook()
    expect(both()).toEqual(['cards', 'cards'])
  })
})
