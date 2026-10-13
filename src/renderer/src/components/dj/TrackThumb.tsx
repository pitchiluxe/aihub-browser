import React, { useState } from 'react'
import { Music } from 'lucide-react'
import type { DjTrack } from './engine/DjEngine'

/** A song's cover beside it in a list (YouTube thumbnail or file artwork); a quiet placeholder otherwise. */
export default function TrackThumb({ track }: { track: Pick<DjTrack, 'cover' | 'title'> }) {
  const [failed, setFailed] = useState(false)
  if (!track.cover || failed) return <span className="dj-thumb dj-thumb-none" aria-hidden="true"><Music size={12} /></span>
  return <img className="dj-thumb" src={track.cover} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
}
