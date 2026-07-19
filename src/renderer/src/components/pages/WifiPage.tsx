import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Wifi, WifiOff, Loader2, Shield, ShieldOff, RefreshCw, CheckCircle2, Eye, EyeOff, X, Lock } from 'lucide-react'

interface Network { ssid: string; auth: string; signal: string; bssid: string; open: boolean; saved?: boolean }

export default function WifiPage() {
  const [networks, setNetworks] = useState<Network[]>([])
  const [scanning, setScanning] = useState(false)
  const [connecting, setConnecting] = useState('')
  const [connected, setConnected] = useState('')
  const [error, setError] = useState('')
  const [pwFor, setPwFor] = useState<Network | null>(null)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pwError, setPwError] = useState('')
  const pwInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { scan() }, [])
  useEffect(() => { if (pwFor) setTimeout(() => pwInputRef.current?.focus(), 50) }, [pwFor])

  const scan = async () => {
    setScanning(true); setError('')
    try {
      const res = await window.electronAPI.wifi.scan()
      if (res.error) setError(res.error)
      else {
        setNetworks(res.networks || [])
        if (res.connectedSsid) setConnected(res.connectedSsid)
      }
    } catch (e: any) { setError(e.message) }
    setScanning(false)
  }

  const connect = async (n: Network, pw?: string) => {
    setConnecting(n.ssid); setError(''); setPwError('')
    try {
      const res = await window.electronAPI.wifi.connect(n.ssid, n.open, pw, n.auth)
      if (res.success) {
        setConnected(n.ssid)
        setPwFor(null); setPassword('')
      } else if (res.needsPassword) {
        // Wrong password or no saved profile — (re)open the prompt with the message
        setPwFor(n)
        setPwError(pw ? (res.error || 'Wrong password — try again') : '')
      } else {
        setError(`Failed to connect to ${n.ssid}: ${res.error}`)
        setPwFor(null); setPassword('')
      }
    } catch (e: any) { setError(e.message) }
    setConnecting('')
  }

  // Click on a network card: open → connect; secured with saved profile →
  // connect directly; secured without → ask for the password first.
  const handleConnect = (n: Network) => {
    if (n.open || n.saved) connect(n)
    else { setPassword(''); setPwError(''); setPwFor(n) }
  }

  const submitPassword = () => {
    if (!pwFor) return
    if (password.length < 8) { setPwError('WiFi passwords are at least 8 characters'); return }
    connect(pwFor, password)
  }

  const openNetworks   = networks.filter(n => n.open)
  const secureNetworks = networks.filter(n => !n.open)

  const signalBars = (sig: string) => {
    const pct = parseInt(sig)
    if (pct >= 80) return 4
    if (pct >= 60) return 3
    if (pct >= 40) return 2
    return 1
  }

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-aihub-text flex items-center gap-3">
              <Wifi size={22} className="text-aihub-cyan" /> WiFi Networks
            </h1>
            <p className="text-sm text-aihub-muted mt-0.5">Connect to any network around you — open or secured</p>
          </div>
          <button onClick={scan} disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-accent text-sm font-medium transition-all disabled:opacity-40">
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        {/* Info banner */}
        <div className="mb-4 p-3 rounded-xl bg-aihub-cyan/10 border border-aihub-cyan/20 text-xs text-aihub-cyan flex items-start gap-2">
          <Wifi size={13} className="mt-0.5 shrink-0" />
          <span>Open networks need no password. Secured networks ask for their password once — after that they connect with one click. Avoid entering sensitive info on open WiFi without a VPN.</span>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-start justify-between gap-2">
            <span>{error}</span>
            <button onClick={() => setError('')}><X size={12} /></button>
          </div>
        )}

        {scanning ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-aihub-muted">
            <Loader2 size={32} className="animate-spin text-aihub-accent" />
            <p className="text-sm">Scanning for networks…</p>
          </div>
        ) : (
          <>
            {/* Open networks */}
            {openNetworks.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-bold text-green-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <ShieldOff size={12} /> Open Networks ({openNetworks.length}) — Free Access
                </h2>
                <div className="space-y-2">
                  {openNetworks.map((n, i) => (
                    <NetworkCard key={i} network={n} connecting={connecting===n.ssid} isConnected={connected===n.ssid}
                      onConnect={() => handleConnect(n)} signalBars={signalBars(n.signal)} />
                  ))}
                </div>
              </div>
            )}

            {/* Secured networks — clickable now */}
            {secureNetworks.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-aihub-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Shield size={12} /> Secured Networks ({secureNetworks.length})
                </h2>
                <div className="space-y-2">
                  {secureNetworks.map((n, i) => (
                    <NetworkCard key={i} network={n} connecting={connecting===n.ssid} isConnected={connected===n.ssid}
                      onConnect={() => handleConnect(n)} signalBars={signalBars(n.signal)} />
                  ))}
                </div>
              </div>
            )}

            {networks.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-aihub-muted">
                <WifiOff size={40} className="opacity-20" />
                <p className="text-sm">No networks found. Make sure WiFi is enabled.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Password prompt ── */}
      {pwFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => { if (!connecting) { setPwFor(null); setPassword('') } }}>
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-[380px] rounded-2xl p-6 bg-aihub-card border border-aihub-border/50 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-aihub-accent/15 flex items-center justify-center shrink-0">
                <Lock size={17} className="text-aihub-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-aihub-text truncate">{pwFor.ssid}</div>
                <div className="text-xs text-aihub-muted">{pwFor.auth} · Signal {pwFor.signal}</div>
              </div>
              <button onClick={() => { setPwFor(null); setPassword('') }} disabled={!!connecting}
                className="text-aihub-muted hover:text-aihub-text transition-colors"><X size={16} /></button>
            </div>

            <p className="text-xs text-aihub-muted mt-3 mb-3">Enter the network password to connect. Windows remembers it for next time.</p>

            <div className="relative mb-2">
              <input
                ref={pwInputRef}
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setPwError('') }}
                onKeyDown={e => { if (e.key === 'Enter') submitPassword() }}
                placeholder="Network password"
                disabled={!!connecting}
                className="w-full rounded-xl px-3 py-2.5 pr-10 text-sm bg-aihub-surface/60 border border-aihub-border/40 text-aihub-text placeholder:text-aihub-muted/60 outline-none focus:border-aihub-accent/50 transition-all"
                style={{ userSelect: 'text' }}
              />
              <button onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-aihub-muted hover:text-aihub-text transition-colors">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            {pwError && (
              <div className="mb-2 text-xs text-red-400">{pwError}</div>
            )}

            <button
              onClick={submitPassword}
              disabled={!!connecting || password.length < 8}
              className="w-full mt-1 py-2.5 rounded-xl bg-aihub-accent hover:bg-aihub-accent-glow text-white text-sm font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {connecting ? <><Loader2 size={14} className="animate-spin" /> Connecting…</> : <><Wifi size={14} /> Connect</>}
            </button>
          </motion.div>
        </div>
      )}
    </div>
  )
}

