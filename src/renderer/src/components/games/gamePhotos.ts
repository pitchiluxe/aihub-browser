// Real photographs for the built-in and family-table games. Every picture comes
// from Wikimedia Commons under a free licence (public domain, CC0, CC BY or
// CC BY-SA) and is credited in the room's photo credits.
import CREDITS from './photos/credits.json'

export interface PhotoCredit { title: string; author: string; license: string; source: string }
const URLS = import.meta.glob('./photos/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

export const PHOTO_CREDITS = CREDITS as Record<string, PhotoCredit>
export const gamePhoto = (id: string): string | undefined => URLS[`./photos/${id}.jpg`]
export const photoCaption = (id: string): string => { const credit = PHOTO_CREDITS[id]; return credit ? `Photo: ${credit.author} · ${credit.license} · Wikimedia Commons` : '' }
