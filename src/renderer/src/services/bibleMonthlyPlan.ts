// The reading of the month.
//
// Every calendar month carries one theme, one verse to carry through it, and a
// stretch of scripture spread across its days — Genesis for January's new
// start, Proverbs for May's thirty-one days, the psalms of thanksgiving for
// November, Isaiah's promises landing on Luke 2 on Christmas Day.
//
// Like the verse of the day, it is deterministic from the date alone: no
// network, no model, nothing stored that can drift from the clock. The
// chapters are curated; only their spread across the days is computed, so a
// leap-year February or a thirty-day month still lands every chapter exactly
// once and never leaves a day empty.

import { getBookMeta } from './bibleService'
import type { Passage } from './bibleCourses'
import { MONTH_WORDS_FR } from './bibleMonthlyPlanFr'

/** A run of whole chapters of one book, inclusive. */
export interface ChapterRun { bookId: string; from: number; to: number }

export interface MonthTheme {
  /** 1–12. */
  month: number
  title: string
  tagline: string
  /** The verse to carry through the month — one or a few consecutive refs. */
  verses: string[]
  /** Why this reading, this month. Read once, at the top of the month. */
  intro: string
  /** One encouragement per week; week five covers the 29th onward. */
  weeks: [string, string, string, string, string]
  readings: ChapterRun[]
}

export interface MonthDay {
  /** Day of the month, 1-based. */
  date: number
  /** "Genesis 1–2" — the whole day's reading in one line. */
  label: string
  passages: Passage[]
  /** The week's encouragement, repeated on each of its days. */
  focus: string
}

export interface MonthPlan {
  /** Progress key — one per calendar month, so November 2026 and November
   *  2027 are tracked separately. */
  id: string
  year: number
  month: number
  theme: MonthTheme
  days: MonthDay[]
}

const run = (bookId: string, from: number, to = from): ChapterRun => ({ bookId, from, to })

