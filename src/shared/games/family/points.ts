import { DIRS4, type FamilyGame, type Move, type Outcome } from './core'
// Games played on points joined by lines, plus the corner-race games.
// Cells hold -1 for empty or the owning player.
export interface PointState { board: number[]; turn: number; last: number[]; winner: number | null | undefined; inHand: number[]; removing: boolean; chain: number; plies: number }
const clone = (s: PointState): PointState => ({ ...s, board: [...s.board], inHand: [...s.inHand], last: [] })
const result = (s: PointState, names: string[]): Outcome | null => s.winner === undefined ? null : { winner: s.winner, text: s.winner === null ? 'A draw.' : `${names[s.winner]} wins.` }
function adjacency(count: number, lines: [number, number][]) { const map: number[][] = Array.from({ length: count }, () => []); for (const [a, b] of lines) { map[a].push(b); map[b].push(a) } return map }

/* ── Morris (mill) games ── */
function morris(id: string, title: string, points: [number, number][], lines: [number, number][], mills: number[][], pieces: number, flying: boolean, size: [number, number]): FamilyGame<PointState> {
  const near = adjacency(points.length, lines), names = ['White', 'Black']
  const inMill = (board: number[], index: number) => mills.some(mill => mill.includes(index) && mill.every(p => board[p] === board[index]))
  const left = (s: PointState, player: number) => s.board.filter(cell => cell === player).length + s.inHand[player]
  const game: FamilyGame<PointState> = {
    id, title, players: 2, names, colors: ['#f6efe0', '#1d1d24'], depth: 3, layout: { kind: 'graph', points, lines, size },
    setup: () => ({ board: Array(points.length).fill(-1), turn: 0, last: [], winner: undefined, inHand: [pieces, pieces], removing: false, chain: -1, plies: 0 }),
    current: s => s.turn,
    moves: s => {
      if (s.winner !== undefined) return []
      const me = s.turn, them = 1 - me
      if (s.removing) {
        const theirs = s.board.map((cell, i) => cell === them ? i : -1).filter(i => i >= 0), free = theirs.filter(i => !inMill(s.board, i))
        return (free.length ? free : theirs).map(to => ({ to, remove: true }))
      }
      if (s.inHand[me] > 0) return s.board.map((cell, i) => cell < 0 ? { to: i } : null).filter(Boolean) as Move[]
      const fly = flying && s.board.filter(cell => cell === me).length === 3, moves: Move[] = []
      s.board.forEach((cell, from) => { if (cell === me) (fly ? s.board.map((_, i) => i) : near[from]).forEach(to => { if (s.board[to] < 0) moves.push({ from, to }) }) })
      return moves
    },
    play: (s, move) => {
      const next = clone(s), me = s.turn
      if (move.remove) { next.board[move.to!] = -1; next.removing = false; next.last = [move.to!] }
      else {
        if (move.from === undefined) next.inHand[me]--; else next.board[move.from] = -1
        next.board[move.to!] = me; next.last = move.from === undefined ? [move.to!] : [move.from, move.to!]
        if (inMill(next.board, move.to!) && next.board.includes(1 - me)) { next.removing = true; return next }
      }
      next.turn = 1 - me; next.plies++
      if (left(next, next.turn) < 3) next.winner = me
      else if (!game.moves(next).length) next.winner = me
      else if (next.plies > 200) next.winner = null
      return next
    },
    outcome: s => result(s, names),
    pieceAt: (s, i) => s.board[i] < 0 ? null : { owner: s.board[i] },
    lastMove: s => s.last,
    evaluate: (s, me) => (left(s, me) - left(s, 1 - me)) * 100 + mills.reduce((sum, mill) => { const mine = mill.filter(p => s.board[p] === me).length, theirs = mill.filter(p => s.board[p] === 1 - me).length; return sum + (theirs ? 0 : mine * mine) - (mine ? 0 : theirs * theirs) }, 0),
    status: s => s.removing ? `${names[s.turn]} made a mill — remove one of the other pieces.` : `In hand: White ${s.inHand[0]} · Black ${s.inHand[1]}`,
  }
  return game
}
const ring = (lo: number, hi: number): [number, number][] => { const mid = (lo + hi) / 2; return [[lo, lo], [mid, lo], [hi, lo], [hi, mid], [hi, hi], [mid, hi], [lo, hi], [lo, mid]] }
const NINE_POINTS = [...ring(0, 6), ...ring(1, 5), ...ring(2, 4)]
const NINE_LINES: [number, number][] = [...[0, 8, 16].flatMap(base => Array.from({ length: 8 }, (_, k) => [base + k, base + (k + 1) % 8] as [number, number])), ...[1, 3, 5, 7].flatMap(k => [[k, k + 8], [k + 8, k + 16]] as [number, number][])]
const NINE_MILLS = [...[0, 8, 16].flatMap(base => [[0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0]].map(mill => mill.map(p => base + p))), ...[1, 3, 5, 7].map(k => [k, k + 8, k + 16])]
export const NINE_MENS_MORRIS = morris('ninemorris', "Nine Men's Morris", NINE_POINTS, NINE_LINES, NINE_MILLS, 9, true, [6, 6])
const THREE_POINTS: [number, number][] = Array.from({ length: 9 }, (_, i) => [i % 3, Math.floor(i / 3)])
const THREE_LINES: [number, number][] = [[0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8], [0, 3], [3, 6], [1, 4], [4, 7], [2, 5], [5, 8], [0, 4], [4, 8], [2, 4], [4, 6]]
export const THREE_MENS_MORRIS = morris('threemorris', "Three Men's Morris", THREE_POINTS, THREE_LINES, [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]], 3, false, [2, 2])
// In three men's morris a line of three wins outright rather than taking a piece.
THREE_MENS_MORRIS.play = (s, move) => {
  const next = clone(s), me = s.turn
  if (move.from === undefined) next.inHand[me]--; else next.board[move.from] = -1
  next.board[move.to!] = me; next.last = move.from === undefined ? [move.to!] : [move.from, move.to!]
  if ([[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]].some(line => line.every(p => next.board[p] === me))) next.winner = me
  next.turn = 1 - me; next.plies++
  if (next.winner === undefined && next.plies > 60) next.winner = null
  return next
}
THREE_MENS_MORRIS.status = s => `In hand: White ${s.inHand[0]} · Black ${s.inHand[1]}`

