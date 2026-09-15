import React, { useEffect, useState } from 'react'
import { ShieldAlert, ShieldQuestion, X } from 'lucide-react'
import {
  assessLogin, buildPasswordFieldScript, type GuardVerdict,
} from '../../../../shared/credentialGuard'

/**
 * A second look before a password is typed.
 *
 * It speaks only when the page is actually asking for a password, and only
 * when the domain is either encoded, or a near-miss of a site this user really
 * uses. Everything else stays silent — a warning that appears on ordinary
 * pages is a warning nobody reads by the second week.
 *
 * It never blocks. Comparing strings produces false positives, and a browser
 * that refuses to load the site someone was trying to reach is worse than the
 * risk it is managing.
 *
 * Nothing here reads, stores or transmits what is typed. The check is on the
 * address only.
 */
export default function CredentialGuardBar({ tabId, wcId, url, isLoading, topOffset = 0, onOfferChange }: {
  tabId: string | null
  wcId: number | null
  url: string | undefined
  isLoading: boolean
  topOffset?: number
  onOfferChange: (visible: boolean) => void
}) {
  const [verdict, setVerdict] = useState<GuardVerdict | null>(null)
  const [dismissed, setDismissed] = useState('')

  useEffect(() => { setDismissed('') }, [url])

  useEffect(() => {
    let cancelled = false
    setVerdict(null)
    if (!url || !wcId || isLoading || !/^https?:/i.test(url)) return

    ;(async () => {
      try {
        // Ask the page whether it wants a password before doing anything else:
        // no login form, no question worth raising.
        const res = await window.electronAPI.webview.execScript(wcId, buildPasswordFieldScript())
        if (cancelled || String(res?.result || 'no') !== 'yes') return

        const known: string[] = (await window.electronAPI.guard?.knownDomains?.()) || []
        if (cancelled) return
        const v = assessLogin(url, known)
        if (v.level !== 'none') setVerdict(v)
      } catch {
        // A page that refuses to run the probe gets no warning rather than a
        // false one.
      }
    })()

    return () => { cancelled = true }
  }, [url, wcId, isLoading, tabId])

  const visible = !!(verdict && dismissed !== url)

  useEffect(() => { onOfferChange(visible) }, [visible, onOfferChange])
  useEffect(() => () => onOfferChange(false), [onOfferChange])

  if (!visible || !verdict) return null

  const isWarn = verdict.level === 'warn'
  const accent = isWarn ? '239,68,68' : '251,191,36'

  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute', top: topOffset + 6, left: '50%', transform: 'translateX(-50%)',
        zIndex: 41, display: 'flex', alignItems: 'center', gap: 10,
        maxWidth: 'min(94%, 680px)',
        padding: '9px 12px 9px 14px', borderRadius: 14,
        background: 'var(--ds-glass-lg, rgb(var(--ds-bg-2)))',
        border: `1px solid rgba(${accent},0.45)`,
        boxShadow: `0 14px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(${accent},0.12)`,
        backdropFilter: 'blur(18px)',
      }}
    >
      {isWarn
        ? <ShieldAlert size={16} style={{ color: `rgb(${accent})`, flexShrink: 0 }} />
        : <ShieldQuestion size={16} style={{ color: `rgb(${accent})`, flexShrink: 0 }} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: `rgb(${accent})` }}>
          {isWarn ? 'Check this address before signing in' : 'First time signing in here'}
        </div>
        <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-3))', marginTop: 1 }}>
          {verdict.message}
        </div>
      </div>
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
