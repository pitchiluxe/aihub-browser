// The verse of the day.
//
// Deterministic from the calendar date and nothing else: the same day always
// yields the same reference, so the card survives a remount, a restart, and a
// week offline. No network, no model, no stored "today's pick" that can drift
// out of step with the clock.
//
// The list is curated rather than generated. A random verse from the whole
// Bible is mostly genealogy and tabernacle measurements; these are passages
// worth sitting with, weighted across both testaments.

const CURATED: string[] = [
  // Torah
  'GEN.1.1', 'GEN.1.27', 'GEN.2.24', 'GEN.9.13', 'GEN.28.15', 'GEN.50.20',
  'EXO.14.14', 'EXO.15.2', 'EXO.20.12', 'EXO.33.14', 'EXO.34.6',
  'LEV.19.18', 'NUM.6.24', 'NUM.6.25', 'NUM.6.26', 'NUM.23.19',
  'DEU.6.5', 'DEU.31.6', 'DEU.31.8', 'DEU.30.19', 'DEU.33.27',
  // History
  'JOS.1.9', 'JOS.24.15', 'JDG.6.12', 'RUT.1.16', '1SA.16.7', '1SA.17.47',
  '2SA.22.31', '1KI.19.12', '2KI.6.16', '1CH.16.11', '1CH.29.11',
  '2CH.7.14', '2CH.20.15', 'NEH.8.10', 'EST.4.14', 'EZR.3.11',
  // Wisdom
  'JOB.19.25', 'JOB.23.10', 'JOB.42.2',
  'PSA.1.1', 'PSA.16.11', 'PSA.19.1', 'PSA.19.14', 'PSA.23.1', 'PSA.23.4',
  'PSA.27.1', 'PSA.27.14', 'PSA.30.5', 'PSA.32.8', 'PSA.34.8', 'PSA.34.18',
  'PSA.37.4', 'PSA.37.5', 'PSA.42.11', 'PSA.46.1', 'PSA.46.10', 'PSA.51.10',
  'PSA.55.22', 'PSA.56.3', 'PSA.62.1', 'PSA.63.1', 'PSA.73.26', 'PSA.84.11',
  'PSA.86.15', 'PSA.90.12', 'PSA.91.1', 'PSA.91.2', 'PSA.94.19', 'PSA.100.4',
  'PSA.103.12', 'PSA.116.1', 'PSA.118.24', 'PSA.119.11', 'PSA.119.105',
  'PSA.121.1', 'PSA.121.2', 'PSA.126.5', 'PSA.130.5', 'PSA.133.1',
  'PSA.136.1', 'PSA.139.14', 'PSA.139.23', 'PSA.143.8', 'PSA.145.18', 'PSA.147.3',
  'PRO.1.7', 'PRO.3.5', 'PRO.3.6', 'PRO.4.23', 'PRO.11.25', 'PRO.15.1',
  'PRO.16.3', 'PRO.16.9', 'PRO.17.17', 'PRO.18.10', 'PRO.19.21', 'PRO.22.6',
  'PRO.27.17', 'PRO.29.25', 'PRO.31.25',
  'ECC.3.1', 'ECC.3.11', 'ECC.4.9', 'ECC.12.13', 'SNG.2.11',
  // Prophets
  'ISA.1.18', 'ISA.6.8', 'ISA.9.6', 'ISA.26.3', 'ISA.30.21', 'ISA.40.8',
  'ISA.40.29', 'ISA.40.31', 'ISA.41.10', 'ISA.41.13', 'ISA.43.1', 'ISA.43.2',
  'ISA.43.19', 'ISA.53.5', 'ISA.54.10', 'ISA.55.8', 'ISA.55.11', 'ISA.58.11',
  'ISA.61.1', 'ISA.61.3',
  'JER.1.5', 'JER.17.7', 'JER.29.11', 'JER.31.3', 'JER.32.27', 'JER.33.3',
  'LAM.3.22', 'LAM.3.23', 'EZK.36.26', 'DAN.3.17', 'DAN.6.23',
  'HOS.6.3', 'JOL.2.25', 'AMO.5.24', 'JON.2.9', 'MIC.6.8', 'MIC.7.7',
  'NAM.1.7', 'HAB.3.19', 'ZEP.3.17', 'HAG.2.4', 'ZEC.4.6', 'MAL.3.10',
  // Gospels
  'MAT.5.14', 'MAT.5.16', 'MAT.6.21', 'MAT.6.33', 'MAT.6.34', 'MAT.7.7',
  'MAT.7.12', 'MAT.11.28', 'MAT.11.29', 'MAT.16.26', 'MAT.19.26', 'MAT.22.37',
  'MAT.28.19', 'MAT.28.20',
  'MRK.9.23', 'MRK.10.27', 'MRK.10.45', 'MRK.11.24', 'MRK.12.31', 'MRK.16.15',
  'LUK.1.37', 'LUK.6.31', 'LUK.6.38', 'LUK.9.23', 'LUK.10.27', 'LUK.12.7',
  'LUK.12.34', 'LUK.15.7', 'LUK.18.27',
  'JHN.1.1', 'JHN.1.5', 'JHN.1.12', 'JHN.3.16', 'JHN.3.17', 'JHN.4.24',
  'JHN.8.12', 'JHN.8.32', 'JHN.10.10', 'JHN.11.25', 'JHN.13.34', 'JHN.14.1',
  'JHN.14.6', 'JHN.14.27', 'JHN.15.5', 'JHN.15.13', 'JHN.16.33',
  // Acts and letters
  'ACT.1.8', 'ACT.2.38', 'ACT.4.12', 'ACT.16.31', 'ACT.20.35',
  'ROM.1.16', 'ROM.5.8', 'ROM.6.23', 'ROM.8.1', 'ROM.8.18', 'ROM.8.28',
  'ROM.8.31', 'ROM.8.38', 'ROM.8.39', 'ROM.10.9', 'ROM.12.1', 'ROM.12.2',
  'ROM.12.12', 'ROM.15.13',
  '1CO.10.13', '1CO.13.4', '1CO.13.13', '1CO.15.58', '1CO.16.14',
  '2CO.1.3', '2CO.4.16', '2CO.4.18', '2CO.5.7', '2CO.5.17', '2CO.9.7', '2CO.12.9',
  'GAL.2.20', 'GAL.5.22', 'GAL.6.9',
  'EPH.2.8', 'EPH.2.10', 'EPH.3.20', 'EPH.4.32', 'EPH.6.10',
  'PHP.1.6', 'PHP.2.3', 'PHP.3.14', 'PHP.4.4', 'PHP.4.6', 'PHP.4.7',
  'PHP.4.8', 'PHP.4.13', 'PHP.4.19',
  'COL.3.2', 'COL.3.12', 'COL.3.15', 'COL.3.23',
  '1TH.5.16', '1TH.5.17', '1TH.5.18', '2TH.3.3',
  '1TI.4.12', '1TI.6.6', '2TI.1.7', '2TI.3.16', 'TIT.3.5', 'PHM.1.6',
  'HEB.4.12', 'HEB.4.16', 'HEB.10.24', 'HEB.11.1', 'HEB.12.1', 'HEB.12.2', 'HEB.13.8',
  'JAS.1.2', 'JAS.1.5', 'JAS.1.17', 'JAS.1.22', 'JAS.4.8', 'JAS.5.16',
  '1PE.2.9', '1PE.4.10', '1PE.5.6', '1PE.5.7', '2PE.3.9',
  '1JN.1.9', '1JN.3.1', '1JN.4.4', '1JN.4.18', '1JN.4.19', '1JN.5.14',
  '2JN.1.6', '3JN.1.4', 'JUD.1.24',
  'REV.3.20', 'REV.21.4', 'REV.21.5', 'REV.22.13',
]

/** The full curated list, in list order. Exported so tests can walk it. */
export function verseList(): readonly string[] {
  return CURATED
}

/** Local calendar date as `YYYY-MM-DD`. UTC would flip the verse mid-evening. */
export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * FNV-1a over the date string.
 *
 * A plain "days since epoch, modulo length" walks the list in order, so a week
 * of daily verses would march through Genesis together. Hashing scatters
 * consecutive days across the whole list while staying perfectly repeatable.
 */
export function hashDay(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** The reference for a given day. Same day in, same reference out. */
export function verseForDay(date: Date | string = new Date()): string {
  const key = typeof date === 'string' ? date : dayKey(date)
  return CURATED[hashDay(key) % CURATED.length]
}

/** How many days in a row the same verse would repeat — used only by tests. */
export function spreadOverDays(start: Date, days: number): string[] {
  const out: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    out.push(verseForDay(d))
  }
  return out
}
