import React from 'react'

/**
 * The trade plan, drawn.
 *
 * A wall of prose telling a trader "resistance at 4363.7, entry 4349–4351.8,
 * stop 4341.9" is work to read and easy to misread. The same numbers drawn to
 * scale — the bar, the entry band, the stop below it, the targets above — can
 * be checked at a glance against the chart they came from.
 *
 * Everything here is rendered from numbers the assistant READ, never from
 * anything it composed: if a field is missing the row is simply absent.
 */

export interface TradePlanData {
  symbol?: string
  interval?: string
  bias?: 'bullish' | 'bearish' | 'range'
  direction?: 'long' | 'short' | 'none'
  price?: number
  readAt?: string
  bar?: { open: number; high: number; low: number; close: number }
  entry?: { from: number; to: number } | null
  stop?: number | null
  targets?: { price: number; label?: string; rr?: number }[]
  levels?: { price: number; label?: string }[]
  invalidation?: string
  note?: string
}

const TONE = {
  bullish: { fg: '#34d399', bg: 'rgba(52,211,153,0.12)', label: 'Bullish' },
  bearish: { fg: '#f87171', bg: 'rgba(248,113,113,0.12)', label: 'Bearish' },
  range:   { fg: '#fbbf24', bg: 'rgba(251,191,36,0.12)', label: 'No trade — ranging' },
}

/** Try to read a trade-plan block; returns null for anything malformed. */
export function parseTradePlan(raw: string): TradePlanData | null {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    // A card with no prices is worse than no card — it implies analysis that
    // did not happen.
    const hasNumbers = typeof data.price === 'number' || data.bar || (Array.isArray(data.targets) && data.targets.length)
    return hasNumbers ? data as TradePlanData : null
  } catch {
    return null
  }
}

