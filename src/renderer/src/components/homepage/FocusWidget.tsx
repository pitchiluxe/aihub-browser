import React, { useEffect, useRef, useState } from 'react'
import { Target, X, Play, Square, Clock } from 'lucide-react'

// A Pomodoro-style focus session that blocks distracting sites for a set time.
// The blocklist + timer live here and in localStorage (so a reload resumes an
// active session); the actual blocking happens in the main process.

const DISTRACTIONS = [
  'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'tiktok.com', 'reddit.com', 'netflix.com', 'twitch.tv', 'pinterest.com',
]
const DURATIONS = [15, 25, 45, 60]
const KEY = 'aihub-focus'

interface FocusState { endsAt: number; blocked: string[] }

function load(): FocusState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (s && s.endsAt > Date.now()) return s
  } catch {}
  return null
}

export default function FocusWidget({ isLight }: { isLight: boolean }) {
  const [active, setActive] = useState<FocusState | null>(() => load())
  const [open, setOpen] = useState(false)
  const [mins, setMins] = useState(25)
  const [blockOn, setBlockOn] = useState(true)
  const [custom, setCustom] = useState('')
  const [remaining, setRemaining] = useState(0)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  const apply = (blocked: string[] | null) => {
    window.electronAPI?.focus?.apply(blocked).catch(() => {})
  }

  // Restore an in-progress session on mount
  useEffect(() => {
    if (active) apply(active.blocked)
    return () => { if (tick.current) clearInterval(tick.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Countdown
  useEffect(() => {
    if (!active) { setRemaining(0); return }
    const update = () => {
      const left = Math.max(0, active.endsAt - Date.now())
      setRemaining(left)
      if (left <= 0) end()
    }
    update()
    tick.current = setInterval(update, 1000)
    return () => { if (tick.current) clearInterval(tick.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const start = () => {
    const extra = custom.split(',').map(s => s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]).filter(Boolean)
    const blocked = [...(blockOn ? DISTRACTIONS : []), ...extra]
    const state: FocusState = { endsAt: Date.now() + mins * 60000, blocked }
    localStorage.setItem(KEY, JSON.stringify(state))
    apply(blocked.length ? blocked : null)
    setActive(state)
    setOpen(false)
  }

  const end = () => {
    localStorage.removeItem(KEY)
    apply(null)
    setActive(null)
    if (tick.current) clearInterval(tick.current)
  }

  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0')
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')

  const panel: React.CSSProperties = isLight
    ? { background: 'rgba(255,255,255,0.82)', border: '1px solid rgba(0,0,0,0.08)' }
    : { background: 'rgba(20,26,44,0.9)', border: '1px solid rgba(255,255,255,0.09)' }

  // ── Active: countdown pill ──
  if (active) {
    return (
      <div
        className="no-drag"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, padding: '7px 8px 7px 14px', borderRadius: 999,
          ...panel, backdropFilter: 'blur(20px)', boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        }}
      >
        <Target size={14} style={{ color: '#f43f5e' }} />
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.02em', color: isLight ? '#111428' : '#e7e9f5', fontVariantNumeric: 'tabular-nums' }}>{mm}:{ss}</span>
        <span style={{ fontSize: 11, color: isLight ? '#6a719a' : '#8c93b8' }}>focus · {active.blocked.length} blocked</span>
        <button
          onClick={end}
          title="End focus session"
          style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4, padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer', background: 'rgba(244,63,94,0.15)', color: '#fb7185', fontSize: 11, fontWeight: 700 }}
        >
          <Square size={10} fill="currentColor" /> End
        </button>
      </div>
    )
  }

  // ── Idle: button + config popover ──
  return (
    <div style={{ position: 'relative', display: 'inline-block' }} className="no-drag">
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
          ...panel, color: isLight ? '#3a4062' : '#bcc2e0', fontSize: 12.5, fontWeight: 600,
        }}
      >
        <Target size={13} style={{ color: '#f43f5e' }} /> Focus
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', zIndex: 41,
              width: 300, padding: 16, borderRadius: 16, ...panel, backdropFilter: 'blur(28px)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: isLight ? '#111428' : '#e7e9f5' }}>
                <Target size={14} style={{ color: '#f43f5e' }} /> Focus session
              </div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isLight ? '#6a719a' : '#8c93b8' }}><X size={14} /></button>
            </div>

            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: isLight ? '#9aa0c0' : '#666d93', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Clock size={11} /> Duration
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {DURATIONS.map(d => (
                <button
                  key={d} onClick={() => setMins(d)}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                    border: `1px solid ${mins === d ? '#f43f5e' : isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
                    background: mins === d ? 'rgba(244,63,94,0.15)' : 'transparent',
                    color: mins === d ? '#fb7185' : isLight ? '#3a4062' : '#bcc2e0',
                  }}
                >{d}m</button>
              ))}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={blockOn} onChange={e => setBlockOn(e.target.checked)} style={{ accentColor: '#f43f5e', width: 15, height: 15 }} />
              <span style={{ fontSize: 12.5, color: isLight ? '#3a4062' : '#bcc2e0' }}>Block distractions <span style={{ color: isLight ? '#9aa0c0' : '#666d93' }}>(social, video, news)</span></span>
            </label>

            <input
              value={custom} onChange={e => setCustom(e.target.value)}
              placeholder="Also block… e.g. espn.com, news.com"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 10, fontSize: 12, marginBottom: 14,
                border: `1px solid ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)',
                color: isLight ? '#111428' : '#e7e9f5', outline: 'none', userSelect: 'text',
              }}
            />

            <button
              onClick={start}
              disabled={!blockOn && !custom.trim()}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 0', borderRadius: 12, cursor: 'pointer',
                border: 'none', background: 'linear-gradient(135deg,#f43f5e,#e11d48)', color: '#fff', fontSize: 13.5, fontWeight: 800,
                opacity: (!blockOn && !custom.trim()) ? 0.5 : 1, boxShadow: '0 4px 20px rgba(244,63,94,0.4)',
              }}
            >
              <Play size={14} fill="currentColor" /> Start {mins}-minute focus
            </button>
          </div>
        </>
      )}
    </div>
  )
}
