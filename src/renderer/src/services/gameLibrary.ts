import { MAX_ROM_BYTES, MAX_GAME_LIBRARY_BYTES, MAX_GAME_LIBRARY_COUNT, validateRom, type RomSystem } from '../../../shared/games/catalog'
export interface RomGame { id: string; title: string; fileName: string; system: RomSystem; size: number; addedAt: number }
export interface RomFiles { game: Blob; bios?: Blob }
let database: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('aihub-game-room', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('games', { keyPath: 'id' }); request.result.createObjectStore('files') }
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined }; resolve(db) }
    request.onerror = () => { database = undefined; reject(Error('Game storage is unavailable. Free some disk space and try again.')) }
    request.onblocked = () => { database = undefined; reject(Error('Close other Game room windows and try again.')) }
  })
}
export async function listRomGames(): Promise<RomGame[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = db.transaction('games').objectStore('games').getAll()
    request.onsuccess = () => resolve((request.result as RomGame[]).sort((a, b) => b.addedAt - a.addedAt))
    request.onerror = () => reject(Error('Could not read your game library.'))
  })
}
export async function prepareRom(file: File, title: string, system: RomSystem, bios?: File): Promise<{ info: RomGame; files: RomFiles }> {
  validateRom(file.name, file.size, system)
  if (bios && bios.size > 8 * 1024 * 1024) throw Error('BIOS files must be 8 MB or smaller.')
  const bytes = await file.arrayBuffer(), header = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'nes' && (header[0] !== 0x4e || header[1] !== 0x45 || header[2] !== 0x53 || header[3] !== 0x1a)) throw Error('This file does not have a valid NES cartridge header.')
  if (extension === 'zip' && (header[0] !== 0x50 || header[1] !== 0x4b)) throw Error('This file is not a ZIP game archive.')
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  return { info: { id: hash, title: title.trim().slice(0, 100) || file.name.replace(/\.[^.]+$/, ''), fileName: file.name, system, size: file.size + (bios?.size || 0), addedAt: Date.now() }, files: { game: new Blob([bytes]), bios } }
}
export async function saveRomGame(info: RomGame, files: RomFiles): Promise<void> {
  if (files.game.size > MAX_ROM_BYTES) throw Error('Game file exceeds 64 MB.')
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['games', 'files'], 'readwrite'), request = tx.objectStore('games').getAll()
    let message = 'Could not save this game. Check available disk space.'
    request.onsuccess = () => {
      const others = (request.result as RomGame[]).filter(game => game.id !== info.id)
      if (others.length >= MAX_GAME_LIBRARY_COUNT || others.reduce((total, game) => total + game.size, 0) + info.size > MAX_GAME_LIBRARY_BYTES) { message = `Your library is limited to ${MAX_GAME_LIBRARY_COUNT} games and 256 MB. Remove an imported game before adding another.`; tx.abort(); return }
      tx.objectStore('games').put(info); tx.objectStore('files').put(files, info.id)
    }
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(Error(message))
  })
}
export async function readRomFiles(id: string): Promise<RomFiles> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(id)
    request.onsuccess = () => request.result ? resolve(request.result) : reject(Error('This game file is missing. Import it again.'))
    request.onerror = () => reject(Error('Could not load this game.'))
  })
}
export async function removeRomGame(id: string): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['games', 'files'], 'readwrite')
    tx.objectStore('games').delete(id); tx.objectStore('files').delete(id)
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(Error('Could not remove this game.'))
  })
}
