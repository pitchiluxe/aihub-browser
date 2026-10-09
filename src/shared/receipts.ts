import { csvCell } from './tableExtract'

/**
 * AIHub Browser — the Ledger.
 *
 * Purchase confirmations arrive as email and the invoices arrive as PDFs in
 * Downloads, and nothing ever puts the two together. Working out what you
 * spent last month means opening a mail client, searching badly, and typing
 * numbers into a spreadsheet by hand.
 *
 * This browser is the one place where the mailbox, the downloads folder and a
 * model already live in the same process, so it is the one place that can
 * assemble the answer without shipping anybody's bank data anywhere. Nothing
 * here talks to a bank; it reads receipts the user was already sent.
 *
 * Parsing money out of prose is the part that quietly gets things wrong, so
 * all of it is pure and tested here: the header shapes, the two decimal
 * conventions, and the difference between a total and an order number.
 */

export interface ReceiptEntry {
  id: string
  merchant: string
  /** Minor units are avoided on purpose — these are display figures. */
  amount: number
  currency: string
  date: number
  subject: string
  /** The Gmail thread this came from, so a row can be opened and checked. */
  threadId?: string
}

/** The Gmail search that finds purchase mail without dragging in newsletters. */
export function buildReceiptQuery(monthsBack = 3): string {
  const terms = [
    'receipt', 'invoice', '"order confirmation"', '"your order"',
    '"payment received"', '"payment confirmation"', 'subscription',
  ].join(' OR ')
  return `(${terms}) newer_than:${Math.max(1, Math.round(monthsBack * 30))}d -in:spam -in:trash`
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR', 'R$': 'BRL',
}

/**
 * Read a money figure out of free text.
 *
 * The hard part is the two decimal conventions: 1,234.56 and 1.234,56 mean the
 * same amount and are written with the separators swapped. The rule that works
 * without knowing the locale is to look at the LAST separator — if exactly two
 * digits follow it, it is the decimal point, whatever character it is.
 *
 * Returns null rather than guessing. A wrong number in a ledger is worse than
 * a missing one, because a missing one is visible.
 */
export function parseAmount(text: string): { amount: number; currency: string } | null {
  const s = String(text || '')

  // Symbol-first ($12.34) or code-first (USD 12.34), then a bare number with a
  // trailing code (12.34 EUR).
  const patterns: [RegExp, 'symbol' | 'code' | 'trailing'][] = [
    [/(R\$|[$£€¥₹])\s?([0-9][0-9.,\s]*[0-9]|[0-9])/, 'symbol'],
    [/\b([A-Z]{3})\s?([0-9][0-9.,\s]*[0-9]|[0-9])\b/, 'code'],
    [/\b([0-9][0-9.,]*[0-9]|[0-9])\s?([A-Z]{3})\b/, 'trailing'],
  ]

  for (const [re, kind] of patterns) {
    const m = s.match(re)
    if (!m) continue
    const rawNumber = kind === 'trailing' ? m[1] : m[2]
    const rawCurrency = kind === 'trailing' ? m[2] : m[1]
    const amount = normaliseNumber(rawNumber)
    if (amount === null) continue
    const currency = kind === 'symbol'
      ? (CURRENCY_SYMBOLS[rawCurrency] || 'USD')
      : rawCurrency.toUpperCase()
    // A three-letter code that is obviously not money would make junk rows.
    if (kind !== 'symbol' && !/^[A-Z]{3}$/.test(currency)) continue
    return { amount, currency }
  }
  return null
}

