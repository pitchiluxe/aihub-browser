// focusMode.ts — F9: Focus Mode 2.0
// Time-aware browsing limits, not hard blocks. Track seconds per hostname
// while a tab is active and in foreground. When a category exceeds its daily
// budget, surface a gentle nudge — not a wall.

import { useEffect, useRef, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FocusBudget {
  /** Display label, e.g. "Twitter", "All social media" */
  label: string
  /** Hostnames that count toward this budget, e.g. ['twitter.com', 'x.com'] */
  hostnames: string[]
  /** Daily minute limit. 0 or undefined = unlimited. */
  dailyMinutes?: number
  /** Which "category" badge color to use in the UI */
  color?: string
}

export interface FocusEntry {
  /** YYYY-MM-DD in local time */
  date: string
  /** hostname -> seconds */
  byHost: Record<string, number>
  /** hostname -> most-recent URL visited (for the "where you spent it" view) */
  lastUrl: Record<string, string>
}

export interface FocusConfig {
  /** Per-category budgets */
  budgets: FocusBudget[]
  /** Master switch — when false, nothing is tracked or warned */
  enabled: boolean
  /** When the user has exceeded a budget, don't keep nagging every second */
  dismissedToday: Record<string, string>   // category label -> YYYY-MM-DD
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const FOCUS_CONFIG_KEY  = 'aihub-focus-config-v1'
const FOCUS_DAYS_KEY    = 'aihub-focus-days-v1'

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hostnameOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

export function loadConfig(): FocusConfig {
  try {
    const raw = localStorage.getItem(FOCUS_CONFIG_KEY)
    if (raw) return { ...defaultConfig(), ...JSON.parse(raw) }
  } catch {}
  return defaultConfig()
}

export function saveConfig(c: FocusConfig) {
  try { localStorage.setItem(FOCUS_CONFIG_KEY, JSON.stringify(c)) } catch {}
}

function defaultConfig(): FocusConfig {
  return {
    enabled: false,
    budgets: [
      { label: 'Social',     color: '#ec4899', hostnames: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'reddit.com'] },
      { label: 'Video',      color: '#f97316', hostnames: ['youtube.com', 'netflix.com', 'twitch.tv', 'tiktok.com'] },
      { label: 'News',       color: '#64748b', hostnames: ['cnn.com', 'bbc.com', 'nytimes.com', 'foxnews.com', 'reuters.com'] },
    ],
    dismissedToday: {},
  }
}

function loadDays(): FocusEntry[] {
  try {
    const raw = localStorage.getItem(FOCUS_DAYS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveDays(d: FocusEntry[]) {
  try { localStorage.setItem(FOCUS_DAYS_KEY, JSON.stringify(d)) } catch {}
}

// Keep at most 30 days of history — older days aren't useful for a weekly
// pattern view, and a focus that needs more than a month of history is asking
// the user the wrong question.
function pruneDays(days: FocusEntry[]): FocusEntry[] {
  if (days.length <= 30) return days
  return days.slice(-30)
}

// ─── Tracker hook ────────────────────────────────────────────────────────────

interface TrackerInput {
  /** URL of the currently active tab (null/empty = no tracking) */
  activeUrl: string | null
  /** Whether the window is currently focused (foreground) */
  windowFocused: boolean
  /** Tick interval in ms (default 1000) */
  tickMs?: number
}

/**
 * Returns the running counter for the currently-tracked hostname and the
 * current totals (today). The hook ticks every `tickMs` while the window is
 * focused and the URL has a hostname that matches a budget.
 */
export function useFocusTracker(input: TrackerInput) {
  const { activeUrl, windowFocused, tickMs = 1000 } = input
  const lastTick = useRef<number>(Date.now())
  const [, force] = useState(0)
  const rerender = useCallback(() => force(n => n + 1), [])

  useEffect(() => {
    if (!activeUrl || !windowFocused) return
    const host = hostnameOf(activeUrl)
    if (!host) return
    const cfg = loadConfig()
    if (!cfg.enabled) return
    // Find which budget (if any) this host belongs to
    const matched = cfg.budgets.find(b => b.hostnames.includes(host))
    if (!matched) return

    lastTick.current = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const elapsed = Math.floor((now - lastTick.current) / 1000)
      lastTick.current = now
      if (elapsed < 1) { rerender(); return }

      const days = loadDays()
      const today = todayKey()
      let day = days.find(d => d.date === today)
      if (!day) { day = { date: today, byHost: {}, lastUrl: {} }; days.push(day) }
      day.byHost[host] = (day.byHost[host] || 0) + elapsed
      day.lastUrl[host] = activeUrl
      saveDays(pruneDays(days))
      rerender()
    }, tickMs)

    return () => clearInterval(id)
  }, [activeUrl, windowFocused, tickMs])

  return {
    getToday: () => getTodayTotals(),
    getConfig: () => loadConfig(),
    setConfig: (updater: (c: FocusConfig) => FocusConfig) => {
      const c = updater(loadConfig())
      saveConfig(c)
    },
  }
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function getTodayTotals(): FocusEntry | null {
  const days = loadDays()
  return days.find(d => d.date === todayKey()) || null
}

export function getRecentDays(n: number = 7): FocusEntry[] {
  const days = loadDays()
  return days.slice(-n)
}

/** Returns the budget that the current active URL's host belongs to, or null. */
export function activeBudget(url: string | null): { budget: FocusBudget; todaySeconds: number; host: string } | null {
  if (!url) return null
  const host = hostnameOf(url)
  if (!host) return null
  const cfg = loadConfig()
  if (!cfg.enabled) return null
  const budget = cfg.budgets.find(b => b.hostnames.includes(host))
  if (!budget) return null
  const today = getTodayTotals()
  const todaySeconds = today?.byHost[host] || 0
  return { budget, todaySeconds, host }
}

/** Sum seconds across all hosts in a budget. */
export function budgetTotal(budget: FocusBudget, day: FocusEntry | null): number {
  if (!day) return 0
  let sum = 0
  for (const h of budget.hostnames) sum += (day.byHost[h] || 0)
  return sum
}

/** Seconds -> "1h 23m" or "12m 5s" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`
}

// ─── Config mutation helpers ──────────────────────────────────────────────────

export function addBudget(hostname: string, label: string = 'Custom'): void {
  const cfg = loadConfig()
  if (cfg.budgets.find(b => b.label === label)) {
    // Merge into existing label
    cfg.budgets = cfg.budgets.map(b => b.label === label
      ? { ...b, hostnames: Array.from(new Set([...b.hostnames, hostname])) }
      : b)
  } else {
    cfg.budgets.push({ label, hostnames: [hostname], color: '#a78bfa' })
  }
  saveConfig(cfg)
}

export function setEnabled(enabled: boolean): void {
  const cfg = loadConfig()
  cfg.enabled = enabled
  saveConfig(cfg)
}

export function dismissBudget(label: string): void {
  const cfg = loadConfig()
  cfg.dismissedToday[label] = todayKey()
  saveConfig(cfg)
}

export function isDismissedToday(label: string): boolean {
  const cfg = loadConfig()
  return cfg.dismissedToday[label] === todayKey()
}

export function setDailyMinutes(label: string, minutes: number | undefined): void {
  const cfg = loadConfig()
  cfg.budgets = cfg.budgets.map(b => b.label === label
    ? { ...b, dailyMinutes: minutes }
    : b)
  saveConfig(cfg)
}
