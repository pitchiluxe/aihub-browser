import { apiRequest } from './rest'
import { API_BASES } from '../auth/config'

// Google Calendar API module (read-only).
export interface CalendarSummary {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
}

export interface CalendarEvent {
  id: string
  summary: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  location?: string
  htmlLink?: string
}

const base = API_BASES.calendar

export async function listCalendars(): Promise<CalendarSummary[]> {
  const res = await apiRequest('GET', `${base}/users/me/calendarList?fields=items(id,summary,primary,backgroundColor)`)
  return res.items || []
}

export async function listEvents(
  calendarId = 'primary',
  opts: { timeMin?: string; timeMax?: string; maxResults?: number } = {}
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(opts.maxResults ?? 25),
    timeMin: opts.timeMin || new Date().toISOString(),
    fields: 'items(id,summary,start,end,location,htmlLink)',
  })
  if (opts.timeMax) params.set('timeMax', opts.timeMax)
  const res = await apiRequest('GET', `${base}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`)
  return res.items || []
}
