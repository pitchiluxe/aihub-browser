/**
 * Generate src/shared/emoji.ts — the community's emoji set.
 *
 * Emoji are enumerated from the Unicode properties V8 already carries rather
 * than typed out or pulled from a package. That keeps the list complete and
 * correct for whatever Unicode version the bundled Electron ships, and it means
 * the app gains new emoji by being rebuilt rather than by someone remembering.
 *
 * What is generated:
 *  - every single-codepoint emoji with default emoji presentation (~1200)
 *  - country and region flags, built from regional indicator pairs
 *  - the ZWJ sequences people actually use — professions, families, couples,
 *    and the handful of coloured hearts and gendered variants
 *
 * What is NOT generated: names. Unicode character names are not exposed to
 * JavaScript at runtime, so search runs over a hand-written keyword table for
 * the common emoji and the rest are browsable by group. Better an honest
 * partial index than invented names.
 *
 * Run: node scripts/build-emoji.mjs
 */

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'src', 'shared', 'emoji.ts')

/**
 * Codepoint ranges to emoji groups.
 *
 * These follow Unicode's own emoji groups where the blocks line up and split by
 * hand where they do not — the Miscellaneous Symbols block, for instance, mixes
 * weather, zodiac and religious symbols across three groups.
 */
const RANGES = [
  ['Smileys & Emotion', [[0x1f600, 0x1f64f], [0x1f910, 0x1f92f], [0x1f970, 0x1f97a],
    [0x1f9d0, 0x1f9d0], [0x2639, 0x263b], [0x1fae0, 0x1faef], [0x1f480, 0x1f480],
    [0x1f4a4, 0x1f4a9], [0x1f5a4, 0x1f5a4], [0x2764, 0x2764], [0x1f493, 0x1f49f],
    [0x1f48b, 0x1f48c], [0x1f4a2, 0x1f4a2]]],
  // 1F4AA (muscle) sits inside the Objects block and is not an object.
  ['People & Body', [[0x1f4aa, 0x1f4aa], [0x1f440, 0x1f450], [0x1f645, 0x1f64f], [0x1f9b0, 0x1f9bf],
    [0x1f9d1, 0x1f9dd], [0x1f466, 0x1f487], [0x1f574, 0x1f57a], [0x1f590, 0x1f596],
    [0x1faf0, 0x1faf8], [0x261d, 0x261d], [0x270a, 0x270d], [0x1f6b4, 0x1f6c5]]],
  ['Animals & Nature', [[0x1f400, 0x1f43f], [0x1f980, 0x1f9ae], [0x1f330, 0x1f344],
    [0x1f490, 0x1f492], [0x1f337, 0x1f33f], [0x1f984, 0x1f9a2], [0x1fab0, 0x1fabf],
    [0x1f577, 0x1f578], [0x1f41d, 0x1f43e]]],
  ['Food & Drink', [[0x1f345, 0x1f37f], [0x1f950, 0x1f96f], [0x1f9c0, 0x1f9cb],
    [0x1fad0, 0x1fadf], [0x1f942, 0x1f94b], [0x2615, 0x2615]]],
  ['Travel & Places', [[0x1f5fa, 0x1f5fa], [0x1f680, 0x1f6a3], [0x1f6a4, 0x1f6b3], [0x1f300, 0x1f32f],
    [0x1f3d4, 0x1f3f0], [0x1f5fb, 0x1f5ff], [0x1f9ed, 0x1f9f0], [0x26f0, 0x26fd],
    [0x1f6e0, 0x1f6ed], [0x2708, 0x2708], [0x1f3e0, 0x1f3f0]]],
  ['Activities', [[0x1f380, 0x1f3ad], [0x1f3ae, 0x1f3d3], [0x1f947, 0x1f94f],
    [0x26bd, 0x26be], [0x1f939, 0x1f93f], [0x1fa80, 0x1fa8f], [0x1f0cf, 0x1f0cf]]],
  ['Objects', [[0x1f4a0, 0x1f4fc], [0x1f4fd, 0x1f53d], [0x1f6aa, 0x1f6b2],
    [0x1f9f1, 0x1f9ff], [0x1fa90, 0x1faaf], [0x1f579, 0x1f58d], [0x2696, 0x2697],
    [0x1f9ea, 0x1f9ec], [0x1f4bb, 0x1f4bf], [0x231a, 0x231b]]],
  ['Symbols', [[0x1f500, 0x1f5ff], [0x2600, 0x27bf], [0x1f191, 0x1f19a],
    [0x1f200, 0x1f2ff], [0x2b00, 0x2bff], [0x1f004, 0x1f004], [0x3030, 0x303d],
    [0x1f7e0, 0x1f7eb], [0x25aa, 0x25fe], [0x2934, 0x2935], [0x2190, 0x21ff]]],
]

