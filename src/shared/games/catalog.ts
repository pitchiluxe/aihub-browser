export type BuiltinGameId = 'blocks' | 'solitaire' | 'maze' | 'property' | 'snake' | '2048' | 'echo' | 'orbit' | 'rulequake' | 'checkers' | 'dames' | 'ludo'
export interface BuiltinGame { id: BuiltinGameId; title: string; genre: string; description: string; color: string; aliases: string; players: string; goal: string; howTo: string[] }
export const BUILTIN_GAMES: BuiltinGame[] = [
  { id: 'echo', title: 'Echo Heist', genre: 'Originals', description: 'Steal tomorrow’s treasure. Escape yesterday’s moves.', color: '#79dce8', aliases: 'original challenge echo heist strategy', players: '1 player',
    goal: 'Collect as many crystals as you can in 36 moves without running into your echo.', howTo: ['Move one square at a time with the arrow keys or the on-screen pad. Each crystal is worth 100 points.', 'Your echo follows four moves behind you, standing where you were four moves ago.', 'Stepping onto your echo costs a heart and 150 points. Three hearts lost ends the heist.', 'Share the challenge code so a friend can play the exact same board.'] },
  { id: 'orbit', title: 'Orbit Auction', genre: 'Originals', description: 'Six reversals. A moving storm. When will you cash out?', color: '#f5ab86', aliases: 'original challenge orbit auction risk stars', players: '1 player',
    goal: 'Catch stars around the orbit and bank your cargo before the 24-turn window closes.', howTo: ['Coast → moves your ship one step. Landing on a star adds cargo — later stars are worth more.', 'Reverse ← turns around. You have fuel for six reversals.', 'The storm circles the other way. Meeting it costs a shield and half your cargo.', 'Bank cargo ↓ ends the round and keeps all of it. If time runs out, you keep only half.'] },
  { id: 'rulequake', title: 'Rulequake', genre: 'Originals', description: 'The board changes. The rule flips. Can your brain keep up?', color: '#c4afff', aliases: 'original challenge rulequake logic reaction', players: '1 player',
    goal: 'Pick tiles that match the current rule as fast as you can before the clock runs out.', howTo: ['Read THE CURRENT RULE, for example “blue AND circle” or “red OR square — but NOT both”.', 'Click any one tile that matches. Every pick deals a new board with a new rule.', 'Correct picks in a row build a streak for bonus points.', 'A wrong tile costs a heart and four seconds. Three wrong picks, or no time left, ends the game.'] },
  { id: 'blocks', title: 'Falling Blocks', genre: 'Puzzle', description: 'Stack, rotate, and clear your way to the next level.', color: '#6eb6ff', aliases: 'tetris tetromino 3d', players: '1 player',
    goal: 'Fill complete rows to clear them. The game ends when the stack reaches the top.', howTo: ['← → move the falling piece. ↑ rotates it.', '↓ drops it faster; Space slams it straight down (the faint outline shows where).', 'C puts the piece on hold so you can swap it in later.', 'Clearing several rows at once scores much more. Every 10 rows the pieces fall faster.'] },
  { id: 'solitaire', title: 'Solitaire', genre: 'Cards', description: 'A quiet table. Fifty-two cards. Your next perfect move.', color: '#6ed5ae', aliases: 'klondike patience cards', players: '1 player',
    goal: 'Move all 52 cards onto the four piles at the top, Ace to King in one suit each.', howTo: ['Click a card, then click where it should go.', 'In the seven columns, stack cards downward in alternating colours (red 7 on black 8).', 'Only a King can go into an empty column.', 'Click the deck to draw a new card when you are stuck. Undo takes back a move.'] },
  { id: 'maze', title: 'Maze Chase', genre: 'Arcade', description: 'Clear every dot. Turn the chase around with a power orb.', color: '#f5cc68', aliases: 'pac man pacman maze', players: '1 player',
    goal: 'Eat every dot in the maze without being caught.', howTo: ['Steer with the arrow keys or the on-screen pad. You keep moving until a wall stops you.', 'Press a direction just before a turn and you will take it as soon as there is room.', 'Big orbs make the chasers turn grey for a few seconds — catch them for bonus points.', 'You have three lives.'] },
  { id: 'property', title: 'Property Circuit', genre: 'Board', description: 'Buy a block, build a district, and outlast your rivals.', color: '#ed9c81', aliases: 'monopoly property money real estate 3d', players: '1–4 players',
    goal: 'Be the last player with money left, or the richest after 120 turns.', howTo: ['Roll dice to move your pawn around the board.', 'Land on an unowned street to buy it. Others pay you rent when they land there.', 'Own both streets of a colour and rent doubles — then develop them to raise it further.', 'Tax spaces cost money and Road works makes you miss a turn. Use Top view for a flat board.'] },
  { id: 'checkers', title: 'Checkers', genre: 'Board', description: 'Eight by eight. Jump, chain, and crown your king.', color: '#e0785a', aliases: 'checkers draughts dame dames board', players: '1–2 players',
    goal: 'Capture all of your opponent’s pieces or leave them with no move.', howTo: ['Pieces move one square diagonally forward onto dark squares.', 'Jump over an opponent’s piece to capture it. Jumping is compulsory — and you keep jumping while you can.', 'Reach the far row to become a king. Kings move forward and backward.', 'Click a piece to see its moves highlighted, then click where to go.'] },
  { id: 'dames', title: 'Dames', genre: 'Board', description: 'International draughts on a 10×10 board with flying kings.', color: '#c9a36b', aliases: 'dame dames international draughts jeu de dames checkers', players: '1–2 players',
    goal: 'Capture all of your opponent’s pieces or leave them with no move.', howTo: ['Pieces move one square diagonally forward, but can capture forwards and backwards.', 'Capturing is compulsory, and you must take the sequence that captures the most pieces.', 'A piece that finishes its move on the far row becomes a dame (king).', 'A dame flies any distance along a diagonal and can capture from afar.'] },
  { id: 'ludo', title: 'Ludo', genre: 'Board', description: 'Roll a six, race four pawns home, send rivals back.', color: '#f1c232', aliases: 'ludo jeu de six petits chevaux parcheesi dice board', players: '1–4 players',
    goal: 'Be the first to bring all four of your pawns around the board and into your home triangle.', howTo: ['Press Roll die (or Space). You need a 6 to bring a pawn out of your yard.', 'Click a glowing pawn to move it that many squares clockwise, then up your coloured column.', 'Land on an opponent to send them back to their yard — but not on a ★ star or a start square, which are safe.', 'Rolling a 6, capturing, or getting a pawn home gives you another roll. Three 6s in a row lose your turn, and you need the exact number to finish.'] },
  { id: 'snake', title: 'Snake', genre: 'Arcade', description: 'One more bite. One less place to turn.', color: '#a8d479', aliases: 'snake classic', players: '1 player',
    goal: 'Eat as much fruit as possible without hitting a wall or yourself.', howTo: ['Steer with the arrow keys or the on-screen pad.', 'Every fruit makes the snake one segment longer.', 'You cannot reverse straight back into yourself.', 'Leave yourself room — the tail follows exactly where the head went.'] },
  { id: '2048', title: '2048', genre: 'Puzzle', description: 'Slide matching numbers together. How far can you go?', color: '#c4afff', aliases: '2048 number slide merge', players: '1 player',
    goal: 'Merge tiles until you make a 2048 tile.', howTo: ['Arrow keys slide every tile as far as it can go in that direction.', 'Two tiles with the same number merge into one with double the value.', 'A new 2 or 4 appears after every move.', 'Keep your biggest tile in a corner. The game ends when no move is possible.'] },
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
export const MAX_GAME_LIBRARY_COUNT = 150
export function validateRom(name: string, size: number, system: RomSystem): void {
  const selected = ROM_SYSTEMS.find(item => item.id === system)
  if (!selected || !Number.isFinite(size) || size <= 0 || size > MAX_ROM_BYTES) throw Error('Choose a supported game file between 1 byte and 64 MB.')
  const extension = name.split('.').pop()?.toLowerCase() || ''
  if (!(selected.extensions as readonly string[]).includes(extension) && !(extension === 'zip' && ['nes', 'genesis', 'snes', 'gb', 'gba'].includes(system))) throw Error(`Choose a ${selected.label} game file (${selected.extensions.map(ext => '.' + ext).join(', ')}${system === 'arcade' || system === 'mame' ? '' : ', or .zip'}).`)
}
