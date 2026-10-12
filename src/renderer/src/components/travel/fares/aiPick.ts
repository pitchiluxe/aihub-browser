// src/renderer/src/components/travel/fares/aiPick.ts
// The AI never sees a booking page. It gets the normalized table — numbers the
// parsers already validated — and must answer with one row key from it. A
// pick for a row that isn't there is a hallucination and is dropped.
import type { BagNeeds, FareRow } from '../../../../../shared/fares/rank'

const MAX_ROWS = 15

export function buildPickPrompt(rows: FareRow[], ctx: { adults: number; needs: BagNeeds }) {
  const table = rows.slice(0, MAX_ROWS).map(r => ({
    key: r.key,
    airlines: r.offer.airlines.join(' + '),
    depart: r.offer.departTime, arrive: `${r.offer.arriveTime}${r.offer.arriveDayOffset ? ` +${r.offer.arriveDayOffset}d` : ''}`,
    stops: r.offer.stops, hours: +(r.offer.durationMin / 60).toFixed(1),
    fare: r.best, bagFeesEst: r.bagFee, trueTotal: r.trueTotal, sitesAgreeing: r.agreement,
  }))
  return [
    { role: 'system', content: 'You pick the best-value flight from a table. Reply with ONLY a JSON object {"key": "<row key>", "reason": "<one sentence, max 25 words, citing numbers from the table>"}. The key must be copied exactly from the table. Never invent prices.' },
    { role: 'user', content: `Travellers: ${ctx.adults}. Bringing: ${ctx.needs.carry ? 'carry-on' : 'no carry-on'}, ${ctx.needs.checked ? 'checked bag' : 'no checked bag'}.\nTable (JSON):\n${JSON.stringify(table)}` },
  ]
}

export function parsePick(reply: string, rows: FareRow[]): { key: string; reason: string } | null {
  const m = /\{[\s\S]*\}/.exec(reply || '')
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const key = String(j?.key || '')
    const reason = String(j?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!reason || !rows.some(r => r.key === key)) return null
    return { key, reason }
  } catch { return null }
}

export async function fetchAiPick(rows: FareRow[], ctx: { adults: number; needs: BagNeeds }, chat: (m: any[]) => Promise<any>) {
  if (rows.length < 2) return null
  try {
    const res = await chat(buildPickPrompt(rows, ctx))
    if (!res?.content || res.provider === 'none') return null
    return parsePick(String(res.content), rows)
  } catch { return null }
}
