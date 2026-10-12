// src/main/fares/adapters/types.ts
import type { FareOffer, FareQuery, SiteId } from '../../../shared/fares/types'

/** What an adapter's in-page script reports on each poll. */
export interface PageProbe<Raw> {
  /** The page has rendered enough results to read. */
  ready: boolean
  /** A bot wall / CAPTCHA is showing. */
  blocked: boolean
  /** Price-looking strings anywhere on the page — tells "unreadable" from "empty". */
  pricesOnPage: number
  raw: Raw
}

export interface SiteAdapter<Raw> {
  id: SiteId
  label: string
  url(q: FareQuery): string
  /** A self-contained JS expression, evaluated in the page, returning PageProbe<Raw>.
   *  It must only READ the DOM. */
  script: string
  /** Pure: raw page data → normalized offers. Tested against fixtures. */
  parse(raw: Raw, q: FareQuery): FareOffer[]
}

/** Shared in-page snippet: bot-wall and price-count detection. */
export const COMMON_PROBE = `
  const __t = (document.body && document.body.innerText || '').slice(0, 200000);
  const __blocked = /unusual traffic|verify you are human|are you a robot|press & hold|captcha/i.test(__t);
  const __prices = (__t.match(/[$€£]\\s?\\d{2,5}/g) || []).length;
`
