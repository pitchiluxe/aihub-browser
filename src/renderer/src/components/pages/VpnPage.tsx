import React, { useState, useEffect, useRef } from 'react'
import {
  Shield, ShieldOff, Globe, Loader2, CheckCircle2,
  AlertTriangle, Trash2, RefreshCw, Eye, EyeOff,
  Wifi, X, ChevronDown, ChevronRight, Zap,
} from 'lucide-react'

// ── Free VPN countries ────────────────────────────────────────────────────────
interface FreeCountry { cc: string; name: string; flag: string }

const FREE_COUNTRIES: FreeCountry[] = [
  { cc: 'FR', name: 'France',         flag: '🇫🇷' },
  { cc: 'BE', name: 'Belgium',        flag: '🇧🇪' },
  { cc: 'CA', name: 'Canada',         flag: '🇨🇦' },
  { cc: 'US', name: 'United States',  flag: '🇺🇸' },
  { cc: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { cc: 'DE', name: 'Germany',        flag: '🇩🇪' },
  { cc: 'NL', name: 'Netherlands',    flag: '🇳🇱' },
  { cc: 'JP', name: 'Japan',          flag: '🇯🇵' },
]

const flagFor = (cc?: string) => FREE_COUNTRIES.find(c => c.cc === cc)?.flag || '🌍'

// ── Types ─────────────────────────────────────────────────────────────────────
interface VpnProfile {
  id: string
  name: string
  countryCode: string
  flag: string
  protocol: 'socks5' | 'http' | 'https'
  host: string
  port: number
  username?: string
  password?: string
}

interface FreeConn { cc: string; name: string; flag: string; proxy: string }

const PROTOCOLS = ['socks5', 'http', 'https'] as const

function inp(overrides: Record<string, any>) {
  return {
    className: 'w-full rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition-all',
    style: {
      background: 'var(--ds-glass-sm)',
      border: '1px solid var(--ds-border)',
      userSelect: 'text' as const,
    },
    ...overrides,
  }
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function VpnPage() {
  const [connected, setConnected]         = useState(false)
  const [activeFree, setActiveFree]       = useState<FreeConn | null>(null)
  const [activeProfile, setActiveProfile] = useState<string | null>(null)
  const [connectingCc, setConnectingCc]   = useState<string | null>(null)
  const [progress, setProgress]           = useState<{ phase: string; tried?: number; total?: number } | null>(null)
  const [manualConnecting, setManualConnecting] = useState(false)
  const [checkingIp, setCheckingIp]       = useState(false)
  const [ipInfo, setIpInfo]               = useState<any>(null)
  const [profiles, setProfiles]           = useState<VpnProfile[]>(() => {
    try { return JSON.parse(localStorage.getItem('vpn-profiles-v2') || '[]') } catch { return [] }
  })
  const [showAdvanced, setShowAdvanced]   = useState(false)
  const [showForm, setShowForm]           = useState(false)
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [showPassword, setShowPassword]   = useState(false)
  const [error, setError]                 = useState('')
  const [success, setSuccess]             = useState('')
  const connectingRef = useRef(false)

  const [form, setForm] = useState<Omit<VpnProfile, 'id'>>({
    name: '', countryCode: 'OTHER', flag: '🌍', protocol: 'socks5', host: '', port: 1080,
    username: '', password: '',
  })

  useEffect(() => {
    loadStatus(); fetchIp()
    const off = window.electronAPI.vpn.onFreeProgress?.((p: any) => setProgress(p))
    return () => { off?.() }
  }, [])

  const saveProfiles = (next: VpnProfile[]) => {
    setProfiles(next)
    localStorage.setItem('vpn-profiles-v2', JSON.stringify(next))
  }

  const loadStatus = async () => {
    try {
      const s = await window.electronAPI.vpn.getStatus()
      setConnected(s.connected)
      if (s.connected && s.config) {
        if (s.config.free) {
          setActiveFree({
            cc: s.config.countryCode, name: s.config.countryName || s.config.countryCode,
            flag: flagFor(s.config.countryCode),
            proxy: `${s.config.protocol}://${s.config.host}:${s.config.port}`,
          })
        } else {
          const match = profiles.find(p => p.host === s.config.host && p.port === s.config.port)
          if (match) setActiveProfile(match.id)
        }
      }
    } catch {}
  }

  const fetchIp = async () => {
    setCheckingIp(true)
    try {
      const r = await window.electronAPI.vpn.getIp()
      setIpInfo(r.success ? r : { ip: 'Unable to detect', country: '—' })
    } catch { setIpInfo({ ip: 'Unable to detect', country: '—' }) }
    setCheckingIp(false)
  }

  // ── Free VPN connect ──
  const freeConnect = async (c: FreeCountry) => {
    if (connectingRef.current) return
    connectingRef.current = true
    setConnectingCc(c.cc); setError(''); setProgress({ phase: 'fetching' })
    try {
      const r = await window.electronAPI.vpn.freeConnect(c.cc, c.name)
      if (r.success) {
        setConnected(true)
        setActiveFree({ cc: c.cc, name: c.name, flag: c.flag, proxy: r.proxy })
        setActiveProfile(null)
        setSuccess(`Connected — you now browse from ${c.flag} ${c.name}`)
        setTimeout(() => setSuccess(''), 5000)
        setTimeout(fetchIp, 1200)
      } else if (!r.cancelled) {
        setError(r.error || 'Could not find a working free server. Try again.')
      }
    } catch (e: any) { setError(e.message) }
    connectingRef.current = false
    setConnectingCc(null); setProgress(null)
  }

  const cancelFreeConnect = async () => {
    try { await window.electronAPI.vpn.freeCancel() } catch {}
  }

  // ── Manual proxy connect (advanced) ──
  const connect = async (profile: VpnProfile) => {
    if (!profile.host) { setError('No proxy host configured for this profile'); return }
    setManualConnecting(true); setError('')
    try {
      const r = await window.electronAPI.vpn.setProxy({
        protocol: profile.protocol,
        host:     profile.host,
        port:     profile.port,
        username: profile.username || undefined,
        password: profile.password || undefined,
      })
      if (r.success) {
        setConnected(true); setActiveProfile(profile.id); setActiveFree(null)
        setSuccess(`Connected via ${profile.flag} ${profile.name}`)
        setTimeout(() => setSuccess(''), 4000)
        setTimeout(fetchIp, 1500)
      } else { setError(r.error || 'Failed to connect. Check host/port and try again.') }
    } catch (e: any) { setError(e.message) }
    setManualConnecting(false)
  }

  const disconnect = async () => {
    setManualConnecting(true); setError('')
    try {
      const r = await window.electronAPI.vpn.clearProxy()
      if (r.success) {
        setConnected(false); setActiveProfile(null); setActiveFree(null)
        setSuccess('Disconnected — using direct connection')
        setTimeout(() => setSuccess(''), 3000)
        setTimeout(fetchIp, 800)
      }
    } catch (e: any) { setError(e.message) }
    setManualConnecting(false)
  }

  const saveForm = () => {
    if (!form.name || !form.host || !form.port) { setError('Profile name, host, and port are required'); return }
    const id = editingId || `vpn-${Date.now()}`
    const next = editingId
      ? profiles.map(p => p.id === editingId ? { ...form, id } : p)
      : [...profiles, { ...form, id }]
    saveProfiles(next)
    setShowForm(false); setEditingId(null); setError('')
    const profile = { ...form, id }
    setTimeout(() => connect(profile), 100)
  }

  const editProfile = (p: VpnProfile) => {
    setForm({ name: p.name, countryCode: p.countryCode, flag: p.flag, protocol: p.protocol, host: p.host, port: p.port, username: p.username || '', password: p.password || '' })
    setEditingId(p.id); setShowForm(true); setShowAdvanced(true)
  }

  const removeProfile = (id: string) => {
    if (activeProfile === id) disconnect()
    saveProfiles(profiles.filter(p => p.id !== id))
  }

  const activeProfileObj = profiles.find(p => p.id === activeProfile)
  const busy = connectingCc !== null || manualConnecting

  const statusTitle = connected
    ? activeFree ? `${activeFree.flag} ${activeFree.name} — Free VPN`
    : activeProfileObj ? `${activeProfileObj.flag} ${activeProfileObj.name}`
    : 'Connected'
    : 'Not Connected'

  const statusSub = connected
    ? activeFree ? activeFree.proxy
    : activeProfileObj ? `${activeProfileObj.protocol.toUpperCase()} → ${activeProfileObj.host}:${activeProfileObj.port}`
    : ''
    : 'Direct connection — your real IP'

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: 'var(--ds-page-bg)', scrollbarWidth: 'thin', scrollbarColor: 'rgba(59,130,246,0.2) transparent' }}
    >
      <div className="max-w-2xl mx-auto pb-20">

        {/* ── HEADER ── */}
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-4">
            <div style={{
              width: 48, height: 48, borderRadius: 16, flexShrink: 0,
              background: connected
                ? 'linear-gradient(135deg,rgba(52,211,153,0.25),rgba(16,185,129,0.12))'
                : 'linear-gradient(135deg,rgba(59,130,246,0.22),rgba(99,102,241,0.12))',
              border: `1px solid ${connected ? 'rgba(52,211,153,0.4)' : 'rgba(59,130,246,0.3)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: connected ? '0 0 24px rgba(52,211,153,0.2)' : '0 0 24px rgba(59,130,246,0.15)',
            }}>
              {connected
                ? <Shield size={22} style={{ color: '#34d399' }} />
                : <ShieldOff size={22} style={{ color: '#60a5fa' }} />}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Free VPN</h1>
              <p className="text-sm text-slate-500 mt-0.5">Pick a country and connect — 100% free, no account needed</p>
            </div>
          </div>
        </div>

        {/* ── STATUS CARD ── */}
        <div className="px-8 mb-6">
          <div style={{
            borderRadius: 20, padding: '20px 24px',
            background: connected
              ? 'linear-gradient(135deg,rgba(52,211,153,0.1),rgba(16,185,129,0.05))'
              : 'var(--ds-glass-xs)',
            border: `1.5px solid ${connected ? 'rgba(52,211,153,0.3)' : 'var(--ds-glass-md)'}`,
          }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div style={{
                  width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                  background: connected ? '#34d399' : 'rgb(var(--ds-text-4) / 0.75)',
                  boxShadow: connected ? '0 0 12px #34d399' : 'none',
                  transition: 'all 0.3s',
                }} />
                <div>
                  <div className="font-semibold" style={{ color: connected ? '#6ee7b7' : 'rgb(var(--ds-text-3))', fontSize: 15 }}>
                    {statusTitle}
                  </div>
                  <div className="text-xs mt-0.5 font-mono" style={{ color: connected ? 'rgba(110,231,183,0.6)' : 'rgb(var(--ds-text-4))' }}>
                    {statusSub}
                  </div>
                </div>
              </div>

              {connected && (
                <button
                  onClick={disconnect}
                  disabled={busy}
                  style={{
                    padding: '9px 22px', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                    background: 'rgba(239,68,68,0.15)', border: '1.5px solid rgba(239,68,68,0.35)', color: '#f87171',
                    display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.28)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.55)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.15)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.35)' }}
                >
                  {manualConnecting ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                  Disconnect
                </button>
              )}
            </div>

            {/* IP row */}
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${connected ? 'rgba(52,211,153,0.15)' : 'var(--ds-glass-sm)'}` }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Globe size={12} style={{ color: '#60a5fa' }} />
                  Your current IP
                </div>
                <button onClick={fetchIp} disabled={checkingIp} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-300 transition-all">
                  <RefreshCw size={10} className={checkingIp ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              {checkingIp
                ? <div className="flex items-center gap-2"><Loader2 size={12} className="animate-spin text-slate-600" /><span className="text-xs text-slate-600">Detecting…</span></div>
                : ipInfo && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono font-bold text-white" style={{ fontSize: 15 }}>{ipInfo.ip}</span>
                    {ipInfo.city && <span className="text-xs text-slate-400">{ipInfo.city}</span>}
                    {ipInfo.region && <span className="text-xs text-slate-500">{ipInfo.region}</span>}
                    {ipInfo.country && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd' }}>
                        {ipInfo.country}
                      </span>
                    )}
                    {ipInfo.org && <span className="text-xs text-slate-600 truncate max-w-[180px]">{ipInfo.org}</span>}
                  </div>
                )
              }
            </div>
          </div>

          {/* Alerts */}
          {error && (
            <div className="mt-3 flex items-start gap-2 px-4 py-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertTriangle size={14} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
              <span className="text-sm text-red-400">{error}</span>
              <button onClick={() => setError('')} className="ml-auto"><X size={13} style={{ color: '#f87171' }} /></button>
            </div>
          )}
          {success && (
            <div className="mt-3 flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <CheckCircle2 size={14} style={{ color: '#34d399' }} />
              <span className="text-sm text-emerald-400 font-medium">{success}</span>
            </div>
          )}
        </div>

        {/* ── FREE COUNTRY PICKER ── */}
        <div className="px-8 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                <Zap size={13} style={{ color: '#fbbf24' }} /> Choose a Free Location
              </div>
              <div className="text-xs text-slate-600 mt-0.5">One click — we find and test a free server for you automatically</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* Direct card */}
            <button
              onClick={() => disconnect()}
              disabled={busy}
              style={{
                borderRadius: 16, padding: '16px 12px', textAlign: 'center', cursor: 'pointer',
                border: `2px solid ${!connected ? '#3b82f6' : 'var(--ds-glass-md)'}`,
                background: !connected
                  ? 'linear-gradient(135deg,rgba(59,130,246,0.22),rgba(99,102,241,0.12))'
                  : 'var(--ds-glass-xs)',
                boxShadow: !connected ? '0 0 20px rgba(59,130,246,0.25)' : 'none',
                transition: 'all 0.18s', position: 'relative',
              }}
            >
              {!connected && (
                <div style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
              )}
              <div style={{ fontSize: 32, marginBottom: 8 }}>🌐</div>
              <div className="text-xs font-bold" style={{ color: !connected ? '#93c5fd' : 'rgb(var(--ds-text-2))', lineHeight: 1.3 }}>Direct</div>
              <div className="text-[10px] mt-1.5 font-medium" style={{ color: !connected ? '#60a5fa' : 'rgb(var(--ds-text-4) / 0.75)' }}>
                {!connected ? '● Active' : 'No VPN'}
              </div>
            </button>

            {FREE_COUNTRIES.map(c => {
              const isActive = connected && activeFree?.cc === c.cc
              const isConnecting = connectingCc === c.cc
              return (
                <button
                  key={c.cc}
                  onClick={() => isConnecting ? cancelFreeConnect() : freeConnect(c)}
                  disabled={busy && !isConnecting}
                  style={{
                    borderRadius: 16, padding: '16px 12px', textAlign: 'center', cursor: 'pointer',
                    border: `2px solid ${isActive ? '#34d399' : isConnecting ? '#3b82f6' : 'var(--ds-glass-md)'}`,
                    background: isActive
                      ? 'linear-gradient(135deg,rgba(52,211,153,0.18),rgba(16,185,129,0.08))'
                      : isConnecting
                        ? 'linear-gradient(135deg,rgba(59,130,246,0.18),rgba(99,102,241,0.1))'
                        : 'var(--ds-glass-xs)',
                    boxShadow: isActive ? '0 0 20px rgba(52,211,153,0.2)' : isConnecting ? '0 0 20px rgba(59,130,246,0.25)' : 'none',
                    transition: 'all 0.18s', position: 'relative',
                    opacity: busy && !isConnecting ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!isActive && !isConnecting && !busy) (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.1)' }}
                  onMouseLeave={e => { if (!isActive && !isConnecting) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-xs)' }}
                >
                  {isActive && (
                    <div style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
                  )}
                  <div style={{ position: 'absolute', top: 6, left: 8 }}>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>FREE</span>
                  </div>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>
                    {isConnecting ? <Loader2 size={30} className="animate-spin mx-auto" style={{ color: '#60a5fa' }} /> : c.flag}
                  </div>
                  <div className="text-xs font-bold" style={{ color: isActive ? '#6ee7b7' : isConnecting ? '#93c5fd' : 'rgb(var(--ds-text-2))', lineHeight: 1.3 }}>
                    {c.name}
                  </div>
                  <div className="text-[10px] mt-1.5 font-medium" style={{
                    color: isActive ? '#34d399' : isConnecting ? '#60a5fa' : 'rgb(var(--ds-text-4) / 0.75)',
                  }}>
                    {isActive ? '● Connected'
                      : isConnecting
                        ? progress?.phase === 'testing' && progress.total
                          ? `Testing ${Math.min((progress.tried || 0) + 1, progress.total)}/${progress.total} — tap to cancel`
                          : 'Finding servers…'
                        : 'Tap to connect'}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-start gap-2 px-1">
            <AlertTriangle size={11} style={{ color: 'rgba(251,191,36,0.5)', flexShrink: 0, marginTop: 2 }} />
            <p className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--ds-text-4) / 0.8)' }}>
              Free servers are community-run and change often — speed varies, and if one drops we'll find another when you reconnect.
              Avoid logging into sensitive accounts (banking) while on a free server.
            </p>
          </div>
        </div>

        {/* ── ADVANCED: OWN PROXY ── */}
        <div className="px-8">
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="flex items-center gap-2 w-full text-left mb-3"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <div className="text-sm font-bold text-slate-400">Advanced — use your own proxy server</div>
            {showAdvanced ? <ChevronDown size={14} style={{ color: 'rgb(var(--ds-text-4))' }} /> : <ChevronRight size={14} style={{ color: 'rgb(var(--ds-text-4))' }} />}
          </button>

          {showAdvanced && (
            <>
              {/* Saved profiles */}
              {profiles.length > 0 && (
                <div className="mb-4 space-y-2">
                  {profiles.map(p => {
                    const isActive = activeProfile === p.id && connected
                    return (
                      <div
                        key={p.id}
                        style={{
                          borderRadius: 16, padding: '14px 16px',
                          background: isActive ? 'rgba(52,211,153,0.07)' : 'var(--ds-glass-xs)',
                          border: `1.5px solid ${isActive ? 'rgba(52,211,153,0.3)' : 'var(--ds-glass-md)'}`,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div style={{ fontSize: 22, flexShrink: 0 }}>{p.flag || '🌐'}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                              {p.name}
                              {isActive && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399' }}>
                                  ACTIVE
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-600 mt-0.5 font-mono truncate">
                              {p.protocol.toUpperCase()}://{p.username ? `${p.username}@` : ''}{p.host}:{p.port}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {isActive ? (
                              <button
                                onClick={disconnect}
                                disabled={busy}
                                style={{
                                  padding: '7px 16px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                                  background: 'rgba(239,68,68,0.12)', border: '1.5px solid rgba(239,68,68,0.3)', color: '#f87171',
                                  display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.12s',
                                }}
                              >
                                {manualConnecting ? <Loader2 size={12} className="animate-spin" /> : <ShieldOff size={12} />}
                                Disconnect
                              </button>
                            ) : (
                              <button
                                onClick={() => connect(p)}
                                disabled={busy}
                                style={{
                                  padding: '7px 18px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                                  background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
                                  border: '1.5px solid rgba(99,102,241,0.5)', color: '#fff',
                                  display: 'flex', alignItems: 'center', gap: 5,
                                  boxShadow: '0 2px 12px rgba(59,130,246,0.35)',
                                }}
                              >
                                {manualConnecting ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                                Connect
                              </button>
                            )}

                            <button onClick={() => editProfile(p)} style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-4))', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button onClick={() => removeProfile(p.id)} style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.15)', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add custom proxy */}
              {!showForm ? (
                <button
                  onClick={() => {
                    setForm({ name: '', countryCode: 'OTHER', flag: '🌍', protocol: 'socks5', host: '', port: 1080, username: '', password: '' })
                    setEditingId(null); setShowForm(true); setError('')
                  }}
                  style={{
                    width: '100%', padding: '12px', borderRadius: 14, cursor: 'pointer',
                    border: '2px dashed var(--ds-glass-md)', background: 'rgba(255,255,255,0.02)',
                    color: 'rgb(var(--ds-text-4))', fontSize: 13, fontWeight: 600,
                    transition: 'all 0.18s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-sm)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)' }}
                >
                  + Add your own proxy server
                </button>
              ) : (
                <div style={{ borderRadius: 20, padding: 24, background: 'rgba(59,130,246,0.06)', border: '1.5px solid rgba(59,130,246,0.2)' }}>
                  <div className="flex items-center justify-between mb-5">
                    <div className="text-base font-bold text-white">{editingId ? 'Edit Profile' : 'Custom Proxy'}</div>
                    <button onClick={() => { setShowForm(false); setEditingId(null); setError('') }} style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--ds-text-4))' }}>
                      <X size={13} />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Profile Name</label>
                        <input {...inp({ placeholder: 'e.g. My VPN', value: form.name, onChange: (e: any) => setForm(f => ({ ...f, name: e.target.value })) })} />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Protocol</label>
                        <select {...inp({ value: form.protocol, onChange: (e: any) => setForm(f => ({ ...f, protocol: e.target.value as any })) })}>
                          {PROTOCOLS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Port</label>
                        <input {...inp({ type: 'number', placeholder: '1080', value: form.port, onChange: (e: any) => setForm(f => ({ ...f, port: parseInt(e.target.value) || 1080 })) })} />
                      </div>

                      <div className="col-span-2">
                        <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Proxy Host / IP Address</label>
                        <input {...inp({ placeholder: 'e.g. 192.168.1.1 or fr-proxy.myvpn.com', value: form.host, onChange: (e: any) => setForm(f => ({ ...f, host: e.target.value })) })} />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Username <span className="text-slate-700 font-normal">(optional)</span></label>
                        <input {...inp({ placeholder: 'Username', value: form.username || '', onChange: (e: any) => setForm(f => ({ ...f, username: e.target.value })) })} />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Password <span className="text-slate-700 font-normal">(optional)</span></label>
                        <div className="relative">
                          <input {...inp({ type: showPassword ? 'text' : 'password', placeholder: 'Password', value: form.password || '', onChange: (e: any) => setForm(f => ({ ...f, password: e.target.value })), style: { userSelect: 'text', paddingRight: 40 } })} />
                          <button onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))' }}>
                            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={saveForm}
                      style={{
                        width: '100%', padding: '13px 24px', borderRadius: 14, cursor: 'pointer',
                        fontSize: 14, fontWeight: 800,
                        background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
                        border: '1.5px solid rgba(99,102,241,0.6)', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        boxShadow: '0 4px 24px rgba(59,130,246,0.45)',
                      }}
                    >
                      <Shield size={16} />
                      {editingId ? 'Save & Connect' : 'Connect'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
