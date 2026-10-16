import React from 'react'
import { Music } from 'lucide-react'
import type { DjTrack } from './engine/DjEngine'
import { useCover } from './coverLookup'

/** A song's cover beside it in a list — its own artwork, else one looked up for it; a quiet placeholder only when none exists. */
export default function TrackThumb({ track }: { track: Pick<DjTrack, 'cover' | 'title'> & Partial<Pick<DjTrack, 'artist' | 'youtubeId'>> }) {
  const { src, onError } = useCover(track)
  if (!src) return <span className="dj-thumb dj-thumb-none" aria-hidden="true"><Music size={12} /></span>
  return <img className="dj-thumb" src={src} alt="" loading="lazy" draggable={false} onError={onError} />
}
