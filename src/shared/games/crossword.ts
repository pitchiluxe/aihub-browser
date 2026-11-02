import { shuffled, type Random } from './random'
// A fresh crossword every time: words from an original clue bank are laid on
// a grid so that each one crosses at least one other, and never touches a
// word side-by-side except where they share a letter.
export const CLUE_BANK: [string, string][] = [
  ['APPLE', 'Fruit that keeps the doctor away, they say'], ['RIVER', 'It flows to the sea'], ['PIANO', 'Instrument with 88 keys'], ['TIGER', 'Striped big cat'],
  ['OCEAN', 'The Pacific, for one'], ['BREAD', 'Baked loaf'], ['CHAIR', 'Seat with a back'], ['HONEY', 'Sweet stuff from a hive'], ['PLANET', 'Mars or Venus'],
  ['GARDEN', 'Where tomatoes and roses grow'], ['WINTER', 'Coldest season'], ['CANDLE', 'Wax light with a wick'], ['ORANGE', 'Colour and citrus fruit'], ['BRIDGE', 'It crosses a river'],
  ['ISLAND', 'Land surrounded by water'], ['ROCKET', 'It blasts off to space'], ['FOREST', 'Lots of trees together'], ['MIRROR', 'It shows your reflection'], ['LADDER', 'You climb its rungs'],
  ['PENCIL', 'Writing tool with an eraser'], ['DRAGON', 'Fire-breathing creature of legend'], ['BASKET', 'Woven carrier for a picnic'], ['GUITAR', 'Six-stringed instrument'], ['KITTEN', 'Young cat'],
  ['MONKEY', 'Banana-loving climber'], ['RABBIT', 'Long-eared hopper'], ['PARROT', 'Talking bird'], ['TURTLE', 'Slow reptile with a shell'], ['SPIDER', 'Eight-legged web spinner'],
  ['DOCTOR', 'Person who treats the sick'], ['FARMER', 'Person who grows crops'], ['SCHOOL', 'Place of lessons'], ['MARKET', 'Place to buy and sell'], ['CASTLE', 'Home of a medieval king'],
  ['WINDOW', 'Glass pane in a wall'], ['BUTTER', 'Spread made from cream'], ['COFFEE', 'Morning brew'], ['CHEESE', 'Food made from curdled milk'], ['PEPPER', 'Salt’s partner'],
  ['SUMMER', 'Warmest season'], ['SPRING', 'Season of blossoms; also a coil'], ['AUTUMN', 'Season of falling leaves'], ['THUNDER', 'Sound after lightning'], ['RAINBOW', 'Arc of seven colours'],
  ['VOLCANO', 'Mountain that can erupt'], ['DIAMOND', 'Hardest gemstone'], ['LIBRARY', 'Place to borrow books'], ['KITCHEN', 'Room for cooking'], ['BLANKET', 'Warm bed cover'],
  ['TEACHER', 'Classroom leader'], ['PICTURE', 'Photo or painting'], ['COMPASS', 'It points north'], ['DOLPHIN', 'Clever sea mammal'], ['PENGUIN', 'Bird that cannot fly but swims well'],
  ['GIRAFFE', 'Tallest animal'], ['ELEPHANT', 'Animal with a trunk'], ['KANGAROO', 'Hopper with a pouch'], ['UMBRELLA', 'Keeps you dry in the rain'], ['MOUNTAIN', 'Very tall landform'],
  ['TREASURE', 'Pirate’s buried chest'], ['BIRTHDAY', 'Day with cake and candles'], ['SANDWICH', 'Filling between two slices'], ['AIRPLANE', 'It flies passengers'], ['SNOWMAN', 'Winter figure with a carrot nose'],
  ['MOON', 'It lights the night sky'], ['STAR', 'Twinkler in the night sky'], ['SUN', 'Our closest star'], ['RAIN', 'Water from clouds'], ['SNOW', 'White winter flakes'],
  ['WIND', 'Moving air'], ['TREE', 'Oak or pine'], ['LEAF', 'Green part of a plant'], ['ROSE', 'Thorny flower'], ['SEED', 'It grows into a plant'],
  ['BOOK', 'Novel or textbook'], ['DOOR', 'You knock on it'], ['LAMP', 'Desk light'], ['BELL', 'It rings'], ['DRUM', 'Instrument you beat'],
  ['SHIP', 'Big boat'], ['TRAIN', 'It runs on rails'], ['TRUCK', 'Big road vehicle for cargo'], ['WHEEL', 'Round part of a car'], ['ROAD', 'Street or highway'],
  ['CAKE', 'Birthday dessert'], ['SOUP', 'Hot dish eaten with a spoon'], ['RICE', 'Grain eaten all over Asia'], ['MILK', 'Drink from a cow'], ['EGG', 'Breakfast laid by a hen'],
  ['FISH', 'Swimmer with fins'], ['BIRD', 'Feathered flyer'], ['BEAR', 'Big furry animal that hibernates'], ['LION', 'King of the jungle'], ['WOLF', 'Wild relative of the dog'],
  ['FROG', 'Green jumper that croaks'], ['DUCK', 'Bird that quacks'], ['GOAT', 'Bearded farm animal'], ['HORSE', 'Animal you can ride'], ['SHEEP', 'Woolly farm animal'],
  ['ZEBRA', 'Striped horse of Africa'], ['CAMEL', 'Desert animal with humps'], ['EAGLE', 'Bird with sharp eyes'], ['WHALE', 'Largest sea mammal'], ['SHARK', 'Ocean predator with a fin'],
  ['MOUSE', 'Small squeaker; also a computer gadget'], ['SNAKE', 'Legless reptile'], ['OWL', 'Night bird that hoots'], ['BEE', 'Buzzing honey maker'], ['ANT', 'Tiny worker insect'],
  ['HAND', 'It has five fingers'], ['NOSE', 'You smell with it'], ['HEART', 'It pumps blood'], ['SMILE', 'Happy face'], ['DREAM', 'Pictures in your sleep'],
  ['MUSIC', 'Songs and melodies'], ['DANCE', 'Move to music'], ['PAINT', 'Colour on a brush'], ['CLOCK', 'It tells the time'], ['WATCH', 'Timepiece on a wrist'],
  ['PHONE', 'You call people with it'], ['HOUSE', 'Place to live'], ['TABLE', 'Furniture you eat at'], ['SPOON', 'Utensil for soup'], ['PLATE', 'Dish for dinner'],
  ['BEACH', 'Sandy shore'], ['CLOUD', 'White puff in the sky'], ['STORM', 'Wild weather'], ['FIELD', 'Open land for crops or games'], ['STONE', 'Small rock'],
  ['LEMON', 'Sour yellow fruit'], ['GRAPE', 'Fruit for raisins'], ['MANGO', 'Tropical fruit with a big pit'], ['PEACH', 'Fuzzy fruit'], ['BERRY', 'Small juicy fruit'],
  ['QUEEN', 'Royal lady'], ['KING', 'Royal ruler'], ['CROWN', 'Royal headwear'], ['SWORD', 'Knight’s blade'], ['SHIELD', 'Knight’s protection'],
  ['PIZZA', 'Italian pie with toppings'], ['PASTA', 'Spaghetti, for example'], ['SALAD', 'Bowl of greens'], ['SUGAR', 'Sweet crystals'], ['SALT', 'Seasoning from the sea'],
  ['CIRCLE', 'Round shape'], ['SQUARE', 'Four equal sides'], ['NUMBER', 'Seven or twelve'], ['LETTER', 'A, B or C'], ['WORD', 'What a crossword is made of'],
  ['GAME', 'Something you play'], ['PUZZLE', 'Brain teaser'], ['DICE', 'Cubes you roll'], ['CARD', 'Ace or king'], ['CHESS', 'Game with knights and bishops'],
]
export interface CrosswordWord { answer: string; clue: string; row: number; col: number; across: boolean; number: number }
export interface Crossword { size: number; grid: (string | null)[][]; words: CrosswordWord[] }