const isEmoji = (s) => /\p{Emoji_Presentation}/u.test(s)
const isModifierBase = (s) => /\p{Emoji_Modifier_Base}/u.test(s)

/** Everything with default emoji presentation, bucketed. Range order decides
 *  ties, so an emoji claimed by two ranges lands in the earlier group. */
function collect() {
  const groups = new Map(RANGES.map(([name]) => [name, []]))
  const claimed = new Set()

  for (const [name, ranges] of RANGES) {
    for (const [from, to] of ranges) {
      for (let cp = from; cp <= to; cp++) {
        if (claimed.has(cp)) continue
        const char = String.fromCodePoint(cp)
        if (!isEmoji(char)) continue
        claimed.add(cp)
        groups.get(name).push({ char, cp, tone: isModifierBase(char) })
      }
    }
  }

  // Sweep for anything the ranges missed, so a new Unicode block cannot go
  // silently absent — it lands in Symbols rather than nowhere.
  const strays = []
  for (let cp = 0x0; cp <= 0x1fbff; cp++) {
    if (claimed.has(cp)) continue
    const char = String.fromCodePoint(cp)
    if (!isEmoji(char)) continue
    strays.push({ char, cp, tone: isModifierBase(char) })
  }
  groups.get('Symbols').push(...strays)

  return { groups, strays: strays.length }
}

/** Country and region flags: two regional indicators, A–Z mapped from ISO codes. */
const REGIONS = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
  'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE ' +
  'EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
  'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC ' +
  'LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
  'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO ' +
  'TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

const flagFor = (code) => String.fromCodePoint(
  ...[...code].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65))

/**
 * ZWJ sequences worth shipping.
 *
 * Not generated: a ZWJ sequence is only valid if the font has it, and
 * enumerating every combination would fill the picker with tofu. These are the
 * sequences in everyday use.
 */
const ZWJ = [
  ['People & Body', [
    '👨‍💻', '👩‍💻', '🧑‍💻', '👨‍🔧', '👩‍🔧', '👨‍🏫', '👩‍🏫', '👨‍⚕️', '👩‍⚕️',
    '👨‍🌾', '👩‍🌾', '👨‍🍳', '👩‍🍳', '👨‍🎓', '👩‍🎓', '👨‍🎤', '👩‍🎤', '👨‍🎨', '👩‍🎨',
    '👨‍🚀', '👩‍🚀', '👨‍🚒', '👩‍🚒', '👮‍♂️', '👮‍♀️', '🕵️‍♂️', '🕵️‍♀️', '💂‍♂️', '💂‍♀️',
    '👷‍♂️', '👷‍♀️', '🦸‍♂️', '🦸‍♀️', '🦹‍♂️', '🦹‍♀️', '🧙‍♂️', '🧙‍♀️', '🧚‍♂️', '🧚‍♀️',
    '🙅‍♂️', '🙅‍♀️', '🙆‍♂️', '🙆‍♀️', '🤷‍♂️', '🤷‍♀️', '🤦‍♂️', '🤦‍♀️', '🙋‍♂️', '🙋‍♀️',
    '🤾‍♂️', '🤾‍♀️', '🏃‍♂️', '🏃‍♀️', '🚶‍♂️', '🚶‍♀️', '🏋️‍♂️', '🏋️‍♀️', '🚴‍♂️', '🚴‍♀️',
    '👨‍👩‍👦', '👨‍👩‍👧', '👨‍👩‍👧‍👦', '👨‍👨‍👦', '👩‍👩‍👦', '👨‍👦', '👩‍👦', '👨‍👧', '👩‍👧',
    '💑', '💏', '👩‍❤️‍👨', '👨‍❤️‍👨', '👩‍❤️‍👩',
  ]],
  ['Symbols', ['❤️‍🔥', '❤️‍🩹', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '👁️‍🗨️']],
]

