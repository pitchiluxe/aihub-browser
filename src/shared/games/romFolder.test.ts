import { describe, expect, it } from 'vitest'
import { cartridgeHue, cleanRomTitle, detectRomSystem, zipEntryNames } from './romFolder'

function zip(names: string[]): Uint8Array {
  // Minimal stored-entry archive: local headers are irrelevant to the
  // central-directory walk, so only the directory and end record are written.
  const encoder = new TextEncoder(), central: number[] = []
  for (const name of names) {
    const bytes = encoder.encode(name), header = new Uint8Array(46)
    new DataView(header.buffer).setUint32(0, 0x02014b50, true)
    new DataView(header.buffer).setUint16(28, bytes.length, true)
    central.push(...header, ...bytes)
  }
  const end = new Uint8Array(22), view = new DataView(end.buffer)
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, names.length, true); view.setUint16(10, names.length, true)
  view.setUint32(12, central.length, true); view.setUint32(16, 4, true)
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...central, ...end])
}

describe('ROM folder import', () => {
  it('reads every file name from a zip central directory', () => {
    expect(zipEntryNames(zip(['readme.txt', 'Mega Man 2 (USA).nes']))).toEqual(['readme.txt', 'Mega Man 2 (USA).nes'])
    expect(zipEntryNames(new Uint8Array([1, 2, 3]))).toEqual([])
  })
  it('detects the console from a loose file or the cartridge inside a zip', () => {
    expect(detectRomSystem('Tennis (JU).nes', new Uint8Array([0x4e, 0x45, 0x53, 0x1a]))).toEqual({ system: 'nes', innerName: 'Tennis (JU).nes' })
    expect(detectRomSystem('Sonic.zip', zip(['Sonic The Hedgehog (USA, Europe).md']))).toEqual({ system: 'genesis', innerName: 'Sonic The Hedgehog (USA, Europe).md' })
    expect(detectRomSystem('pack.zip', zip(['notes.txt', 'Game.sfc']))?.system).toBe('snes')
    expect(detectRomSystem('mslug.zip', zip(['201-p1.p1', '201-s1.s1']))).toBeNull()
    expect(detectRomSystem('photo.jpg', new Uint8Array(4))).toBeNull()
  })
  it('turns dump names into shelf titles', () => {
    expect(cleanRomTitle('Batman - Return of the Joker (USA).nes')).toBe('Batman - Return of the Joker')
    expect(cleanRomTitle('Mortal Kombat Trilogy [!].nes')).toBe('Mortal Kombat Trilogy')
    expect(cleanRomTitle('Flintstones 2 - The Surprise at Dinosaur Peak!, The (U).nes')).toBe('The Flintstones 2 - The Surprise at Dinosaur Peak!')
    expect(cleanRomTitle('Super Mario Bros. 3 (USA) (Rev 1).nes')).toBe('Super Mario Bros. 3')
    expect(cleanRomTitle('Batman_ The Video Game.zip')).toBe('Batman: The Video Game')
    expect(cleanRomTitle('(USA).nes')).toBe('(USA)')
  })
  it('gives each title a stable label colour', () => {
    expect(cartridgeHue('Mega Man 2')).toBe(cartridgeHue('Mega Man 2'))
    expect(cartridgeHue('Mega Man 2')).not.toBe(cartridgeHue('Mega Man 4'))
    expect(cartridgeHue('x')).toBeGreaterThanOrEqual(0); expect(cartridgeHue('x')).toBeLessThan(360)
  })
})
