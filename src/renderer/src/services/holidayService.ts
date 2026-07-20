// Holiday detection for the homepage. Dates that move year to year (Easter,
// Thanksgiving, Mother's/Father's Day) are computed rather than hard-coded, so
// this keeps working without maintenance.

export interface Holiday {
  id: string
  /** Shown under the clock, e.g. "Christmas Eve" */
  name: string
  emoji: string
  /** Replaces "Good morning" when set */
  greeting?: string
  /** Two accent colours driving the orbs, glow and particles */
  colors: [string, string]
  /** Glyphs drifting across the background */
  particles: string[]
  /** How the particles move */
  motion: 'fall' | 'rise' | 'drift' | 'burst'
}

const ONE_DAY = 86400000

function ymd(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

/** Anonymous Gregorian algorithm — Easter Sunday for a given year. */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

/** The nth given weekday of a month (weekday: 0=Sun). n is 1-based. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1)
  const shift = (weekday - first.getDay() + 7) % 7
  return new Date(year, month, 1 + shift + (n - 1) * 7)
}

/** Inclusive day-window test, tolerant of month boundaries. */
function within(date: Date, start: Date, endInclusive: Date): boolean {
  const v = ymd(date)
  return v >= ymd(start) && v <= ymd(endInclusive)
}

function daysBefore(d: Date, n: number): Date {
  return new Date(d.getTime() - n * ONE_DAY)
}

/**
 * The holiday in effect on `date`, or null on an ordinary day.
 * Earlier entries win when windows overlap.
 */
export function getHoliday(date: Date = new Date()): Holiday | null {
  const y = date.getFullYear()
  const m = date.getMonth() // 0-based
  const d = date.getDate()

  // ── Fixed dates ──────────────────────────────────────────────────────────
  if (m === 0 && d === 1) return {
    id: 'new-year', name: "New Year's Day", emoji: '🎉',
    greeting: `Happy New Year`, colors: ['#fbbf24', '#f472b6'],
    particles: ['🎉', '✨', '🎊'], motion: 'burst',
  }

  if (m === 11 && (d === 30 || d === 31)) return {
    id: 'new-year-eve', name: "New Year's Eve", emoji: '🥂',
    greeting: 'Happy New Year’s Eve', colors: ['#fbbf24', '#a78bfa'],
    particles: ['✨', '🥂', '🎊'], motion: 'burst',
  }

  if (m === 1 && d >= 13 && d <= 14) return {
    id: 'valentines', name: "Valentine's Day", emoji: '❤️',
    greeting: 'Happy Valentine’s Day', colors: ['#fb7185', '#f472b6'],
    particles: ['❤️', '💕', '🌹'], motion: 'rise',
  }

  if (m === 2 && d === 17) return {
    id: 'st-patricks', name: "St. Patrick's Day", emoji: '🍀',
    greeting: 'Happy St. Patrick’s Day', colors: ['#34d399', '#a3e635'],
    particles: ['🍀', '☘️', '💚'], motion: 'drift',
  }

  if (m === 6 && d === 4) return {
    id: 'independence', name: 'Independence Day', emoji: '🎆',
    greeting: 'Happy Fourth of July', colors: ['#60a5fa', '#f87171'],
    particles: ['🎆', '🎇', '⭐'], motion: 'burst',
  }

  if (m === 9 && d >= 28 && d <= 31) return {
    id: 'halloween', name: d === 31 ? 'Halloween' : 'Halloween week', emoji: '🎃',
    greeting: d === 31 ? 'Happy Halloween' : undefined,
    colors: ['#fb923c', '#a855f7'],
    particles: ['🎃', '👻', '🦇', '🕸️'], motion: 'drift',
  }

  // ── Christmas window ─────────────────────────────────────────────────────
  if (m === 11 && d >= 20 && d <= 26) {
    const name = d === 24 ? 'Christmas Eve' : d === 25 ? 'Christmas Day' : 'Christmas season'
    return {
      id: 'christmas', name, emoji: '🎄',
      greeting: d === 25 ? 'Merry Christmas' : d === 24 ? 'Merry Christmas Eve' : undefined,
      colors: ['#f87171', '#34d399'],
      particles: ['❄️', '🎄', '🎁', '⭐'], motion: 'fall',
    }
  }

  // ── Computed dates ───────────────────────────────────────────────────────
  const easter = easterSunday(y)
  if (within(date, daysBefore(easter, 2), easter)) {
    const isDay = ymd(date) === ymd(easter)
    return {
      id: 'easter', name: isDay ? 'Easter Sunday' : 'Easter weekend', emoji: '🐣',
      greeting: isDay ? 'Happy Easter' : undefined,
      colors: ['#f9a8d4', '#a3e635'],
      particles: ['🐣', '🌷', '🥚', '🐰'], motion: 'rise',
    }
  }

  // Thanksgiving — 4th Thursday of November (US)
  const thanksgiving = nthWeekday(y, 10, 4, 4)
  if (ymd(date) === ymd(thanksgiving)) return {
    id: 'thanksgiving', name: 'Thanksgiving', emoji: '🦃',
    greeting: 'Happy Thanksgiving', colors: ['#fb923c', '#fbbf24'],
    particles: ['🦃', '🍁', '🍂', '🥧'], motion: 'fall',
  }

  // Mother's Day — 2nd Sunday of May
  if (ymd(date) === ymd(nthWeekday(y, 4, 0, 2))) return {
    id: 'mothers-day', name: "Mother's Day", emoji: '💐',
    greeting: 'Happy Mother’s Day', colors: ['#f472b6', '#c084fc'],
    particles: ['💐', '🌸', '💖'], motion: 'rise',
  }

  // Father's Day — 3rd Sunday of June
  if (ymd(date) === ymd(nthWeekday(y, 5, 0, 3))) return {
    id: 'fathers-day', name: "Father's Day", emoji: '🧔',
    greeting: 'Happy Father’s Day', colors: ['#38bdf8', '#818cf8'],
    particles: ['👔', '⭐', '🧰'], motion: 'drift',
  }

  return null
}

// Users who don't want the seasonal look can switch it off.
const PREF_KEY = 'aihub-holiday-theme'

export function holidayThemeEnabled(): boolean {
  try { return localStorage.getItem(PREF_KEY) !== 'off' } catch { return true }
}

export function setHolidayThemeEnabled(on: boolean): void {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off') } catch {}
}
