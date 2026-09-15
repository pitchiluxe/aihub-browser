/**
 * AIHub Browser — the Morning Brief.
 *
 * Six features already know something worth saying first thing: Watch knows
 * which pages changed overnight, the calendar knows what is coming, the
 * mailbox knows what is unanswered, Recall knows what is due, the Ledger knows
 * what was charged. Each of them requires you to go and look, so in practice
 * none of them get looked at.
 *
 * This assembles one page out of what they already hold. It is the only thing
 * here that has to be true for the feature to work: a brief that pads itself
 * out with sections saying "nothing to report" is a page people stop opening,
 * so empty sections are dropped and a genuinely quiet morning says so in one
 * line.
 *
 * Pure: everything is passed in. No IPC, no clock of its own.
 */

export interface BriefItem {
  text: string
  /** Where to go when this line is clicked. */
  url?: string
  /** An AIHub page, when the answer is not a web address. */
  page?: string
  /** Shown to the right — a time, a count, an age. */
  meta?: string
  /** Lifts the row visually. Reserve it for things with a deadline. */
  urgent?: boolean
}

export interface BriefSection {
  key: string
  title: string
  items: BriefItem[]
}

export interface BriefInput {
  now: number
  /** Watches whose page changed and has not been acknowledged. */
  watches?: { title: string; url: string; lastChanged?: number; triggered?: boolean }[]
  /** Calendar events, already filtered to the ones this account can see. */
  events?: { summary: string; start: number; location?: string }[]
  /** Unread or unanswered mail. */
  threads?: { subject: string; from: string; date: string; unread?: boolean }[]
  /** How many Recall items are due. */
  recallDue?: number
  /** Downloads that finished since the last brief. */
  downloads?: { filename: string; completedAt?: number; state: string }[]
}

export const DAY_MS = 86_400_000

/** "Good morning" is wrong at 9pm, and being wrong about that reads as sloppy. */
export function greeting(now: number): string {
  const hour = new Date(now).getHours()
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** A clock time for an event today, or a day and time for one further out. */
export function formatEventTime(start: number, now: number): string {
  const d = new Date(start)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameDay = new Date(now).toDateString() === d.toDateString()
  if (sameDay) return time
  const tomorrow = new Date(now + DAY_MS).toDateString() === d.toDateString()
  return tomorrow ? `tomorrow ${time}` : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

/** How long ago, in the coarse terms a brief wants. */
export function ago(ts: number | undefined, now: number): string {
  if (!ts) return ''
  const mins = Math.max(0, Math.round((now - ts) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Everything worth saying, in the order it matters.
 *
 * Calendar first because it is the only part with a deadline attached;
 * everything else can be read later in the day without cost.
 */
export function buildBrief(input: BriefInput): BriefSection[] {
  const now = input.now
  const sections: BriefSection[] = []

  const events = (input.events || [])
    .filter(e => e.start >= now - 30 * 60_000 && e.start <= now + DAY_MS)
    .sort((a, b) => a.start - b.start)
  if (events.length) {
    sections.push({
      key: 'calendar',
      title: 'Next 24 hours',
      items: events.map(e => ({
        text: e.summary || '(no title)',
        meta: formatEventTime(e.start, now),
        // Within the hour is the only thing here that changes what you do next.
        urgent: e.start - now <= 3_600_000,
      })),
    })
  }

  const changed = (input.watches || []).filter(w => w.triggered)
  if (changed.length) {
    sections.push({
      key: 'watches',
      title: 'Pages that changed',
      items: changed.map(w => ({
        text: w.title || w.url,
        url: w.url,
        meta: ago(w.lastChanged, now),
      })),
    })
  }

  const unread = (input.threads || []).filter(t => t.unread !== false).slice(0, 6)
  if (unread.length) {
    sections.push({
      key: 'mail',
      title: 'Waiting on you',
      items: unread.map(t => ({
        text: t.subject || '(no subject)',
        meta: senderName(t.from),
        page: 'mail',
      })),
    })
  }

  if (input.recallDue && input.recallDue > 0) {
    sections.push({
      key: 'recall',
      title: 'Recall',
      items: [{
        text: `${input.recallDue} ${input.recallDue === 1 ? 'thing' : 'things'} to review`,
        page: 'recall',
      }],
    })
  }

  const recent = (input.downloads || [])
    .filter(d => d.state === 'completed' && d.completedAt && now - d.completedAt < DAY_MS)
    .slice(0, 5)
  if (recent.length) {
    sections.push({
      key: 'downloads',
      title: 'Downloaded yesterday',
      items: recent.map(d => ({ text: d.filename, meta: ago(d.completedAt, now), page: 'downloads' })),
    })
  }

  return sections
}

/** Just the human part of a From header. */
export function senderName(from: string): string {
  const raw = String(from || '').trim()
  const named = raw.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)
  if (named && named[1].trim()) return named[1].trim()
  return (raw.match(/<([^>]+)>/)?.[1] || raw).split('@')[0] || raw
}

/** One line summarising the brief, for the top of the page. */
export function summarise(sections: BriefSection[]): string {
  const total = sections.reduce((n, s) => n + s.items.length, 0)
  if (!total) return 'Nothing needs you right now.'
  const parts = sections.map(s => `${s.items.length} ${s.title.toLowerCase()}`)
  return parts.join(' · ')
}