/** "1,234.56" or "1.234,56" or "1 234,56" → 1234.56. Null when it is not a number. */
export function normaliseNumber(raw: string): number | null {
  let s = String(raw || '').replace(/\s/g, '')
  if (!s) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  const lastSep = Math.max(lastComma, lastDot)

  if (lastSep === -1) {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  const decimals = s.length - lastSep - 1
  if (decimals === 2) {
    // The last separator is the decimal point; everything before it groups.
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '')
    const frac = s.slice(lastSep + 1)
    const n = Number(`${intPart}.${frac}`)
    return Number.isFinite(n) ? n : null
  }

  // No two-digit tail: every separator is a thousands grouping.
  const n = Number(s.replace(/[.,]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Who was paid.
 *
 * The sender's display name is right far more often than anything parsed out
 * of a subject line, and when there is no display name the domain is a better
 * answer than the local part — "no-reply" is not a merchant.
 */
export function merchantFrom(from: string, subject = ''): string {
  const raw = String(from || '').trim()
  const named = raw.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)
  if (named && named[1].trim() && !/^no.?reply$/i.test(named[1].trim())) {
    return named[1].trim()
  }
  const email = (raw.match(/<([^>]+)>/)?.[1] || raw).trim()
  const domain = email.split('@')[1] || ''
  if (domain) {
    const name = domain.replace(/^(mail|email|e|no-?reply|notifications?|billing|receipts?)\./i, '')
      .split('.')
      .slice(0, -1)
      .pop() || domain
    if (name) return name.charAt(0).toUpperCase() + name.slice(1)
  }
  const fallback = String(subject || '').trim()
  return fallback ? fallback.slice(0, 40) : 'Unknown'
}

/**
 * Whether this mail is a purchase rather than an advert for one.
 *
 * Marketing mail uses the same words, so the discriminator is an amount: a
 * receipt states what was charged, a promotion states what something costs and
 * usually reaches for a percentage instead.
 */
export function looksLikeReceipt(subject: string, snippet: string): boolean {
  const text = `${subject || ''} ${snippet || ''}`
  if (/\b(unsubscribe|% off|sale ends|deal|coupon|newsletter)\b/i.test(text)) return false
  if (!/\b(receipt|invoice|order|payment|charged|subscription|renewal|billed)\b/i.test(text)) return false
  return parseAmount(text) !== null
}

/** Total per currency. Mixing currencies into one number would be a lie. */
export function totalsByCurrency(entries: ReceiptEntry[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of entries || []) {
    out[e.currency] = Math.round(((out[e.currency] || 0) + e.amount) * 100) / 100
  }
  return out
}

/**
 * Merchants that look like a subscription: charged repeatedly, at a steady
 * amount. Three occurrences is the floor — two is a coincidence, and the
 * forgotten subscriptions people actually want surfaced have many.
 */
export function detectRecurring(entries: ReceiptEntry[], minCount = 3): string[] {
  const byMerchant = new Map<string, ReceiptEntry[]>()
  for (const e of entries || []) {
    const key = e.merchant.toLowerCase()
    byMerchant.set(key, [...(byMerchant.get(key) || []), e])
  }

  const out: string[] = []
  for (const [, list] of byMerchant) {
    if (list.length < minCount) continue
    const amounts = list.map(e => e.amount)
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
    if (mean <= 0) continue
    // Within a tenth of the mean each time: a subscription, not a shop.
    const steady = amounts.every(a => Math.abs(a - mean) <= mean * 0.1)
    if (steady) out.push(list[0].merchant)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/** Newest first — a ledger is read from the most recent thing that happened. */
export function sortEntries(entries: ReceiptEntry[]): ReceiptEntry[] {
  return [...(entries || [])].sort((a, b) => b.date - a.date)
}

export function toLedgerCsv(entries: ReceiptEntry[]): string {
  const header = ['Date', 'Merchant', 'Amount', 'Currency', 'Subject']
  const rows = sortEntries(entries).map(e => [
    new Date(e.date).toISOString().slice(0, 10),
    e.merchant,
    e.amount.toFixed(2),
    e.currency,
    e.subject,
  ])
  return [header, ...rows].map(r => r.map(c => csvCell(String(c))).join(',')).join('\r\n')
}
