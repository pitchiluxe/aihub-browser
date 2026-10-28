import { useEffect, useState } from 'react'
import { getTranslationMeta, onTranslationChange } from './bibleService'

// The Bible speaks one language at a time.
//
// The version the reader picks decides the language of everything around the
// scripture too — buttons, the study rooms, the month's reading, the voice —
// so Louis Segond never sits inside an English interface. There is no
// separate language setting to fall out of step with the version.
//
// Strings are written as English/French pairs at the point of use,
// `t('Read it', 'Lire')`, rather than as keys in a far-away table: the French
// stays next to the English it translates, and a missing translation is
// visible in review instead of rendering as a key name.

export type BibleLang = 'en' | 'fr'

/** The language of the open version. */
export function bibleLang(): BibleLang {
  return getTranslationMeta().locale.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

export type Translate = (en: string, fr: string) => string

export function translator(lang: BibleLang): Translate {
  return (en, fr) => (lang === 'fr' ? fr : en)
}

/**
 * The open version's language and a `t(en, fr)` for it, re-rendering when the
 * reader switches version anywhere in the app.
 */
export function useBibleLang(): { lang: BibleLang; t: Translate } {
  const [lang, setLang] = useState<BibleLang>(bibleLang)
  useEffect(() => onTranslationChange(() => setLang(bibleLang())), [])
  return { lang, t: translator(lang) }
}

/** "3 jours" / "1 day" — the plural forms used across the study rooms. */
export function plural(lang: BibleLang, n: number, en: [string, string], fr: [string, string]): string {
  const [one, many] = lang === 'fr' ? fr : en
  // French treats 0 and 1 as singular.
  const single = lang === 'fr' ? n <= 1 : n === 1
  return `${n} ${single ? one : many}`
}

/**
 * The browser's own names for the Bible pages — tab titles and sidebar
 * entries — in the open version's language, so a French Bible does not sit in
 * a tab called "Study". Other pages keep the name they were given.
 */
export function biblePageName(pageType: string | undefined, fallback: string, lang: BibleLang): string {
  if (pageType === 'study') return lang === 'fr' ? 'Étude biblique' : 'Bible Study'
  if (pageType === 'bible') return 'Bible'
  return fallback
}
