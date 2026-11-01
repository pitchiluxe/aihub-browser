import { ROM_SYSTEMS, type RomSystem } from './catalog'

// Console systems only: arcade sets are zips of chip dumps whose names do not
// identify a board, so they still go through the manual import form.
const CONSOLE_EXTENSIONS = new Map<string, RomSystem>(ROM_SYSTEMS.filter(system => system.id !== 'arcade' && system.id !== 'mame').flatMap(system => system.extensions.map(extension => [extension, system.id] as [string, RomSystem])))
const extensionOf = (name: string) => name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''

export function zipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record sits in the last 22 bytes plus an optional comment of up to 64 KB.
  for (let end = bytes.length - 22; end >= Math.max(0, bytes.length - 22 - 65_535); end--) {
    if (view.getUint32(end, true) !== 0x06054b50) continue
    const names: string[] = [], decoder = new TextDecoder()
    let offset = view.getUint32(end + 16, true)
    for (let index = view.getUint16(end + 10, true); index > 0 && offset + 46 <= bytes.length && view.getUint32(offset, true) === 0x02014b50; index--) {
      const nameLength = view.getUint16(offset + 28, true)
      names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)))
      offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    }
    return names
  }
  return []
}

export function detectRomSystem(fileName: string, bytes: Uint8Array): { system: RomSystem; innerName: string } | null {
  const extension = extensionOf(fileName)
  if (extension !== 'zip') { const system = CONSOLE_EXTENSIONS.get(extension); return system ? { system, innerName: fileName } : null }
  for (const name of zipEntryNames(bytes)) { const system = CONSOLE_EXTENSIONS.get(extensionOf(name)); if (system) return { system, innerName: name.split('/').pop()! } }
  return null
}

export function cleanRomTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  // Archive sites swap ":" for "_ " because Windows forbids colons in file names.
  let title = base.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_ /g, ': ').replace(/\s+/g, ' ').trim()
  if (/, The$/.test(title)) title = 'The ' + title.slice(0, -5)
  return title || base
}

export function cartridgeHue(title: string): number {
  let hash = 2166136261
  for (const character of title) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619)
  return (hash >>> 0) % 360
}