/* ── Pong Hau K'i: two pieces each on five points; whoever cannot move loses ── */
const PONG_POINTS: [number, number][] = [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], PONG_LINES: [number, number][] = [[0, 2], [1, 2], [2, 3], [2, 4], [0, 3], [1, 4], [3, 4]]
const PONG_NEAR = adjacency(5, PONG_LINES)
export const PONG_HAU_KI: FamilyGame<PointState> = {
  id: 'ponghauki', title: "Pong Hau K'i", players: 2, names: ['Red', 'Blue'], colors: ['#e8342c', '#2f6fd8'], depth: 8, layout: { kind: 'graph', points: PONG_POINTS, lines: PONG_LINES, size: [2, 2] },
  setup: () => ({ board: [1, 1, -1, 0, 0], turn: 0, last: [], winner: undefined, inHand: [0, 0], removing: false, chain: -1, plies: 0 }),
  current: s => s.turn,
  moves: s => { if (s.winner !== undefined) return []; const moves: Move[] = []; s.board.forEach((cell, from) => { if (cell === s.turn) PONG_NEAR[from].forEach(to => { if (s.board[to] < 0) moves.push({ from, to }) }) }); return moves },
  play: (s, move) => { const next = clone(s); next.board[move.to!] = s.turn; next.board[move.from!] = -1; next.last = [move.from!, move.to!]; next.turn = 1 - s.turn; next.plies++; if (!PONG_HAU_KI.moves(next).length) next.winner = s.turn; else if (next.plies >= 40) next.winner = null; return next },
  outcome: s => result(s, ['Red', 'Blue']),
  pieceAt: (s, i) => s.board[i] < 0 ? null : { owner: s.board[i] },
  lastMove: s => s.last,
  evaluate: (s, me) => PONG_HAU_KI.moves({ ...s, turn: me }).length - PONG_HAU_KI.moves({ ...s, turn: 1 - me }).length,
}

