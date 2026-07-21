import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Shield, ShieldOff, Loader2, Search, Check, X, Globe, Zap } from 'lucide-react'
import { FREE_COUNTRIES, FreeCountry, flagFor, rememberCountry } from '../../services/vpnCountries'
import { useBrowserStore } from '../../store/browserStore'

// Toolbar VPN control — green while protected, with a modern in-app country
// picker. The dropdown is host HTML, so while it's open we flag the store
// (isVpnMenuOpen) and App detaches the active tab's BrowserView; otherwise the
// page would paint over the panel. Same trick the app's modals use.
export default function VpnButton() {
  const setVpnMenuOpen = useBrowserStore(s => s.setVpnMenuOpen)

  const [connected, setConnected] = useState(false)
  const [country,   setCountry]   = useState<{ cc?: string; name?: string } | null>(null)
  const [busyCc,    setBusyCc]    = useState<string | null>(null)   // country being connected, or 'off'
  const [progress,  setProgress]  = useState<{ tried?: number; total?: number } | null>(null)
  const [error,     setError]     = useState('')
  const [open,      setOpen]      = useState(false)
  const [query,     setQuery]     = useState('')
  const [hovered,   setHovered]   = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; right: number }>({ top: 52, right: 14 })

  const applyState = useCallback((s: any) => {
    setConnected(!!s?.connected)
    setCountry(s?.connected && s.config
      ? { cc: s.config.countryCode, name: s.config.countryName || s.config.host }
      : null)
  }, [])

  useEffect(() => {
    window.electronAPI.vpn.getStatus().then(applyState).catch(() => {})
    const offState = window.electronAPI.vpn.onState?.(applyState)
    const offProg  = window.electronAPI.vpn.onFreeProgress?.((p: any) => {
      setProgress(p?.phase === 'testing' ? { tried: p.tried, total: p.total } : null)
    })
    return () => { try { offState?.(); offProg?.() } catch {} }
  }, [applyState])

  // Keep the store flag in sync so App hides/restores the tab overlay.
  useEffect(() => { setVpnMenuOpen(open); return () => setVpnMenuOpen(false) }, [open, setVpnMenuOpen])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const openPanel = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) })
    setError(''); setQuery('')
    setOpen(o => !o)
  }

  const connect = async (c: FreeCountry) => {
    if (busyCc) return
    setBusyCc(c.cc); setError(''); setProgress(null)
    try {
      const r = await window.electronAPI.vpn.freeConnect(c.cc, c.name)
      if (r?.success) { rememberCountry(c); setOpen(false) }
      else if (!r?.cancelled) setError(r?.error || `No working free ${c.name} server right now. Try another country.`)
    } catch (e: any) { setError(e?.message || String(e)) }
    setBusyCc(null); setProgress(null)
  }

  const disconnect = async () => {
    if (busyCc) return
    setBusyCc('off'); setError('')
    try { await window.electronAPI.vpn.clearProxy() } catch (e: any) { setError(e?.message || String(e)) }
    setBusyCc(null)
  }

  const busy = !!busyCc
  const activeFlag = connected ? flagFor(country?.cc) : null

  const title = busy
    ? (progress?.total ? `Testing server ${Math.min((progress.tried || 0) + 1, progress.total)} of ${progress.total}…` : 'Connecting…')
    : connected ? `VPN on — ${country?.name || 'connected'}` : 'VPN off — click to pick a country'

  const q = query.trim().toLowerCase()
  const list = q ? FREE_COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.cc.toLowerCase().includes(q)) : FREE_COUNTRIES

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPanel}
        onContextMenu={e => { e.preventDefault(); openPanel() }}
        title={title}
        aria-label={title}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="ds-navbtn no-drag"
        style={{
          width: connected ? 'auto' : 32, gap: 4, padding: connected ? '0 8px' : 0,
          color: connected ? '#34d399' : hovered || open ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-4))',
          background: connected ? 'rgba(52,211,153,0.14)' : hovered || open ? 'rgb(var(--ds-accent) / 0.12)' : 'transparent',
          border: `1px solid ${connected ? 'rgba(52,211,153,0.42)' : 'transparent'}`,
          boxShadow: connected ? '0 0 14px rgba(52,211,153,0.30)' : 'none',
        }}
      >
        {busy ? <Loader2 size={13} className="animate-spin" />
          : connected ? <Shield size={13} fill="currentColor" /> : <ShieldOff size={13} />}
        {connected && !busy && activeFlag && <span style={{ fontSize: 11, lineHeight: 1 }}>{activeFlag}</span>}
        {connected && !busy && (
          <span style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 6px #34d399' }} />
        )}
      </button>

      {open && createPortal(
        <>
          {/* Backdrop — closes on outside click, gently dims the (now detached) page */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(4,7,15,0.35)', backdropFilter: 'blur(1px)' }}
          />

          {/* Panel */}
          <div
            className="no-drag"
            style={{
              position: 'fixed', top: anchor.top, right: anchor.right, zIndex: 2147483001,
              width: 288, maxHeight: 'min(560px, 80vh)', display: 'flex', flexDirection: 'column',
              borderRadius: 18, overflow: 'hidden',
              background: 'var(--ds-panel-bg, rgba(16,20,34,0.96))',
              backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
              border: '1px solid rgb(var(--ds-accent) / 0.22)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
              animation: 'vpnPop .16s cubic-bezier(0.34,1.2,0.64,1)',
            }}
          >
            <style>{`@keyframes vpnPop{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:none}}`}</style>

            {/* Header */}
            <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--ds-border-sm)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: connected ? 'linear-gradient(135deg,rgba(52,211,153,0.28),rgba(16,185,129,0.14))' : 'linear-gradient(135deg,rgb(var(--ds-accent) / 0.28),rgba(126,92,255,0.16))',
                  border: `1px solid ${connected ? 'rgba(52,211,153,0.4)' : 'rgb(var(--ds-accent) / 0.3)'}`,
                }}>
                  {connected ? <Shield size={15} style={{ color: '#34d399' }} fill="currentColor" /> : <Globe size={15} style={{ color: 'rgb(var(--ds-accent-soft))' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'rgb(var(--ds-text-1, var(--ds-text-2)))', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Free VPN
                    <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em', padding: '1px 6px', borderRadius: 20, background: 'rgba(251,191,36,0.16)', color: '#fbbf24' }}>FREE</span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 1, color: connected ? '#34d399' : 'rgb(var(--ds-text-4))' }}>
                    {connected ? `● On · ${country?.name || ''}` : 'Off · direct connection'}
                  </div>
                </div>
                <button onClick={() => setOpen(false)} style={{ width: 26, height: 26, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={13} />
                </button>
              </div>

              {/* Search */}
              <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 11, background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
                <Search size={13} style={{ color: 'rgb(var(--ds-text-4))', flexShrink: 0 }} />
                <input
                  autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search countries…"
                  style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 12.5, color: 'rgb(var(--ds-text-2))', userSelect: 'text' }}
                />
              </div>
            </div>

            {/* Country list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
              {list.map(c => {
                const isActive = connected && country?.cc === c.cc
                const isBusy = busyCc === c.cc
                return (
                  <button
                    key={c.cc}
                    onClick={() => (isActive ? disconnect() : connect(c))}
                    disabled={busy && !isBusy}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px',
                      borderRadius: 11, border: 'none', cursor: 'pointer', textAlign: 'left', marginBottom: 1,
                      background: isActive ? 'rgba(52,211,153,0.13)' : 'transparent',
                      opacity: busy && !isBusy ? 0.4 : 1, transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-sm)' }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: isActive ? '#6ee7b7' : 'rgb(var(--ds-text-2))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </span>
                    {isBusy ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 10, color: 'rgb(var(--ds-text-4))' }}>
                          {progress?.total ? `${Math.min((progress.tried || 0) + 1, progress.total)}/${progress.total}` : ''}
                        </span>
                        <Loader2 size={13} className="animate-spin" style={{ color: 'rgb(var(--ds-accent-soft))' }} />
                      </span>
                    ) : isActive ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#34d399' }}>
                        <Check size={13} /> On
                      </span>
                    ) : (
                      <Zap size={12} style={{ color: 'rgb(var(--ds-text-4) / 0.6)' }} />
                    )}
                  </button>
                )
              })}
              {list.length === 0 && (
                <div style={{ padding: '18px 10px', textAlign: 'center', fontSize: 12, color: 'rgb(var(--ds-text-4))' }}>No country matches "{query}"</div>
              )}
            </div>

            {error && (
              <div style={{ padding: '9px 14px', borderTop: '1px solid var(--ds-border-sm)', fontSize: 11, lineHeight: 1.4, color: '#f87171', display: 'flex', gap: 7 }}>
                <span style={{ flex: 1 }}>{error}</span>
                <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', padding: 0 }}><X size={12} /></button>
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: 8, borderTop: '1px solid var(--ds-border-sm)' }}>
              {connected ? (
                <button
                  onClick={disconnect} disabled={busy}
                  style={{ width: '100%', padding: '9px 0', borderRadius: 11, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: '#f87171', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  {busyCc === 'off' ? 'Turning off…' : 'Turn VPN off'}
                </button>
              ) : (
                <div style={{ fontSize: 10, lineHeight: 1.45, color: 'rgb(var(--ds-text-4) / 0.85)', padding: '2px 6px', textAlign: 'center' }}>
                  Free servers — great for browsing &amp; watching videos. We pick the fastest one.
                </div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
