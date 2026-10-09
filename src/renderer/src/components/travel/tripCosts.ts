export const COST_CATEGORIES = [
  { id: 'flights', label: 'Flight fare · all travelers', detail: 'Enter the round-trip total for everyone.' },
  { id: 'baggage', label: 'Baggage, seats & airline fees', detail: 'Include fees needed for your trip.' },
  { id: 'hotel', label: 'Hotel · full stay', detail: 'Enter the full stay amount before taxes, if shown separately.' },
  { id: 'hotelFees', label: 'Hotel taxes & other fees', detail: 'Taxes, resort fees, cleaning fees and deposits.' },
  { id: 'transfers', label: 'Airport transfers · round trip', detail: 'Ground transport between airports and your stay.' },
  { id: 'rental', label: 'Rental car · full period', detail: 'Enter the full rental amount before optional coverage.' },
  { id: 'rentalInsurance', label: 'Rental insurance & extras', detail: 'Coverage, fuel, tolls and other required extras.' },
] as const
export type CostCategory = typeof COST_CATEGORIES[number]['id']
export interface TripCostLine { id: CostCategory; amount: string }
export interface TripEstimate { updatedAt: string; currency: string; lines: TripCostLine[] }
export interface TripEstimateSummary { knownTotalCents: number; unknownCount: number; invalidCount: number }
const CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD'])
const AMOUNT = /^\d{1,9}(?:\.\d{1,2})?$/

export function createTripEstimate(currency: string, now = new Date()): TripEstimate {
  return { updatedAt: now.toISOString(), currency: CURRENCIES.has(currency) ? currency : 'USD', lines: COST_CATEGORIES.map(category => ({ id: category.id, amount: '' })) }
}

export function parseCostCents(amount: string): number | null {
  const value = amount.trim()
  if (!value || !AMOUNT.test(value)) return null
  const [units, fraction = ''] = value.split('.')
  return Number(units) * 100 + Number(fraction.padEnd(2, '0'))
}

export function summarizeTripEstimate(estimate: TripEstimate): TripEstimateSummary {
  let knownTotalCents = 0, unknownCount = 0, invalidCount = 0
  for (const line of estimate.lines) {
    if (!line.amount.trim()) { unknownCount++; continue }
    const cents = parseCostCents(line.amount)
    if (cents === null) invalidCount++
    else knownTotalCents += cents
  }
  return { knownTotalCents, unknownCount, invalidCount }
}

export function validateTripEstimate(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Estimate data is invalid.'
  const estimate = value as TripEstimate
  if (typeof estimate.updatedAt !== 'string' || estimate.updatedAt.length > 32 || !Number.isFinite(Date.parse(estimate.updatedAt))) return 'Estimate date is invalid.'
  if (typeof estimate.currency !== 'string' || !CURRENCIES.has(estimate.currency)) return 'Estimate currency is unsupported.'
  if (!Array.isArray(estimate.lines) || estimate.lines.length !== COST_CATEGORIES.length) return 'Estimate categories are invalid.'
  const ids = new Set<string>()
  for (const line of estimate.lines) {
    if (!line || !COST_CATEGORIES.some(category => category.id === line.id) || ids.has(line.id)) return 'Estimate categories are invalid.'
    if (typeof line.amount !== 'string' || line.amount.length > 12 || (line.amount !== '' && parseCostCents(line.amount) === null)) return 'Enter a valid non-negative amount with up to two decimals.'
    ids.add(line.id)
  }
  return null
}

export function formatCostCents(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100)
}
