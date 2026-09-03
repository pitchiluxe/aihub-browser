/**
 * AIHub Browser — the Trading Coach bot.
 *
 * A dedicated trading analyst that appears only when a TradingView chart is
 * open. Knows Gold and Nasdaq deeply, always reads the live chart before
 * answering, and responds in structured tables + trade-plan cards — never
 * bare paragraphs.
 *
 * Per-symbol memory: chat history is saved per symbol (e.g. XAUUSD) and
 * restored when the same chart is re-opened.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, X, Send, Loader2, BarChart3, Activity, Target, Bell,
  Trash2, Sparkles, AlertCircle, Square,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'
import { looksLikeChartUrl } from '../../services/tradingCoach'
import { buildTradingCoachSystemPrompt, detectInstrumentFamily, type InstrumentFamily } from '../../services/tradingCoachBot'
import { streamChat } from '../../services/streamingChat'
import { extractTradePlans, mergeBracket, type RawTradePlan } from '../../services/tradePlanBlocks'
import ChatMessage from '../ai/ChatMessage'
import TradePlanCard from '../ai/TradePlanCard'

interface ChatMsg { role: 'user' | 'assistant'; content: string }

const GOLD = '#fbbf24'
const GOLD_BRIGHT = '#fde68a'
const GOLD_DARK = '#92400e'

const QUICK_ACTIONS = [
  { id: 'analyze',  label: 'Full Analysis', icon: Sparkles,    prompt: 'Do a complete analysis of this chart. Read the chart, then give me the snapshot, the levels, the bias, and any setup you see — all in tables and a trade-plan block.' },
  { id: 'trend',    label: 'Trend Check',   icon: TrendingUp,  prompt: 'What is the current trend on this chart? Is it bullish, bearish, or range-bound? Read the chart and back your call with the actual levels and structure.' },
  { id: 'levels',   label: 'Key Levels',    icon: Target,      prompt: 'Give me every key level on this chart in a table — prior day high/low, session high/low, swing highs/lows, and any round numbers. Read the chart first.' },
  { id: 'alerts',   label: 'Set Alerts',    icon: Bell,        prompt: 'What are the price levels I should set alerts at? Read the chart and list the key levels where price is likely to react, with a short reason for each.' },
] as const

const PLACEHOLDER_BY_FAMILY: Record<InstrumentFamily, string> = {
  gold: 'Ask about Gold — trend, levels, setups, news reaction…',
  nasdaq: 'Ask about Nasdaq — trend, levels, earnings, FOMC reaction…',
  generic: 'Ask about this chart — trend, levels, setups…',
}

export default function TradingCoach() {
  const { tabs, activeTabId } = useBrowserStore(useShallow(s => ({
    tabs: s.tabs, activeTabId: s.activeTabId,
  })))
  const activeTab = tabs.find(t => t.id === activeTabId)
  const isChart = looksLikeChartUrl(activeTab?.url)

  // Panel open/closed — never auto-opens; the floating button is always there on a chart.
  const [isOpen, setIsOpen] = useState(false)

  // Per-symbol message history. Saved/restored via electronAPI.trading.getMemory.
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [currentSymbol, setCurrentSymbol] = useState<string | undefined>()
  const [family, setFamily] = useState<InstrumentFamily>('generic')
  const [interval, setInterval] = useState<string>('1D')
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [chartBusy, setChartBusy] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const stopRequestedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSymbolRef = useRef<string | undefined>(undefined)

  // ── Detect the symbol from the live chart ────────────────────────────────
  // Calls readChart on first chart-detection. The symbol returned is the
  // authoritative one (FX:XAUUSD, NASDAQ:NQ1!, etc.) — we key memory on it.
  const ensureChartDetected = useCallback(async () => {
    if (!activeTabId || chartBusy) return
    setChartBusy(true)
    try {
      const res = await window.electronAPI?.trading?.readChart?.(activeTabId)
      if (!res?.ok || !res?.reading?.symbol) return
      const sym = res.reading.symbol
      const iv  = res.reading.interval || '1D'
      setInterval(iv)
      const fam = detectInstrumentFamily(sym)
      setFamily(fam)
      if (sym !== currentSymbol) {
        setCurrentSymbol(sym)
      }
    } catch { /* silent — the bot still works without a symbol; it just won't load history */ }
    finally { setChartBusy(false) }
  }, [activeTabId, chartBusy, currentSymbol])

  // When the active tab becomes a chart, detect its symbol. Also when the user
  // switches between different TradingView charts (XAUUSD → NQ1!).
  useEffect(() => {
    if (isChart && activeTabId) {
      ensureChartDetected()
    } else if (!isChart) {
      // Leaving the chart: clear symbol so memory key doesn't leak across tabs.
      setCurrentSymbol(undefined)
      setFamily('generic')
    }
  }, [isChart, activeTabId])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Per-symbol memory load/save ──────────────────────────────────────────
  // On symbol change: load the saved history for the new symbol.
  useEffect(() => {
    const sym = currentSymbol
    if (!sym) return
    if (lastSymbolRef.current === sym) return
    lastSymbolRef.current = sym

    ;(window.electronAPI as any)?.trading?.getMemory?.(sym)
      .then((res: any) => {
        if (Array.isArray(res?.messages)) {
          // Only adopt the saved history if the panel is empty (don't clobber
          // a session the user just started).
          setMessages(prev => prev.length ? prev : res.messages)
        }
      })
      .catch(() => {})
  }, [currentSymbol])

  // Debounced save on any message change.
  useEffect(() => {
    const sym = currentSymbol
    if (!sym || !messages.length) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      ;(window.electronAPI as any)?.trading?.saveMemory?.(
        sym,
        messages.map(m => ({ role: m.role, content: m.content })),
      ).catch(() => {})
    }, 1200)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [messages, currentSymbol])

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamText])

  // Focus the composer when the panel opens.
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 220)
  }, [isOpen])

  // Auto-grow the composer.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [input])

  // ── Send a turn ──────────────────────────────────────────────────────────
  const send = useCallback(async (rawText: string) => {
    const text = rawText.trim()
    if (!text || isLoading) return

    setErrorMsg(null)
    setIsLoading(true)
    stopRequestedRef.current = false
    setMessages(m => [...m, { role: 'user', content: text }])
    setInput('')

    try {
      // Read the live chart BEFORE the model answers. Embedding the actual
      // numbers in the system prompt is the only way to guarantee the model
      // never invents a price.
      let chartBlock = '## Current chart data\n(no chart read yet — the user has not opened one for this turn)'
      if (activeTabId) {
        const res = await window.electronAPI?.trading?.readChart?.(activeTabId)
        if (res?.ok && res.reading) {
          const r = res.reading
          const a: any = res.analysis || {}
          const levels = Array.isArray(a.levels) ? a.levels.slice(0, 8) : []
          const lines = [
            '## Current chart data — read live, USE THESE NUMBERS',
            '',
            `- Symbol: **${r.symbol}** (${r.name || 'n/a'})`,
            `- Exchange: ${r.exchange || 'n/a'}`,
            `- Timeframe: **${r.interval || 'n/a'}**`,
            `- Last price: **${r.price}**`,
            r.ohlc ? `- Current bar OHLC: O ${r.ohlc.open} / H ${r.ohlc.high} / L ${r.ohlc.low} / C ${r.ohlc.close}` : '',
            r.change !== undefined ? `- Change: ${r.change} (${r.changePercent ?? '?'}%)` : '',
            r.volume ? `- Volume: ${r.volume}` : '',
            r.bid !== undefined ? `- Bid/Ask: ${r.bid} / ${r.ask}` : '',
            r.sessionTime ? `- Session clock: ${r.sessionTime}` : '',
            a.bias ? `- Computed bias: **${a.bias}** (${a.reasoning || 'from chart structure'})` : '',
            typeof a.atr === 'number' ? `- ATR: ${a.atr}` : '',
            typeof a.barsRead === 'number' ? `- Bars read: ${a.barsRead}` : '',
            '',
            '### Key levels (computed)',
            levels.length
              ? levels.map((l: any) => `- ${l.label} = **${l.price}** (${l.kind}, weight ${l.weight})`).join('\n')
              : '(no levels computed)',
            '',
            a.plan ? `### Plan\n\`\`\`json\n${JSON.stringify(a.plan, null, 2)}\n\`\`\`` : '',
            Array.isArray(a.bracket) && a.bracket.length
              ? `### Bracket\n\`\`\`json\n${JSON.stringify(a.bracket, null, 2)}\n\`\`\``
              : '',
          ].filter(Boolean).join('\n')
          chartBlock = lines
        } else if (res && !res.ok) {
          chartBlock = `## Current chart data\n(read failed: ${res.error || 'unknown'})`
        }
      }

      const systemPrompt = buildTradingCoachSystemPrompt(family, chartBlock)
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const result = await streamChat(
        [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: text }],
        { needsTools: false },
        setStreamText,
      )
      setStreamText('')
      const content = (result?.content || '').trim() || 'No response — try again.'
      setMessages(m => [...m, { role: 'assistant', content }])
    } catch (err: any) {
      setErrorMsg(err?.message || 'Connection error')
      setMessages(m => [...m, { role: 'assistant', content: 'Connection error. Try again.' }])
    } finally {
      setIsLoading(false)
      setStreamText('')
      stopRequestedRef.current = false
    }
  }, [isLoading, messages, family, activeTabId])

  const stopLoop = useCallback(() => {
    stopRequestedRef.current = true
    setIsLoading(false)
    setStreamText('')
  }, [])

  const handleQuick = useCallback((prompt: string) => {
    if (isLoading) return
    send(prompt)
  }, [isLoading, send])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const handleClear = useCallback(() => {
    if (isLoading) return
    setMessages([])
  }, [isLoading])

  // ── Render a message — extract trade plans, render them as cards ─────────
  // Pulls out any ```trade-plan blocks (or tagged equivalents — see
  // tradePlanBlocks.ts) and renders them as TradePlanCard. The remaining
  // prose is the assistant bubble.
  const renderAssistant = (content: string, key: number) => {
    const { text, plans } = extractTradePlans(content)
    const merged = mergeBracket(plans as RawTradePlan[])
    return (
      <div key={key}>
        <ChatMessage
          role="assistant"
          content={text}
          accent={GOLD}
          avatar={
            <div style={{
              width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
              background: `linear-gradient(135deg, ${GOLD}33, ${GOLD}11)`,
              border: `1px solid ${GOLD}55`,
            }}>
              <BarChart3 size={11} style={{ color: GOLD_BRIGHT }} />
            </div>
          }
        />
        {merged.length > 0 && merged.map((plan, i) => (
          <div key={`plan-${key}-${i}`} style={{ marginTop: 8 }}>
            <TradePlanCard plan={plan as any} />
          </div>
        ))}
      </div>
    )
  }

  // ── Floating button + panel ──────────────────────────────────────────────
  // When the active tab is not a TradingView chart, the entire component
  // returns null. The button is only ever on a chart.
  // Hooks MUST be called unconditionally before any early return.

  // ── Draggable button position (persists in localStorage) ────────────────
  // Default is bottom-left; the user can drag the button anywhere on the
  // viewport. Stored as {x, y} = top-left corner of the 56x56 button. The
  // panel is anchored to the same position so the two stay together.
  const BUTTON_SIZE = 56
  const storedPos = (() => {
    try {
      const raw = localStorage.getItem('trading-coach-pos')
      if (raw) {
        const p = JSON.parse(raw)
        if (typeof p?.x === 'number' && typeof p?.y === 'number') return p
      }
    } catch {}
    // Default: bottom-left, 18px margin
    return { x: 18, y: typeof window !== 'undefined' ? window.innerHeight - BUTTON_SIZE - 18 : 600 }
  })()
  const [pos, setPos] = useState(storedPos)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!isChart) return
    try { localStorage.setItem('trading-coach-pos', JSON.stringify(pos)) } catch {}
  }, [pos, isChart])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true
    if (!dragRef.current.moved) return
    const maxX = window.innerWidth  - BUTTON_SIZE
    const maxY = window.innerHeight - BUTTON_SIZE
    setPos({
      x: Math.max(0, Math.min(maxX, dragRef.current.origX + dx)),
      y: Math.max(0, Math.min(maxY, dragRef.current.origY + dy)),
    })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const wasMoved = dragRef.current.moved
    dragRef.current = null
    setDragging(false)
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    // If the pointer didn't move, treat as a click (open/close panel)
    if (!wasMoved) setIsOpen(o => !o)
  }

  if (!isChart) return null

  // The panel is anchored next to the button: vertically centered, horizontally
  // to whichever side has more room. The user dragging the button effectively
  // moves the whole coach.
  const panelStyle = (() => {
    const PANEL_W = 400, PANEL_H_PAD = 176 // top+bottom 88
    const centerY = pos.y + BUTTON_SIZE / 2
    const wantTop = centerY - window.innerHeight / 2
    const top = Math.max(8, Math.min(window.innerHeight - PANEL_H_PAD, wantTop))
    const preferRight = pos.x < window.innerWidth - PANEL_W - 20
    const left = preferRight ? pos.x + BUTTON_SIZE + 12 : Math.max(8, pos.x - PANEL_W - 12)
    return { top, left }
  })()

  const body = (
    <>
      {/* Floating button — draggable, only on a chart */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 12 }}
        transition={{ type: 'spring', damping: 22, stiffness: 320 }}
        title="Trading Coach — drag to move"
        className="no-drag"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'fixed', left: pos.x, top: pos.y, zIndex: 260,
          width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: 18,
          border: `1px solid ${GOLD}66`,
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none', touchAction: 'none',
          background: isOpen
            ? `linear-gradient(135deg, ${GOLD}EE, ${GOLD_DARK}DD)`
            : `linear-gradient(135deg, ${GOLD}AA, ${GOLD_DARK}88)`,
          boxShadow: isOpen
            ? `0 8px 28px ${GOLD}55, 0 0 0 2px ${GOLD}33`
            : `0 6px 22px ${GOLD}44, 0 0 0 1px ${GOLD}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff',
          transition: dragging ? 'none' : 'box-shadow 0.18s, background 0.18s',
        }}
        onMouseEnter={e => { if (!dragging) { e.currentTarget.style.boxShadow = `0 10px 32px ${GOLD}66, 0 0 0 2px ${GOLD}55` } }}
        onMouseLeave={e => { if (!dragging) { e.currentTarget.style.boxShadow = isOpen ? `0 8px 28px ${GOLD}55, 0 0 0 2px ${GOLD}33` : `0 6px 22px ${GOLD}44, 0 0 0 1px ${GOLD}22` } }}
      >
        {isOpen ? <X size={20} /> : <BarChart3 size={22} />}
        {!isOpen && (
          <span style={{
            position: 'absolute', top: -3, right: -3, width: 12, height: 12, borderRadius: '50%',
            background: GOLD, border: '2px solid var(--ds-bg-1, #0a0a0a)',
            boxShadow: `0 0 8px ${GOLD}`,
            animation: 'tcPulse 1.8s ease-in-out infinite',
          }} />
        )}
      </motion.div>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: -24, opacity: 0, scale: 0.97 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: -24, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="no-drag"
            style={{
              position: 'fixed', left: panelStyle.left, top: panelStyle.top,
              width: 400, height: `calc(100vh - ${panelStyle.top}px - 18px)`, zIndex: 250,
              display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden',
              background: 'var(--ds-panel-bg)',
              backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
              border: `1px solid ${GOLD}55`,
              boxShadow: `inset 0 1px 0 var(--ds-glass-md), 0 18px 48px rgba(0,0,0,0.5), 0 0 0 1px ${GOLD}22`,
            }}
          >
            {/* Top highlight */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 1, zIndex: 1, pointerEvents: 'none',
              background: `linear-gradient(90deg, transparent 5%, ${GOLD}88 50%, transparent 95%)`,
            }} />

            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px 10px', borderBottom: `1px solid ${GOLD}22`, flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: `linear-gradient(135deg, ${GOLD}44, ${GOLD_DARK}22)`,
                  border: `1px solid ${GOLD}55`, boxShadow: `0 0 18px ${GOLD}33`,
                }}>
                  <BarChart3 size={16} style={{ color: GOLD_BRIGHT }} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'rgb(var(--ds-text-1))', lineHeight: 1 }}>Trading Coach</span>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                      padding: '2px 6px', borderRadius: 999,
                      background: `${GOLD}22`, color: GOLD, border: `1px solid ${GOLD}44`,
                    }}>GOLD · NASDAQ</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: currentSymbol ? '#34d399' : 'rgb(var(--ds-text-4))',
                      boxShadow: currentSymbol ? '0 0 6px #34d399' : 'none',
                    }} />
                    <span style={{ fontSize: 10.5, color: 'rgb(var(--ds-text-4))' }}>
                      {currentSymbol
                        ? <>on <span style={{ color: GOLD_BRIGHT, fontWeight: 600 }}>{currentSymbol}</span> · {interval}</>
                        : 'waiting for chart…'}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <HeaderBtn onClick={handleClear} title="Clear chat"><Trash2 size={13} /></HeaderBtn>
                <HeaderBtn onClick={() => setIsOpen(false)} title="Close"><X size={14} /></HeaderBtn>
              </div>
            </div>

            {/* Quick actions */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--ds-glass-sm)', flexShrink: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {QUICK_ACTIONS.map(a => {
                  const Icon = a.icon
                  return (
                    <button
                      key={a.id}
                      onClick={() => handleQuick(a.prompt)}
                      disabled={isLoading}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: '8px 10px', borderRadius: 10,
                        border: `1px solid ${GOLD}33`, background: `${GOLD}0C`,
                        color: GOLD_BRIGHT, fontSize: 11, fontWeight: 600,
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        opacity: isLoading ? 0.5 : 1,
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${GOLD}22`; (e.currentTarget as HTMLElement).style.borderColor = `${GOLD}66` }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${GOLD}0C`; (e.currentTarget as HTMLElement).style.borderColor = `${GOLD}33` }}
                    >
                      <Icon size={12} />{a.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Error / loading hint */}
            {errorMsg && (
              <div style={{
                margin: '8px 12px 0', padding: '6px 10px', borderRadius: 8, flexShrink: 0,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#fca5a5', fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <AlertCircle size={11} /> {errorMsg}
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} style={{
              flex: 1, overflowY: 'auto', padding: 12,
              scrollbarWidth: 'thin', scrollbarColor: `${GOLD}33 transparent`,
              userSelect: 'text', WebkitUserSelect: 'text',
            }}>
              {messages.length === 0 && (
                <EmptyState family={family} symbol={currentSymbol} chartBusy={chartBusy} />
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {messages.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16 }}
                  >
                    {m.role === 'user' ? (
                      <ChatMessage
                        role="user"
                        content={m.content}
                        accent={GOLD}
                        avatar={
                          <div style={{
                            width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
                            background: `rgb(var(--ds-accent) / 0.15)`, border: '1px solid rgb(var(--ds-accent) / 0.2)',
                          }}>
                            <Activity size={11} style={{ color: 'rgb(var(--ds-accent-soft))' }} />
                          </div>
                        }
                      />
                    ) : renderAssistant(m.content, i)}
                  </motion.div>
                ))}
              </div>

              {/* Streaming bubble */}
              {isLoading && (
                <div style={{ display: 'flex', alignItems: streamText ? 'flex-start' : 'center', gap: 8, marginTop: 12 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: `linear-gradient(135deg, ${GOLD}33, ${GOLD}11)`, border: `1px solid ${GOLD}55`,
                  }}>
                    <BarChart3 size={11} style={{ color: GOLD_BRIGHT }} />
                  </div>
                  {streamText ? (
                    <div style={{
                      maxWidth: '85%', padding: '9px 12px', borderRadius: 14, borderTopLeftRadius: 4,
                      fontSize: 12, lineHeight: 1.55,
                      background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)',
                      color: 'rgb(var(--ds-text-2))', userSelect: 'text', WebkitUserSelect: 'text',
                      overflow: 'hidden', wordBreak: 'break-word', overflowWrap: 'break-word',
                    }}>
                      <span style={{ whiteSpace: 'pre-wrap' }}>{streamText}</span>
                      <span style={{
                        display: 'inline-block', width: 6, height: 12, marginLeft: 2, verticalAlign: 'text-bottom',
                        background: GOLD, animation: 'aiDotBounce 1.1s ease-in-out infinite',
                      }} />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 4, padding: '9px 14px', borderRadius: 14, borderTopLeftRadius: 4,
                      background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
                      {[0, 1, 2].map(n => (
                        <span key={n} style={{
                          width: 6, height: 6, borderRadius: '50%', background: GOLD, display: 'inline-block',
                          animation: `aiDotBounce 1.3s ease-in-out ${n * 0.18}s infinite`,
                        }} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Composer */}
            <div style={{ padding: 12, borderTop: '1px solid var(--ds-border-sm)', flexShrink: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 8,
                padding: '8px 12px', borderRadius: 14,
                background: 'var(--ds-glass-sm)', border: `1px solid var(--ds-border-sm)`,
                transition: 'border-color 0.12s',
              }}
                onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = `${GOLD}66`}
                onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-border-sm)'}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={PLACEHOLDER_BY_FAMILY[family]}
                  rows={1}
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                    fontSize: 12, color: 'rgb(var(--ds-text-2))', lineHeight: 1.5, maxHeight: 96, overflowY: 'auto',
                    userSelect: 'text',
                  }}
                />
                <button
                  onClick={() => send(input)}
                  disabled={(!input.trim() || isLoading)}
                  style={{
                    width: 30, height: 30, borderRadius: 10, border: 'none',
                    cursor: (!input.trim() || isLoading) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: (!input.trim() || isLoading)
                      ? 'var(--ds-glass-sm)'
                      : `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})`,
                    opacity: (!input.trim() || isLoading) ? 0.4 : 1,
                    boxShadow: (!input.trim() || isLoading) ? 'none' : `0 2px 14px ${GOLD}55`,
                    transition: 'all 0.15s',
                  }}
                >
                  {isLoading
                    ? <Loader2 size={13} style={{ color: GOLD_BRIGHT, animation: 'spin 0.7s linear infinite' }} />
                    : <Send size={13} style={{ color: '#fff' }} />}
                </button>
                {isLoading && (
                  <button
                    onClick={stopLoop}
                    title="Stop"
                    style={{
                      width: 30, height: 30, borderRadius: 10,
                      border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      background: 'rgba(239,68,68,0.12)', color: '#f87171',
                    }}
                  >
                    <Square size={11} fill="currentColor" />
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, padding: '0 2px' }}>
                <span style={{ fontSize: 10, color: 'rgb(var(--ds-text-4) / 0.75)' }}>
                  {currentSymbol
                    ? <>on <span style={{ color: GOLD_BRIGHT }}>{currentSymbol}</span> · memory saved per symbol</>
                    : 'open a chart to start'}
                </span>
                <span style={{ fontSize: 10, color: `${GOLD}88` }}>● trading coach</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pulse animation for the floating button's notification dot */}
      <style>{`
        @keyframes tcPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.25); opacity: 0.7; }
        }
      `}</style>
    </>
  )

  // Portal out to <body> so no ancestor stacking context, overflow, or
  // transform can ever clip or relocate the floating UI. This guarantees
  // the button is on the actual viewport, above the sidebar, sidebar
  // drag-region, and any other in-app chrome.
  if (typeof document === 'undefined') return body
  return createPortal(body, document.body)
}

function HeaderBtn({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hovered ? 'var(--ds-glass-md)' : 'var(--ds-glass-xs)',
        color: hovered ? 'rgb(var(--ds-text-2))' : 'rgb(var(--ds-text-4))', transition: 'all 0.12s',
      }}>
      {children}
    </button>
  )
}

function EmptyState({ family, symbol, chartBusy }: { family: InstrumentFamily; symbol?: string; chartBusy: boolean }) {
  const headline = family === 'gold'
    ? 'Gold Specialist'
    : family === 'nasdaq'
    ? 'Nasdaq Specialist'
    : 'Chart Analyst'
  const sub = symbol
    ? `Connected to ${symbol}. Ask me for an analysis, a level summary, or a setup.`
    : chartBusy
    ? 'Reading your chart…'
    : 'Waiting for a chart signal.'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: '24px 0', textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${GOLD}22, ${GOLD_DARK}11)`,
        border: `1px solid ${GOLD}44`, boxShadow: `0 0 28px ${GOLD}22`,
      }}>
        <TrendingUp size={26} style={{ color: GOLD_BRIGHT }} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgb(var(--ds-text-1))', marginBottom: 6 }}>{headline}</div>
        <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-4))', lineHeight: 1.55, maxWidth: 280 }}>{sub}</div>
      </div>
      <div style={{
        fontSize: 10, padding: '4px 10px', borderRadius: 999,
        background: `${GOLD}11`, border: `1px solid ${GOLD}33`, color: GOLD_BRIGHT,
      }}>
        Every answer has a snapshot table, a bias badge, and a trade plan.
      </div>
    </div>
  )
}
