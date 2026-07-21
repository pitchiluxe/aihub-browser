// Shared free-VPN location list — used by both the VPN page and the toolbar
// quick-toggle so the two can never drift apart.

export interface FreeCountry {
  cc: string
  name: string
  flag: string
}

export const FREE_COUNTRIES: FreeCountry[] = [
  { cc: 'US', name: 'United States',  flag: '🇺🇸' },
  { cc: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { cc: 'CA', name: 'Canada',         flag: '🇨🇦' },
  { cc: 'FR', name: 'France',         flag: '🇫🇷' },
  { cc: 'DE', name: 'Germany',        flag: '🇩🇪' },
  { cc: 'NL', name: 'Netherlands',    flag: '🇳🇱' },
  { cc: 'BE', name: 'Belgium',        flag: '🇧🇪' },
  { cc: 'ES', name: 'Spain',          flag: '🇪🇸' },
  { cc: 'IT', name: 'Italy',          flag: '🇮🇹' },
  { cc: 'CH', name: 'Switzerland',    flag: '🇨🇭' },
  { cc: 'SE', name: 'Sweden',         flag: '🇸🇪' },
  { cc: 'PL', name: 'Poland',         flag: '🇵🇱' },
  { cc: 'IE', name: 'Ireland',        flag: '🇮🇪' },
  { cc: 'JP', name: 'Japan',          flag: '🇯🇵' },
  { cc: 'SG', name: 'Singapore',      flag: '🇸🇬' },
  { cc: 'IN', name: 'India',          flag: '🇮🇳' },
  { cc: 'AU', name: 'Australia',      flag: '🇦🇺' },
  { cc: 'BR', name: 'Brazil',         flag: '🇧🇷' },
]

export const flagFor = (cc?: string): string =>
  FREE_COUNTRIES.find(c => c.cc === cc)?.flag || '🌍'

// Remembering the last country lets the toolbar reconnect in one click
// instead of making the user pick again every time.
const LAST_KEY = 'vpn-last-country'

export function rememberCountry(c: FreeCountry): void {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(c)) } catch {}
}

export function lastCountry(): FreeCountry | null {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    if (!raw) return null
    const c = JSON.parse(raw)
    return c && typeof c.cc === 'string' ? c as FreeCountry : null
  } catch { return null }
}
