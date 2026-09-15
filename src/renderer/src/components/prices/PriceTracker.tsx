// PriceTracker.tsx — F7: Live Price Tracker
// Shows live prices for tracked symbols in the sidebar. Uses free public APIs
// (CoinGecko for crypto, Yahoo Finance for stocks/forex) with 30s polling.

import React, { useState, useEffect, useRef } from 'react'

export interface TrackedSymbol {
  id: string
  symbol: string       // e.g. "BTC", "XAUUSD"
  name: string         // e.g. "Bitcoin", "Gold"
  type: 'crypto' | 'forex' | 'stock'
  price: number | null
  change24h: number | null   // percent
  updatedAt: number | null
}

// Default tracked symbols
const DEFAULT_SYMBOLS: TrackedSymbol[] = [
  { id: 'bitcoin',      symbol: 'BTC',   name: 'Bitcoin',     type: 'crypto', price: null, change24h: null, updatedAt: null },
  { id: 'ethereum',     symbol: 'ETH',   name: 'Ethereum',     type: 'crypto', price: null, change24h: null, updatedAt: null },
  { id: 'XAUUSD',       symbol: 'XAU',  name: 'Gold',         type: 'forex', price: null, change24h: null, updatedAt: null },
  { id: 'NQ=F',         symbol: 'NQ',    name: 'Nasdaq',       type: 'stock', price: null, change24h: null, updatedAt: null },
]

// CoinGecko simple price endpoint — free, no API key
async function fetchCryptoPrices(ids: string[]): Promise<Map<string, { usd: number; usd_24h_change?: number }>> {
  const map = new Map()
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (res.ok) {
      const data = await res.json() as Record<string, { usd: number; usd_24h_change: number }>
      for (const [id, val] of Object.entries(data)) {
        map.set(id, val)
      }
    }
  } catch { /* network error */ }
  return map
}

// Yahoo Finance live price via query1 endpoint — no auth needed
async function fetchYahooPrice(symbol: string): Promise<{ price: number; change24h: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const json = await res.json() as any
    const result = json?.chart?.result?.[0]
    if (!result) return null
    const meta = result.meta
    const close = meta?.regularMarketPrice
    const prevClose = meta?.previousClose ?? meta?.chartPreviousClose
    if (!close) return null
    const change24h = prevClose ? ((close - prevClose) / prevClose) * 100 : 0
    return { price: close, change24h }
  } catch { return null }
}

export default function PriceTracker() {
  const [symbols, setSymbols] = useState<TrackedSymbol[]>(DEFAULT_SYMBOLS)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<any>(null)

  const fetchAll = async () => {
    const cryptoIds = symbols.filter(s => s.type === 'crypto').map(s => s.id)
    const forexSym = symbols.find(s => s.type === 'forex')
    const stockSym = symbols.find(s => s.type === 'stock')

    const [cryptoPrices, forexPrice, stockPrice] = await Promise.all([
      cryptoIds.length ? fetchCryptoPrices(cryptoIds) : Promise.resolve(new Map()),
      forexSym ? fetchYahooPrice(forexSym.id) : Promise.resolve(null),
      stockSym ? fetchYahooPrice(stockSym.id) : Promise.resolve(null),
    ])

    setSymbols(prev => prev.map(sym => {
      if (sym.type === 'crypto') {
        const p = cryptoPrices.get(sym.id)
        return p ? { ...sym, price: p.usd, change24h: p.usd_24h_change ?? null, updatedAt: Date.now() } : sym
      }
      if (sym.type === 'forex' && forexPrice) {
        return { ...sym, price: forexPrice.price, change24h: forexPrice.change24h, updatedAt: Date.now() }
      }
      if (sym.type === 'stock' && stockPrice) {
        return { ...sym, price: stockPrice.price, change24h: stockPrice.change24h, updatedAt: Date.now() }
      }
      return sym
    }))
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    intervalRef.current = setInterval(fetchAll, 30_000)
    return () => clearInterval(intervalRef.current)
  }, [])

  const allLoaded = symbols.some(s => s.price !== null)

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 8px',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          {loading && !allLoaded ? 'Prices…' : 'Live Prices'}
        </span>
        {allLoaded && (
          <span style={{ fontSize: 9, color: 'var(--accent)', opacity: 0.7 }} title={`Updated ${new Date().toLocaleTimeString()}`}>
            🔴 LIVE
          </span>
        )}
      </div>

      {symbols.map(sym => (
        <div key={sym.id} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 8px',
          borderBottom: '1px solid var(--border)',
        }}>
          {/* Symbol badge */}
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
            color: sym.type === 'crypto' ? '#f7931a' : sym.type === 'forex' ? '#ffd700' : '#3b82f6',
            background: sym.type === 'crypto' ? '#f7931a22' : sym.type === 'forex' ? '#ffd70022' : '#3b82f622',
            padding: '2px 5px', borderRadius: 4, flexShrink: 0, minWidth: 28, textAlign: 'center',
          }}>
            {sym.symbol}
          </div>

          {/* Name */}
          <span style={{ flex: 1, fontSize: 10.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sym.name}
          </span>

          {/* Price */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {sym.price !== null ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
                  {sym.type === 'forex' || sym.type === 'stock'
                    ? sym.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : sym.price.toLocaleString('en-US', { minimumFractionDigits: sym.price < 1 ? 4 : 2, maximumFractionDigits: 4 })
                  }
                </div>
                {sym.change24h !== null && (
                  <div style={{
                    fontSize: 9.5,
                    color: sym.change24h >= 0 ? '#22c55e' : '#ef4444',
                  }}>
                    {sym.change24h >= 0 ? '▲' : '▼'} {Math.abs(sym.change24h).toFixed(2)}%
                  </div>
                )}
              </>
            ) : (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
