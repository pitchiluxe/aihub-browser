import { describe, it, expect } from 'vitest'
import {
  buildReceiptQuery, parseAmount, normaliseNumber, merchantFrom, looksLikeReceipt,
  totalsByCurrency, detectRecurring, sortEntries, toLedgerCsv, type ReceiptEntry,
} from './receipts'

const entry = (over: Partial<ReceiptEntry> = {}): ReceiptEntry => ({
  id: 'e1', merchant: 'Acme', amount: 10, currency: 'USD',
  date: Date.parse('2026-08-01T00:00:00Z'), subject: 'Receipt', ...over,
})

describe('buildReceiptQuery', () => {
  it('searches purchase words and excludes the bins', () => {
    const q = buildReceiptQuery(3)
    expect(q).toContain('receipt')
    expect(q).toContain('invoice')
    expect(q).toContain('-in:spam')
    expect(q).toContain('newer_than:90d')
  })
  it('never asks for a zero-day window', () => {
    expect(buildReceiptQuery(0)).toContain('newer_than:1d')
  })
})

describe('normaliseNumber', () => {
  it('reads the anglophone convention', () => {
    expect(normaliseNumber('1,234.56')).toBe(1234.56)
  })
  it('reads the continental convention', () => {
    expect(normaliseNumber('1.234,56')).toBe(1234.56)
    expect(normaliseNumber('1 234,56')).toBe(1234.56)
  })
  it('treats a separator with no two-digit tail as grouping', () => {
    expect(normaliseNumber('1.234')).toBe(1234)
    expect(normaliseNumber('1,234')).toBe(1234)
  })
  it('handles a bare number', () => {
    expect(normaliseNumber('99')).toBe(99)
    expect(normaliseNumber('9.99')).toBe(9.99)
  })
  it('is null for things that are not numbers', () => {
    expect(normaliseNumber('')).toBeNull()
    expect(normaliseNumber('abc')).toBeNull()
  })
})

describe('parseAmount', () => {
  it('reads a leading symbol', () => {
    expect(parseAmount('Your total was $1,234.56 today')).toEqual({ amount: 1234.56, currency: 'USD' })
    expect(parseAmount('Charged £9.99')).toEqual({ amount: 9.99, currency: 'GBP' })
    expect(parseAmount('Total: €1.234,56')).toEqual({ amount: 1234.56, currency: 'EUR' })
  })
  it('reads a leading code', () => {
    expect(parseAmount('Amount USD 42.00')).toEqual({ amount: 42, currency: 'USD' })
  })
  it('reads a trailing code', () => {
    expect(parseAmount('Total 42.00 EUR')).toEqual({ amount: 42, currency: 'EUR' })
  })
  it('returns null rather than guessing', () => {
    // A wrong number in a ledger is worse than a missing one.
    expect(parseAmount('Your order has shipped')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('merchantFrom', () => {
  it('prefers the sender display name', () => {
    expect(merchantFrom('"Spotify" <no-reply@spotify.com>')).toBe('Spotify')
  })
  it('falls back to the domain when the name says nothing', () => {
    expect(merchantFrom('no-reply <no-reply@netflix.com>')).toBe('Netflix')
    expect(merchantFrom('billing@github.com')).toBe('Github')
  })
  it('strips the mail subdomain rather than reporting it as the merchant', () => {
    expect(merchantFrom('receipts@email.uber.com')).toBe('Uber')
  })
  it('falls back to the subject, then to Unknown', () => {
    expect(merchantFrom('', 'Order from a shop')).toBe('Order from a shop')
    expect(merchantFrom('', '')).toBe('Unknown')
  })
})

describe('looksLikeReceipt', () => {
  it('accepts a real receipt', () => {
    expect(looksLikeReceipt('Your receipt from Acme', 'Total charged $12.00')).toBe(true)
  })
  it('rejects marketing that uses the same words', () => {
    expect(looksLikeReceipt('Your order could be 20% off!', 'Sale ends soon. Unsubscribe')).toBe(false)
  })
  it('rejects a purchase word with no amount anywhere', () => {
    expect(looksLikeReceipt('Your order has shipped', 'On its way')).toBe(false)
  })
})

describe('totalsByCurrency', () => {
  it('keeps currencies apart instead of adding a lie together', () => {
    expect(totalsByCurrency([
      entry({ amount: 10, currency: 'USD' }),
      entry({ amount: 5.5, currency: 'USD' }),
      entry({ amount: 3, currency: 'EUR' }),
    ])).toEqual({ USD: 15.5, EUR: 3 })
  })
  it('is empty for nothing', () => {
    expect(totalsByCurrency([])).toEqual({})
  })
})

describe('detectRecurring', () => {
  it('spots a steady monthly charge', () => {
    const subs = [
      entry({ id: 'a', merchant: 'Spotify', amount: 11.99 }),
      entry({ id: 'b', merchant: 'Spotify', amount: 11.99 }),
      entry({ id: 'c', merchant: 'Spotify', amount: 11.99 }),
    ]
    expect(detectRecurring(subs)).toEqual(['Spotify'])
  })
  it('ignores a shop where the amount jumps around', () => {
    const shop = [
      entry({ id: 'a', merchant: 'Amazon', amount: 5 }),
      entry({ id: 'b', merchant: 'Amazon', amount: 90 }),
      entry({ id: 'c', merchant: 'Amazon', amount: 240 }),
    ]
    expect(detectRecurring(shop)).toEqual([])
  })
  it('needs more than a coincidence', () => {
    expect(detectRecurring([
      entry({ id: 'a', merchant: 'Twice', amount: 5 }),
      entry({ id: 'b', merchant: 'Twice', amount: 5 }),
    ])).toEqual([])
  })
})

describe('sortEntries / toLedgerCsv', () => {
  it('reads newest first', () => {
    const out = sortEntries([
      entry({ id: 'old', date: 1000 }),
      entry({ id: 'new', date: 9000 }),
    ])
    expect(out.map(e => e.id)).toEqual(['new', 'old'])
  })
  it('writes a spreadsheet-safe CSV with a header', () => {
    const csv = toLedgerCsv([entry({ merchant: 'Acme, Inc', amount: 12.5, subject: 'Receipt' })])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Date,Merchant,Amount,Currency,Subject')
    expect(lines[1]).toBe('2026-08-01,"Acme, Inc",12.50,USD,Receipt')
  })
})