function build() {
  const { groups, strays } = collect()

  for (const [group, chars] of ZWJ) {
    for (const char of chars) groups.get(group).push({ char, cp: 0, tone: false })
  }

  const flags = REGIONS.map(code => ({ char: flagFor(code), cp: 0, tone: false, code }))

  const sections = [...groups.entries()].map(([name, list]) => ({ name, list }))
  sections.push({ name: 'Flags', list: flags })

  const total = sections.reduce((n, s) => n + s.list.length, 0)

  const body = sections.map(section => {
    const chars = section.list.map(e => JSON.stringify(e.char)).join(', ')
    return `  {\n    name: ${JSON.stringify(section.name)},\n    emoji: [${chars}],\n  },`
  }).join('\n')

  const tonable = [...groups.values()].flat().filter(e => e.tone).map(e => e.char)

  const file = `/**
 * The community's emoji set — GENERATED by scripts/build-emoji.mjs. Do not edit.
 *
 * Regenerate with: node scripts/build-emoji.mjs
 *
 * Enumerated from the Unicode properties the bundled Electron already carries,
 * so the set matches whatever Unicode version this build of Chromium can
 * actually render. Emoji nobody's font supports never make it in, and new ones
 * arrive with an Electron upgrade rather than with someone remembering to add
 * them.
 *
 * ${total} emoji across ${sections.length} groups.
 *
 * Names are absent on purpose: Unicode character names are not reachable from
 * JavaScript at runtime, so inventing them would mean shipping a table that
 * quietly disagrees with the characters. Search runs over EMOJI_KEYWORDS below;
 * everything else is browsable by group.
 */

export interface EmojiGroup {
  name: string
  emoji: string[]
}

export const EMOJI_GROUPS: EmojiGroup[] = [
${body}
]

export const EMOJI_COUNT = ${total}

/** Emoji that accept a skin tone modifier. */
export const SKIN_TONE_BASES = new Set<string>([${tonable.map(c => JSON.stringify(c)).join(', ')}])

/** The five Fitzpatrick modifiers, plus the default. */
export const SKIN_TONES = ['', '\\u{1F3FB}', '\\u{1F3FC}', '\\u{1F3FD}', '\\u{1F3FE}', '\\u{1F3FF}']

/** Apply a tone to an emoji that supports one; a no-op for the rest. */
export function withSkinTone(emoji: string, tone: string): string {
  if (!tone || !SKIN_TONE_BASES.has(emoji)) return emoji
  return emoji + tone
}

/**
 * Search terms for the emoji people reach for.
 *
 * Deliberately partial. A keyword table covering every emoji would be a second
 * Unicode database maintained by hand, and the failure mode of getting one
 * wrong is worse than the failure mode of not finding a rarely used symbol by
 * name — that one is still one group away.
 */
export const EMOJI_KEYWORDS: Record<string, string> = ${JSON.stringify(KEYWORDS, null, 2)
    .split('\n').map((line, i) => i === 0 ? line : '  ' + line).join('\n')}

/** Group name plus keywords, lowercased, for one pass over the picker. */
export function emojiMatches(emoji: string, query: string): boolean {
  const terms = EMOJI_KEYWORDS[emoji]
  return !!terms && terms.includes(query)
}
`

  writeFileSync(OUT, file, 'utf8')
  console.log(`wrote ${OUT}`)
  for (const section of sections) console.log(`  ${section.name.padEnd(20)} ${section.list.length}`)
  console.log(`  ${'TOTAL'.padEnd(20)} ${total}   (${strays} found by the sweep, ${tonable.length} tonable)`)
}

