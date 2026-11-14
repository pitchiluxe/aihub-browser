import React, { useEffect, useState } from 'react'
import { letterTileDataUri } from '../../../../shared/favicon'

/**
 * A site icon with a local fallback.
 *
 * The main process resolves and caches the site icon. Bookmarks can also
 * supply an existing image and a custom fallback while the lookup runs.
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
  savedIcon?: string
  fallback?: React.ReactNode
}

function usableSavedIcon(icon: string | undefined, url: string): string | undefined {
  if (!icon) return
  if (/^data:image\/(?:png|gif|webp|jpeg|x-icon|vnd\.microsoft\.icon);base64,/i.test(icon)) return icon
  try {
    const saved = new URL(icon)
    if (saved.protocol === 'https:' && !saved.username && !saved.password && saved.origin === new URL(url).origin) return saved.href
  } catch { /* Invalid or unsupported saved icon. */ }
  return undefined
}

export default function Favicon({ url, size = 16, className, style, alt = '', savedIcon, fallback }: Props) {
  const [resolved, setResolved] = useState(() => ({ url, icon: memo.get(url) ?? null }))
  const [failed, setFailed] = useState<string[]>([])
  const saved = usableSavedIcon(savedIcon, url)
  const source = [saved, resolved.url === url ? resolved.icon : memo.get(url)].find(value => value && !failed.includes(value))

  useEffect(() => {
    const cached = memo.get(url)
    if (cached !== undefined) { setResolved({ url, icon: cached }); return }

    let cancelled = false
    void resolve(url).then(icon => { if (!cancelled) setResolved({ url, icon }) })
    return () => { cancelled = true }
  }, [url])

  if (!source && fallback !== undefined) return <>{fallback}</>

  return (
    <img
      src={source || letterTileDataUri(url, size)}
      onError={source ? () => setFailed(values => [...values, source]) : undefined}
      width={size}
      height={size}
      alt={alt}
      className={className}
      style={{ borderRadius: Math.max(3, Math.round(size * 0.22)), flexShrink: 0, ...style }}
    />
  )
}