function NetworkCard({ network, connecting, isConnected, onConnect, signalBars }: {
  network: Network; connecting: boolean; isConnected: boolean; onConnect: () => void; signalBars: number
}) {
  return (
    <motion.div initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
      className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
        isConnected ? 'bg-green-500/10 border-green-500/30'
        : network.open ? 'bg-aihub-card/60 border-aihub-border/30 hover:border-green-500/30'
        : 'bg-aihub-card/60 border-aihub-border/30 hover:border-aihub-accent/40'
      }`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${network.open ? 'bg-green-500/15' : 'bg-aihub-accent/10'}`}>
        {network.open ? <Wifi size={18} className="text-green-400" /> : <Shield size={18} className="text-aihub-accent" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-aihub-text truncate">{network.ssid || '(Hidden)'}</span>
          {network.open && <span className="text-xs px-1.5 py-0.5 rounded-md bg-green-500/15 text-green-400 shrink-0">Free</span>}
          {!network.open && network.saved && <span className="text-xs px-1.5 py-0.5 rounded-md bg-aihub-accent/15 text-aihub-accent shrink-0">Saved</span>}
          {isConnected && <CheckCircle2 size={13} className="text-green-400 shrink-0" />}
        </div>
        <div className="text-xs text-aihub-muted">{network.auth || 'Open'} · Signal: {network.signal}</div>
      </div>
      {/* Signal bars */}
      <div className="flex items-end gap-0.5 shrink-0 h-4">
        {[1,2,3,4].map(b => (
          <div key={b} className={`w-1.5 rounded-sm ${b <= signalBars ? (network.open ? 'bg-green-400' : 'bg-aihub-accent') : 'bg-aihub-border/40'}`}
            style={{ height: `${b*25}%` }} />
        ))}
      </div>
      <button onClick={onConnect} disabled={connecting || isConnected}
        className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-40 shrink-0 ${
          isConnected ? 'bg-green-500/20 text-green-400' : 'bg-aihub-accent text-white hover:bg-aihub-accent-glow'
        }`}>
        {connecting ? <Loader2 size={12} className="animate-spin" /> : isConnected ? 'Connected' : 'Connect'}
      </button>
    </motion.div>
  )
}
