import type { Random } from './random'
export interface PropertySpace { name: string; type: 'start' | 'property' | 'tax' | 'chance' | 'rest' | 'detour'; group?: number; price?: number; rent?: number }
export const PROPERTY_BOARD: PropertySpace[] = [
  { name: 'Launch', type: 'start' }, { name: 'Copper Lane', type: 'property', group: 0, price: 100, rent: 18 },
  { name: 'Foundry Row', type: 'property', group: 0, price: 120, rent: 22 }, { name: 'City tax', type: 'tax' },
  { name: 'Ocean Drive', type: 'property', group: 1, price: 150, rent: 28 }, { name: 'Coffee break', type: 'rest' },
  { name: 'Harbor Walk', type: 'property', group: 1, price: 170, rent: 32 }, { name: 'Opportunity', type: 'chance' },
  { name: 'Orchard Park', type: 'property', group: 2, price: 190, rent: 36 }, { name: 'Garden Gate', type: 'property', group: 2, price: 210, rent: 40 },
  { name: 'Town square', type: 'rest' }, { name: 'Studio Avenue', type: 'property', group: 3, price: 230, rent: 44 },
  { name: 'Gallery Street', type: 'property', group: 3, price: 250, rent: 48 }, { name: 'City tax', type: 'tax' },
  { name: 'Skyline Plaza', type: 'property', group: 4, price: 280, rent: 54 }, { name: 'Road works', type: 'detour' },
  { name: 'Cloud Terrace', type: 'property', group: 4, price: 300, rent: 60 }, { name: 'Opportunity', type: 'chance' },
  { name: 'Moonlight Mile', type: 'property', group: 5, price: 340, rent: 68 }, { name: 'Summit House', type: 'property', group: 5, price: 380, rent: 76 },
]
export interface CircuitPlayer { name: string; cash: number; position: number; bot: boolean; out: boolean; skip: boolean }
export interface CircuitState { players: CircuitPlayer[]; owners: number[]; levels: number[]; current: number; phase: 'roll' | 'buy' | 'upgrade' | 'end' | 'over'; dice: number[]; log: string[]; turns: number; winner: number | null }
export const circuitWorth = (state: CircuitState, player: number) => state.players[player].cash + PROPERTY_BOARD.reduce((sum, tile, index) => sum + (state.owners[index] === player ? (tile.price || 0) * (1 + state.levels[index] / 2) : 0), 0)
export function newCircuit(humans = 1, opponents = 1): CircuitState {
  const count = Math.min(4, Math.max(2, humans + opponents))
  return { players: Array.from({ length: count }, (_, i) => ({ name: i < humans ? humans === 1 ? 'You' : `Player ${i + 1}` : `Computer ${i - humans + 1}`, cash: 1200, position: 0, bot: i >= humans, out: false, skip: false })), owners: Array(20).fill(-1), levels: Array(20).fill(0), current: 0, phase: 'roll', dice: [], log: ['Pass Launch to collect $100. Complete a color pair to develop it.'], turns: 0, winner: null }
}
export function ownsCircuitGroup(state: CircuitState, index: number, player = state.current): boolean {
  const tile = PROPERTY_BOARD[index]
  return tile.type === 'property' && PROPERTY_BOARD.every((other, at) => other.group !== tile.group || state.owners[at] === player)
}
export function circuitAction(state: CircuitState, action: 'roll' | 'buy' | 'upgrade' | 'end', random: Random = Math.random): CircuitState {
  if (state.phase === 'over') return state
  const next: CircuitState = { ...state, players: state.players.map(player => ({ ...player })), owners: [...state.owners], levels: [...state.levels], log: [...state.log] }
  const player = next.players[next.current]
  const note = (text: string) => { next.log = [text, ...next.log].slice(0, 12) }
  if (action === 'roll' && state.phase === 'roll') {
    if (player.skip) { player.skip = false; next.phase = 'end'; note(`${player.name} wait out the road works.`); return next }
    next.dice = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)]
    const destination = player.position + next.dice[0] + next.dice[1]
    if (destination >= 20) player.cash += 100
    player.position = destination % 20
    const tile = PROPERTY_BOARD[player.position], owner = next.owners[player.position]
    note(`${player.name} rolled ${next.dice.join(' + ')} and reached ${tile.name}.`)
    next.phase = 'end'
    if (tile.type === 'property') {
      if (owner < 0) next.phase = player.cash >= tile.price! ? 'buy' : 'end'
      else if (owner !== next.current) {
        const rent = tile.rent! * (next.levels[player.position] + 1) * (ownsCircuitGroup(next, player.position, owner) ? 2 : 1)
        player.cash -= rent; next.players[owner].cash += rent
        note(`${player.name} paid $${rent} rent to ${next.players[owner].name}.`)
      } else if (ownsCircuitGroup(next, player.position) && next.levels[player.position] < 3 && player.cash >= tile.price! / 2) next.phase = 'upgrade'
    } else if (tile.type === 'tax') { player.cash -= 80; note(`${player.name} paid $80 city tax.`) }
    else if (tile.type === 'chance') {
      const amount = [120, 60, -40, -90][Math.floor(random() * 4)]
      player.cash += amount; note(amount > 0 ? `${player.name} received a $${amount} opportunity bonus.` : `${player.name} paid $${-amount} in repairs.`)
    } else if (tile.type === 'detour') { player.skip = true; note(`${player.name} will miss the next turn for road works.`) }
    if (player.cash < 0) {
      player.out = true
      next.owners = next.owners.map((at, i) => { if (at !== next.current) return at; next.levels[i] = 0; return -1 })
      note(`${player.name} are out of the circuit.`)
    }
    const alive = next.players.map((value, i) => value.out ? -1 : i).filter(i => i >= 0)
    if (alive.length === 1) { next.phase = 'over'; next.winner = alive[0] }
    return next
  }
  if (action === 'buy' && state.phase === 'buy') {
    const index = player.position, tile = PROPERTY_BOARD[index]
    if (next.owners[index] < 0 && player.cash >= tile.price!) { player.cash -= tile.price!; next.owners[index] = next.current; next.phase = 'end'; note(`${player.name} bought ${tile.name} for $${tile.price}.`) }
    return next
  }
  if (action === 'upgrade' && state.phase === 'upgrade') {
    const index = player.position, cost = PROPERTY_BOARD[index].price! / 2
    if (ownsCircuitGroup(next, index) && next.levels[index] < 3 && player.cash >= cost) { player.cash -= cost; next.levels[index]++; next.phase = 'end'; note(`${player.name} developed ${PROPERTY_BOARD[index].name}.`) }
    return next
  }
  if (action === 'end' && ['buy', 'upgrade', 'end'].includes(state.phase)) {
    next.turns++
    if (next.turns >= 120) { next.phase = 'over'; next.winner = next.players.reduce((best, _, i) => !next.players[i].out && circuitWorth(next, i) > circuitWorth(next, best) ? i : best, next.players.findIndex(player => !player.out)); return next }
    do { next.current = (next.current + 1) % next.players.length } while (next.players[next.current].out)
    next.phase = 'roll'
    return next
  }
  return state
}
