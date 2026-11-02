import { shuffled, type Random } from '../random'
import { CLUE_BANK } from '../crossword'
import type { FamilyGame, Move } from './core'

/* ── Nim: take any number from one heap; whoever takes the last object wins ── */
export interface NimState { heaps: number[]; turn: number; winner: number | null | undefined; last: number[] }
export const NIM: FamilyGame<NimState> = {
  id: 'nim', title: 'Nim', players: 2, names: ['You', 'Computer'], layout: { kind: 'custom' },
  setup: () => ({ heaps: [3, 4, 5, 6], turn: 0, winner: undefined, last: [] }),
  current: s => s.turn,
  moves: s => s.winner !== undefined ? [] : s.heaps.flatMap((size, heap) => Array.from({ length: size }, (_, k) => ({ heap, take: k + 1, label: `Take ${k + 1} from heap ${heap + 1}` }))),
  play: (s, move) => { const heaps = [...s.heaps]; heaps[move.heap as number] -= move.take as number; return { heaps, turn: 1 - s.turn, winner: heaps.every(h => !h) ? s.turn : undefined, last: [move.heap as number] } },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `${['You', 'Computer'][s.winner!]} took the last one.` },
  // Perfect play: leave a position whose heap sizes XOR to zero whenever possible.
  bot: (s, random) => {
    const xor = s.heaps.reduce((a, b) => a ^ b, 0)
    if (xor) for (const [heap, size] of s.heaps.entries()) { const target = size ^ xor; if (target < size) return { heap, take: size - target } }
    const options = NIM.moves(s); return options[Math.floor(random() * options.length)]
  },
  status: s => `Heaps: ${s.heaps.join(' · ')}`,
}

/* ── Code Breaker: find the hidden row of four colours in ten guesses ── */
export const CODE_COLORS = ['#e8342c', '#f2c230', '#2fa64a', '#2f6fd8', '#8a4fd6', '#f6efe0']
export interface CodeState { secret: number[]; guesses: { pegs: number[]; exact: number; near: number }[]; draft: number[]; winner: number | null | undefined }
export function grade(secret: number[], guess: number[]) {
  const exact = guess.filter((g, i) => g === secret[i]).length
  const near = CODE_COLORS.reduce((sum, _, color) => sum + Math.min(secret.filter(s => s === color).length, guess.filter(g => g === color).length), 0) - exact
  return { exact, near }
}
export const CODE_BREAKER: FamilyGame<CodeState> = {
  id: 'codebreaker', title: 'Code Breaker', players: 1, names: ['You'], layout: { kind: 'custom' },
  setup: random => ({ secret: Array.from({ length: 4 }, () => Math.floor(random() * 6)), guesses: [], draft: [], winner: undefined }),
  current: () => 0,
  moves: s => s.winner !== undefined ? [] : [...CODE_COLORS.map((_, color) => ({ add: color, label: 'Add colour' })).filter(() => s.draft.length < 4), ...(s.draft.length ? [{ undo: true, label: 'Undo' }] : []), ...(s.draft.length === 4 ? [{ submit: true, label: 'Check guess' }] : [])],
  play: (s, move) => {
    if (move.add !== undefined) return { ...s, draft: [...s.draft, move.add as number] }
    if (move.undo) return { ...s, draft: s.draft.slice(0, -1) }
    const result = grade(s.secret, s.draft), guesses = [...s.guesses, { pegs: s.draft, ...result }]
    return { ...s, guesses, draft: [], winner: result.exact === 4 ? 0 : guesses.length >= 10 ? null : undefined }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: s.winner === 0 ? `Cracked in ${s.guesses.length} ${s.guesses.length === 1 ? 'guess' : 'guesses'}!` : 'Out of guesses — the code is shown above.' },
  status: s => `Guess ${s.guesses.length + 1} of 10. A black peg: right colour, right place. White: right colour, wrong place.`,
}

