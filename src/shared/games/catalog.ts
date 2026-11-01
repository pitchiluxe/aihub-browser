export type BuiltinGameId = 'blocks' | 'solitaire' | 'maze' | 'property' | 'snake' | '2048'
export interface BuiltinGame { id: BuiltinGameId; title: string; genre: string; description: string; color: string; aliases: string; players: string }
export const BUILTIN_GAMES: BuiltinGame[] = [
  { id: 'blocks', title: 'Falling Blocks', genre: 'Puzzle', description: 'Stack, rotate, and clear your way to the next level.', color: '#6eb6ff', aliases: 'tetris tetromino', players: '1 player' },
  { id: 'solitaire', title: 'Solitaire', genre: 'Cards', description: 'A quiet table. Fifty-two cards. Your next perfect move.', color: '#6ed5ae', aliases: 'klondike patience cards', players: '1 player' },
  { id: 'maze', title: 'Maze Chase', genre: 'Arcade', description: 'Clear every dot. Turn the chase around with a power orb.', color: '#f5cc68', aliases: 'pac man pacman maze', players: '1 player' },
  { id: 'property', title: 'Property Circuit', genre: 'Board', description: 'Buy a block, build a district, and outlast your rivals.', color: '#ed9c81', aliases: 'monopoly property money real estate', players: '1–4 players' },
  { id: 'snake', title: 'Snake', genre: 'Arcade', description: 'One more bite. One less place to turn.', color: '#a8d479', aliases: 'snake classic', players: '1 player' },
  { id: '2048', title: '2048', genre: 'Puzzle', description: 'Slide matching numbers together. How far can you go?', color: '#c4afff', aliases: '2048 number slide merge', players: '1 player' },
]
export const ROM_SYSTEMS = [
  { id: 'nes', label: 'NES / Famicom', core: 'fceumm', extensions: ['nes'] },
  { id: 'genesis', label: 'Sega Genesis / Mega Drive', core: 'picodrive', extensions: ['md', 'gen', 'bin', 'smd'] },
  { id: 'snes', label: 'Super Nintendo', core: 'snes9x', extensions: ['smc', 'sfc'] },
  { id: 'gb', label: 'Game Boy / Game Boy Color', core: 'gambatte', extensions: ['gb', 'gbc'] },
  { id: 'gba', label: 'Game Boy Advance', core: 'mgba', extensions: ['gba'] },
  { id: 'arcade', label: 'Arcade — FinalBurn Neo', core: 'fbneo', extensions: ['zip'] },
  { id: 'mame', label: 'Arcade — MAME 2003 Plus', core: 'mame2003_plus', extensions: ['zip'] },
] as const
export type RomSystem = typeof ROM_SYSTEMS[number]['id']
export const CLASSIC_GAMES: { title: string; system: RomSystem; genre: string; color: string }[] = [
  { title: 'Super Mario Bros. 1', system: 'nes', genre: 'Platform', color: '#ed9c81' },
  { title: 'Sonic the Hedgehog', system: 'genesis', genre: 'Platform', color: '#6eb6ff' },
  { title: 'Double Dragon', system: 'nes', genre: 'Beat ’em up', color: '#c4afff' },
  { title: 'Mortal Kombat', system: 'genesis', genre: 'Fighting', color: '#f5cc68' },
  { title: 'Street Fighter II', system: 'genesis', genre: 'Fighting', color: '#ed9c81' },
  { title: 'Pac-Man', system: 'nes', genre: 'Arcade', color: '#f5cc68' },
  { title: 'Monopoly', system: 'nes', genre: 'Board', color: '#6ed5ae' },
]
export const MAX_ROM_BYTES = 64 * 1024 * 1024
export const MAX_GAME_LIBRARY_BYTES = 256 * 1024 * 1024
export const MAX_GAME_LIBRARY_COUNT = 40
export function validateRom(name: string, size: number, system: RomSystem): void {
  const selected = ROM_SYSTEMS.find(item => item.id === system)
  if (!selected || !Number.isFinite(size) || size <= 0 || size > MAX_ROM_BYTES) throw Error('Choose a supported game file between 1 byte and 64 MB.')
  const extension = name.split('.').pop()?.toLowerCase() || ''
  if (!(selected.extensions as readonly string[]).includes(extension) && !(extension === 'zip' && ['nes', 'genesis', 'snes', 'gb', 'gba'].includes(system))) throw Error(`Choose a ${selected.label} game file (${selected.extensions.map(ext => '.' + ext).join(', ')}${system === 'arcade' || system === 'mame' ? '' : ', or .zip'}).`)
}
