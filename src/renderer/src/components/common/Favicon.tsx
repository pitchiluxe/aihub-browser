import React, { useEffect, useState } from 'react'
import { letterTileDataUri } from '../../../../shared/favicon'

/**
 * A site icon that cannot produce a console error.
 *
 * The `src` is only ever a data URI — either the real icon, fetched and cached
 * by the main process, or a generated letter tile. Nothing here reaches the
 * network, so there is no request to 404 and nothing for Chromium to log.
 *
 * The tile renders first and is replaced if a real icon arrives, which also
 * removes the empty-square flash the old <img> had while Google answered.
 */

/** Resolved icons for this window, so remounting a list is free. */
const memo = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

function resolve(url: string): Promise<string | null> {
  const hit = pending.get(url)
  if (hit) return hit

  const api = (window as any).electronAPI?.favicon
  if (!api) return Promise.resolve(null)

  const work = api.get(url)
    .then((r: any) => {
      const data = r?.data ?? null
      memo.set(url, data)
      return data
    })
    .catch(() => { memo.set(url, null); return null })
    .finally(() => { pending.delete(url) })

  pending.set(url, work)
  return work
}

interface Props {
  url: string
  size?: number
  className?: string
  style?: React.CSSProperties
  /** Decorative by default: the label next to it already names the site. */
  alt?: string
}

export default function Favicon({ url, size = 16, className, style, alt = '' }: Props) {
  const [icon, setIcon] = useState<string | null>(() => memo.get(url) ?? null)

  useEffect(() => {
    const cached = memo.get(url)
    if (cached !== undefined) { setIcon(cached); return }

    let cancelled = false
    void resolve(url).then(data => { if (!cancelled) setIcon(data) })
    return () => { cancelled = true }
  }, [url])

  return (
    <img
      src={icon || letterTileDataUri(url, size)}
      width={size}
      height={size}
      alt={alt}
      className={className}
      style={{ borderRadius: Math.max(3, Math.round(size * 0.22)), flexShrink: 0, ...style }}
    />
  )
}
