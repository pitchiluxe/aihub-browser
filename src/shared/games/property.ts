import { shuffled, type Random } from './random'
// An original property-trading board: 36 spaces, eight colour districts, four
// metro lines, two works, two card decks and a lockup in the corner.
export type SpaceType = 'start' | 'property' | 'station' | 'utility' | 'tax' | 'chance' | 'chest' | 'jail' | 'rest' | 'gotojail'
export interface PropertySpace { name: string; type: SpaceType; group?: number; price?: number; rents?: number[]; house?: number; tax?: number }
const street = (name: string, group: number, price: number, house: number): PropertySpace => {
  const base = Math.round(price / 10 / 2) * 2, round5 = (value: number) => Math.round(value / 5) * 5
  return { name, type: 'property', group, price, house, rents: [base, round5(base * 5), round5(base * 15), round5(base * 40), round5(base * 52), round5(base * 64)] }
}
export const PROPERTY_BOARD: PropertySpace[] = [
  { name: 'Launch', type: 'start' }, street('Copper Lane', 0, 60, 50), { name: 'Town Hall', type: 'chest' }, street('Foundry Row', 0, 70, 50), { name: 'City tax', type: 'tax', tax: 150 },
  { name: 'Harbor Line', type: 'station', price: 200 }, street('Ocean Drive', 1, 100, 50), street('Pier Street', 1, 100, 50), street('Harbor Walk', 1, 120, 50),
  { name: 'Lockup', type: 'jail' }, street('Orchard Park', 2, 140, 100), { name: 'Power Works', type: 'utility', price: 150 }, street('Garden Gate', 2, 140, 100), street('Meadow Way', 2, 160, 100),
  { name: 'Uptown Line', type: 'station', price: 200 }, street('Studio Avenue', 3, 180, 100), { name: 'Town Hall', type: 'chest' }, street('Gallery Street', 3, 200, 100),
  { name: 'Free Park', type: 'rest' }, street('Market Row', 4, 220, 150), { name: 'Opportunity', type: 'chance' }, street('Bazaar Lane', 4, 220, 150), street('Spice Court', 4, 240, 150),
  { name: 'Riverside Line', type: 'station', price: 200 }, street('Skyline Plaza', 5, 260, 150), { name: 'Water Works', type: 'utility', price: 150 }, street('Cloud Terrace', 5, 280, 150),
  { name: 'Go to lockup', type: 'gotojail' }, street('Ember Road', 6, 300, 200), street('Forge Square', 6, 300, 200), { name: 'Opportunity', type: 'chance' }, street('Anvil Heights', 6, 320, 200),
  { name: 'Summit Line', type: 'station', price: 200 }, { name: 'Luxury tax', type: 'tax', tax: 100 }, street('Moonlight Mile', 7, 350, 200), street('Summit House', 7, 400, 200),
]
export const BOARD_SIZE = PROPERTY_BOARD.length, JAIL = 9, PASS_START = 200, JAIL_FINE = 50, MAX_LEVEL = 5, TURN_LIMIT = 300
type CardEffect = { kind: 'move'; to: number } | { kind: 'back'; steps: number } | { kind: 'nearest'; type: 'station' | 'utility' } | { kind: 'cash'; amount: number } | { kind: 'each'; amount: number } | { kind: 'jail' } | { kind: 'free' } | { kind: 'repairs'; house: number; tower: number }
export interface CircuitCard { text: string; effect: CardEffect }
export const CARDS: Record<'chance' | 'chest', CircuitCard[]> = {
  chance: [
    { text: 'Advance to Launch. Collect $200.', effect: { kind: 'move', to: 0 } },
    { text: 'Take the express to Summit House.', effect: { kind: 'move', to: 35 } },
    { text: 'Head to Market Row. Collect $200 if you pass Launch.', effect: { kind: 'move', to: 19 } },
    { text: 'Ride to the nearest metro line. If it is owned, pay double fare.', effect: { kind: 'nearest', type: 'station' } },
    { text: 'Hop a cab to the nearest works. If it is owned, pay ten times your dice.', effect: { kind: 'nearest', type: 'utility' } },
    { text: 'Your startup pays a dividend. Collect $50.', effect: { kind: 'cash', amount: 50 } },
    { text: 'Release pass. Keep this card until you need to leave the lockup.', effect: { kind: 'free' } },
    { text: 'Take three steps back.', effect: { kind: 'back', steps: 3 } },
    { text: 'Caught jaywalking twice. Go directly to the lockup.', effect: { kind: 'jail' } },
    { text: 'Street repairs: pay $25 per house and $100 per tower.', effect: { kind: 'repairs', house: 25, tower: 100 } },
    { text: 'Speeding ticket. Pay $15.', effect: { kind: 'cash', amount: -15 } },
    { text: 'You were elected block captain. Pay each player $50.', effect: { kind: 'each', amount: -50 } },
    { text: 'Your crowdfunding campaign succeeds. Collect $150.', effect: { kind: 'cash', amount: 150 } },
  ],
  chest: [
    { text: 'Advance to Launch. Collect $200.', effect: { kind: 'move', to: 0 } },
    { text: 'Tax refund. Collect $20.', effect: { kind: 'cash', amount: 20 } },
    { text: 'Clinic bill. Pay $100.', effect: { kind: 'cash', amount: -100 } },
    { text: 'You sold your old bicycle. Collect $45.', effect: { kind: 'cash', amount: 45 } },
    { text: 'Release pass. Keep this card until you need to leave the lockup.', effect: { kind: 'free' } },
    { text: 'Paperwork mix-up. Go directly to the lockup.', effect: { kind: 'jail' } },
    { text: 'Block party! Collect $10 from every player.', effect: { kind: 'each', amount: 10 } },
    { text: 'Neighborhood award. Collect $100.', effect: { kind: 'cash', amount: 100 } },
    { text: 'Insurance renewal. Pay $50.', effect: { kind: 'cash', amount: -50 } },
    { text: 'A great-aunt remembered you. Collect $100.', effect: { kind: 'cash', amount: 100 } },
    { text: 'Second prize in a baking contest. Collect $10.', effect: { kind: 'cash', amount: 10 } },
    { text: 'Home improvements: pay $40 per house and $115 per tower.', effect: { kind: 'repairs', house: 40, tower: 115 } },
    { text: 'School fees. Pay $50.', effect: { kind: 'cash', amount: -50 } },
  ],
}
export interface CircuitPlayer { name: string; cash: number; position: number; bot: boolean; out: boolean; jail: number; passes: number; doubles: number }
export interface CircuitAuction { space: number; bid: number; leader: number; bidders: number[]; turn: number }
export interface CircuitTrade { from: number; to: number; give: number[]; get: number[]; cash: number }
export type CircuitPhase = 'roll' | 'buy' | 'auction' | 'trade' | 'debt' | 'end' | 'over'
export interface CircuitState {
  players: CircuitPlayer[]; owners: number[]; levels: number[]; mortgaged: boolean[]; current: number; phase: CircuitPhase
  dice: number[]; rollId: number; again: boolean; auction: CircuitAuction | null; trade: CircuitTrade | null; tradeReturn: CircuitPhase
  debt: { creditor: number; owed: number } | null; card: { deck: 'chance' | 'chest'; text: string } | null
  decks: { chance: number[]; chest: number[] }; log: string[]; turns: number; winner: number | null
}
export type CircuitAction =
  | { type: 'roll' } | { type: 'buy' } | { type: 'decline' } | { type: 'bid'; amount: number } | { type: 'pass' }
  | { type: 'build'; space: number } | { type: 'sell'; space: number } | { type: 'mortgage'; space: number } | { type: 'unmortgage'; space: number }
  | { type: 'payJail' } | { type: 'usePass' } | { type: 'offer'; trade: CircuitTrade } | { type: 'accept' } | { type: 'reject' } | { type: 'bankrupt' } | { type: 'end' }

