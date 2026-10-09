import { resolveAirport } from './airports'
import type { Trip } from './flightsRentals'
export interface DestinationPhoto { title: string; image: string; source: string; creator: string; license: string }
const text = (value: unknown) => String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
export function destinationPhotoQuery(trip: Trip): string {
  const airport = resolveAirport(trip.destination)
  const country = airport ? new Intl.DisplayNames(['en'], { type: 'region' }).of(airport.country) || airport.country : ''
  const city = airport?.city.replace(/\([^)]*\)/g, '').trim()
  return `${airport ? city || airport.name : trip.destination} ${country} ${trip.kind === 'flights' && airport ? 'skyline' : 'travel'} filetype:bitmap`
}
function trustedUrl(value: unknown, host: string): value is string {
  try { const u = new URL(String(value)); return u.protocol === 'https:' && u.hostname === host && !u.username && !u.password } catch { return false }
}
export async function fetchDestinationPhotos(trip: Trip, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<DestinationPhoto[]> {
  try {
    const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: destinationPhotoQuery(trip), gsrnamespace: '6', gsrlimit: '4', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '640', iiextmetadatafilter: 'Artist|LicenseShortName', iiextmetadatalanguage: 'en' })
    const response = await fetcher(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: signal || AbortSignal.timeout(12000) })
    if (!response.ok) return []
    const data = await response.json()
    const seen = new Set<string>()
    const photos: DestinationPhoto[] = []
    const pages: any[] = Object.values(data?.query?.pages || {})
    pages.sort((a, b) => (a.index || 0) - (b.index || 0))
    for (const page of pages) {
      const info = page.imageinfo?.[0]
      const license = text(info?.extmetadata?.LicenseShortName?.value)
      if (!(trustedUrl(info?.thumburl, 'upload.wikimedia.org') || trustedUrl(info?.thumburl, 'thumb.wikimedia.org')) || !trustedUrl(info?.descriptionurl, 'commons.wikimedia.org') || !/^(CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain)$/i.test(license) || seen.has(info.thumburl)) continue
      seen.add(info.thumburl)
      photos.push({ title: text(page.title).replace(/^File:/, '').replace(/\.(jpe?g|png|webp)$/i, ''), image: info.thumburl, source: info.descriptionurl, creator: text(info.extmetadata?.Artist?.value) || 'Wikimedia Commons contributor', license })
      if (photos.length === 3) break
    }
    return photos
  } catch { return [] }
}