/* ── Memory: turn over two cards at a time; match every pair ── */
export const MEMORY_FACES = ['🦁', '🐘', '🦒', '🐼', '🦊', '🦉', '🐢', '🐳', '🐧', '🦜', '🐸', '🦋']
export interface MemoryState { cards: number[]; matched: boolean[]; open: number[]; turns: number; scores: number[]; turn: number; players: number; winner: number | null | undefined; last: number[] }
export const MEMORY: FamilyGame<MemoryState> = {
  id: 'memory', title: 'Memory Match', players: 2, names: ['You', 'Computer'], layout: { kind: 'custom' },
  setup: random => ({ cards: shuffled([...MEMORY_FACES, ...MEMORY_FACES].map((_, i) => i % MEMORY_FACES.length), random), matched: Array(24).fill(false), open: [], turns: 0, scores: [0, 0], turn: 0, players: 2, winner: undefined, last: [] }),
  current: s => s.turn,
  moves: s => s.winner !== undefined ? [] : s.open.length === 2 ? [{ hide: true, label: 'Continue' }] : s.cards.map((_, i) => !s.matched[i] && !s.open.includes(i) ? { to: i } : null).filter(Boolean) as Move[],
  play: (s, move) => {
    if (move.hide) {
      const [a, b] = s.open, pair = s.cards[a] === s.cards[b]
      return { ...s, open: [], turn: pair ? s.turn : (s.turn + 1) % s.players, last: [] }
    }
    const open = [...s.open, move.to!], matched = [...s.matched], scores = [...s.scores]
    if (open.length === 2 && s.cards[open[0]] === s.cards[open[1]]) { matched[open[0]] = matched[open[1]] = true; scores[s.turn]++ }
    const finished = matched.every(Boolean)
    return { ...s, open, matched, scores, turns: s.turns + (open.length === 2 ? 1 : 0), last: [move.to!], winner: finished ? scores[0] === scores[1] ? null : scores.indexOf(Math.max(...scores)) : undefined }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `Pairs: You ${s.scores[0]} · Computer ${s.scores[1]}.` },
  // The computer remembers about half of the cards it has seen.
  bot: (s, random) => {
    if (s.open.length === 2) return { hide: true }
    const options = MEMORY.moves(s)
    if (s.open.length === 1) { const twin = s.cards.findIndex((face, i) => i !== s.open[0] && !s.matched[i] && face === s.cards[s.open[0]]); if (twin >= 0 && random() < 0.55) return { to: twin } }
    return options[Math.floor(random() * options.length)]
  },
  status: s => `Pairs: You ${s.scores[0]} · Computer ${s.scores[1]}`,
  lastMove: s => s.last,
}