export const MONTH_THEMES: MonthTheme[] = [
  {
    month: 1,
    title: 'In the Beginning',
    tagline: 'A new year, read from the first page',
    verses: ['ISA.43.19'],
    intro: 'Every story God tells begins with a word spoken over emptiness — and light answers. Start the year where scripture starts: creation, a promise to Abraham, a dreamer sold into Egypt who lives to say "you meant it for evil, but God meant it for good." Whatever this year holds, it is not the first beginning God has handled.',
    weeks: [
      'Light before the sun. Whatever is formless in your life is not beyond his voice.',
      'Abraham walks without a map. Faith is the next step, not the whole road.',
      'Jacob wrestles and limps away blessed. God is not afraid of your questions.',
      'Joseph in the pit and in the prison — and never once out of God\'s sight.',
      'The last pages of Genesis: what was meant for harm, turned for good.',
    ],
    readings: [run('GEN', 1, 50)],
  },
  {
    month: 2,
    title: 'Loved First',
    tagline: 'The month of love, from the One who invented it',
    verses: ['1JN.4.19'],
    intro: 'Before you loved anyone, you were loved. February reads the love stories of scripture — Ruth\'s loyalty, Hosea\'s stubborn faithfulness, the prodigal\'s father running down the road — and ends in the letters of John, who leaned on Jesus\' chest and spent his old age saying one thing: love one another.',
    weeks: [
      'Ruth chooses a people and a God. Loyal love is a decision before it is a feeling.',
      'Hosea keeps buying back a wife who keeps leaving. That is how God loves you.',
      'The upper room: Jesus washes feet, then calls them friends.',
      'Rooted and grounded in love — wider, longer, higher, deeper than you know.',
      'One more day this year — spend it resting in being loved.',
    ],
    readings: [
      run('RUT', 1, 4), run('HOS', 1, 3), run('LUK', 15), run('JHN', 13, 17),
      run('1CO', 13), run('ROM', 8), run('EPH', 1, 6), run('PSA', 136),
      run('1JN', 1, 5), run('2JN', 1), run('3JN', 1),
    ],
  },
  {
    month: 3,
    title: 'Return to Me',
    tagline: 'A season of turning around',
    verses: ['JOL.2.13'],
    intro: 'Tear your heart, not your clothes. March is a month for coming home — through Joel\'s call to return, Jonah\'s reluctant mercy and Luke\'s gospel of the lost being found. Repentance is not a punishment; it is the road back to a Father who has been watching it.',
    weeks: [
      'Joel: even now, return. It is never too late to turn around.',
      'Jonah runs; God follows. You cannot outrun mercy.',
      'In Luke, Jesus eats with the people everyone else avoided.',
      'The lost sheep, the lost coin, the lost son — and the joy when they are found.',
      'Jerusalem, the cross and an empty tomb. The way home is open.',
    ],
    readings: [run('JOL', 1, 3), run('JON', 1, 4), run('LUK', 1, 24)],
  },
  {
    month: 4,
    title: 'Alive Again',
    tagline: 'Resurrection, and what it changes',
    verses: ['1PE.1.3'],
    intro: 'The tomb is empty, and so everything is different. April walks with John from the first light of creation to breakfast on the beach with the risen Christ, then reads what the apostles wrote once they understood: we are born again into a living hope.',
    weeks: [
      'In the beginning was the Word — and the Word came near.',
      'Living water, bread of life, light of the world. He is what you are hungry for.',
      'The good shepherd lays his life down; Lazarus walks out of his grave.',
      'Morning by the sea: the risen Lord cooks breakfast for the friend who denied him.',
      'Dead to sin, alive to God. Live like someone who has been raised.',
    ],
    readings: [
      run('JHN', 1, 21), run('1CO', 15), run('ROM', 6), run('EPH', 2),
      run('COL', 3), run('1PE', 1, 5),
    ],
  },
  {
    month: 5,
    title: 'Wisdom for Every Day',
    tagline: 'One proverb chapter for each day of May',
    verses: ['PRO.3.5', 'PRO.3.6'],
    intro: 'Proverbs has thirty-one chapters and May has thirty-one days. Read today\'s date. These are not lofty theories; they are words for the kitchen, the office, the market and the argument — the fear of the LORD worked out in ordinary life.',
    weeks: [
      'Wisdom calls out in the street. She is not hiding — she is waiting to be asked.',
      'Guard your heart, for everything you do flows from it.',
      'A gentle answer turns away wrath. Watch your words this week.',
      'Iron sharpens iron. Who sharpens you — and whom do you sharpen?',
      'Strength and dignity are her clothing; she laughs at the days to come.',
    ],
    readings: [run('PRO', 1, 31)],
  },
  {
    month: 6,
    title: 'Fire and Wind',
    tagline: 'The Spirit poured out on ordinary people',
    verses: ['ACT.1.8'],
    intro: 'Fishermen and tax collectors, filled with the Spirit, turned the world upside down. June reads the Acts of the Apostles — Pentecost, prison doors swinging open, the gospel crossing every border — and closes in Romans 8 and Galatians 5, where the same Spirit lives in you.',
    weeks: [
      'Wind and fire at Pentecost. The promise is for you and for your children.',
      'Stephen sees heaven open. Courage is a gift of the Spirit, not a personality type.',
      'Saul is stopped on the road. Nobody is too far gone.',
      'Paul and Silas sing at midnight in chains — and the doors open.',
      'No condemnation, and nothing can separate you. Walk by the Spirit.',
    ],
    readings: [run('ACT', 1, 28), run('ROM', 8), run('GAL', 5)],
  },
  {
    month: 7,
    title: 'Set Free',
    tagline: 'The great story of freedom',
    verses: ['GAL.5.1'],
    intro: 'Israel cried out under the whip, and God heard. July follows the exodus — the burning bush, the plagues, the sea standing up like walls, the law given at Sinai — and then Paul\'s letter to the Galatians, which says the same God has set you free and you should not go back.',
    weeks: [
      'A bush that burns and is not consumed. God has seen your affliction.',
      'Ten plagues and a lamb\'s blood on the doorpost. Rescue has a price, and God pays it.',
      'The sea opens. Stand still and see the salvation of the LORD.',
      'At Sinai, freedom is given a shape: love God, love your neighbour.',
      'For freedom Christ has set you free. Stand firm.',
    ],
    readings: [run('EXO', 1, 24), run('ISA', 61), run('GAL', 1, 6)],
  },
  {
    month: 8,
    title: 'Rest for Your Soul',
    tagline: 'Thirty-one psalms for the slower days',
    verses: ['PSA.23.2', 'PSA.23.3'],
    intro: 'The first book of the Psalms — songs for the morning and the night, for when enemies close in and when the heavens declare his glory. Read one a day, slowly. Pray it back. August is for being led beside still waters.',
    weeks: [
      'Blessed is the one planted by streams of water. Put your roots down.',
      'I lay down and slept; I woke again, for the LORD sustained me.',
      'The heavens declare the glory of God. Look up this week.',
      'The LORD is my shepherd. Let him lead.',
      'Into your hands I commit my spirit. Rest.',
    ],
    readings: [run('PSA', 1, 31)],
  },
  {
    month: 9,
    title: 'Strong and Courageous',
    tagline: 'Facing a new season without fear',
    verses: ['JOS.1.9'],
    intro: 'September is a month of new starts — school, work, the turn of the season. Joshua steps into Moses\' sandals and into a land full of giants, and God tells him three times not to be afraid. Then Daniel, far from home, stays faithful in a foreign court and in a den of lions.',
    weeks: [
      'Be strong and courageous. The LORD your God goes with you wherever you go.',
      'Jericho falls to marching and trumpets. God\'s ways are not ours.',
      'As for me and my house, we will serve the LORD.',
      'Daniel resolves not to defile himself. Small faithfulness, big consequences.',
      'The lions\' mouths are shut. Your God is able.',
    ],
    readings: [run('JOS', 1, 24), run('DAN', 1, 6)],
  },
  {
    month: 10,
    title: 'A Season of Harvest',
    tagline: 'Sowing, waiting and reaping',
    verses: ['GAL.6.9'],
    intro: 'Fields turn gold and the harvest comes in. October reads Matthew, where Jesus speaks of sowers and seeds, wheat and weeds, and a harvest that is plentiful while the workers are few — then John 15, James and Galatians 6: do not grow weary. In due season you will reap.',
    weeks: [
      'The Sermon on the Mount: a harvest grows from what you plant in secret.',
      'Come to me, all who are weary. Take his yoke — it is easy.',
      'The sower sows the word. Let it fall on good soil in you.',
      'Abide in the vine. Fruit is what happens when you stay connected.',
      'Do not grow weary of doing good. The season is coming.',
    ],
    readings: [run('MAT', 1, 28), run('JHN', 15), run('JAS', 5), run('GAL', 6)],
  },
  {
    month: 11,
    title: 'A Grateful Heart',
    tagline: 'A month of giving thanks',
    verses: ['1TH.5.16', '1TH.5.17', '1TH.5.18'],
    intro: 'Gratitude is not a feeling that arrives when life is good; it is a practice that changes how you see life. November sings through the great psalms of praise — "Enter his gates with thanksgiving" — and then reads Paul, who wrote "rejoice always" from a prison cell. Give thanks in everything.',
    weeks: [
      'Come, let us sing to the LORD. Begin each day this week with one thing you are thankful for.',
      'Bless the LORD, O my soul, and forget not all his benefits. Count them.',
      'Rejoice in the Lord always. Gratitude is a choice before it is a feeling.',
      'Let the peace of Christ rule in your heart — and be thankful.',
      'In everything give thanks. End the month the way you began it.',
    ],
    readings: [
      run('PSA', 95, 108), run('PHP', 1, 4), run('COL', 1, 4),
      run('1TH', 1, 5), run('2TH', 1, 3),
    ],
  },
  {
    month: 12,
    title: 'Waiting for the King',
    tagline: 'Advent: from promise to manger',
    verses: ['ISA.9.6'],
    intro: 'For centuries God\'s people waited in the dark for the promise to be kept. December reads Isaiah\'s prophecies of comfort and the coming King for twenty-three days of Advent — then Luke 1 on Christmas Eve, the manger on Christmas Day, and the last week of the year on who this child really is.',
    weeks: [
      'Comfort, comfort my people. Waiting is not wasted.',
      'He was pierced for our transgressions. The King comes to suffer.',
      'Arise, shine, for your light has come.',
      'Unto us a child is born. Make room.',
      'The Word became flesh. Behold, he makes all things new.',
    ],
    readings: [
      run('ISA', 40, 62), run('LUK', 1, 2), run('MAT', 2), run('JHN', 1),
      run('PHP', 2), run('COL', 1), run('HEB', 1), run('REV', 21),
    ],
  },
]

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * The month's theme in the reader's language. The readings and the verse are
 * the same in both; only the words around them are translated.
 */