export function buildCrossword(random: Random = Math.random, size = 13, target = 14): Crossword {
  let best: Crossword | null = null
  // Several attempts; keep the densest grid.
  for (let attempt = 0; attempt < 12; attempt++) {
    const grid: (string | null)[][] = Array.from({ length: size }, () => Array(size).fill(null))
    const placed: Omit<CrosswordWord, 'number'>[] = []
    const pool = shuffled(CLUE_BANK.filter(([answer]) => answer.length <= size - 2), random)
    const fits = (answer: string, row: number, col: number, across: boolean) => {
      let crossings = 0
      const dr = across ? 0 : 1, dc = across ? 1 : 0
      const before = [row - dr, col - dc], after = [row + dr * answer.length, col + dc * answer.length]
      for (const [r, c] of [before, after]) if (r >= 0 && c >= 0 && r < size && c < size && grid[r][c]) return -1
      for (let i = 0; i < answer.length; i++) {
        const r = row + dr * i, c = col + dc * i
        if (r < 0 || c < 0 || r >= size || c >= size) return -1
        const cell = grid[r][c]
        if (cell) { if (cell !== answer[i]) return -1; crossings++; continue }
        // An empty cell must not sit beside another word running the same way.
        const [n1, n2] = across ? [[r - 1, c], [r + 1, c]] : [[r, c - 1], [r, c + 1]]
        if ([n1, n2].some(([nr, nc]) => nr >= 0 && nc >= 0 && nr < size && nc < size && grid[nr][nc])) return -1
      }
      return crossings
    }
    const place = (answer: string, clue: string, row: number, col: number, across: boolean) => {
      for (let i = 0; i < answer.length; i++) grid[row + (across ? 0 : i)][col + (across ? i : 0)] = answer[i]
      placed.push({ answer, clue, row, col, across })
    }
    const [first, firstClue] = pool.find(([answer]) => answer.length >= 6) || pool[0]
    place(first, firstClue, Math.floor(size / 2), Math.floor((size - first.length) / 2), true)
    for (const [answer, clue] of pool) {
      if (placed.length >= target) break
      if (placed.some(word => word.answer === answer)) continue
      let choice: { row: number; col: number; across: boolean; score: number } | null = null
      for (const word of placed) for (let i = 0; i < word.answer.length; i++) for (let j = 0; j < answer.length; j++) {
        if (word.answer[i] !== answer[j]) continue
        const across = !word.across
        const row = word.across ? word.row - j : word.row + i, col = word.across ? word.col + i : word.col - j
        const crossings = fits(answer, row, col, across)
        if (crossings < 1) continue
        const centre = Math.abs(row - size / 2) + Math.abs(col - size / 2)
        const score = crossings * 10 - centre + random()
        if (!choice || score > choice.score) choice = { row, col, across, score }
      }
      if (choice) place(answer, clue, choice.row, choice.col, choice.across)
    }
    if (!best || placed.length > best.words.length) best = { size, grid, words: number(placed) }
    if (placed.length >= target) break
  }
  return best!
}
// Classic numbering: left to right, top to bottom, one number per starting cell.
function number(words: Omit<CrosswordWord, 'number'>[]): CrosswordWord[] {
  const starts = [...new Set(words.map(word => word.row * 100 + word.col))].sort((a, b) => a - b)
  return words.map(word => ({ ...word, number: starts.indexOf(word.row * 100 + word.col) + 1 })).sort((a, b) => a.number - b.number || Number(b.across) - Number(a.across))
}
export const cellsOf = (word: CrosswordWord) => Array.from({ length: word.answer.length }, (_, i) => [word.row + (word.across ? 0 : i), word.col + (word.across ? i : 0)] as [number, number])
