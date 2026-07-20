import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Shield, ShieldOff, Loader2 } from 'lucide-react'
import { FREE_COUNTRIES, FreeCountry, flagFor, rememberCountry } from '../../services/vpnCountries'

// Toolbar VPN control — green while protected, so the user can see and change
// VPN state without opening the VPN page.
//
// The country picker is a NATIVE menu, not an HTML dropdown: the nav bar is
// host HTML and the active tab's BrowserView paints above host HTML, so a
// panel hanging below the bar would be invisible behind the page.
export default function VpnButton() {
  const [connected, setConnected] = useState(false)
  const [country,   setCountry]   = useState<{ cc?: string; name?: string } | null>(null)
  const [busy,      setBusy]      = useState(false)
  const [progress,  setProgress]  = useState<{ tried?: number; total?: number } | null>(null)
  const [toast,     setToast]     = useState('')
  const [hovered,   setHovered]   = useState(false)
  const menuOpenRef = useRef(false)
  const toastTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4000)
  }

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
    return () => {
      try { offState?.(); offProg?.() } catch {}
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [applyState])

  const connect = async (c: FreeCountry) => {
    setBusy(true); setProgress(null)
    flash(`Finding a free ${c.name} server…`)
    try {
      const r = await window.electronAPI.vpn.freeConnect(c.cc, c.name)
      if (r?.success) {
        rememberCountry(c)
        flash(`Connected — browsing from ${c.name}`)
      } else if (!r?.cancelled) {
        flash(r?.error || 'No working free server right now. Try another country.')
      } else {
        setToast('')
      }
    } catch (e: any) {
      flash(e?.message || String(e))
    }
    setBusy(false); setProgress(null)
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await window.electronAPI.vpn.clearProxy()
      flash('VPN off — direct connection')
    } catch (e: any) {
      flash(e?.message || String(e))
    }
    setBusy(false)
  }

  // One click always opens the picker, so the control behaves the same
  // whether the VPN is currently on or off.
  const openMenu = async () => {
    if (busy || menuOpenRef.current) return
    menuOpenRef.current = true
    try {
      const action = await window.electronAPI.vpn.showMenu(
        FREE_COUNTRIES.map(c => ({ cc: c.cc, name: c.name }))
      )
      if (action === 'disconnect') {
        await disconnect()
      } else if (typeof action === 'string' && action.startsWith('connect:')) {
        const cc = action.slice('connect:'.length)
        const c = FREE_COUNTRIES.find(x => x.cc === cc)
        if (c) {
          // Picking the country you're already on means "turn it off"
          if (connected && country?.cc === cc) await disconnect()
          else await connect(c)
        }
      }
    } catch (e: any) {
      flash(e?.message || String(e))
    } finally {
      menuOpenRef.current = false
    }
  }

  const activeFlag = connected ? flagFor(country?.cc) : null

  const title = busy
    ? (progress?.total
        ? `Testing server ${Math.min((progress.tried || 0) + 1, progress.total)} of ${progress.total}…`
        : 'Connecting…')
    : connected
      ? `VPN on — ${country?.name || 'connected'} · click to change or turn off`
      : 'VPN off — click to pick a country'

  return (
    <>
      <button
        onClick={openMenu}
        onContextMenu={e => { e.preventDefault(); openMenu() }}
        title={title}
        aria-label={title}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="ds-navbtn no-drag"
        style={{
          width: connected ? 'auto' : 32,
          gap: 4,
          padding: connected ? '0 8px' : 0,
          color: connected ? '#34d399' : hovered ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-4))',
          background: connected
            ? 'rgba(52,211,153,0.14)'
            : hovered ? 'rgb(var(--ds-accent) / 0.12)' : 'transparent',
          border: `1px solid ${connected ? 'rgba(52,211,153,0.42)' : 'transparent'}`,
          boxShadow: connected ? '0 0 14px rgba(52,211,153,0.30)' : 'none',
        }}
      >
        {busy
          ? <Loader2 size={13} className="animate-spin" />
          : connected
            ? <Shield size={13} fill="currentColor" />
            : <ShieldOff size={13} />}
        {connected && !busy && activeFlag && (
          <span style={{ fontSize: 11, lineHeight: 1 }}>{activeFlag}</span>
        )}
        {connected && !busy && (
          <span style={{
            position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%',
            background: '#34d399', boxShadow: '0 0 6px #34d399',
          }} />
        )}
      </button>

      {/* Status toast — rendered inside the nav-bar chrome, which sits above
          the BrowserView region, so it stays visible over web pages. */}
      {toast && (
        <div
          className="no-drag"
          style={{
            position: 'absolute', top: '50%', right: 130, transform: 'translateY(-50%)',
            zIndex: 60, pointerEvents: 'none',
            background: connected ? 'rgba(16,185,129,0.95)' : 'rgba(51,65,85,0.96)',
            color: '#fff', borderRadius: 8, padding: '5px 12px',
            fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
            boxShadow: '0 6px 22px rgba(0,0,0,0.35)',
            maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {toast}
        </div>
      )}
    </>
  )
}