/* ── Alquerque and Fox & Geese share a lined grid: diagonals run through every other point ── */
function linedGrid(points: [number, number][]): [number, number][] {
  const index = new Map(points.map(([x, y], i) => [`${x},${y}`, i])), lines: [number, number][] = []
  points.forEach(([x, y], i) => {
    for (const [dx, dy] of [[1, 0], [0, 1], ...((x + y) % 2 === 0 ? [[1, 1], [1, -1]] : [])]) { const j = index.get(`${x + dx},${y + dy}`); if (j !== undefined) lines.push([i, j]) }
  })
  return lines
}
// The point two steps away along the same line, if the line continues.
function beyond(points: [number, number][], near: number[][], from: number, over: number): number {
  const [x0, y0] = points[from], [x1, y1] = points[over]
  return near[over].find(n => points[n][0] === 2 * x1 - x0 && points[n][1] === 2 * y1 - y0) ?? -1
}
const ALQ_POINTS: [number, number][] = Array.from({ length: 25 }, (_, i) => [i % 5, Math.floor(i / 5)])
const ALQ_LINES = linedGrid(ALQ_POINTS), ALQ_NEAR = adjacency(25, ALQ_LINES)
export const ALQUERQUE: FamilyGame<PointState> = {
  id: 'alquerque', title: 'Alquerque', players: 2, names: ['White', 'Black'], colors: ['#f6efe0', '#1d1d24'], depth: 3, layout: { kind: 'graph', points: ALQ_POINTS, lines: ALQ_LINES, size: [4, 4] },
  setup: () => ({ board: Array.from({ length: 25 }, (_, i) => i < 10 || (i >= 10 && i < 12) ? 1 : i > 14 || i === 13 || i === 14 ? 0 : -1), turn: 0, last: [], winner: undefined, inHand: [0, 0], removing: false, chain: -1, plies: 0 }),
  current: s => s.turn,
  moves: s => {
    if (s.winner !== undefined) return []
    const jumps: Move[] = [], steps: Move[] = [], forward = s.turn === 0 ? -1 : 1
    s.board.forEach((cell, from) => {
      if (cell !== s.turn || (s.chain >= 0 && from !== s.chain)) return
      for (const over of ALQ_NEAR[from]) { if (s.board[over] !== 1 - s.turn) continue; const to = beyond(ALQ_POINTS, ALQ_NEAR, from, over); if (to >= 0 && s.board[to] < 0) jumps.push({ from, to, over }) }
      // Plain steps go forward or sideways, never back.
      if (s.chain < 0) for (const to of ALQ_NEAR[from]) if (s.board[to] < 0 && (ALQ_POINTS[to][1] - ALQ_POINTS[from][1]) * forward >= 0) steps.push({ from, to })
    })
    if (s.chain >= 0) return [...jumps, { label: 'End turn' }]
    return jumps.length ? jumps : steps
  },
  play: (s, move) => {
    const next = clone(s)
    if (move.from === undefined) { next.chain = -1; next.turn = 1 - s.turn }
    else {
      next.board[move.to!] = s.turn; next.board[move.from] = -1; next.last = [move.from, move.to!]
      if (move.over !== undefined) {
        next.board[move.over as number] = -1; next.chain = move.to!
        if (!ALQUERQUE.moves(next).some(m => m.over !== undefined)) { next.chain = -1; next.turn = 1 - s.turn }
      } else next.turn = 1 - s.turn
    }
    next.plies++
    if (!next.board.includes(1 - s.turn)) next.winner = s.turn
    else if (next.chain < 0 && !ALQUERQUE.moves(next).length) next.winner = 1 - next.turn
    else if (next.plies > 240) next.winner = null
    return next
  },
  outcome: s => result(s, ['White', 'Black']),
  pieceAt: (s, i) => s.board[i] < 0 ? null : { owner: s.board[i] },
  lastMove: s => s.last,
  evaluate: (s, me) => s.board.filter(c => c === me).length * 10 - s.board.filter(c => c === 1 - me).length * 10,
  status: s => s.chain >= 0 ? 'Keep jumping with the same piece, or end your turn.' : 'Jumping is compulsory when you can.',
}
const CROSS_POINTS: [number, number][] = []
for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if ((x >= 2 && x <= 4) || (y >= 2 && y <= 4)) CROSS_POINTS.push([x, y])
const CROSS_LINES = linedGrid(CROSS_POINTS), CROSS_NEAR = adjacency(CROSS_POINTS.length, CROSS_LINES)
// Player 0 plays the thirteen geese, player 1 the fox.
export const FOX_AND_GEESE: FamilyGame<PointState> = {
  id: 'foxgeese', title: 'Fox & Geese', players: 2, names: ['Geese', 'Fox'], colors: ['#f6efe0', '#e8742c'], depth: 4, layout: { kind: 'graph', points: CROSS_POINTS, lines: CROSS_LINES, size: [6, 6] },
  setup: () => ({ board: CROSS_POINTS.map(([x, y]) => y >= 4 ? 0 : x === 3 && y === 2 ? 1 : -1), turn: 1, last: [], winner: undefined, inHand: [0, 0], removing: false, chain: -1, plies: 0 }),
  current: s => s.turn,
  moves: s => {
    if (s.winner !== undefined) return []
    const moves: Move[] = []
    s.board.forEach((cell, from) => {
      if (cell !== s.turn || (s.chain >= 0 && from !== s.chain)) return
      if (s.turn === 1) for (const over of CROSS_NEAR[from]) { if (s.board[over] !== 0) continue; const to = beyond(CROSS_POINTS, CROSS_NEAR, from, over); if (to >= 0 && s.board[to] < 0) moves.push({ from, to, over }) }
      if (s.chain < 0) for (const to of CROSS_NEAR[from]) if (s.board[to] < 0 && (s.turn === 1 || CROSS_POINTS[to][1] <= CROSS_POINTS[from][1])) moves.push({ from, to })
    })
    return s.chain >= 0 ? [...moves, { label: 'End turn' }] : moves
  },
  play: (s, move) => {
    const next = clone(s)
    if (move.from === undefined) { next.chain = -1; next.turn = 0 }
    else {
      next.board[move.to!] = s.turn; next.board[move.from] = -1; next.last = [move.from, move.to!]
      if (move.over !== undefined) { next.board[move.over as number] = -1; next.chain = move.to!; if (!FOX_AND_GEESE.moves(next).some(m => m.over !== undefined)) { next.chain = -1; next.turn = 0 } }
      else next.turn = 1 - s.turn
    }
    next.plies++
    if (next.board.filter(c => c === 0).length < 6) next.winner = 1
    else if (next.turn === 1 && next.chain < 0 && !FOX_AND_GEESE.moves(next).length) next.winner = 0
    else if (next.turn === 0 && !FOX_AND_GEESE.moves(next).length) next.winner = 1
    else if (next.plies > 200) next.winner = 1
    return next
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: s.winner === 0 ? 'The geese trapped the fox!' : 'The fox got away with the flock.' },
  pieceAt: (s, i) => s.board[i] < 0 ? null : { owner: s.board[i], glyph: s.board[i] === 1 ? '🦊' : undefined },
  lastMove: s => s.last,
  evaluate: (s, me) => { const geese = s.board.filter(c => c === 0).length, fox = s.board.indexOf(1), room = fox >= 0 ? CROSS_NEAR[fox].filter(n => s.board[n] < 0).length : 0; const score = geese * 30 - room * 12 - FOX_AND_GEESE.moves({ ...s, turn: 1, chain: -1 }).length * 4; return me === 0 ? score : -score },
  status: s => `${s.board.filter(c => c === 0).length} geese left · the fox wins below 6`,
}