export default function TradePlanCard({ plan }: { plan: TradePlanData }) {
  const tone = TONE[plan.bias || 'range'] || TONE.range
  const fmt = (value: number | undefined) =>
    value === undefined || value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 5 })

  // Everything that needs a position on the scale.
  const points: number[] = []
  if (plan.bar) points.push(plan.bar.high, plan.bar.low)
  if (typeof plan.price === 'number') points.push(plan.price)
  if (plan.entry) points.push(plan.entry.from, plan.entry.to)
  if (typeof plan.stop === 'number') points.push(plan.stop)
  for (const target of plan.targets || []) points.push(target.price)
  for (const level of plan.levels || []) points.push(level.price)

  const usable = points.filter(p => typeof p === 'number' && isFinite(p))
  const min = Math.min(...usable)
  const max = Math.max(...usable)
  const span = max - min || 1
  const pad = span * 0.08
  const top = max + pad
  const bottom = min - pad
  const H = 260
  const W = 520
  const y = (price: number) => H - ((price - bottom) / (top - bottom)) * H

  const hasChart = usable.length >= 2

  return (
    <div
      style={{
        margin: '10px 0', borderRadius: 16, overflow: 'hidden',
        border: '1px solid var(--ds-border-sm)', background: 'var(--ds-glass-sm)',
      }}
    >
      {/* Header: what was read, and the call */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: '10px 14px', borderBottom: '1px solid var(--ds-border-sm)', background: tone.bg,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--ds-text-1))' }}>
            {plan.symbol || 'Chart'} {plan.interval ? <span style={{ opacity: 0.6, fontWeight: 500 }}>· {plan.interval}</span> : null}
          </div>
          {!!plan.readAt && (
            <div style={{ fontSize: 10.5, color: 'rgb(var(--ds-text-4))' }}>
              read from your chart · {new Date(plan.readAt).toLocaleString()}
            </div>
          )}
        </div>
        <div style={{
          padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
          color: tone.fg, border: `1px solid ${tone.fg}55`, whiteSpace: 'nowrap',
        }}>
          {plan.direction && plan.direction !== 'none' ? plan.direction.toUpperCase() : tone.label}
        </div>
      </div>

      {hasChart && (
        <div style={{ padding: '12px 14px 4px' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
            {/* Targets — drawn first so labels sit above the bands */}
            {(plan.targets || []).map((target, i) => (
              <g key={`t${i}`}>
                <line x1={70} x2={W - 8} y1={y(target.price)} y2={y(target.price)}
                  stroke="#34d399" strokeWidth={1} strokeDasharray="5 4" opacity={0.75} />
                <text x={74} y={y(target.price) - 4} fontSize={10} fill="#34d399">
                  {target.label || `T${i + 1}`} {typeof target.rr === 'number' ? `· ${target.rr}R` : ''}
                </text>
                <text x={0} y={y(target.price) + 3} fontSize={10} fill="#34d399">{fmt(target.price)}</text>
              </g>
            ))}

            {/* Entry band */}
            {plan.entry && (
              <g>
                <rect x={70} y={Math.min(y(plan.entry.from), y(plan.entry.to))} width={W - 78}
                  height={Math.max(2, Math.abs(y(plan.entry.from) - y(plan.entry.to)))}
                  fill="rgb(var(--ds-accent) / 0.25)" stroke="rgb(var(--ds-accent))" strokeWidth={1} />
                <text x={74} y={Math.min(y(plan.entry.from), y(plan.entry.to)) - 4}
                  fontSize={10} fill="rgb(var(--ds-accent-soft))" fontWeight={700}>
                  ENTRY ZONE
                </text>
                <text x={0} y={y(plan.entry.to) + 3} fontSize={10} fill="rgb(var(--ds-accent-soft))">{fmt(plan.entry.to)}</text>
                <text x={0} y={y(plan.entry.from) + 12} fontSize={10} fill="rgb(var(--ds-accent-soft))">{fmt(plan.entry.from)}</text>
              </g>
            )}

            {/* Stop */}
            {typeof plan.stop === 'number' && (
              <g>
                <line x1={70} x2={W - 8} y1={y(plan.stop)} y2={y(plan.stop)} stroke="#f87171" strokeWidth={1.5} />
                <text x={74} y={y(plan.stop) + 12} fontSize={10} fill="#f87171" fontWeight={700}>STOP</text>
                <text x={0} y={y(plan.stop) + 3} fontSize={10} fill="#f87171">{fmt(plan.stop)}</text>
              </g>
            )}

            {/* The bar that was actually read */}
            {plan.bar && (
              <g>
                <line x1={40} x2={40} y1={y(plan.bar.high)} y2={y(plan.bar.low)}
                  stroke="rgb(var(--ds-text-3))" strokeWidth={1.5} />
                <rect
                  x={30} width={20}
                  y={Math.min(y(plan.bar.open), y(plan.bar.close))}
                  height={Math.max(2, Math.abs(y(plan.bar.open) - y(plan.bar.close)))}
                  fill={plan.bar.close >= plan.bar.open ? '#34d399' : '#f87171'}
                  opacity={0.85}
                />
                <text x={30} y={y(plan.bar.high) - 5} fontSize={9} fill="rgb(var(--ds-text-4))">H {fmt(plan.bar.high)}</text>
                <text x={30} y={y(plan.bar.low) + 12} fontSize={9} fill="rgb(var(--ds-text-4))">L {fmt(plan.bar.low)}</text>
              </g>
            )}

            {/* Last price */}
            {typeof plan.price === 'number' && (
              <g>
                <line x1={20} x2={W - 8} y1={y(plan.price)} y2={y(plan.price)}
                  stroke="rgb(var(--ds-text-2))" strokeWidth={1} opacity={0.5} strokeDasharray="2 3" />
                <rect x={W - 66} y={y(plan.price) - 9} width={62} height={17} rx={4} fill="rgb(var(--ds-text-2) / 0.9)" />
                <text x={W - 60} y={y(plan.price) + 3} fontSize={10} fill="rgb(var(--ds-bg))" fontWeight={700}>
                  {fmt(plan.price)}
                </text>
              </g>
            )}
          </svg>
        </div>
      )}

      {/* The numbers, for placing the order */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 1, background: 'var(--ds-border-sm)' }}>
        {plan.entry && (
          <Cell label="Entry zone" value={`${fmt(plan.entry.from)} – ${fmt(plan.entry.to)}`} color="rgb(var(--ds-accent-soft))" />
        )}
        {typeof plan.stop === 'number' && <Cell label="Stop" value={fmt(plan.stop)} color="#f87171" />}
        {(plan.targets || []).slice(0, 3).map((t, i) => (
          <Cell key={i} label={t.label || `Target ${i + 1}`} value={`${fmt(t.price)}${typeof t.rr === 'number' ? ` · ${t.rr}R` : ''}`} color="#34d399" />
        ))}
      </div>

      {(plan.invalidation || plan.note) && (
        <div style={{ padding: '10px 14px', fontSize: 11.5, color: 'rgb(var(--ds-text-3))', lineHeight: 1.5 }}>
          {plan.invalidation && <div><strong style={{ color: '#f87171' }}>Wrong if:</strong> {plan.invalidation}</div>}
          {plan.note && <div style={{ marginTop: 4, color: 'rgb(var(--ds-text-4))' }}>{plan.note}</div>}
          <div style={{ marginTop: 6, fontSize: 10.5, color: 'rgb(var(--ds-text-4))' }}>
            Read from your open chart. Not financial advice — size any position so a loss is survivable.
          </div>
        </div>
      )}
    </div>
  )
}

function Cell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'var(--ds-glass-sm)', padding: '8px 12px' }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'rgb(var(--ds-text-4))' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