/** Keywords for the everyday set. Lowercase, space separated. */
const KEYWORDS = {
  '😀': 'grin smile happy face', '😃': 'smile happy face joy', '😄': 'smile happy grin eyes',
  '😁': 'beam grin smile', '😆': 'laugh squint happy', '😅': 'sweat laugh relief',
  '🤣': 'rofl laugh rolling floor', '😂': 'joy tears laugh cry', '🙂': 'slight smile',
  '🙃': 'upside down silly', '😉': 'wink', '😊': 'blush smile happy', '😇': 'halo angel innocent',
  '🥰': 'love hearts adore', '😍': 'heart eyes love', '🤩': 'star struck excited wow',
  '😘': 'kiss blow love', '😗': 'kiss', '😚': 'kiss closed eyes', '😙': 'kiss smile',
  '🥲': 'smile tear happy sad', '😋': 'yum tongue tasty', '😛': 'tongue out',
  '😜': 'wink tongue joke', '🤪': 'zany crazy silly', '😝': 'tongue squint',
  '🤑': 'money mouth rich dollar', '🤗': 'hug hands', '🤭': 'oops hand mouth giggle',
  '🤫': 'shush quiet secret', '🤔': 'think hmm consider', '🤐': 'zipper mouth silent',
  '🤨': 'raised eyebrow skeptical doubt', '😐': 'neutral blank', '😑': 'expressionless',
  '😶': 'no mouth speechless', '😏': 'smirk', '😒': 'unamused meh', '🙄': 'eye roll',
  '😬': 'grimace awkward', '🤥': 'lying nose pinocchio', '😌': 'relieved calm',
  '😔': 'pensive sad', '😪': 'sleepy tired', '🤤': 'drool', '😴': 'sleep zzz',
  '😷': 'mask sick', '🤒': 'thermometer sick ill', '🤕': 'bandage hurt injured',
  '🤢': 'nauseated sick green', '🤮': 'vomit sick', '🤧': 'sneeze tissue',
  '🥵': 'hot heat sweat', '🥶': 'cold freezing', '🥴': 'woozy drunk', '😵': 'dizzy knocked out',
  '🤯': 'mind blown explode shock', '🤠': 'cowboy hat', '🥳': 'party celebrate birthday',
  '😎': 'sunglasses cool', '🤓': 'nerd glasses geek', '🧐': 'monocle inspect',
  '😕': 'confused', '😟': 'worried', '🙁': 'frown slight sad', '😮': 'open mouth surprise',
  '😯': 'hushed surprise', '😲': 'astonished shock', '😳': 'flushed embarrassed',
  '🥺': 'pleading puppy eyes beg', '😦': 'frown open', '😧': 'anguished',
  '😨': 'fearful scared', '😰': 'anxious sweat', '😥': 'sad relieved', '😢': 'cry tear sad',
  '😭': 'sob cry loud', '😱': 'scream fear shock', '😖': 'confounded', '😣': 'persevere',
  '😞': 'disappointed sad', '😓': 'downcast sweat', '😩': 'weary tired', '😫': 'tired',
  '🥱': 'yawn bored tired', '😤': 'triumph steam angry', '😡': 'rage angry red',
  '😠': 'angry mad', '🤬': 'cursing swearing symbols', '😈': 'devil smiling imp',
  '👿': 'imp angry devil', '💀': 'skull dead', '💩': 'poop pile', '🤡': 'clown',
  '👹': 'ogre', '👺': 'goblin', '👻': 'ghost boo halloween', '👽': 'alien ufo',
  '🤖': 'robot bot ai', '😺': 'cat smile', '😹': 'cat joy tears', '😻': 'cat heart eyes',
  '🙈': 'see no evil monkey', '🙉': 'hear no evil monkey', '🙊': 'speak no evil monkey',
  '💌': 'love letter', '💘': 'heart arrow cupid', '💝': 'heart ribbon gift',
  '❤️': 'red heart love', '🧡': 'orange heart', '💛': 'yellow heart', '💚': 'green heart',
  '💙': 'blue heart', '💜': 'purple heart', '🖤': 'black heart', '🤍': 'white heart',
  '🤎': 'brown heart', '💔': 'broken heart', '❤️‍🔥': 'heart fire burning',
  '💕': 'two hearts', '💞': 'revolving hearts', '💓': 'beating heart', '💗': 'growing heart',
  '💖': 'sparkling heart', '💘': 'heart arrow', '💯': 'hundred perfect score',
  '💥': 'boom collision explode', '💫': 'dizzy star', '💦': 'sweat droplets water',
  '💨': 'dash wind', '🕳️': 'hole', '💬': 'speech balloon comment', '💭': 'thought balloon',
  '👋': 'wave hello hi bye', '🤚': 'raised back hand', '🖐️': 'hand fingers splayed',
  '✋': 'raised hand stop', '🖖': 'vulcan spock', '👌': 'ok hand perfect', '🤌': 'pinched fingers',
  '🤏': 'pinch small', '✌️': 'victory peace', '🤞': 'crossed fingers luck', '🤟': 'love you gesture',
  '🤘': 'horns rock', '🤙': 'call me shaka', '👈': 'point left', '👉': 'point right',
  '👆': 'point up', '👇': 'point down', '☝️': 'index up', '👍': 'thumbs up like yes approve',
  '👎': 'thumbs down dislike no', '✊': 'fist raised', '👊': 'fist bump punch',
  '👏': 'clap applause', '🙌': 'raising hands celebrate praise', '👐': 'open hands',
  '🤲': 'palms up together pray', '🤝': 'handshake deal agree', '🙏': 'pray thanks please',
  '✍️': 'writing hand', '💅': 'nail polish', '💪': 'muscle flex strong', '🦾': 'mechanical arm',
  '🧠': 'brain', '👀': 'eyes look watch', '👁️': 'eye', '👄': 'mouth lips',
  '👶': 'baby', '🧒': 'child', '👦': 'boy', '👧': 'girl', '🧑': 'person', '👨': 'man',
  '👩': 'woman', '🧓': 'older person', '👴': 'old man', '👵': 'old woman',
  '👨‍💻': 'developer programmer man coding', '👩‍💻': 'developer programmer woman coding',
  '🧑‍💻': 'developer programmer coding', '🦸': 'superhero', '🥷': 'ninja',
  '🐶': 'dog puppy', '🐱': 'cat kitten', '🐭': 'mouse', '🐹': 'hamster', '🐰': 'rabbit bunny',
  '🦊': 'fox', '🐻': 'bear', '🐼': 'panda', '🐨': 'koala', '🐯': 'tiger', '🦁': 'lion',
  '🐮': 'cow', '🐷': 'pig', '🐸': 'frog', '🐵': 'monkey', '🐔': 'chicken', '🐧': 'penguin',
  '🐦': 'bird', '🦆': 'duck', '🦅': 'eagle', '🦉': 'owl', '🐺': 'wolf', '🐗': 'boar',
  '🐴': 'horse', '🦄': 'unicorn', '🐝': 'bee honey', '🐛': 'bug caterpillar',
  '🦋': 'butterfly', '🐌': 'snail', '🐞': 'ladybug bug', '🐜': 'ant', '🕷️': 'spider',
  '🐢': 'turtle', '🐍': 'snake', '🦎': 'lizard', '🐙': 'octopus', '🦑': 'squid',
  '🦐': 'shrimp', '🦀': 'crab', '🐡': 'blowfish', '🐠': 'tropical fish', '🐟': 'fish',
  '🐬': 'dolphin', '🐳': 'whale', '🦈': 'shark', '🐊': 'crocodile', '🐅': 'tiger',
  '🦓': 'zebra', '🦍': 'gorilla', '🐘': 'elephant', '🦏': 'rhino', '🐪': 'camel',
  '🦒': 'giraffe', '🐃': 'buffalo', '🐄': 'cow', '🐎': 'racehorse', '🐖': 'pig',
  '🐑': 'sheep', '🐐': 'goat', '🦌': 'deer', '🐕': 'dog', '🐩': 'poodle', '🐈': 'cat',
  '🐓': 'rooster', '🦃': 'turkey', '🕊️': 'dove peace', '🐇': 'rabbit', '🐿️': 'chipmunk',
  '🦔': 'hedgehog', '🐾': 'paw prints', '🌵': 'cactus', '🎄': 'christmas tree',
  '🌲': 'evergreen tree', '🌳': 'tree', '🌴': 'palm tree', '🌱': 'seedling plant',
  '🌿': 'herb leaves', '☘️': 'shamrock', '🍀': 'four leaf clover luck', '🍁': 'maple leaf',
  '🍂': 'fallen leaves autumn', '🍃': 'leaf wind', '🍄': 'mushroom', '🌷': 'tulip flower',
  '🌹': 'rose flower', '🌺': 'hibiscus', '🌸': 'cherry blossom sakura', '🌼': 'blossom flower',
  '🌻': 'sunflower', '🌞': 'sun face', '🌝': 'full moon face', '🌛': 'moon face',
  '🌜': 'moon face', '🌚': 'new moon face', '🌕': 'full moon', '🌖': 'moon',
  '🌙': 'crescent moon', '⭐': 'star', '🌟': 'glowing star', '✨': 'sparkles magic',
  '⚡': 'zap lightning fast', '🔥': 'fire hot lit flame', '💥': 'boom', '☄️': 'comet',
  '🌈': 'rainbow', '☀️': 'sun sunny', '⛅': 'partly cloudy', '☁️': 'cloud',
  '🌧️': 'rain', '⛈️': 'storm thunder', '❄️': 'snowflake cold', '⛄': 'snowman',
  '🌊': 'wave ocean water', '💧': 'droplet water', '🍏': 'green apple', '🍎': 'apple red',
  '🍐': 'pear', '🍊': 'orange tangerine', '🍋': 'lemon', '🍌': 'banana', '🍉': 'watermelon',
  '🍇': 'grapes', '🍓': 'strawberry', '🫐': 'blueberries', '🍈': 'melon', '🍒': 'cherries',
  '🍑': 'peach', '🥭': 'mango', '🍍': 'pineapple', '🥥': 'coconut', '🥝': 'kiwi',
  '🍅': 'tomato', '🍆': 'eggplant aubergine', '🥑': 'avocado', '🥦': 'broccoli',
  '🥬': 'leafy green', '🥒': 'cucumber', '🌶️': 'hot pepper spicy', '🌽': 'corn',
  '🥕': 'carrot', '🧄': 'garlic', '🧅': 'onion', '🥔': 'potato', '🍠': 'sweet potato',
  '🥐': 'croissant', '🥖': 'baguette bread', '🍞': 'bread', '🥨': 'pretzel',
  '🧀': 'cheese', '🥚': 'egg', '🍳': 'cooking fried egg', '🥞': 'pancakes',
  '🥓': 'bacon', '🍔': 'burger hamburger', '🍟': 'fries chips', '🍕': 'pizza',
  '🌭': 'hot dog', '🥪': 'sandwich', '🌮': 'taco', '🌯': 'burrito', '🥗': 'salad',
  '🍝': 'spaghetti pasta', '🍜': 'ramen noodles', '🍲': 'stew pot', '🍛': 'curry rice',
  '🍣': 'sushi', '🍱': 'bento', '🥟': 'dumpling', '🍤': 'fried shrimp', '🍙': 'rice ball',
  '🍚': 'rice', '🍥': 'fish cake', '🥮': 'moon cake', '🍢': 'oden', '🍡': 'dango',
  '🍦': 'ice cream soft serve', '🍧': 'shaved ice', '🍨': 'ice cream', '🍩': 'doughnut',
  '🍪': 'cookie biscuit', '🎂': 'birthday cake', '🍰': 'cake slice', '🧁': 'cupcake',
  '🥧': 'pie', '🍫': 'chocolate', '🍬': 'candy sweet', '🍭': 'lollipop', '🍮': 'custard',
  '🍯': 'honey', '🍼': 'baby bottle', '🥛': 'milk', '☕': 'coffee tea hot drink',
  '🍵': 'tea green', '🧃': 'juice box', '🥤': 'cup straw soda', '🍺': 'beer',
  '🍻': 'cheers beers', '🥂': 'clinking glasses champagne celebrate', '🍷': 'wine',
  '🥃': 'whisky tumbler', '🍸': 'cocktail martini', '🍹': 'tropical drink',
  '🍾': 'champagne bottle celebrate', '🧊': 'ice cube',
  '⚽': 'soccer football', '🏀': 'basketball', '🏈': 'american football', '⚾': 'baseball',
  '🎾': 'tennis', '🏐': 'volleyball', '🏉': 'rugby', '🎱': 'pool billiards 8 ball',
  '🏓': 'ping pong table tennis', '🏸': 'badminton', '🥅': 'goal net', '⛳': 'golf',
  '🏹': 'bow arrow archery', '🎣': 'fishing', '🥊': 'boxing glove', '🥋': 'martial arts',
  '⛸️': 'ice skate', '🎿': 'ski', '🛹': 'skateboard', '🏆': 'trophy win first',
  '🥇': 'gold medal first', '🥈': 'silver medal second', '🥉': 'bronze medal third',
  '🏅': 'medal', '🎖️': 'military medal', '🎯': 'dart bullseye target', '🎲': 'dice game',
  '🎮': 'video game controller', '🕹️': 'joystick', '🎰': 'slot machine', '🧩': 'puzzle piece',
  '🎨': 'art palette paint', '🎭': 'theater masks', '🎤': 'microphone sing',
  '🎧': 'headphones', '🎵': 'music note', '🎶': 'music notes', '🎸': 'guitar',
  '🎹': 'piano keyboard', '🥁': 'drum', '🎺': 'trumpet', '🎻': 'violin',
  '🚗': 'car auto', '🚕': 'taxi', '🚌': 'bus', '🚎': 'trolleybus', '🏎️': 'racing car',
  '🚓': 'police car', '🚑': 'ambulance', '🚒': 'fire engine', '🚐': 'minibus van',
  '🚚': 'truck delivery', '🚛': 'lorry truck', '🚜': 'tractor', '🏍️': 'motorcycle',
  '🛵': 'scooter', '🚲': 'bicycle bike', '🛴': 'kick scooter', '🚨': 'siren police alert',
  '🚔': 'police car', '🚍': 'bus', '✈️': 'airplane flight', '🛫': 'takeoff',
  '🛬': 'landing', '🚀': 'rocket launch ship fast', '🛸': 'ufo flying saucer',
  '🚁': 'helicopter', '⛵': 'sailboat', '🚤': 'speedboat', '🛳️': 'passenger ship',
  '🚢': 'ship', '🚂': 'locomotive train', '🚆': 'train', '🚇': 'metro subway',
  '🚊': 'tram', '🚉': 'station', '🗺️': 'world map', '🗿': 'moai statue',
  '🗽': 'statue of liberty', '🗼': 'tokyo tower', '🏰': 'castle', '🏯': 'japanese castle',
  '🏟️': 'stadium', '🎡': 'ferris wheel', '🎢': 'roller coaster', '🎠': 'carousel',
  '⛲': 'fountain', '⛱️': 'umbrella beach', '🏖️': 'beach', '🏝️': 'desert island',
  '🏔️': 'snow mountain', '⛰️': 'mountain', '🌋': 'volcano', '🏕️': 'camping',
  '🏠': 'house home', '🏡': 'house garden', '🏢': 'office building', '🏥': 'hospital',
  '🏦': 'bank', '🏨': 'hotel', '🏪': 'convenience store', '🏫': 'school',
  '🏬': 'department store', '🏭': 'factory', '🏛️': 'classical building',
  '⛪': 'church', '🕌': 'mosque', '🕍': 'synagogue', '🛕': 'hindu temple',
  '🌆': 'cityscape dusk', '🌃': 'night stars city', '🌉': 'bridge night',
  '⌚': 'watch', '📱': 'mobile phone smartphone', '💻': 'laptop computer',
  '⌨️': 'keyboard', '🖥️': 'desktop computer monitor', '🖨️': 'printer',
  '🖱️': 'mouse computer', '💽': 'minidisc', '💾': 'floppy disk save', '💿': 'cd',
  '📀': 'dvd', '📷': 'camera photo', '📸': 'camera flash', '📹': 'video camera',
  '🎥': 'movie camera', '📽️': 'projector film', '🎞️': 'film frames', '📞': 'telephone',
  '☎️': 'telephone', '📟': 'pager', '📠': 'fax', '📺': 'television tv', '📻': 'radio',
  '🎙️': 'studio microphone podcast', '⏱️': 'stopwatch', '⏰': 'alarm clock',
  '🕰️': 'mantelpiece clock', '⏳': 'hourglass time', '⌛': 'hourglass done',
  '🔋': 'battery', '🔌': 'plug electric', '💡': 'light bulb idea', '🔦': 'flashlight torch',
  '🕯️': 'candle', '🧯': 'fire extinguisher', '🛢️': 'oil drum', '💸': 'money wings',
  '💵': 'dollar money', '💴': 'yen', '💶': 'euro', '💷': 'pound', '💰': 'money bag',
  '💳': 'credit card', '🧾': 'receipt', '💎': 'gem diamond', '⚖️': 'balance scale justice',
  '🧰': 'toolbox', '🔧': 'wrench spanner', '🔨': 'hammer', '⚒️': 'hammer pick',
  '🛠️': 'hammer wrench tools', '⛏️': 'pick', '🔩': 'nut bolt', '⚙️': 'gear settings cog',
  '🧲': 'magnet', '🔫': 'water pistol', '💣': 'bomb', '🧨': 'firecracker', '🪓': 'axe',
  '🔪': 'knife', '🗡️': 'dagger', '⚔️': 'crossed swords', '🛡️': 'shield protect',
  '🚬': 'cigarette', '⚰️': 'coffin', '🏺': 'amphora', '🔮': 'crystal ball',
  '📿': 'prayer beads', '💈': 'barber pole', '⚗️': 'alembic chemistry', '🔭': 'telescope',
  '🔬': 'microscope science', '🕳️': 'hole', '💊': 'pill medicine', '💉': 'syringe injection',
  '🩸': 'blood drop', '🩹': 'adhesive bandage plaster', '🩺': 'stethoscope',
  '🚪': 'door', '🛗': 'elevator lift', '🪑': 'chair', '🚽': 'toilet', '🚿': 'shower',
  '🛁': 'bathtub', '🧴': 'lotion bottle', '🧷': 'safety pin', '🧹': 'broom',
  '🧺': 'basket', '🧻': 'toilet paper roll', '🧼': 'soap', '🧽': 'sponge',
  '🔑': 'key', '🗝️': 'old key', '🔒': 'lock closed secure', '🔓': 'lock open unlocked',
  '🔐': 'lock key secure', '🔏': 'lock pen', '📝': 'memo note write', '✏️': 'pencil',
  '🖊️': 'pen', '🖋️': 'fountain pen', '🖌️': 'paintbrush', '🖍️': 'crayon',
  '📋': 'clipboard', '📁': 'folder', '📂': 'open folder', '🗂️': 'card index dividers',
  '📅': 'calendar date', '📆': 'calendar', '🗓️': 'spiral calendar', '📇': 'card index',
  '📈': 'chart increasing up growth', '📉': 'chart decreasing down loss',
  '📊': 'bar chart stats', '📋': 'clipboard', '📌': 'pushpin', '📍': 'round pushpin location',
  '📎': 'paperclip attach', '🖇️': 'linked paperclips', '📏': 'ruler', '📐': 'triangular ruler',
  '✂️': 'scissors cut', '🗃️': 'card file box', '🗄️': 'file cabinet', '🗑️': 'wastebasket delete trash',
  '📦': 'package box parcel', '📫': 'mailbox', '📮': 'postbox', '✉️': 'envelope email mail',
  '📧': 'e-mail', '📨': 'incoming envelope', '📩': 'envelope arrow', '📤': 'outbox tray',
  '📥': 'inbox tray', '📜': 'scroll', '📃': 'page curl', '📄': 'page document',
  '📑': 'bookmark tabs', '📓': 'notebook', '📔': 'notebook decorative', '📒': 'ledger',
  '📕': 'closed book', '📖': 'open book read', '📗': 'green book', '📘': 'blue book',
  '📙': 'orange book', '📚': 'books library', '🔖': 'bookmark', '🏷️': 'label tag',
  '🔍': 'search magnifying glass find', '🔎': 'search magnifying glass',
  '🔗': 'link chain', '⛓️': 'chains', '📢': 'loudspeaker announce', '📣': 'megaphone cheer',
  '📯': 'postal horn', '🔔': 'bell notification', '🔕': 'bell slash muted',
  '✅': 'check mark done complete yes', '☑️': 'ballot box check', '✔️': 'check mark',
  '❌': 'cross mark no wrong x', '❎': 'cross mark button', '➕': 'plus add',
  '➖': 'minus subtract', '➗': 'divide', '✖️': 'multiply', '♾️': 'infinity',
  '❓': 'question mark', '❔': 'white question', '❗': 'exclamation mark',
  '❕': 'white exclamation', '‼️': 'double exclamation', '⁉️': 'exclamation question',
  '⚠️': 'warning caution alert', '🚫': 'prohibited no forbidden', '⛔': 'no entry',
  '🔞': 'no one under eighteen', '☢️': 'radioactive', '☣️': 'biohazard',
  '⬆️': 'up arrow', '⬇️': 'down arrow', '⬅️': 'left arrow', '➡️': 'right arrow',
  '🔄': 'refresh sync arrows', '🔃': 'clockwise arrows', '🔀': 'shuffle',
  '🔁': 'repeat loop', '🔂': 'repeat one', '▶️': 'play', '⏸️': 'pause',
  '⏹️': 'stop', '⏺️': 'record', '⏭️': 'next track', '⏮️': 'previous track',
  '⏩': 'fast forward', '⏪': 'rewind', '🔼': 'up button', '🔽': 'down button',
  '🎦': 'cinema', '🔅': 'dim brightness', '🔆': 'bright brightness',
  '📶': 'signal bars wifi', '📳': 'vibration mode', '📴': 'mobile off',
  '♻️': 'recycle', '⚜️': 'fleur de lis', '🔱': 'trident', '📛': 'name badge',
  '🔰': 'japanese symbol beginner', '⭕': 'hollow red circle', '💠': 'diamond dot',
  '🌐': 'globe web internet meridians', '💤': 'zzz sleep',
  '🏳️': 'white flag', '🏴': 'black flag', '🏁': 'chequered flag finish race',
  '🚩': 'triangular flag', '🏳️‍🌈': 'rainbow flag pride', '🏴‍☠️': 'pirate flag',
  '🕐': 'clock one', '🕑': 'clock two', '🕒': 'clock three',
  '🅰️': 'a button blood', '🅱️': 'b button blood', '🆎': 'ab button', '🆑': 'cl button',
  '🆒': 'cool button', '🆓': 'free button', 'ℹ️': 'information', '🆔': 'id button',
  '🆕': 'new button', '🆖': 'ng button', '🅾️': 'o button', '🆗': 'ok button',
  '🆘': 'sos help emergency', '🆙': 'up button', '🆚': 'vs versus',
}

build()