/* ── Tablut: the king escapes to any edge; attackers capture him by surrounding him ── */
const T = 9, THRONE = 40
export interface TablutState extends PointState { king: number }
const ATTACKERS = [3, 4, 5, 13, 27, 36, 37, 45, 35, 43, 44, 53, 67, 75, 76, 77], DEFENDERS = [22, 31, 38, 39, 41, 42, 49, 58]
export const TABLUT: FamilyGame<TablutState> = {
  id: 'tablut', title: 'Tablut', players: 2, names: ['Attackers', 'Defenders'], colors: ['#1d1d24', '#f6efe0'], depth: 2, layout: { kind: 'grid', rows: T, cols: T, style: 'plain' },
  setup: () => { const board = Array(T * T).fill(-1); ATTACKERS.forEach(i => { board[i] = 0 }); DEFENDERS.forEach(i => { board[i] = 1 }); board[THRONE] = 1; return { board, turn: 0, last: [], winner: undefined, inHand: [0, 0], removing: false, chain: -1, plies: 0, king: THRONE } },
  current: s => s.turn,
  moves: s => {
    if (s.winner !== undefined) return []
    const moves: Move[] = []
    s.board.forEach((cell, from) => {
      if (cell !== s.turn) return
      for (const [dr, dc] of DIRS4) for (let k = 1; ; k++) {
        const r = Math.floor(from / T) + dr * k, c = from % T + dc * k, to = r * T + c
        if (r < 0 || c < 0 || r >= T || c >= T || s.board[to] >= 0) break
        if (to === THRONE && from !== s.king) continue
        moves.push({ from, to })
      }
    })
    return moves
  },
  play: (s, move) => {
    const next = { ...clone(s), king: s.king } as TablutState, me = s.turn
    next.board[move.to!] = me; next.board[move.from!] = -1; next.last = [move.from!, move.to!]
    if (move.from === s.king) next.king = move.to!
    const r = Math.floor(move.to! / T), c = move.to! % T, hostile = (i: number) => next.board[i] === me && i !== next.king || (i === THRONE && next.board[i] < 0) || (me === 1 && i === next.king)
    for (const [dr, dc] of DIRS4) {
      const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc
      if (r2 < 0 || c2 < 0 || r2 >= T || c2 >= T) continue
      const victim = r1 * T + c1
      if (next.board[victim] !== 1 - me) continue
      if (victim === next.king) {
        // The king falls only when attackers close every side (the empty throne counts as one).
        const kr = r1, kc = c1, closed = DIRS4.every(([ar, ac]) => { const n = (kr + ar) * T + kc + ac; return kr + ar >= 0 && kc + ac >= 0 && kr + ar < T && kc + ac < T && (next.board[n] === 0 || n === THRONE) })
        if (closed) { next.board[victim] = -1; next.winner = 0 }
        continue
      }
      if (hostile(r2 * T + c2)) next.board[victim] = -1
    }
    const kr = Math.floor(next.king / T), kc = next.king % T
    if (next.winner === undefined && (kr === 0 || kc === 0 || kr === T - 1 || kc === T - 1)) next.winner = 1
    next.turn = 1 - me; next.plies++
    if (next.winner === undefined && (!TABLUT.moves(next).length)) next.winner = me
    else if (next.winner === undefined && next.plies > 300) next.winner = null
    return next
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: s.winner === 1 ? 'The king escaped!' : s.winner === 0 ? 'The king is captured.' : 'A draw.' },
  pieceAt: (s, i) => s.board[i] < 0 ? null : { owner: s.board[i], king: i === s.king, glyph: i === s.king ? '♔' : undefined },
  lastMove: s => s.last,
  evaluate: (s, me) => { const kr = Math.floor(s.king / T), kc = s.king % T, edge = Math.min(kr, kc, T - 1 - kr, T - 1 - kc), score = s.board.filter(c => c === 1).length * 12 - s.board.filter(c => c === 0).length * 8 - edge * 15; return me === 1 ? score : -score },
  status: () => 'Attackers move first. The king escapes to any edge square.',
}