export function themeFor(month: number, lang: 'en' | 'fr' = 'en'): MonthTheme {
  const theme = MONTH_THEMES[(((month - 1) % 12) + 12) % 12]
  const fr = lang === 'fr' ? MONTH_WORDS_FR[theme.month] : undefined
  return fr ? { ...theme, ...fr } : theme
}

function bookName(bookId: string): string {
  return getBookMeta(bookId)?.name ?? bookId
}

/** Every chapter of a theme, in reading order. */
export function themeChapters(theme: MonthTheme): { bookId: string; chapter: number }[] {
  const out: { bookId: string; chapter: number }[] = []
  for (const r of theme.readings) {
    for (let c = r.from; c <= r.to; c++) out.push({ bookId: r.bookId, chapter: c })
  }
  return out
}

/** "Genesis 1–2", "Psalm 95", "Ruth 4 · Hosea 1". */
export function dayLabel(chapters: { bookId: string; chapter: number }[], lang: 'en' | 'fr' = 'en'): string {
  const groups: { bookId: string; first: number; last: number }[] = []
  for (const c of chapters) {
    const g = groups[groups.length - 1]
    if (g && g.bookId === c.bookId && g.last + 1 === c.chapter) g.last = c.chapter
    else groups.push({ bookId: c.bookId, first: c.chapter, last: c.chapter })
  }
  return groups.map(g => {
    // One psalm is a Psalm, not a Psalms.
    const name = g.bookId === 'PSA' && g.first === g.last ? (lang === 'fr' ? 'Psaume' : 'Psalm') : bookName(g.bookId)
    return g.first === g.last ? `${name} ${g.first}` : `${name} ${g.first}–${g.last}`
  }).join(' · ')
}

