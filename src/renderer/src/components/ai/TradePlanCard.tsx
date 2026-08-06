import React from 'react'

/**
 * The trade plan, drawn.
 *
 * Prose telling a trader "resistance at 4304.03, entry 4260.3–4268.13, stop
 * 4220.98, targets 4203.08 / 4165.97 / 4120" is work to read and easy to
 * misread. The same numbers laid out to scale — the entry band, the stop
 * below it, each target with what it pays — can be checked against the chart
 * at a glance.
 *
 * Everything rendered here comes from numbers the assistant READ. A missing
 * field simply does not draw; nothing is inferred to fill a gap.
 */

export interface TradeTarget { price: number; label?: string; rr?: number }

export interface TradeScenario {
  direction?: 'long' | 'short'
  trigger?: number
  triggerLabel?: string
  entry?: { from: number; to: number } | null
  stop?: number | null
  targets?: TradeTarget[]
  bestRr?: number
  invalidation?: string
}

export interface TradePlanData extends TradeScenario {
  symbol?: string
  interval?: string
  bias?: 'bullish' | 'bearish' | 'range'
  price?: number
  readAt?: string
  bar?: { open: number; high: number; low: number; close: number }
  levels?: { price: number; label?: string }[]
  note?: string
  /** Both sides of an undecided chart. */
  scenarios?: TradeScenario[]
}

const GREEN = '#34d399'
const RED = '#f87171'
const AMBER = '#fbbf24'

const toneFor = (bias?: string, direction?: string) => {
  if (direction === 'long') return GREEN
  if (direction === 'short') return RED
  if (bias === 'bullish') return GREEN
  if (bias === 'bearish') return RED
  return AMBER
}

export function parseTradePlan(raw: string): TradePlanData | null {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const hasNumbers = data.entry || data.stop !== undefined || data.scenarios ||
      (Array.isArray(data.targets) && data.targets.length) || typeof data.price === 'number'
    return hasNumbers ? data as TradePlanData : null
  } catch {
    return null
  }
}

const fmt = (value?: number | null) =>
  value === undefined || value === null || !isFinite(value)
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: 5 })

export default function TradePlanCard({ plan }: { plan: TradePlanData }) {
  const scenarios: TradeScenario[] = plan.scenarios?.length
    ? plan.scenarios
    : [{ direction: plan.direction, entry: plan.entry, stop: plan.stop, targets: plan.targets, trigger: plan.trigger, triggerLabel: plan.triggerLabel, invalidation: plan.invalidation }]

  const isBracket = scenarios.length > 1
  const headerTone = toneFor(plan.bias, isBracket ? undefined : scenarios[0]?.direction)

  // Which side actually pays: the single most useful comparison on the card.
  const best = scenarios.reduce<{ side?: TradeScenario; rr: number }>((acc, s) => {
    const rr = s.bestRr ?? Math.max(0, ...(s.targets || []).map(t => Number(t.rr) || 0))
    return rr > acc.rr ? { side: s, rr } : acc
  }, { rr: 0 })

  return (
    <div
      style={{
        margin: '12px 0', borderRadius: 18, overflow: 'hidden',
        border: '1px solid var(--ds-border-sm)',
        background: 'linear-gradient(180deg, rgb(var(--ds-bg-2)) 0%, rgb(var(--ds-bg-3)) 100%)',
        boxShadow: '0 10px 32px rgba(0,0,0,0.28)',
      }}
    >
      {/* Header — what was read, and the call */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '12px 16px',
        background: `linear-gradient(90deg, ${headerTone}22 0%, transparent 70%)`,
        borderBottom: '1px solid var(--ds-border-sm)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.2, color: 'rgb(var(--ds-text-1))' }}>
              {plan.symbol || 'Chart'}
            </span>
            {!!plan.interval && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                background: 'rgb(var(--ds-text-1) / 0.08)', color: 'rgb(var(--ds-text-3))',
              }}>{plan.interval}</span>
            )}
            {typeof plan.price === 'number' && (
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--ds-text-2))' }}>{fmt(plan.price)}</span>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: 'rgb(var(--ds-text-4))', marginTop: 2 }}>
            read from your chart{plan.readAt ? ` · ${new Date(plan.readAt).toLocaleString()}` : ''}
          </div>
        </div>

        <div style={{
          padding: '5px 12px', borderRadius: 999, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
          color: headerTone, border: `1px solid ${headerTone}66`, background: `${headerTone}14`,
        }}>
          {isBracket ? 'BOTH SIDES' : (scenarios[0]?.direction || plan.bias || 'range').toUpperCase()}
        </div>
      </div>

      {/* One column per scenario */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isBracket ? 'repeat(auto-fit, minmax(230px, 1fr))' : '1fr',
        gap: 1, background: 'var(--ds-border-sm)',
      }}>
        {scenarios.map((scenario, i) => (
          <ScenarioPane
            key={i}
            scenario={scenario}
            price={plan.price}
            isBest={isBracket && scenario === best.side && best.rr >= 1}
          />
        ))}
      </div>

      {/* Which side is worth taking — the sentence a coach must not omit */}
      {isBracket && best.rr > 0 && (
        <div style={{
          padding: '9px 16px', fontSize: 11.5, lineHeight: 1.5,
          borderTop: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))',
        }}>
          {best.rr >= 1
            ? <>The <strong style={{ color: toneFor(undefined, best.side?.direction) }}>{best.side?.direction}</strong> side
              pays up to <strong>{best.rr}R</strong> — the other side does not pay enough for the risk.</>
            : <>Neither side pays 1R from here. Nothing on this chart is worth the risk yet.</>}
        </div>
      )}

      {(plan.note || scenarios.some(s => s.invalidation)) && (
        <div style={{ padding: '10px 16px', fontSize: 11, color: 'rgb(var(--ds-text-4))', lineHeight: 1.55, borderTop: '1px solid var(--ds-border-sm)' }}>
          {!isBracket && scenarios[0]?.invalidation && (
            <div style={{ color: 'rgb(var(--ds-text-3))' }}>
              <strong style={{ color: RED }}>Wrong if:</strong> {scenarios[0].invalidation}
            </div>
          )}
          {!!plan.note && <div style={{ marginTop: 3 }}>{plan.note}</div>}
          <div style={{ marginTop: 5 }}>
            Levels computed from your chart's own candles. Not financial advice — size the position so a loss is survivable.
          </div>
        </div>
      )}
    </div>
  )
}

