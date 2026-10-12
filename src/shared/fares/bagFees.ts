// src/shared/fares/bagFees.ts
// Estimated ROUND-TRIP bag fees per traveller, USD, for the first bag paid at
// booking. Airlines change these; the UI labels every figure "est.". The point
// is ordering — a $162 fare that needs $130 of bags is not cheaper than $190
// with a carry-on included — not to quote an exact fee.
const FEES: Record<string, { carry: number; checked: number }> = {
  frontier: { carry: 130, checked: 120 },
  spirit:   { carry: 120, checked: 110 },
  allegiant:{ carry: 100, checked: 100 },
  'sun country': { carry: 80, checked: 80 },
  breeze:   { carry: 70, checked: 80 },
  avelo:    { carry: 70, checked: 80 },
  delta:    { carry: 0, checked: 80 },
  american: { carry: 0, checked: 80 },
  'american airlines': { carry: 0, checked: 80 },
  united:   { carry: 0, checked: 80 },
  alaska:   { carry: 0, checked: 80 },
  jetblue:  { carry: 0, checked: 90 },
  southwest:{ carry: 0, checked: 70 },
  hawaiian: { carry: 0, checked: 60 },
}
const UNKNOWN = { carry: 0, checked: 80 }

export function estimatedBagFee(airline: string, kind: 'carry' | 'checked'): number {
  return (FEES[airline.trim().toLowerCase()] ?? UNKNOWN)[kind]
}