/**
 * The month's plan, one entry per calendar day.
 *
 * Chapters are dealt out evenly: day i gets the chapters between
 * floor(i·C/D) and floor((i+1)·C/D). With at least as many chapters as days
 * (asserted by the tests for every month, leap years included) no day is
 * empty, no chapter is read twice, and the extra chapters spread across the
 * month instead of piling up at the end.
 */
export function monthlyPlan(year: number, month: number, lang: 'en' | 'fr' = 'en'): MonthPlan {
  const theme = themeFor(month, lang)
  const total = daysInMonth(year, month)
  const chapters = themeChapters(theme)
  const days: MonthDay[] = []
  for (let i = 0; i < total; i++) {
    const slice = chapters.slice(
      Math.floor((i * chapters.length) / total),
      Math.floor(((i + 1) * chapters.length) / total),
    )
    days.push({
      date: i + 1,
      label: dayLabel(slice, lang),
      // to: 999 is "to the end of the chapter" — the passage filter is a range
      // check, so whole chapters need no verse counts loaded up front.
      passages: slice.map(c => ({
        bookId: c.bookId, chapter: c.chapter, from: 1, to: 999,
        label: dayLabel([c], lang),
      })),
      focus: theme.weeks[Math.min(4, Math.floor(i / 7))],
    })
  }
  return {
    id: `month-${year}-${String(month).padStart(2, '0')}`,
    year, month, theme, days,
  }
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const MONTH_NAMES_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** "November" / "novembre" — French month names are not capitalised mid-sentence. */
export function monthName(month: number, lang: 'en' | 'fr' = 'en'): string {
  return (lang === 'fr' ? MONTH_NAMES_FR : MONTH_NAMES)[month - 1]
}
