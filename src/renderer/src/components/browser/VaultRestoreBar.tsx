import React, { useEffect, useState } from 'react'
import { Archive, X } from 'lucide-react'
import { formatWhen } from '../../services/downloadDisplay'

interface Snapshot { id: string; url: string; title: string; createdAt: number }

/**
 * "The live page is gone — here is the copy you kept."
 *
 * This is the whole point of the vault, and it has to appear without being
 * asked for: nobody reacts to a 404 by remembering that this browser has an
 * archive feature. So the bar watches for a failed load on the active tab,
 * asks whether a snapshot exists for that exact URL, and offers it inline.
 *
 * It stays quiet when there is nothing to offer. A failed load with no
 * snapshot behind it gets Chromium's error page and no extra noise, because a
 * bar that says "no copy available" is a bar that trains people to ignore it.
 */
export default function VaultRestoreBar({ tabId, url, failed, topOffset = 0, onOfferChange }: {
  tabId: string | null
  url: string | undefined
  failed: boolean
  /** Pixels already reserved above us (the find bar, when it is open). */
  topOffset?: number
  /** Told whenever the offer appears or disappears, so App can reserve the
      strip this bar occupies — a BrowserView cannot be overlaid. */
  onOfferChange: (visible: boolean) => void
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [dismissed, setDismissed] = useState('')
  const [opening, setOpening] = useState(false)

  // A new failure on a different URL is a fresh offer, even if the last one
  // was waved away.
  useEffect(() => { setDismissed('') }, [url])

  useEffect(() => {
    let cancelled = false
    if (!failed || !url) { setSnap(null); return }
    window.electronAPI.vault?.latestFor?.(url)
      .then((s: Snapshot | null) => { if (!cancelled) setSnap(s || null) })
      .catch(() => { if (!cancelled) setSnap(null) })
    return () => { cancelled = true }
  }, [failed, url])

  const visible = !!(failed && snap && tabId && dismissed !== url)

  // Reserving the strip is App's job, and it needs to happen as an effect —
  // telling a parent to re-render from inside our own render is a React error.
  useEffect(() => { onOfferChange(visible) }, [visible, onOfferChange])
  useEffect(() => () => onOfferChange(false), [onOfferChange])

  if (!visible || !snap) return null

  const restore = async () => {
    setOpening(true)
    try { await window.electronAPI.vault.open({ tabId, id: snap.id }) } catch {}
    setOpening(false)
  }

  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute', top: topOffset + 6, left: '50%', transform: 'translateX(-50%)',
        zIndex: 40, display: 'flex', alignItems: 'center', gap: 10,
        maxWidth: 'min(92%, 620px)',
        padding: '9px 12px 9px 14px', borderRadius: 14,
        background: 'var(--ds-glass-lg, rgb(var(--ds-bg-2)))',
        border: '1px solid rgb(var(--ds-accent) / 0.35)',
        boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(18px)',
      }}
    >
      <Archive size={15} style={{ color: 'rgb(var(--ds-accent-soft))', flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 650, color: 'rgb(var(--ds-text-2))' }}>
          This page didn’t load — but you kept a copy
        </div>
        <div style={{
          fontSize: 11, color: 'rgb(var(--ds-text-4))',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          Saved {formatWhen(snap.createdAt)} · {snap.title}
        </div>
      </div>
      <button
        onClick={restore}
        disabled={opening}
        style={{
          flexShrink: 0, padding: '5px 12px', borderRadius: 9, cursor: 'pointer',
          background: 'rgb(var(--ds-accent))', border: 'none', color: '#fff',
          fontSize: 11.5, fontWeight: 700,
        }}
      >
        {opening ? 'Opening…' : 'Open the copy'}
      </button>
      <button
        onClick={() => setDismissed(url || '')}
        title="Dismiss"
        style={{
          flexShrink: 0, width: 22, height: 22, borderRadius: 7, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', color: 'rgb(var(--ds-text-4))',
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}
