import directory from './airports.json'
export interface Airport { iata: string; icao: string; name: string; city: string; country: string; scheduled: boolean }
export const AIRPORTS: Airport[] = directory.airports.map(row => ({ iata: String(row[0]), icao: String(row[1]), name: String(row[2]), city: String(row[3]), country: String(row[4]), scheduled: Boolean(row[5]) }))
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const index = AIRPORTS.map(a => ({ airport: a, text: normalize(`${a.iata} ${a.icao} ${a.name} ${a.city} ${a.country}`) }))
const byCode = new Map<string, Airport>()
for (const a of AIRPORTS) { byCode.set(a.iata, a); if (a.icao) byCode.set(a.icao, a) }
export function airportLabel(a: Airport): string { return `${a.iata} · ${a.name}${a.city ? ` — ${a.city}` : ''}` }
export function resolveAirport(value: string): Airport | null {
  const code = value.trim().toUpperCase()
  const direct = byCode.get(code)
  if (direct) return direct
  const match = /^([A-Z]{3}) · /.exec(value)
  const airport = match && byCode.get(match[1])
  return airport && airportLabel(airport) === value ? airport : null
}
export function searchAirports(query: string, limit = 8): Airport[] {
  const q = normalize(query)
  if (!q) return []
  const words = q.split(/\s+/)
  return index.filter(x => words.every(w => x.text.includes(w))).map(({ airport: a }) => ({ a, score: a.iata.toLowerCase() === q || a.icao.toLowerCase() === q ? 100 : a.iata.toLowerCase().startsWith(q) || (a.icao && a.icao.toLowerCase().startsWith(q)) ? 70 : normalize(a.city) === q ? 50 : 20 })).sort((a, b) => b.score - a.score || Number(b.a.scheduled) - Number(a.a.scheduled) || a.a.name.localeCompare(b.a.name)).slice(0, limit).map(x => x.a)
}
