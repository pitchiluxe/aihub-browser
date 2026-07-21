import { getBooks, getBook, refKey, type Verse } from './bibleService'

// Offline scripture retrieval.
//
// The assistant must never be asked to recall verses from memory — that is how
// a Bible app ends up quoting text that does not exist. Instead every question
// is answered from verses actually retrieved out of the bundled World English
// Bible, and the model is only allowed to reason over what it is handed.
//
// The index is a plain inverted index scored with BM25. Over 31,103 verses it
// builds in a couple of seconds and costs a few MB, so it is built once, lazily,
// the first time the reader asks something.

export interface Hit {
  ref: string          // BOOK.CHAPTER.VERSE
  book: string         // display name, e.g. "John"
  bookId: string
  chapter: number
  verse: number
  text: string
  score: number
}

interface Entry { ref: string; bookId: string; book: string; chapter: number; verse: number; text: string; len: number }

// Words carrying no retrieval signal. Deliberately small: "love", "fear" and
// "give" are content words here even though a generic English stop list would
// sometimes drop them.
const STOP = new Set([
  'the', 'and', 'of', 'to', 'a', 'in', 'that', 'is', 'was', 'he', 'for', 'it', 'with', 'as', 'his',
  'on', 'be', 'at', 'by', 'i', 'this', 'had', 'not', 'are', 'but', 'from', 'or', 'have', 'an',
  'they', 'you', 'were', 'their', 'which', 'we', 'there', 'been', 'has', 'will', 'would', 'what',
  'all', 'if', 'so', 'no', 'when', 'them', 'him', 'her', 'she', 'my', 'me', 'your', 'our', 'us',
  'said', 'unto', 'shall', 'thou', 'thee', 'thy', 'about', 'does', 'do', 'did', 'tell', 'show',
  'find', 'verse', 'verses', 'bible', 'scripture', 'say', 'says', 'any', 'some', 'who', 'how',
])

// Light suffix folding so "giving"/"gives"/"gave" collide with "give". A real
// stemmer would be better; this is deliberately conservative to avoid merging
// words that matter theologically.
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('eth')) return w.slice(0, -3)
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z']+/g) || [])
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(stem)
}

let entries: Entry[] | null = null
let postings: Map<string, number[]> | null = null
let avgLen = 1
let building: Promise<void> | null = null

export function isReady(): boolean { return entries !== null }

// Build once. Concurrent callers share the same promise rather than each
// parsing 66 books.
export function buildIndex(onProgress?: (done: number, total: number) => void): Promise<void> {
  if (entries) return Promise.resolve()
  if (building) return building
  building = (async () => {
    const books = getBooks()
    const acc: Entry[] = []
    const post = new Map<string, number[]>()
    let total = 0
    for (let b = 0; b < books.length; b++) {
      const meta = books[b]
      const book = await getBook(meta.id)
      book.chapters.forEach((verses: Verse[], ci: number) => {
        verses.forEach(v => {
          if (!v.t.trim()) return          // the five manuscript-omission placeholders
          const toks = tokenize(v.t)
          const i = acc.length
          acc.push({
            ref: refKey(meta.id, ci + 1, v.v), bookId: meta.id, book: meta.name,
            chapter: ci + 1, verse: v.v, text: v.t, len: toks.length,
          })
          total += toks.length
          // Postings are per-verse, deduped: BM25 uses term frequency, which we
          // recover by counting repeats in the same verse.
          for (const t of toks) {
            const list = post.get(t)
            if (list) list.push(i)
            else post.set(t, [i])
          }
        })
      })
      onProgress?.(b + 1, books.length)
    }
    entries = acc
    postings = post
    avgLen = total / Math.max(1, acc.length)
  })()
  return building
}

const K1 = 1.5
const B = 0.75