const clone = (state: CircuitState): CircuitState => ({ ...state, players: state.players.map(player => ({ ...player })), owners: [...state.owners], levels: [...state.levels], mortgaged: [...state.mortgaged], decks: { chance: [...state.decks.chance], chest: [...state.decks.chest] }, log: [...state.log], auction: state.auction && { ...state.auction, bidders: [...state.auction.bidders] }, trade: state.trade && { ...state.trade } })
const isOwnable = (index: number) => ['property', 'station', 'utility'].includes(PROPERTY_BOARD[index].type)
const groupOf = (index: number) => PROPERTY_BOARD.map((_, at) => at).filter(at => PROPERTY_BOARD[at].group === PROPERTY_BOARD[index].group && PROPERTY_BOARD[at].type === 'property')
export const ownsGroup = (state: CircuitState, index: number, player = state.owners[index]) => PROPERTY_BOARD[index].type === 'property' && player >= 0 && groupOf(index).every(at => state.owners[at] === player)
export const mortgageValue = (index: number) => (PROPERTY_BOARD[index].price || 0) / 2
export const unmortgageCost = (index: number) => Math.ceil(mortgageValue(index) * 1.1)
export function circuitWorth(state: CircuitState, player: number): number {
  return state.players[player].cash + PROPERTY_BOARD.reduce((sum, space, index) => state.owners[index] !== player ? sum : sum + (state.mortgaged[index] ? mortgageValue(index) : space.price || 0) + state.levels[index] * (space.house || 0), 0)
}
export function circuitRent(state: CircuitState, index: number, diceTotal: number, multiplier = 1): number {
  const space = PROPERTY_BOARD[index], owner = state.owners[index]
  if (owner < 0 || state.mortgaged[index]) return 0
  const owned = (type: SpaceType) => PROPERTY_BOARD.filter((other, at) => other.type === type && state.owners[at] === owner).length
  if (space.type === 'station') return 25 * 2 ** (owned('station') - 1) * multiplier
  if (space.type === 'utility') return diceTotal * (multiplier > 1 || owned('utility') === 2 ? 10 : 4)
  const level = state.levels[index]
  return level ? space.rents![level] : space.rents![0] * (ownsGroup(state, index) ? 2 : 1)
}
export function canBuild(state: CircuitState, index: number, player = state.current): boolean {
  const space = PROPERTY_BOARD[index], group = groupOf(index)
  return space.type === 'property' && ownsGroup(state, index, player) && state.levels[index] < MAX_LEVEL && group.every(at => !state.mortgaged[at] && state.levels[at] >= state.levels[index]) && state.players[player].cash >= space.house!
}
export const canSell = (state: CircuitState, index: number, player = state.current) => state.owners[index] === player && state.levels[index] > 0 && groupOf(index).every(at => state.levels[at] <= state.levels[index])
export const canMortgage = (state: CircuitState, index: number, player = state.current) => state.owners[index] === player && !state.mortgaged[index] && (PROPERTY_BOARD[index].type !== 'property' || groupOf(index).every(at => state.levels[at] === 0))
export const canUnmortgage = (state: CircuitState, index: number, player = state.current) => state.owners[index] === player && state.mortgaged[index] && state.players[player].cash >= unmortgageCost(index)
// Only unbuilt property can change hands; buildings are sold back first.
export const tradable = (state: CircuitState, index: number, player: number) => state.owners[index] === player && (PROPERTY_BOARD[index].type !== 'property' || groupOf(index).every(at => state.levels[at] === 0))

