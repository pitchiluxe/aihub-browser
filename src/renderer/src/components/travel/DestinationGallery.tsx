import React, { useEffect, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { fetchDestinationPhotos, type DestinationPhoto } from './destinationPhotos'
import type { Trip } from './flightsRentals'

export default function DestinationGallery({ trip, onNavigate }: { trip: Trip; onNavigate: (url: string) => void }) {
  const [photos, setPhotos] = useState<DestinationPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string[]>([])
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    let alive = true
    setPhotos([]); setFailed([]); setLoading(true)
    void fetchDestinationPhotos(trip, fetch, controller.signal).then(items => { if (alive) { setPhotos(items); setLoading(false) } })
    return () => { alive = false; clearTimeout(timeout); controller.abort() }
  }, [trip.destination, trip.kind])
  const visible = photos.filter(p => !failed.includes(p.image))
  return <section className="fare-gallery" aria-label="Destination photos">
    <div className="fare-section-heading"><h2><ImageIcon size={17} /> Destination preview</h2><span>Travel photos · not offer photos</span></div>
    {loading ? <p role="status">Finding destination photos…</p> : !visible.length ? <p>Destination photos are unavailable right now. Your provider comparisons are ready below.</p> : <div className="fare-photo-grid">{visible.map(p => <figure key={p.image}>
      <button className="fare-photo-button" onClick={() => onNavigate(p.source)} aria-label={`View photo source: ${p.title}`}><img src={p.image} alt={p.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(f => [...f, p.image])} /></button>
      <figcaption><strong>{p.title}</strong><button className="fare-photo-credit" onClick={() => onNavigate(p.source)}>{p.creator} · {p.license} · Wikimedia Commons</button></figcaption>
    </figure>)}</div>}
  </section>
}
