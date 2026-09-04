// FocusPanel.tsx — F9: Focus Mode 2.0
// Floating nudge panel shown when a focus budget is exceeded.
// Also accessible as a modal from the Ledger or a nav button.

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Clock, Plus, X, Settings, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import {
  useFocusTracker, activeBudget, budgetTotal, formatDuration,
  getTodayTotals, getRecentDays, dismissBudget, isDismissedToday,
  loadConfig, saveConfig, addBudget, setEnabled, todayKey,
  type FocusBudget, type FocusConfig, type FocusEntry,
} from '../../services/focusMode'
import { useBrowserStore } from '../../store/browserStore'

// ─── Floating nudge ──────────────────────────────────────────────────────────

export default function FocusNudge() {
  const activeTab = useBrowserStore(s => s.tabs.find(t => t.id === s.activeTabId))
  const [windowFocused, setWindowFocused] = useState(true)
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const [showPanel, setShowPanel] = useState(false)
  const [config, setConfig] = useState<FocusConfig>(loadConfig)
  const [today, setToday] = useState<FocusEntry | null>(null)

  // Track window focus
  useEffect(() => {
    const onFocus  = () => setWindowFocused(true)
    const onBlur   = () => setWindowFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur) }
  }, [])

  // Tracker tick
  const { getToday } = useFocusTracker({
    activeUrl: activeTab?.url || null,
    windowFocused,
    tickMs: 5000, // tick every 5s to avoid hammering localStorage
  })

  // Load + refresh today totals immediately, then on a fast interval
  useEffect(() => {
    setToday(getToday())
    const id = setInterval(() => setToday(getToday()), 2000)
    return () => clearInterval(id)
  }, [])

  // Check which budgets are exceeded
  const exceeded = config.budgets
    .filter(b => b.dailyMinutes && b.dailyMinutes > 0)
    .map(b => {
      const secs = budgetTotal(b, today)
      const limit = b.dailyMinutes! * 60
      return { budget: b, used: secs, limit }
    })
    .filter(r => r.used >= r.limit)
    .filter(r => !dismissed[r.budget.label] && !isDismissedToday(r.budget.label))

  const dismiss = useCallback((label: string) => {
    dismissBudget(label)
    setDismissed(prev => ({ ...prev, [label]: true }))
  }, [])

  // Panel renders as portal
  if (showPanel) {
    return createPortal(
      <FocusPanelContent
        config={config}
        onUpdateConfig={setConfig}
        today={today}
        onClose={() => setShowPanel(false)}
      />,
      document.body,
    )
  }

  if (!config.enabled || exceeded.length === 0) return null

  return createPortal(
    <div
      style={{
        position: 'fixed', bottom: 18, left: 232, right: 390,
        zIndex: 2147483000,
        background: 'rgba(16,20,34,0.96)',
        border: '1px solid rgba(251,191,36,0.35)',
        borderRadius: 14, padding: '12px 16px',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)',
        maxWidth: 480,
      }}
      className="no-drag"
    >
      <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)' }}>
        <Clock size={16} style={{ color: '#fbbf24' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>
          Focus budget reached
        </div>
        {exceeded.map(r => (
          <div key={r.budget.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.budget.color || '#fbbf24', flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-3))' }}>
              {r.budget.label}: {formatDuration(r.used)} / {r.budget.dailyMinutes}m today
            </span>
            <button
              onClick={() => dismiss(r.budget.label)}
              style={{ marginLeft: 'auto', fontSize: 10, color: 'rgb(var(--ds-text-4))', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 6 }}
            >
              Dismiss
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button
            onClick={() => setShowPanel(true)}
            style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}
          >
            View focus stats
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Focus Panel Content ────────────────────────────────────────────────────

function FocusPanelContent({ config, onUpdateConfig, today, onClose }: {
  config: FocusConfig
  onUpdateConfig: (c: FocusConfig) => void
  today: FocusEntry | null
  onClose: () => void
}) {
  const [newHost, setNewHost] = useState('')
  const [selectedLabel, setSelectedLabel] = useState(config.budgets[0]?.label || '')
  const recent = getRecentDays(7)

  const addSite = () => {
    const h = newHost.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    if (!h) return
    addBudget(h, selectedLabel)
    const updated = loadConfig()
    onUpdateConfig(updated)
    setNewHost('')
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483100,
        background: 'rgba(4,7,15,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '10vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 94vw)', maxHeight: '80vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          background: 'var(--ds-panel-bg, rgba(16,20,34,0.98))',
          borderRadius: 18, border: '1px solid rgba(251,191,36,0.25)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.65)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--ds-border-sm)', flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)', flexShrink: 0 }}>
            <Clock size={16} style={{ color: '#fbbf24' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'rgb(var(--ds-text-1))' }}>Focus Mode 2.0</div>
            <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-4))' }}>Time-aware browsing — no blocks, just awareness</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ds-glass-sm)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--ds-text-4))' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {/* Master toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--ds-text-2))' }}>Enable Focus Mode</div>
              <div style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', marginTop: 2 }}>Track time on distracting sites and show gentle nudges</div>
            </div>
            <button
              onClick={() => { const c = loadConfig(); setEnabled(!c.enabled); onUpdateConfig({ ...c, enabled: !c.enabled }) }}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                background: config.enabled ? 'rgba(34,197,94,0.6)' : 'var(--ds-glass-sm)',
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: config.enabled ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%', background: config.enabled ? '#22c55e' : 'rgb(var(--ds-text-4))',
                transition: 'left 0.2s',
              }} />
            </button>
          </div>

          {/* Today's breakdown */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--ds-text-4))', marginBottom: 10 }}>
              Today
            </div>
            {config.budgets.map(b => {
              const secs = budgetTotal(b, today)
              const limit = b.dailyMinutes ? b.dailyMinutes * 60 : 0
              const pct = limit > 0 ? Math.min(100, (secs / limit) * 100) : 0
              const exceeded = limit > 0 && secs >= limit
              return (
                <div key={b.label} style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: b.color || '#a78bfa', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--ds-text-2))', flex: 1 }}>{b.label}</span>
                    <span style={{ fontSize: 11.5, color: exceeded ? '#f87171' : 'rgb(var(--ds-text-3))' }}>
                      {formatDuration(secs)}{limit > 0 ? ` / ${b.dailyMinutes}m` : ''}
                    </span>
                  </div>
                  {limit > 0 && (
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: exceeded ? '#f87171' : (b.color || '#a78bfa'), transition: 'width 0.5s' }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Weekly pattern */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--ds-text-4))', marginBottom: 10 }}>
              This week
            </div>
            <div style={{ display: 'flex', gap: 4, height: 60, alignItems: 'flex-end' }}>
              {getLast7Days().map((date, i) => {
                const day = recent.find(d => d.date === date)
                const total = config.budgets.reduce((s, b) => s + budgetTotal(b, day || null), 0)
                const max = 60 * 60 // 1h = max bar height
                const height = total > 0 ? Math.max(4, Math.min(56, (total / max) * 56)) : 4
                const isToday = date === todayKey()
                return (
                  <div key={date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <div title={`${date}: ${formatDuration(total)}`} style={{ width: '100%', height, borderRadius: 3, background: isToday ? 'rgba(251,191,36,0.5)' : 'rgba(251,191,36,0.2)', transition: 'height 0.3s' }} />
                    <span style={{ fontSize: 9, color: isToday ? '#fbbf24' : 'rgb(var(--ds-text-4))' }}>
                      {date.slice(5)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Add site */}
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--ds-text-4))', marginBottom: 10 }}>
              Track a new site
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={selectedLabel}
                onChange={e => setSelectedLabel(e.target.value)}
                style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', borderRadius: 8, padding: '6px 8px', fontSize: 11.5, color: 'rgb(var(--ds-text-3))', outline: 'none' }}
              >
                {config.budgets.map(b => <option key={b.label} value={b.label}>{b.label}</option>)}
              </select>
              <input
                value={newHost}
                onChange={e => setNewHost(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addSite() }}
                placeholder="hostname.com"
                style={{ flex: 1, background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', borderRadius: 8, padding: '6px 10px', fontSize: 11.5, color: 'rgb(var(--ds-text-3))', outline: 'none' }}
              />
              <button
                onClick={addSite}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function getLast7Days(): string[] {
  const result = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return result
}
