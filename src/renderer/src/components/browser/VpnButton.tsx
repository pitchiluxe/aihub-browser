import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Shield, ShieldOff, Loader2, Check, X } from 'lucide-react'
import { FREE_COUNTRIES, FreeCountry, flagFor, rememberCountry, lastCountry } from '../../services/vpnCountries'

// Toolbar VPN control — green when protected, with a one-click country picker
// so switching location never requires opening the VPN page.
export default function VpnButton() {
  const [connected,  setConnected]  = useState(false)
  const [country,    setCountry]    = useState<{ cc?: string; name?: string } | null>(null)
  const [open,       setOpen]       = useState(false)
  const [busyCc,     setBusyCc]     = useState<string | null>(null)
  const [progress,   setProgress]   = useState<{ tried?: number; total?: number } | null>(null)
  const [error,      setError]      = useState('')
  const [hovered,    setHovered]    = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const applyState = useCallback((s: any) => {
    setConnected(!!s?.connected)
    setCountry(s?.connected && s.config
      ? { cc: s.config.countryCode, name: s.config.countryName || s.config.host }
      : null)
  }, [])

  // Initial read + live updates (either surface can change the VPN)
  useEffect(() => {
    window.electronAPI.vpn.getStatus().then(applyState).catch(() => {})
    const offState = window.electronAPI.vpn.onState?.(applyState)
    const offProg  = window.electronAPI.vpn.onFreeProgress?.((p: any) => {
      setProgress(p?.phase === 'testing' ? { tried: p.tried, total: p.total } : null)
    })
    return () => { try { offState?.(); offProg?.() } catch {} }
  }, [applyState])

  // Close the popover on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const connect = async (c: FreeCountry) => {
    if (busyCc) return
    setBusyCc(c.cc); setError(''); setProgress(null)
    try {
      const r = await window.electronAPI.vpn.freeConnect(c.cc, c.name)
      if (r?.success) {
        rememberCountry(c)
        setOpen(false)
      } else if (!r?.cancelled) {
        setError(r?.error || 'Could not find a working free server. Try again.')
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    }
    setBusyCc(null); setProgress(null)
  }

  const disconnect = async () => {
    if (busyCc) return
    setBusyCc('off'); setError('')
    try { await window.electronAPI.vpn.clearProxy() } catch (e: any) { setError(e?.message || String(e)) }
    setBusyCc(null)
    setOpen(false)
  }

  // Plain click is the fast path: connected → disconnect, otherwise reconnect
  // to the last country used. With no history, open the picker instead.
  const handleClick = () => {
    if (busyCc) return
    if (connected) { disconnect(); return }
    const last = lastCountry()
    if (last) connect(last)
    else setOpen(o => !o)
  }

  const busy = !!busyCc
  const activeFlag = connected ? flagFor(country?.cc) : null

  const title = busy
    ? 'Connecting…'
    : connected
      ? `VPN on — ${country?.name || 'connected'} · click to turn off, right-click to switch country`
      : lastCountry()
        ? `VPN off — click to reconnect to ${lastCountry()!.name}, right-click to pick a country`
        : 'VPN off — click to choose a country'

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} className="no-drag">
      <button
        onClick={handleClick}
        onContextMenu={e => { e.preventDefault(); setOpen(o => !o) }}
        title={title}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="ds-navbtn flex items-center"
        style={{
          gap: 4,
          padding: connected ? '0 8px 0 7px' : undefined,
          width: connected ? 'auto' : undefined,
          color: connected ? '#34d399' : hovered ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-4))',
          background: connected
            ? 'rgba(52,211,153,0.14)'
            : hovered ? 'rgb(var(--ds-accent) / 0.10)' : 'transparent',
          border: `1px solid ${connected ? 'rgba(52,211,153,0.42)' : 'transparent'}`,
          boxShadow: connected ? '0 0 14px rgba(52,211,153,0.30)' : 'none',
        }}
      >
        {busy
          ? <Loader2 size={13} className="animate-spin" />
          : connected ? <Shield size={13} fill="currentColor" /> : <ShieldOff size={13} />}
        {connected && !busy && activeFlag && (
          <span style={{ fontSize: 11, lineHeight: 1 }}>{activeFlag}</span>
        )}
        {connected && (
          <span style={{
            position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%',
            background: '#34d399', boxShadow: '0 0 6px #34d399',
          }} />
        )}
      </button>

      {/* Country picker */}
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 300, width: 216,
            borderRadius: 14, overflow: 'hidden',
            background: 'var(--ds-panel-bg)',
            backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--ds-border)',
            boxShadow: 'var(--ds-panel-shadow, 0 12px 44px rgba(0,0,0,0.5))',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 12px', borderBottom: '1px solid var(--ds-border-sm)',
          }}>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'rgb(var(--ds-text-4))',
            }}>
              Free VPN
            </span>
            <span style={{ fontSize: 10, color: connected ? '#34d399' : 'rgb(var(--ds-text-4))' }}>
              {connected ? '● On' : 'Off'}
            </span>
          </div>

          <div style={{ maxHeight: 268, overflowY: 'auto', padding: 4 }}>
            {FREE_COUNTRIES.map(c => {
              const isActive = connected && country?.cc === c.cc
              const isBusy   = busyCc === c.cc
              return (
                <button
                  key={c.cc}
                  onClick={() => (isActive ? disconnect() : connect(c))}
                  disabled={busy && !isBusy}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 9px', borderRadius: 9, border: 'none', cursor: 'pointer',
                    background: isActive ? 'rgba(52,211,153,0.13)' : 'transparent',
                    color: isActive ? '#6ee7b7' : 'rgb(var(--ds-text-3))',
                    fontSize: 12, fontWeight: 600, textAlign: 'left',
                    opacity: busy && !isBusy ? 0.45 : 1,
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-sm)' }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{c.flag}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
                  {isBusy
                    ? <Loader2 size={12} className="animate-spin" style={{ color: 'rgb(var(--ds-accent-soft))' }} />
                    : isActive
                      ? <Check size={12} style={{ color: '#34d399' }} />
                      : null}
                </button>
              )
            })}
          </div>

          {progress?.total ? (
            <div style={{
              padding: '7px 12px', borderTop: '1px solid var(--ds-border-sm)',
              fontSize: 10, color: 'rgb(var(--ds-text-4))',
            }}>
              Testing server {Math.min((progress.tried || 0) + 1, progress.total)} of {progress.total}…
            </div>
          ) : null}

          {error && (
            <div style={{
              padding: '8px 12px', borderTop: '1px solid var(--ds-border-sm)',
              fontSize: 10.5, color: '#f87171', lineHeight: 1.45,
              display: 'flex', alignItems: 'flex-start', gap: 6,
            }}>
              <span style={{ flex: 1 }}>{error}</span>
              <button
                onClick={() => setError('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', padding: 0 }}
              >
                <X size={11} />
              </button>
            </div>
          )}

          {connected && (
            <button
              onClick={disconnect}
              disabled={busy}
              style={{
                width: '100%', padding: '9px 0', border: 'none',
                borderTop: '1px solid var(--ds-border-sm)',
                background: 'rgba(239,68,68,0.10)', color: '#f87171',
                fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Turn VPN off
            </button>
          )}
        </div>
      )}
    </div>
  )
}