function ScenarioPane({ scenario, price, isBest }: { scenario: TradeScenario; price?: number; isBest: boolean }) {
  const tone = toneFor(undefined, scenario.direction)
  const targets = scenario.targets || []
  const maxRr = Math.max(1, ...targets.map(t => Number(t.rr) || 0))

  return (
    <div style={{ background: 'rgb(var(--ds-bg-2))', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: tone }} />
        <span style={{ fontSize: 11.5, fontWeight: 800, color: tone, letterSpacing: 0.3 }}>
          {(scenario.direction || 'plan').toUpperCase()}
        </span>
        {typeof scenario.trigger === 'number' && (
          <span style={{ fontSize: 10.5, color: 'rgb(var(--ds-text-4))' }}>
            {scenario.direction === 'short' ? 'below' : 'above'} {fmt(scenario.trigger)}
            {scenario.triggerLabel ? ` · ${scenario.triggerLabel}` : ''}
          </span>
        )}
        {isBest && (
          <span style={{
            marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
            background: `${tone}1f`, color: tone, border: `1px solid ${tone}55`,
          }}>BETTER R:R</span>
        )}
      </div>

      <Row label="Entry" value={scenario.entry ? `${fmt(scenario.entry.from)} – ${fmt(scenario.entry.to)}` : '—'} color="rgb(var(--ds-accent-soft))" />
      <Row label="Stop" value={fmt(scenario.stop ?? undefined)} color={RED} />
      {typeof price === 'number' && scenario.stop != null && scenario.entry && (
        <Row
          label="Risk / unit"
          value={fmt(Math.abs((scenario.entry.from + scenario.entry.to) / 2 - scenario.stop))}
          color="rgb(var(--ds-text-3))"
        />
      )}

      {/* Targets as bars, so the reward on each is visible, not just stated */}
      {targets.length > 0 && (
        <div style={{ marginTop: 9 }}>
          {targets.map((target, i) => {
            const rr = Number(target.rr) || 0
            return (
              <div key={i} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: 'rgb(var(--ds-text-3))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {target.label || `Target ${i + 1}`}
                  </span>
                  <span style={{ color: GREEN, fontWeight: 700, marginLeft: 8, whiteSpace: 'nowrap' }}>
                    {fmt(target.price)}{rr ? ` · ${rr}R` : ''}
                  </span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: 'rgb(var(--ds-text-1) / 0.07)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (rr / maxRr) * 100)}%`, height: '100%', borderRadius: 999,
                    background: rr >= 1 ? GREEN : AMBER,
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'rgb(var(--ds-text-4))' }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color }}>{value}</span>
    </div>
  )
}