export function newCircuit(humans = 1, opponents = 1, random: Random = Math.random): CircuitState {
  const count = Math.min(4, Math.max(2, humans + opponents)), deck = (name: 'chance' | 'chest') => shuffled(CARDS[name].map((_, index) => index), random)
  return {
    players: Array.from({ length: count }, (_, i) => ({ name: i < humans ? humans === 1 ? 'You' : `Player ${i + 1}` : `Computer ${i - humans + 1}`, cash: 1500, position: 0, bot: i >= humans, out: false, jail: -1, passes: 0, doubles: 0 })),
    owners: Array(BOARD_SIZE).fill(-1), levels: Array(BOARD_SIZE).fill(0), mortgaged: Array(BOARD_SIZE).fill(false), current: 0, phase: 'roll',
    dice: [], rollId: 0, again: false, auction: null, trade: null, tradeReturn: 'roll', debt: null, card: null, decks: { chance: deck('chance'), chest: deck('chest') },
    log: [`Pass Launch to collect $${PASS_START}. Own a whole district to build houses.`], turns: 0, winner: null,
  }
}

export function circuitAction(state: CircuitState, action: CircuitAction, random: Random = Math.random): CircuitState {
  if (state.phase === 'over') return state
  const next = clone(state), me = next.players[next.current]
  const note = (text: string) => { next.log = [text, ...next.log].slice(0, 30) }
  const said = (player: CircuitPlayer, singular: string, plural: string) => `${player.name} ${player.name === 'You' ? plural : singular}`
  // Payments that the payer cannot cover leave them in debt until they raise the cash or retire.
  const pay = (from: number, to: number, amount: number) => {
    if (amount <= 0) return
    const payer = next.players[from], covered = Math.min(amount, Math.max(0, payer.cash))
    payer.cash -= amount
    if (to >= 0) next.players[to].cash += covered
    if (payer.cash < 0 && !next.debt) next.debt = { creditor: to, owed: amount - covered }
  }
  const moveTo = (destination: number, collect = true) => {
    if (collect && destination < me.position) { me.cash += PASS_START; note(`${said(me, 'passes', 'pass')} Launch and ${me.name === 'You' ? 'collect' : 'collects'} $${PASS_START}.`) }
    me.position = destination
  }
  const toJail = () => { me.position = JAIL; me.jail = 0; me.doubles = 0; next.again = false; note(`${said(me, 'goes', 'go')} straight to the lockup.`) }
  const land = (diceTotal: number, multiplier = 1, depth = 0): void => {
    const index = me.position, space = PROPERTY_BOARD[index], owner = next.owners[index]
    if (isOwnable(index)) {
      if (owner < 0) { next.phase = 'buy'; return }
      if (owner !== next.current && !next.players[owner].out) {
        const rent = circuitRent(next, index, diceTotal, multiplier)
        if (rent) { pay(next.current, owner, rent); note(`${said(me, 'pays', 'pay')} $${rent} rent to ${next.players[owner].name} for ${space.name}.`) }
        else if (next.mortgaged[index]) note(`${space.name} is mortgaged — no rent due.`)
      }
    } else if (space.type === 'tax') { pay(next.current, -1, space.tax!); note(`${said(me, 'pays', 'pay')} $${space.tax} ${space.name.toLowerCase()}.`) }
    else if (space.type === 'gotojail') toJail()
    else if ((space.type === 'chance' || space.type === 'chest') && depth < 3) {
      const deck = next.decks[space.type], drawn = deck.shift()!, card = CARDS[space.type][drawn]
      if (card.effect.kind !== 'free') deck.push(drawn)
      next.card = { deck: space.type, text: card.text }
      note(`${space.name}: ${card.text}`)
      const effect = card.effect
      if (effect.kind === 'move') { moveTo(effect.to); land(diceTotal, 1, depth + 1) }
      else if (effect.kind === 'back') { me.position = (me.position - effect.steps + BOARD_SIZE) % BOARD_SIZE; land(diceTotal, 1, depth + 1) }
      else if (effect.kind === 'nearest') {
        let at = me.position; do { at = (at + 1) % BOARD_SIZE } while (PROPERTY_BOARD[at].type !== effect.type)
        moveTo(at); land(diceTotal, 2, depth + 1)
      } else if (effect.kind === 'cash') effect.amount > 0 ? me.cash += effect.amount : pay(next.current, -1, -effect.amount)
      else if (effect.kind === 'each') next.players.forEach((other, at) => { if (at === next.current || other.out) return; effect.amount > 0 ? pay(at, next.current, effect.amount) : pay(next.current, at, -effect.amount) })
      else if (effect.kind === 'jail') toJail()
      else if (effect.kind === 'free') me.passes++
      else if (effect.kind === 'repairs') pay(next.current, -1, next.levels.reduce((sum, level, at) => next.owners[at] !== next.current ? sum : sum + (level === MAX_LEVEL ? effect.tower : level * effect.house), 0))
    }
  }
  const settle = () => {
    // Someone else may be in debt after a "collect from every player" card; the current player resolves only their own.
    if (me.cash < 0) { next.phase = 'debt'; if (!next.debt) next.debt = { creditor: -1, owed: -me.cash }; return }
    next.debt = null
    for (const [at, other] of next.players.entries()) if (at !== next.current && other.cash < 0) retire(at, -1)
    if (next.phase !== 'buy' && next.phase !== 'over') next.phase = 'end'
  }
  const retire = (who: number, creditor: number) => {
    const person = next.players[who]
    let proceeds = 0
    next.owners.forEach((owner, at) => { if (owner === who) { proceeds += next.levels[at] * (PROPERTY_BOARD[at].house || 0) / 2; next.levels[at] = 0 } })
    if (creditor >= 0) {
      next.owners = next.owners.map(owner => owner === who ? creditor : owner)
      next.players[creditor].cash += proceeds + Math.max(0, person.cash); next.players[creditor].passes += person.passes
    } else next.owners = next.owners.map((owner, at) => { if (owner !== who) return owner; next.mortgaged[at] = false; return -1 })
    person.out = true; person.cash = 0; person.passes = 0
    note(`${person.name} ${person.name === 'You' ? 'are' : 'is'} bankrupt${creditor >= 0 ? ` — everything goes to ${next.players[creditor].name}` : ''}.`)
    const alive = next.players.map((player, at) => player.out ? -1 : at).filter(at => at >= 0)
    if (alive.length === 1) { next.phase = 'over'; next.winner = alive[0] }
  }
  const finishAuction = () => {
    const auction = next.auction!, space = PROPERTY_BOARD[auction.space]
    if (auction.leader >= 0) { next.players[auction.leader].cash -= auction.bid; next.owners[auction.space] = auction.leader; note(`${next.players[auction.leader].name} won ${space.name} at auction for $${auction.bid}.`) }
    else note(`Nobody bid on ${space.name}. It stays with the bank.`)
    next.auction = null; next.phase = 'end'
  }
  const nextBidder = () => {
    const auction = next.auction!
    if (auction.bidders.length === 0 || (auction.bidders.length === 1 && auction.leader === auction.bidders[0])) { finishAuction(); return }
    auction.turn %= auction.bidders.length
    if (auction.bidders[auction.turn] === auction.leader) auction.turn = (auction.turn + 1) % auction.bidders.length
  }
  const owned = (index: number, player = next.current) => index >= 0 && index < BOARD_SIZE && next.owners[index] === player

  switch (action.type) {
    case 'roll': {
      if (state.phase !== 'roll' && !(state.phase === 'end' && state.again)) return state
      next.dice = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)]; next.rollId++; next.card = null; next.again = false
      const [a, b] = next.dice, total = a + b, double = a === b
      if (me.jail >= 0) {
        if (double) { me.jail = -1; note(`${said(me, 'rolls', 'roll')} a double ${a} and ${me.name === 'You' ? 'walk' : 'walks'} out of the lockup.`) }
        else if (++me.jail >= 3) { pay(next.current, -1, JAIL_FINE); me.jail = -1; note(`Third try. ${said(me, 'pays', 'pay')} the $${JAIL_FINE} fine and ${me.name === 'You' ? 'leave' : 'leaves'}.`) }
        else { note(`${said(me, 'rolls', 'roll')} ${a} + ${b} — still in the lockup.`); next.phase = 'end'; return next }
        moveTo((me.position + total) % BOARD_SIZE); note(`${said(me, 'moves', 'move')} to ${PROPERTY_BOARD[me.position].name}.`); land(total); settle(); return next
      }
      me.doubles = double ? me.doubles + 1 : 0
      if (me.doubles === 3) { note(`${said(me, 'rolls', 'roll')} a third double in a row.`); toJail(); next.phase = 'end'; return next }
      moveTo((me.position + total) % BOARD_SIZE)
      note(`${said(me, 'rolls', 'roll')} ${a} + ${b}${double ? ' — doubles!' : ''} and ${me.name === 'You' ? 'land' : 'lands'} on ${PROPERTY_BOARD[me.position].name}.`)
      next.again = double && me.jail < 0
      land(total); settle(); return next
    }
    case 'payJail': case 'usePass': {
      if (state.phase !== 'roll' || me.jail < 0) return state
      if (action.type === 'usePass') { if (!me.passes) return state; me.passes--; returnPass(next); note(`${said(me, 'uses', 'use')} a release pass.`) }
      else { if (me.cash < JAIL_FINE) return state; me.cash -= JAIL_FINE; note(`${said(me, 'pays', 'pay')} the $${JAIL_FINE} fine.`) }
      me.jail = -1; return next
    }
    case 'buy': {
      const space = PROPERTY_BOARD[me.position]
      if (state.phase !== 'buy' || me.cash < space.price!) return state
      me.cash -= space.price!; next.owners[me.position] = next.current; next.phase = 'end'; note(`${said(me, 'buys', 'buy')} ${space.name} for $${space.price}.`); return next
    }
    case 'decline': {
      if (state.phase !== 'buy') return state
      const bidders = next.players.map((player, at) => player.out ? -1 : (next.current + at) % next.players.length).filter(at => at >= 0 && !next.players[at].out)
      next.auction = { space: me.position, bid: 0, leader: -1, bidders, turn: 0 }; next.phase = 'auction'
      note(`${PROPERTY_BOARD[me.position].name} goes to auction.`); return next
    }
    case 'bid': case 'pass': {
      const auction = next.auction
      if (state.phase !== 'auction' || !auction) return state
      const bidder = auction.bidders[auction.turn]
      if (action.type === 'bid') {
        if (action.amount <= auction.bid || action.amount > next.players[bidder].cash) return state
        auction.bid = action.amount; auction.leader = bidder; auction.turn++
        note(`${next.players[bidder].name} ${next.players[bidder].name === 'You' ? 'bid' : 'bids'} $${action.amount}.`)
      } else { auction.bidders.splice(auction.turn, 1); note(`${said(next.players[bidder], 'passes', 'pass')}.`) }
      nextBidder(); return next
    }
    case 'build': case 'sell': case 'mortgage': case 'unmortgage': {
      if (!['roll', 'end', 'debt'].includes(state.phase) || !owned(action.space)) return state
      const space = PROPERTY_BOARD[action.space]
      if (action.type === 'build') { if (state.phase === 'debt' || !canBuild(next, action.space)) return state; me.cash -= space.house!; next.levels[action.space]++; note(`${said(me, 'builds', 'build')} ${next.levels[action.space] === MAX_LEVEL ? 'a tower' : 'a house'} on ${space.name}.`) }
      if (action.type === 'sell') { if (!canSell(next, action.space)) return state; me.cash += space.house! / 2; next.levels[action.space]--; note(`${said(me, 'sells', 'sell')} a building on ${space.name}.`) }
      if (action.type === 'mortgage') { if (!canMortgage(next, action.space)) return state; me.cash += mortgageValue(action.space); next.mortgaged[action.space] = true; note(`${said(me, 'mortgages', 'mortgage')} ${space.name} for $${mortgageValue(action.space)}.`) }
      if (action.type === 'unmortgage') { if (state.phase === 'debt' || !canUnmortgage(next, action.space)) return state; me.cash -= unmortgageCost(action.space); next.mortgaged[action.space] = false; note(`${said(me, 'lifts', 'lift')} the mortgage on ${space.name}.`) }
      if (state.phase === 'debt' && me.cash >= 0) { if (next.debt && next.debt.creditor >= 0) next.players[next.debt.creditor].cash += next.debt.owed; next.debt = null; next.phase = 'end'; note(`${said(me, 'settles', 'settle')} the debt.`) }
      return next
    }
    case 'bankrupt': {
      if (state.phase !== 'debt') return state
      retire(next.current, next.debt?.creditor ?? -1); next.debt = null
      if (next.phase === 'over') return next
      next.again = false; next.phase = 'end'
      return endTurn(next)
    }
    case 'offer': {
      const { trade } = action, partner = next.players[trade.to]
      if (!['roll', 'end'].includes(state.phase) || trade.from !== next.current || trade.to === trade.from || !partner || partner.out) return state
      if (!trade.give.every(at => tradable(next, at, trade.from)) || !trade.get.every(at => tradable(next, at, trade.to)) || (!trade.give.length && !trade.get.length && !trade.cash)) return state
      if (trade.cash > me.cash || -trade.cash > partner.cash) return state
      next.trade = { ...trade, give: [...trade.give], get: [...trade.get] }; next.tradeReturn = state.phase; next.phase = 'trade'
      note(`${said(me, 'offers', 'offer')} ${partner.name} a trade.`)
      if (partner.bot) return circuitAction(next, tradeValue(next, next.trade) > 0 ? { type: 'accept' } : { type: 'reject' }, random)
      return next
    }
    case 'accept': case 'reject': {
      const trade = next.trade
      if (state.phase !== 'trade' || !trade) return state
      if (action.type === 'accept') {
        trade.give.forEach(at => { next.owners[at] = trade.to }); trade.get.forEach(at => { next.owners[at] = trade.from })
        next.players[trade.from].cash -= trade.cash; next.players[trade.to].cash += trade.cash
      }
      note(`${next.players[trade.to].name} ${action.type === 'accept' ? next.players[trade.to].name === 'You' ? 'accept' : 'accepts' : next.players[trade.to].name === 'You' ? 'decline' : 'declines'} the trade.`)
      next.trade = null; next.phase = next.tradeReturn; return next
    }
    case 'end': {
      if (state.phase !== 'end' || state.again) return state
      return endTurn(next)
    }
  }
}
function returnPass(state: CircuitState) {
  // A used pass goes back under whichever deck is missing its own.
  const deck = state.decks.chance.length < CARDS.chance.length ? 'chance' : 'chest'
  state.decks[deck].push(CARDS[deck].findIndex(card => card.effect.kind === 'free'))
}
function endTurn(next: CircuitState): CircuitState {
  next.turns++; next.card = null
  if (next.turns >= TURN_LIMIT) {
    const alive = next.players.map((player, at) => player.out ? -1 : at).filter(at => at >= 0)
    next.winner = alive.reduce((best, at) => circuitWorth(next, at) > circuitWorth(next, best) ? at : best, alive[0]); next.phase = 'over'
    next.log = [`Time is up after ${TURN_LIMIT} turns. ${next.players[next.winner].name} ${next.players[next.winner].name === 'You' ? 'have' : 'has'} the richest estate.`, ...next.log]
    return next
  }
  next.players[next.current].doubles = 0
  do { next.current = (next.current + 1) % next.players.length } while (next.players[next.current].out)
  next.phase = 'roll'; next.again = false
  return next
}
// How much better a trade leaves its receiving player, in dollars. Completing a district is worth a premium.
export function tradeValue(state: CircuitState, trade: CircuitTrade): number {
  const after = clone(state)
  trade.give.forEach(at => { after.owners[at] = trade.to }); trade.get.forEach(at => { after.owners[at] = trade.from })
  const worth = (at: number, owner: number, view: CircuitState) => (view.mortgaged[at] ? mortgageValue(at) : PROPERTY_BOARD[at].price!) * (ownsGroup(view, at, owner) ? 2.2 : 1)
  const gained = trade.give.reduce((sum, at) => sum + worth(at, trade.to, after), 0) + trade.cash
  const lost = trade.get.reduce((sum, at) => sum + worth(at, trade.to, state), 0)
  // Handing the other side a full district costs the receiver too.
  const enabled = trade.get.filter(at => ownsGroup(after, at, trade.from) && !ownsGroup(state, at, trade.from)).length * 250
  return gained - lost * 1.15 - enabled
}
// The computer's move in whatever the current phase is waiting on.
export function chooseCircuitAction(state: CircuitState): CircuitAction | null {
  const me = state.players[state.current], reserve = 150
  if (state.phase === 'auction' && state.auction) {
    const auction = state.auction, bidder = state.players[auction.bidders[auction.turn]], space = PROPERTY_BOARD[auction.space]
    const trial = { ...state, owners: state.owners.map((owner, at) => at === auction.space ? auction.bidders[auction.turn] : owner) }
    const ceiling = Math.min(bidder.cash - 60, space.price! * (ownsGroup(trial, auction.space) ? 1.7 : 1.05))
    const bid = auction.bid + (auction.bid < 100 ? 10 : 20)
    return bid <= ceiling ? { type: 'bid', amount: bid } : { type: 'pass' }
  }
  if (state.phase === 'trade' && state.trade) return tradeValue(state, state.trade) > 0 ? { type: 'accept' } : { type: 'reject' }
  const mine = state.owners.map((owner, at) => owner === state.current ? at : -1).filter(at => at >= 0)
  if (state.phase === 'debt') {
    const sell = mine.filter(at => canSell(state, at)).sort((a, b) => state.levels[b] - state.levels[a])[0]
    if (sell !== undefined) return { type: 'sell', space: sell }
    const mortgage = mine.filter(at => canMortgage(state, at)).sort((a, b) => Number(ownsGroup(state, a)) - Number(ownsGroup(state, b)) || PROPERTY_BOARD[a].price! - PROPERTY_BOARD[b].price!)[0]
    return mortgage !== undefined ? { type: 'mortgage', space: mortgage } : { type: 'bankrupt' }
  }
  if (state.phase === 'roll' && me.jail >= 0) {
    const late = state.owners.filter(owner => owner < 0).length < 8
    if (me.passes && !late) return { type: 'usePass' }
    if (!late && me.cash >= JAIL_FINE + reserve) return { type: 'payJail' }
    return { type: 'roll' }
  }
  if (state.phase === 'buy') {
    const space = PROPERTY_BOARD[me.position], trial = { ...state, owners: state.owners.map((owner, at) => at === me.position ? state.current : owner) }
    return me.cash - space.price! >= reserve || (ownsGroup(trial, me.position) && me.cash >= space.price!) ? { type: 'buy' } : { type: 'decline' }
  }
  if (state.phase === 'end' || state.phase === 'roll') {
    const build = mine.filter(at => canBuild(state, at) && me.cash - PROPERTY_BOARD[at].house! >= reserve + 100).sort((a, b) => state.levels[a] - state.levels[b] || PROPERTY_BOARD[b].price! - PROPERTY_BOARD[a].price!)[0]
    if (build !== undefined) return { type: 'build', space: build }
    const lift = mine.find(at => canUnmortgage(state, at) && me.cash - unmortgageCost(at) >= reserve + 300)
    if (lift !== undefined) return { type: 'unmortgage', space: lift }
    return state.phase === 'roll' || state.again ? { type: 'roll' } : { type: 'end' }
  }
  return null
}
// Who has to act right now: the auction bidder or trade partner when one is pending, otherwise the current player.
export function circuitActor(state: CircuitState): number {
  if (state.phase === 'auction' && state.auction) return state.auction.bidders[state.auction.turn]
  if (state.phase === 'trade' && state.trade) return state.trade.to
  return state.current
}