// BM25 over the verse collection, with a coordination bonus.
//
// Plain BM25 answers "find verses about money" with every narrative mention of
// the word — "we have brought down other money in our hand to buy food" — and
// misses the passages that actually teach about it. Verses matching several
// distinct query terms are far more likely to be topically about the subject
// than verses matching one term repeatedly, so matching breadth is rewarded
// explicitly. Feed this an expanded query (see expandQuery) for best results.
export function search(query: string, limit = 12): Hit[] {
  if (!entries || !postings) return []
  const terms = [...new Set(tokenize(query))]
  if (!terms.length) return []
  const N = entries.length
  const scores = new Map<number, number>()
  const matched = new Map<number, number>()   // distinct query terms per verse

  for (const term of terms) {
    const list = postings.get(term)
    if (!list || !list.length) continue
    // Document frequency = distinct verses containing the term.
    const freq = new Map<number, number>()
    for (const i of list) freq.set(i, (freq.get(i) ?? 0) + 1)
    const df = freq.size
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
    for (const [i, tf] of freq) {
      const len = entries[i].len || 1
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (len / avgLen)))
      scores.set(i, (scores.get(i) ?? 0) + idf * norm)
      matched.set(i, (matched.get(i) ?? 0) + 1)
    }
  }

  return [...scores.entries()]
    .map(([i, s]) => {
      // Up to a 1.8x lift for a verse touching many distinct query terms.
      const coord = 1 + 0.8 * ((matched.get(i) ?? 1) - 1) / Math.max(1, terms.length - 1)
      return [i, s * coord] as const
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([i, score]) => {
      const e = entries![i]
      return { ref: e.ref, book: e.book, bookId: e.bookId, chapter: e.chapter, verse: e.verse, text: e.text, score }
    })
}

// Turn a question into the vocabulary scripture actually uses.
//
// A reader asks about "money"; the verses that TEACH about it say mammon,
// riches, treasure, covet, gain. Searching the bare word returns every ledger
// entry in Kings and none of the Sermon on the Mount.
//
// This is a lexicon rather than a model call on purpose: an extra round trip
// to a local model doubled the wait to over two minutes on ordinary hardware,
// and a reader asking a question will not sit through that. Lookup is instant
// and deterministic. Topics not covered here still work — they fall through to
// the plain query, which is exactly what would have happened anyway.
const TOPICS: Record<string, string> = {
  money: 'mammon riches rich wealth wealthy treasure covet covetousness greed gain silver gold poor poverty generous generosity give giving lend debt profit possessions',
  wealth: 'mammon riches rich treasure covet greed gain gold silver possessions poor generous',
  greed: 'covet covetousness mammon riches gain greedy envy possessions treasure',
  fear: 'afraid fear feareth dread terror courage strong brave dismayed trouble anxious refuge',
  anxiety: 'anxious worry careful troubled fear peace rest burden cast care',
  worry: 'anxious careful troubled fear peace rest burden care tomorrow',
  forgiveness: 'forgive forgiven forgiveth pardon mercy merciful trespass sin debtor reconcile repent',
  love: 'love loveth charity beloved kindness compassion neighbour brother enemy',
  marriage: 'wife husband marry married wedding cleave adultery divorce bride bridegroom',
  anger: 'wrath angry anger fury rage slow patient provoke bitterness strife',
  pride: 'proud pride haughty humble humility lowly boast arrogant exalt abase',
  humility: 'humble lowly meek submit exalt proud servant',
  faith: 'faith believe believeth trust doubt assurance hope faithful',
  hope: 'hope trust wait patience expectation promise',
  suffering: 'affliction suffer tribulation trouble persecuted endure patience comfort trial',
  grief: 'mourn mourning weep sorrow tears comfort lament grief heavy',
  death: 'die died death grave dust resurrection perish everlasting mortal',
  healing: 'heal healed healeth sick sickness whole physician restore infirmity',
  prayer: 'pray prayer supplication ask seek knock intercession petition',
  wisdom: 'wisdom wise understanding knowledge prudent instruction folly fool discern counsel',
  work: 'labour work diligent slothful sluggard hands toil hire wages servant',
  temptation: 'tempt tempted temptation lust flesh sin snare endure',
  enemies: 'enemy enemies persecute hate bless curse revenge vengeance',
  patience: 'patience patient longsuffering endure wait temperance',
  generosity: 'give giving generous alms poor needy bountiful cheerful lend',
  justice: 'justice just judgment righteous oppress widow fatherless stranger equity',
  peace: 'peace peaceable quiet rest reconcile strife war',
  salvation: 'saved salvation save redeem redeemer grace born everlasting believe',
  sin: 'sin sinned iniquity transgression trespass wicked guilt repent confess',
  grace: 'grace mercy favour gift undeserved kindness',
  children: 'children child son daughter father mother train instruct discipline honour',
  friendship: 'friend friends companion brother neighbour counsel faithful',
  loneliness: 'alone forsaken lonely desolate comfort presence forsake',
  purpose: 'purpose called calling ordained plan counsel work appointed',
  addiction: 'drunk drunkenness wine strong bondage servant free lust flesh',
  gossip: 'talebearer slander tongue whisperer backbiting babbler words strife',
  honesty: 'truth lie lying deceit false witness honest sincere just weights',
  thankfulness: 'thanks thanksgiving praise bless rejoice glad grateful',
}

