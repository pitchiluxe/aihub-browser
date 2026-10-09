import { describe, it, expect, vi } from 'vitest'
import { destinationPhotoQuery, fetchDestinationPhotos } from './destinationPhotos'
import type { Trip } from './flightsRentals'
const trip: Trip = { kind: 'flights', origin: 'KJFK', destination: 'LFPG', start: '2099-06-10', end: '2099-06-17', travelers: 2, budget: '', currency: 'USD', flexible: true }
describe('destination photos', () => {
  it('searches the selected airport city rather than its ICAO code', () => {
    expect(destinationPhotoQuery(trip)).toBe('Paris France skyline filetype:bitmap')
    expect(destinationPhotoQuery(trip)).not.toContain('LFPG')
  })
  it('returns licensed Wikimedia photos with creator and source, rejecting unsafe URLs', async () => {
    const photo = { title: 'File:Paris.jpg', imageinfo: [{ thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/a/ab/Paris.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Paris.jpg', extmetadata: { Artist: { value: '<a href="https://example.com">Photographer</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { pages: { 1: photo, 2: { ...photo, imageinfo: [{ ...photo.imageinfo[0], thumburl: 'https://evil.test/track.jpg' }] } } } }) })
    const photos = await fetchDestinationPhotos(trip, fetcher as any)
    expect(photos).toHaveLength(1)
    expect(photos[0].creator).toBe('Photographer')
    expect(photos[0].license).toBe('CC BY-SA 4.0')
    expect(photos[0].source).toContain('commons.wikimedia.org')
  })
  it('returns an empty gallery on a failed request without breaking comparisons', async () => {
    expect(await fetchDestinationPhotos(trip, vi.fn().mockRejectedValue(new Error('offline')) as any)).toEqual([])
  })
})
