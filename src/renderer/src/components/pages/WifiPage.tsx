import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Wifi, WifiOff, Loader2, Shield, ShieldOff, Signal, RefreshCw, CheckCircle2 } from 'lucide-react'

interface Network { ssid: string; auth: string; signal: string; bssid: string; open: boolean }

export default function WifiPage() {
  const [networks, setNetworks] = useState<Network[]>([])
  const [scanning, setScanning] = useState(false)
  const [connecting, setConnecting] = useState('')
  const [connected, setConnected] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { scan() }, [])

  const scan = async () => {
    setScanning(true); setError('')
    try {
      const res = await window.electronAPI.wifi.scan()
      if (res.error) setError(res.error)
      else setNetworks(res.networks || [])
    } catch (e: any) { setError(e.message) }
    setScanning(false)
  }

  const connect = async (ssid: string) => {
    setConnecting(ssid)
    const res = await window.electronAPI.wifi.connect(ssid)
    setConnecting('')
    if (res.success) setConnected(ssid)
    else setError(`Failed to connect to ${ssid}: ${res.error}`)
  }

  const openNetworks  = networks.filter(n => n.open)
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
              <Wifi size={22} className="text-aihub-cyan" /> Free WiFi Networks
            </h1>
            <p className="text-sm text-aihub-muted mt-0.5">Connect to open networks near you — no password needed</p>
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
          <span>Open networks require no password. Use with caution — avoid entering sensitive info on open WiFi without a VPN.</span>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">{error}</div>
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
                      onConnect={() => connect(n.ssid)} signalBars={signalBars(n.signal)} />
                  ))}
                </div>
              </div>
            )}

            {/* Secured networks */}
            {secureNetworks.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-aihub-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Shield size={12} /> Secured Networks ({secureNetworks.length})
                </h2>
                <div className="space-y-2 opacity-60">
                  {secureNetworks.map((n, i) => (
                    <NetworkCard key={i} network={n} connecting={false} isConnected={false}
                      onConnect={() => {}} signalBars={signalBars(n.signal)} disabled />
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
    </div>
  )
}

function NetworkCard({ network, connecting, isConnected, onConnect, signalBars, disabled }: {
  network: Network; connecting: boolean; isConnected: boolean; onConnect: () => void; signalBars: number; disabled?: boolean
}) {
  return (
    <motion.div initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
      className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
        isConnected ? 'bg-green-500/10 border-green-500/30' : network.open ? 'bg-aihub-card/60 border-aihub-border/30 hover:border-green-500/30' : 'bg-aihub-surface/40 border-aihub-border/20'
      }`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${network.open ? 'bg-green-500/15' : 'bg-aihub-border/20'}`}>
        {network.open ? <Wifi size={18} className="text-green-400" /> : <Shield size={18} className="text-aihub-muted" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-aihub-text truncate">{network.ssid || '(Hidden)'}</span>
          {network.open && <span className="text-xs px-1.5 py-0.5 rounded-md bg-green-500/15 text-green-400 shrink-0">Free</span>}
          {isConnected && <CheckCircle2 size={13} className="text-green-400 shrink-0" />}
        </div>
        <div className="text-xs text-aihub-muted">{network.auth || 'Open'} · Signal: {network.signal}</div>
      </div>
      {/* Signal bars */}
      <div className="flex items-end gap-0.5 shrink-0 h-4">
        {[1,2,3,4].map(b => (
          <div key={b} className={`w-1.5 rounded-sm ${b <= signalBars ? (network.open ? 'bg-green-400' : 'bg-aihub-muted') : 'bg-aihub-border/40'}`}
            style={{ height: `${b*25}%` }} />
        ))}
      </div>
      {!disabled && (
        <button onClick={onConnect} disabled={connecting || isConnected}
          className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-40 shrink-0 ${
            isConnected ? 'bg-green-500/20 text-green-400' : 'bg-aihub-accent text-white hover:bg-aihub-accent-glow'
          }`}>
          {connecting ? <Loader2 size={12} className="animate-spin" /> : isConnected ? 'Connected' : 'Connect'}
        </button>
      )}
    </motion.div>
  )
}