// People do not ask using the lexicon's own key words — nobody types "fear",
// they type "afraid" or "scared". These route everyday phrasing to a topic.
const ALIASES: Record<string, string> = {
  afraid: 'fear', scared: 'fear', terrified: 'fear', frightened: 'fear', courage: 'fear',
  anxious: 'anxiety', worried: 'worry', stress: 'anxiety', stressed: 'anxiety', panic: 'anxiety',
  forgive: 'forgiveness', forgiving: 'forgiveness', forgiven: 'forgiveness', mercy: 'forgiveness',
  rich: 'money', riches: 'money', wealthy: 'money', finances: 'money', financial: 'money',
  debt: 'money', tithe: 'generosity', tithing: 'generosity', giving: 'generosity', charity: 'generosity',
  angry: 'anger', rage: 'anger', temper: 'anger', bitterness: 'anger',
  proud: 'pride', arrogant: 'pride', humble: 'humility',
  married: 'marriage', wife: 'marriage', husband: 'marriage', divorce: 'marriage', spouse: 'marriage',
  sad: 'grief', depressed: 'grief', depression: 'grief', mourning: 'grief', sorrow: 'grief',
  grieving: 'grief', dying: 'death', died: 'death', funeral: 'death', heaven: 'salvation',
  sick: 'healing', illness: 'healing', disease: 'healing', ill: 'healing',
  praying: 'prayer', pray: 'prayer', job: 'work', career: 'work', lazy: 'work', employment: 'work',
  tempted: 'temptation', lust: 'temptation', addicted: 'addiction', alcohol: 'addiction',
  drinking: 'addiction', enemy: 'enemies', revenge: 'enemies', hate: 'enemies',
  waiting: 'patience', wait: 'patience', suffer: 'suffering', pain: 'suffering', trials: 'suffering',
  lonely: 'loneliness', alone: 'loneliness', friend: 'friendship', friends: 'friendship',
  lying: 'honesty', truth: 'honesty', honest: 'honesty', liar: 'honesty',
  gossiping: 'gossip', slander: 'gossip', parenting: 'children', kids: 'children', son: 'children',
  daughter: 'children', thankful: 'thankfulness', grateful: 'thankfulness', gratitude: 'thankfulness',
  doubt: 'faith', believe: 'faith', trust: 'faith', saved: 'salvation', forgiveness_of_sins: 'salvation',
  guilt: 'sin', guilty: 'sin', shame: 'sin', repent: 'sin', calling: 'purpose', meaning: 'purpose',
}

export function expandQuery(question: string): string {
  const q = question.toLowerCase()
  const topics = new Set<string>()

  for (const topic of Object.keys(TOPICS)) {
    if (q.includes(topic)) topics.add(topic)
  }
  // Alias and stem passes catch the words people actually use.
  for (const t of tokenize(q)) {
    if (TOPICS[t]) topics.add(t)
    const alias = ALIASES[t]
    if (alias && TOPICS[alias]) topics.add(alias)
  }
  for (const [word, topic] of Object.entries(ALIASES)) {
    if (q.includes(word) && TOPICS[topic]) topics.add(topic)
  }

  const extras = [...topics].map(t => TOPICS[t])
  return extras.length ? `${question} ${extras.join(' ')}` : question
}

// Exact-reference lookup, so "what does John 3:16 say" resolves directly
// instead of going through the scorer.
export function lookup(bookId: string, chapter: number, verse: number): Hit | null {
  if (!entries) return null
  const key = refKey(bookId, chapter, verse)
  const e = entries.find(x => x.ref === key)
  if (!e) return null
  return { ref: e.ref, book: e.book, bookId: e.bookId, chapter: e.chapter, verse: e.verse, text: e.text, score: 1 }
}

// The verses immediately around a reference, for "explain this verse" so the
// model sees the passage rather than an isolated line.
export function context(bookId: string, chapter: number, verse: number, span = 4): Hit[] {
  if (!entries) return []
  return entries
    .filter(e => e.bookId === bookId && e.chapter === chapter && Math.abs(e.verse - verse) <= span)
    .sort((a, b) => a.verse - b.verse)
    .map(e => ({ ref: e.ref, book: e.book, bookId: e.bookId, chapter: e.chapter, verse: e.verse, text: e.text, score: 1 }))
}
