// The server's files on a real disk: every action, and every way a path
// might try to leave the folder. The cases are those of the desktop app's own
// side (src-tauri/src/library.rs), so that both keep the same rules.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { kindOf, NodeFiles, plain } from '../src/nodeFiles.js'

const made: string[] = []
/** A fresh folder for one test, with a long name in it so that Windows gives it a short one too. */
function fresh(name: string): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), `shellnote-files-${name}-`))
  made.push(folder)
  return folder
}
afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true })
})

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const text = (data: Uint8Array): string => new TextDecoder().decode(data)

describe('a name', () => {
  it('is plain only when Windows would keep it as written', () => {
    for (const good of ['Trip.shellnote', 'Recently deleted', '.shellnote', 'a~b', 'Über', 'x'.repeat(255)]) expect(plain(good), good).toBe(true)
    const bad = ['', '.', '..', 'a.', 'a ', '...', 'a/b', 'a\\b', 'C:', 'a:b', 'a.shellnote:stream', 'a*', 'a?', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0000b', 'a\nb', 'x'.repeat(256)]
    const devices = ['CON', 'con', 'nul', 'NUL.shellnote', 'prn.txt', 'AUX', 'COM1', 'com9.shellnote', 'LPT1', 'lpt\u00b9', 'CONIN$', 'conout$', 'con .shellnote']
    for (const name of [...bad, ...devices]) expect(plain(name), JSON.stringify(name)).toBe(false)
  })

  it('says what a path is to the library', () => {
    expect(kindOf('shared', 'Trip.shellnote')).toBe('note')
    expect(kindOf('shared', 'Work/Plans.SHELLNOTE')).toBe('note')
    expect(kindOf('shared', '.shellnote')).toBe('other')
    expect(kindOf('shared', 'Work/Thesis.docx')).toBe('other')
    expect(kindOf('shared', 'run.exe')).toBe('other')
    expect(kindOf('shared', '.hidden/a.shellnote')).toBe('other')
    expect(kindOf('shared', '~$lock.shellnote')).toBe('other')
    expect(kindOf('shared', 'Work/desktop.ini')).toBe('clutter')
    expect(kindOf('shared', '.a.shellnote.tmp-12-3')).toBe('clutter')
    expect(kindOf('shared', '.shellnote/library.json')).toBe('own')
    expect(kindOf('shared', '.shellnote/previews/n1.webp')).toBe('own')
    expect(kindOf('shared', '.shellnote/run.exe')).toBe('other')
    expect(kindOf('shared', '.shellnote/a/b/c.json')).toBe('other')
    expect(kindOf('own', 'device.json')).toBe('own')
    expect(kindOf('own', 'notes/n1.doc.json')).toBe('own')
    expect(kindOf('own', 'notes/n1.state.json')).toBe('own')
    expect(kindOf('own', 'notes/n1.exe')).toBe('other')
    expect(kindOf('own', 'notes/../x.doc.json')).toBe('other')
    expect(kindOf('own', 'assets/0a1b2c3d')).toBe('own')
    expect(kindOf('own', 'assets/run.exe')).toBe('other')
    expect(kindOf('own', 'run.exe')).toBe('other')
  })
})

describe('the folder chosen', () => {
  it('must be there, and is given as a whole path', async () => {
    await expect(NodeFiles.open('notes', 'shared')).rejects.toThrow()
    await expect(NodeFiles.open(path.join(fresh('none'), 'not-there'), 'shared')).rejects.toThrow()
    const own = path.join(fresh('own'), 'made', 'on', 'the', 'way')
    await NodeFiles.open(own, 'own')
    expect(existsSync(own)).toBe(true)
  })

  it('reads, writes, lists, moves and removes notes and the library\'s own files', async () => {
    const root = fresh('acts')
    const files = await NodeFiles.open(root, 'shared')
    await files.write('Trip.shellnote', bytes('trip'))
    await files.write('Work/Plans.shellnote', bytes('plans'))
    await files.write('.shellnote/library.json', bytes('{}'))
    await files.makeFolder('Empty/Deeper')
    expect(text(await files.read('Trip.shellnote'))).toBe('trip')
    expect(text(await files.read('Work/Plans.shellnote'))).toBe('plans')

    const listed = (await files.list()).map((info) => `${info.path}${info.folder ? '/' : ''}`).sort()
    expect(listed).toEqual(['.shellnote/', '.shellnote/library.json', 'Empty/', 'Empty/Deeper/', 'Trip.shellnote', 'Work/', 'Work/Plans.shellnote'])
    const info = await files.info('Trip.shellnote')
    expect(info).toMatchObject({ path: 'Trip.shellnote', folder: false, size: 4 })
    expect(info!.modified).toBeGreaterThan(1_700_000_000_000)
    expect(await files.info('Work')).toMatchObject({ folder: true, size: 0 })
    expect(await files.info('not-there.shellnote')).toBeUndefined()

    // A write takes the place of what was there, whole, and leaves no temporary file behind.
    await files.write('Trip.shellnote', bytes('trip, again'))
    expect(text(await files.read('Trip.shellnote'))).toBe('trip, again')
    expect(readdirSync(root).filter((name) => name.includes('.tmp-'))).toEqual([])

    await files.move('Trip.shellnote', 'Work/Journey.shellnote')
    expect(text(await files.read('Work/Journey.shellnote'))).toBe('trip, again')
    await files.move('Work', 'Office')
    expect(text(await files.read('Office/Plans.shellnote'))).toBe('plans')

    await files.remove('Office/Plans.shellnote')
    await files.remove('not-there.shellnote')
    await files.remove('Empty')
    expect(existsSync(path.join(root, 'Empty'))).toBe(false)
    await expect(files.read('Office/Plans.shellnote')).rejects.toThrow('is not there')
  })

  it('never touches a file that is not the library\'s', async () => {
    const root = fresh('kinds')
    mkdirSync(path.join(root, 'Folder'))
    writeFileSync(path.join(root, 'Folder', 'Thesis.docx'), "the person's own")
    writeFileSync(path.join(root, 'Folder', 'b.shellnote'), 'b')
    const files = await NodeFiles.open(root, 'shared')

    await expect(files.read('Folder/Thesis.docx')).rejects.toThrow('not a note')
    await expect(files.write('Folder/Thesis.docx', bytes('x'))).rejects.toThrow('not a note')
    await expect(files.write('run.exe', bytes('x'))).rejects.toThrow('not a note')
    await expect(files.write('.shellnote/run.exe', bytes('x'))).rejects.toThrow('not a note')
    await expect(files.remove('Folder/Thesis.docx')).rejects.toThrow('not a note')
    // A folder with a file in it is never removed with what it holds, and the library's hidden folder never whole.
    await expect(files.remove('Folder')).rejects.toThrow('still holds files')
    await files.write('.shellnote/library.json', bytes('{}'))
    await expect(files.remove('.shellnote')).rejects.toThrow()
    await expect(files.makeFolder('.shellnote/more')).rejects.toThrow()
    expect(readFileSync(path.join(root, 'Folder', 'Thesis.docx'), 'utf8')).toBe("the person's own")

    // A move never takes another file's place, never changes a file's kind, and never goes into the hidden folder.
    writeFileSync(path.join(root, 'a.shellnote'), 'a')
    await expect(files.move('a.shellnote', 'Folder/b.shellnote')).rejects.toThrow('is there already')
    await expect(files.move('Folder/Thesis.docx', 'Folder/Thesis.shellnote')).rejects.toThrow('not a note')
    await expect(files.move('a.shellnote', 'a.exe')).rejects.toThrow('not a note')
    await expect(files.move('a.shellnote', '.shellnote/a.shellnote')).rejects.toThrow()
    await expect(files.move('Folder', '.shellnote/Folder')).rejects.toThrow()
    expect(readFileSync(path.join(root, 'Folder', 'b.shellnote'), 'utf8')).toBe('b')
    // The same name in other letters is the note itself: renamed.
    await files.move('a.shellnote', 'A.shellnote')
    expect(readdirSync(root)).toContain('A.shellnote')
  })

  it('keeps its own place to its own three kinds of file', async () => {
    const own = await NodeFiles.open(fresh('own-kinds'), 'own')
    await own.write('device.json', bytes('{}'))
    await own.write('notes/n1.doc.json', bytes('{}'))
    await own.write('assets/0a1b2c3d', bytes('picture'))
    expect(text(await own.read('assets/0a1b2c3d'))).toBe('picture')
    await expect(own.write('run.exe', bytes('x'))).rejects.toThrow('not a note')
    await expect(own.write('notes/n1.exe', bytes('x'))).rejects.toThrow('not a note')
    await expect(own.move('assets/0a1b2c3d', 'assets/0a1b2c3e')).rejects.toThrow()
    await expect(own.makeFolder('more')).rejects.toThrow()
    await own.remove('notes/n1.doc.json')
    expect(await own.info('notes/n1.doc.json')).toBeUndefined()
  })
})

describe('a path that would leave the folder', () => {
  const HOSTILE = [
    '',
    '..',
    '../secret.shellnote',
    'Folder/../../secret.shellnote',
    'Folder/./a.shellnote',
    '/secret.shellnote',
    '//server/share/secret.shellnote',
    '\\\\server\\share\\secret.shellnote',
    'Folder\\..\\..\\secret.shellnote',
    'C:/secret.shellnote',
    'C:secret.shellnote',
    'a.shellnote:stream',
    'a.shellnote::$DATA',
    'NUL',
    'CON.shellnote',
    'Folder/aux.shellnote',
    'a.shellnote.',
    'a.shellnote ',
    'Folder /a.shellnote',
    'a\u0000.shellnote',
    `${'x/'.repeat(1100)}a.shellnote`,
  ]

  it('is refused by every action, and nothing outside changes', async () => {
    const base = fresh('hostile')
    const root = path.join(base, 'library')
    mkdirSync(path.join(root, 'Folder'), { recursive: true })
    writeFileSync(path.join(base, 'secret.shellnote'), 'secret')
    const files = await NodeFiles.open(root, 'shared')
    for (const rel of HOSTILE) {
      const where = JSON.stringify(rel.slice(0, 60))
      await expect(files.read(rel), where).rejects.toThrow()
      await expect(files.write(rel, bytes('x')), where).rejects.toThrow()
      await expect(files.info(rel), where).rejects.toThrow()
      await expect(files.remove(rel), where).rejects.toThrow()
      await expect(files.makeFolder(rel), where).rejects.toThrow()
      await expect(files.move(rel, 'moved.shellnote'), where).rejects.toThrow()
      await expect(files.move('Folder', rel), where).rejects.toThrow()
    }
    expect(readFileSync(path.join(base, 'secret.shellnote'), 'utf8')).toBe('secret')
    expect(readdirSync(base).sort()).toEqual(['library', 'secret.shellnote'])
    expect(readdirSync(root)).toEqual(['Folder'])
  })

  it('is refused through a link to elsewhere, which a listing never follows', async () => {
    const base = fresh('links')
    const [root, outside] = [path.join(base, 'library'), path.join(base, 'outside')]
    mkdirSync(path.join(root, 'A folder with a long name'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(path.join(outside, 'secret.shellnote'), 'secret')
    writeFileSync(path.join(root, 'A folder with a long name', 'a.shellnote'), 'a')
    // A junction needs no administrator on Windows: any program may leave one in a folder it can write to.
    symlinkSync(outside, path.join(root, 'way-out'), 'junction')
    const files = await NodeFiles.open(root, 'shared')

    await expect(files.info('way-out')).rejects.toThrow('not inside')
    await expect(files.read('way-out/secret.shellnote')).rejects.toThrow('not inside')
    await expect(files.write('way-out/new.shellnote', bytes('x'))).rejects.toThrow('not inside')
    await expect(files.remove('way-out/secret.shellnote')).rejects.toThrow('not inside')
    await expect(files.remove('way-out')).rejects.toThrow('not inside')
    await expect(files.move('way-out/secret.shellnote', 'taken.shellnote')).rejects.toThrow('not inside')
    await expect(files.move('A folder with a long name/a.shellnote', 'way-out/a.shellnote')).rejects.toThrow('not inside')
    await expect(files.makeFolder('way-out/more')).rejects.toThrow('not inside')
    expect(readdirSync(outside)).toEqual(['secret.shellnote'])
    expect(readFileSync(path.join(outside, 'secret.shellnote'), 'utf8')).toBe('secret')
    expect((await files.list()).every((info) => !info.path.startsWith('way-out'))).toBe(true)

    // The short form of a long name, where this disk keeps one, is not the name: refused.
    await expect(files.read('AFOLDE~1/a.shellnote')).rejects.toThrow()
    expect(text(await files.read('A folder with a long name/a.shellnote'))).toBe('a')
  })

  it('is refused when the folder chosen is itself reached through a link, once inside', async () => {
    const base = fresh('root-link')
    const [real, link] = [path.join(base, 'real'), path.join(base, 'link')]
    mkdirSync(real)
    symlinkSync(real, link, 'junction')
    // The link is followed once, as the folder is opened: the person chose it. Paths inside are then held to the real one.
    const files = await NodeFiles.open(link, 'shared')
    await files.write('a.shellnote', bytes('a'))
    expect(readFileSync(path.join(real, 'a.shellnote'), 'utf8')).toBe('a')
    await expect(files.read('../link/a.shellnote')).rejects.toThrow('not inside')
  })
})