/* ── Hangman: guess the word one letter at a time; seven misses and it is over ── */
export interface HangmanState { word: string; clue: string; guessed: string[]; misses: number; winner: number | null | undefined }
export const HANGMAN: FamilyGame<HangmanState> = {
  id: 'hangman', title: 'Hangman', players: 1, names: ['You'], layout: { kind: 'custom' },
  setup: random => { const pool = CLUE_BANK.filter(([word]) => word.length >= 5), [word, clue] = pool[Math.floor(random() * pool.length)]; return { word, clue, guessed: [], misses: 0, winner: undefined } },
  current: () => 0,
  moves: s => s.winner !== undefined ? [] : [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter(letter => !s.guessed.includes(letter)).map(letter => ({ letter, label: letter })),
  play: (s, move) => {
    const letter = move.letter as string, guessed = [...s.guessed, letter], misses = s.misses + (s.word.includes(letter) ? 0 : 1)
    return { ...s, guessed, misses, winner: [...s.word].every(ch => guessed.includes(ch)) ? 0 : misses >= 7 ? null : undefined }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: s.winner === 0 ? `You found ${s.word}!` : `The word was ${s.word}.` },
  status: s => `Clue: ${s.clue} · ${7 - s.misses} misses left`,
}

/* ── Sea Battle: sink the hidden fleet before yours goes down ── */
export const FLEET = [5, 4, 3, 3, 2]
export interface SeaState { ships: number[][][]; shots: number[][]; turn: number; winner: number | null | undefined; last: number[]; log: string }
function placeFleet(random: Random): number[][] {
  const taken = new Set<number>(), ships: number[][] = []
  for (const length of FLEET) for (;;) {
    const across = random() < 0.5, r = Math.floor(random() * (across ? 10 : 11 - length)), c = Math.floor(random() * (across ? 11 - length : 10))
    const cells = Array.from({ length }, (_, k) => (r + (across ? 0 : k)) * 10 + c + (across ? k : 0))
    // Ships never touch, not even diagonally.
    if (cells.some(cell => [-11, -10, -9, -1, 0, 1, 9, 10, 11].some(d => { const n = cell + d; return n >= 0 && n < 100 && Math.abs((n % 10) - (cell % 10)) <= 1 && taken.has(n) }))) continue
    cells.forEach(cell => taken.add(cell)); ships.push(cells); break
  }
  return ships
}
export const seaSunk = (ships: number[][], shots: number[]) => ships.filter(ship => ship.every(cell => shots.includes(cell)))
export const SEA_BATTLE: FamilyGame<SeaState> = {
  id: 'seabattle', title: 'Sea Battle', players: 2, names: ['You', 'Computer'], layout: { kind: 'custom' },
  setup: random => ({ ships: [placeFleet(random), placeFleet(random)], shots: [[], []], turn: 0, winner: undefined, last: [], log: 'Fire at the enemy grid. A hit lets you fire again.' }),
  current: s => s.turn,
  moves: s => s.winner !== undefined ? [] : Array.from({ length: 100 }, (_, i) => i).filter(i => !s.shots[s.turn].includes(i)).map(to => ({ to })),
  play: (s, move) => {
    const shots = s.shots.map(list => [...list]), me = s.turn, enemy = s.ships[1 - me]
    shots[me].push(move.to!)
    const hit = enemy.some(ship => ship.includes(move.to!)), sunkNow = enemy.find(ship => ship.includes(move.to!) && ship.every(cell => shots[me].includes(cell)))
    const won = seaSunk(enemy, shots[me]).length === enemy.length
    return { ...s, shots, last: [move.to!], turn: hit ? me : 1 - me, winner: won ? me : undefined, log: `${['You', 'Computer'][me]} ${hit ? sunkNow ? `sank a ${sunkNow.length}-ship!` : 'hit!' : 'missed.'}` }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: s.winner === 0 ? 'The enemy fleet is sunk!' : 'Your fleet went down.' },
  // Hunt on a checkerboard; once something is hit, finish it off along its line.
  bot: (s, random) => {
    const mine = s.shots[s.turn], enemy = s.ships[1 - s.turn], sunk = new Set(seaSunk(enemy, mine).flat())
    const hits = mine.filter(cell => enemy.some(ship => ship.includes(cell)) && !sunk.has(cell))
    const open = (cell: number) => cell >= 0 && cell < 100 && !mine.includes(cell)
    const around = (cell: number) => [cell - 10, cell + 10, ...(cell % 10 ? [cell - 1] : []), ...(cell % 10 < 9 ? [cell + 1] : [])].filter(open)
    if (hits.length >= 2) {
      const across = Math.floor(hits[0] / 10) === Math.floor(hits[1] / 10), sorted = [...hits].sort((a, b) => a - b), step = across ? 1 : 10
      const ends = [sorted[0] - step, sorted[sorted.length - 1] + step].filter(cell => open(cell) && (!across || Math.floor(cell / 10) === Math.floor(sorted[0] / 10)))
      if (ends.length) return { to: ends[0] }
    }
    for (const hit of hits) { const next = around(hit); if (next.length) return { to: next[Math.floor(random() * next.length)] } }
    const pattern = Array.from({ length: 100 }, (_, i) => i).filter(cell => open(cell) && (Math.floor(cell / 10) + cell % 10) % 2 === 0)
    const pool = pattern.length ? pattern : Array.from({ length: 100 }, (_, i) => i).filter(open)
    return { to: pool[Math.floor(random() * pool.length)] }
  },
  status: s => s.log,
  lastMove: s => s.last,
}

/* ── Dots & Boxes on a 5 × 5 grid of dots: close a box, move again ── */
// Edges: horizontal h(r,c) for r 0..4, c 0..3 → index r*4+c (0–19); vertical v(r,c) for r 0..3, c 0..4 → 20 + r*5+c (20–39).
export const DOTS = 5, EDGES = 40
export interface DotsState { edges: number[]; boxes: number[]; scores: number[]; turn: number; winner: number | null | undefined; last: number[] }
export const boxEdges = (r: number, c: number) => [r * 4 + c, (r + 1) * 4 + c, 20 + r * 5 + c, 20 + r * 5 + c + 1]
const boxesOf = (edge: number) => edge < 20 ? [[Math.floor(edge / 4) - 1, edge % 4], [Math.floor(edge / 4), edge % 4]].filter(([r]) => r >= 0 && r < 4) : [[Math.floor((edge - 20) / 5), (edge - 20) % 5 - 1], [Math.floor((edge - 20) / 5), (edge - 20) % 5]].filter(([, c]) => c >= 0 && c < 4)
export const DOTS_AND_BOXES: FamilyGame<DotsState> = {
  id: 'dotsboxes', title: 'Dots & Boxes', players: 2, names: ['You', 'Computer'], colors: ['#3fc1ff', '#ff5f6d'], depth: 3, layout: { kind: 'custom' },
  setup: () => ({ edges: Array(EDGES).fill(-1), boxes: Array(16).fill(-1), scores: [0, 0], turn: 0, winner: undefined, last: [] }),
  current: s => s.turn,
  moves: s => s.winner !== undefined ? [] : s.edges.map((owner, i) => owner < 0 ? { to: i } : null).filter(Boolean) as Move[],
  play: (s, move) => {
    const edges = [...s.edges], boxes = [...s.boxes], scores = [...s.scores]; edges[move.to!] = s.turn
    let closed = 0
    for (const [r, c] of boxesOf(move.to!)) if (boxes[r * 4 + c] < 0 && boxEdges(r, c).every(e => edges[e] >= 0)) { boxes[r * 4 + c] = s.turn; closed++ }
    scores[s.turn] += closed
    const finished = boxes.every(b => b >= 0)
    return { edges, boxes, scores, turn: closed ? s.turn : 1 - s.turn, last: [move.to!], winner: finished ? scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1 : undefined }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `Boxes: You ${s.scores[0]} · Computer ${s.scores[1]}.` },
  // Take any box on offer; otherwise avoid drawing a box's third side.
  bot: (s, random) => {
    const moves = DOTS_AND_BOXES.moves(s), sides = (r: number, c: number) => boxEdges(r, c).filter(e => s.edges[e] >= 0).length
    const closing = moves.find(m => boxesOf(m.to!).some(([r, c]) => sides(r, c) === 3))
    if (closing) return closing
    const safe = moves.filter(m => boxesOf(m.to!).every(([r, c]) => sides(r, c) < 2))
    const pool = safe.length ? safe : moves
    if (!safe.length) { const least = Math.min(...pool.map(m => boxesOf(m.to!).filter(([r, c]) => sides(r, c) === 2).length)); return pool.filter(m => boxesOf(m.to!).filter(([r, c]) => sides(r, c) === 2).length === least)[0] }
    return pool[Math.floor(random() * pool.length)]
  },
  status: s => `Boxes: You ${s.scores[0]} · Computer ${s.scores[1]}`,
  lastMove: s => s.last,
}