/* ── Halma and Chinese checkers: step, or chain jumps over any piece, into the far camp ── */
function hopGame(id: string, title: string, points: [number, number][], near: number[][], camps: [number[], number[]], depth: number, layout: FamilyGame['layout']): FamilyGame<PointState> {
  const jumpsFrom = (board: number[], start: number) => {
    const reached = new Set<number>(), queue = [start]
    while (queue.length) { const at = queue.pop()!; for (const over of near[at]) { if (board[over] < 0) continue; const to = beyond(points, near, at, over); if (to >= 0 && board[to] < 0 && to !== start && !reached.has(to)) { reached.add(to); queue.push(to) } } }
    return reached
  }
  const target = (player: number) => camps[1 - player]
  const distance = (player: number, i: number) => Math.min(...target(player).map(t => Math.max(Math.abs(points[t][0] - points[i][0]) / (layout.kind === 'graph' ? 2 : 1), Math.abs(points[t][1] - points[i][1]))))
  const game: FamilyGame<PointState> = {
    id, title, players: 2, names: ['Green', 'Purple'], colors: ['#2fb38c', '#8a4fd6'], depth, layout,
    setup: () => { const board = Array(points.length).fill(-1); camps[0].forEach(i => { board[i] = 0 }); camps[1].forEach(i => { board[i] = 1 }); return { board, turn: 0, last: [], winner: undefined, inHand: [0, 0], removing: false, chain: -1, plies: 0 } },
    current: s => s.turn,
    moves: s => {
      if (s.winner !== undefined) return []
      const moves: Move[] = []
      s.board.forEach((cell, from) => {
        if (cell !== s.turn) return
        // Pieces already home stay home, and nobody steps backwards out of the target camp.
        for (const to of near[from]) if (s.board[to] < 0 && distance(s.turn, to) <= distance(s.turn, from) + 1) moves.push({ from, to })
        for (const to of jumpsFrom(s.board, from)) if (distance(s.turn, to) <= distance(s.turn, from) + 1) moves.push({ from, to })
      })
      return moves
    },
    play: (s, move) => {
      const next = clone(s); next.board[move.to!] = s.turn; next.board[move.from!] = -1; next.last = [move.from!, move.to!]; next.plies++
      if (target(s.turn).every(i => next.board[i] === s.turn)) next.winner = s.turn
      else if (next.plies > 400) next.winner = null
      next.turn = 1 - s.turn; return next
    },
    outcome: s => result(s, ['Green', 'Purple']),
    pieceAt: (s, i) => s.board[i] < 0 ? null : { owner: s.board[i] },
    lastMove: s => s.last,
    evaluate: (s, me) => s.board.reduce((sum, cell, i) => cell < 0 ? sum : sum + (cell === me ? -1 : 1) * distance(cell, i) ** 1.3, 0),
    status: () => 'Fill the opposite corner. Hop over any piece, as many times as you can.',
  }
  return game
}
const HALMA_SIZE = 8, HALMA_POINTS: [number, number][] = Array.from({ length: 64 }, (_, i) => [i % 8, Math.floor(i / 8)])
const HALMA_NEAR = HALMA_POINTS.map(([x, y]) => HALMA_POINTS.map((p, j) => Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y)) === 1 ? j : -1).filter(j => j >= 0))
const corner = (flip: boolean) => HALMA_POINTS.map(([x, y], i) => (flip ? (7 - x) + (7 - y) : x + y) <= 3 ? i : -1).filter(i => i >= 0)
export const HALMA = hopGame('halma', 'Halma', HALMA_POINTS, HALMA_NEAR, [corner(true), corner(false)], 2, { kind: 'grid', rows: HALMA_SIZE, cols: HALMA_SIZE, style: 'checker' })
// The six-pointed star: 121 holes in rows of 1,2,3,4,13,12,11,10,9,10,11,12,13,4,3,2,1.
const STAR_ROWS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1]
const STAR_POINTS: [number, number][] = STAR_ROWS.flatMap((count, y) => Array.from({ length: count }, (_, k) => [12 - (count - 1) + k * 2, y] as [number, number]))
const STAR_INDEX = new Map(STAR_POINTS.map(([x, y], i) => [`${x},${y}`, i]))
const STAR_NEAR = STAR_POINTS.map(([x, y]) => [[2, 0], [-2, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => STAR_INDEX.get(`${x + dx},${y + dy}`) ?? -1).filter(j => j >= 0))
const STAR_CAMPS: [number[], number[]] = [STAR_POINTS.map(([, y], i) => y >= 13 ? i : -1).filter(i => i >= 0), STAR_POINTS.map(([, y], i) => y <= 3 ? i : -1).filter(i => i >= 0)]
const STAR_LINES: [number, number][] = STAR_NEAR.flatMap((list, i) => list.filter(j => j > i).map(j => [i, j] as [number, number]))
// Rows sit √3 apart on screen so the holes form true triangles; the rules keep integer coordinates.
export const CHINESE_CHECKERS = hopGame('chinesecheckers', 'Chinese Checkers', STAR_POINTS, STAR_NEAR, STAR_CAMPS, 2, { kind: 'graph', points: STAR_POINTS.map(([x, y]) => [x, y * Math.sqrt(3)] as [number, number]), lines: STAR_LINES, size: [24, 16 * Math.sqrt(3)] })
