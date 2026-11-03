/**
 * AIHub Browser — Agent Doctor, the observation core.
 *
 * Pure: no Electron imports, no timers. The wiring in register.ts feeds it a
 * sample every few seconds and forwards tab hang/crash events; this module
 * keeps a short history, decides what is wrong with fixed rules, and records
 * when each problem starts and stops. Rules, not a model, make the decisions
 * so diagnosis is deterministic, instant, and still works when the local AI
 * is itself the thing hogging the machine.
 *
 * Nothing here is written to disk. The journal names tabs, and tab titles are
 * browsing history; keeping it in memory for the session means it never
 * outlives the app or needs its own privacy controls.
 */

export interface ProcessSample {
  pid: number
  /** Electron's process type: 'Browser', 'Tab', 'GPU', 'Utility', … */
  type: string
  /** Percent of one core, averaged since the previous sample. */
  cpu: number
  memMb: number
  /** Set when this process hosts a browser tab. */
  tab?: { id: string; windowId: number; title: string; active: boolean }
}

export interface Sample {
  at: number
  /** Main-process event loop delay over the sample window. */
  loopP99Ms: number
  loopMaxMs: number
  processes: ProcessSample[]
}

export type FindingKind = 'main-stall' | 'main-spike' | 'tab-hung' | 'tab-crashed' | 'tab-cpu' | 'tab-memory'
export type Severity = 'warn' | 'critical'

export interface Finding {
  /** Stable while the problem lasts, so the journal can pair open/close. */
  key: string
  kind: FindingKind
  severity: Severity
  title: string
  detail: string
  since: number
  tab?: { id: string; windowId: number; title: string }
}

export interface JournalEntry {
  at: number
  event: 'opened' | 'resolved'
  kind: FindingKind
  severity: Severity
  title: string
}

export interface DoctorSnapshot {
  status: 'ok' | 'warn' | 'critical'
  samples: Sample[]
  findings: Finding[]
  journal: JournalEntry[]
}

export const DOCTOR_LIMITS = {
  /** History kept for the charts: 60 samples ≈ 10 min at the 10 s cadence. */
  samples: 60,
  journal: 200,
  /** p99 loop delay that, held for `stallSamples` in a row, means sustained lag. */
  stallP99Ms: 250,
  stallSamples: 3,
  /** A single main-thread block this long is felt as a freeze. */
  spikeMaxMs: 1000,
  /** A tab counts as hung once it has gone this long without answering (a
   *  liveness ping is sent every sample, so detection lands on the sample after). */
  hungMs: 8000,
  /** Background tab CPU held this high for `cpuSamples` samples (≈1 min). */
  bgCpuPct: 40,
  cpuSamples: 6,
  tabMemMb: 1500,
  /** A crash is shown for this long, then drops off. */
  crashShowMs: 5 * 60_000,
} as const

const round = (n: number) => Math.round(n)

export function createDoctorModel(limits = DOCTOR_LIMITS) {
  const samples: Sample[] = []
  const journal: JournalEntry[] = []
  const hung = new Map<string, { since: number; windowId: number; title: string }>()
  const crashed = new Map<string, { at: number; windowId: number; title: string; reason: string }>()
  let open = new Map<string, Finding>()

  const tabKey = (windowId: number, tabId: string) => `${windowId}:${tabId}`

  function diagnose(now: number): Finding[] {
    const out: Finding[] = []
    const last = samples[samples.length - 1]

    const recent = samples.slice(-limits.stallSamples)
    if (recent.length === limits.stallSamples && recent.every(s => s.loopP99Ms >= limits.stallP99Ms)) {
      out.push({
        key: 'main-stall', kind: 'main-stall', severity: 'critical', since: recent[0].at,
        title: 'The browser itself is lagging',
        detail: `The main process has been slow to respond for ${round((now - recent[0].at) / 1000)} s (p99 delay ${round(last.loopP99Ms)} ms). Every tab feels this.`,
      })
    } else if (last && last.loopMaxMs >= limits.spikeMaxMs) {
      out.push({
        key: 'main-spike', kind: 'main-spike', severity: 'warn', since: last.at,
        title: 'The browser froze briefly',
        detail: `The main process was blocked for ${round(last.loopMaxMs)} ms in the last few seconds.`,
      })
    }

    for (const [key, h] of hung) {
      if (now - h.since < limits.hungMs) continue
      const tabId = key.slice(key.indexOf(':') + 1)
      out.push({
        key: `tab-hung:${key}`, kind: 'tab-hung', severity: 'critical', since: h.since,
        title: `Tab not responding: ${h.title}`,
        detail: `The page has been frozen for ${round((now - h.since) / 1000)} s: a script is blocking it. Restarting the page reloads it.`,
        tab: { id: tabId, windowId: h.windowId, title: h.title },
      })
    }

    for (const [key, c] of crashed) {
      if (now - c.at > limits.crashShowMs) { crashed.delete(key); continue }
      const tabId = key.slice(key.indexOf(':') + 1)
      out.push({
        key: `tab-crashed:${key}:${c.at}`, kind: 'tab-crashed', severity: 'warn', since: c.at,
        title: `Tab crashed: ${c.title}`,
        detail: `Its page process ended (${c.reason}). The browser reloads it automatically once.`,
        tab: { id: tabId, windowId: c.windowId, title: c.title },
      })
    }

    if (last) {
      for (const p of last.processes) {
        if (!p.tab) continue
        const key = tabKey(p.tab.windowId, p.tab.id)
        const tab = { id: p.tab.id, windowId: p.tab.windowId, title: p.tab.title }
        if (!p.tab.active) {
          const window = samples.slice(-limits.cpuSamples)
          const busy = window.length === limits.cpuSamples && window.every(s =>
            s.processes.some(q => q.pid === p.pid && q.tab && !q.tab.active && q.cpu >= limits.bgCpuPct))
          if (busy) {
            out.push({
              key: `tab-cpu:${key}`, kind: 'tab-cpu', severity: 'warn', since: window[0].at,
              title: `Background tab using CPU: ${p.tab.title}`,
              detail: `${round(p.cpu)}% CPU for over a minute while you are not looking at it. Sleeping it frees the CPU and memory.`,
              tab,
            })
          }
        }
        if (p.memMb >= limits.tabMemMb) {
          out.push({
            key: `tab-memory:${key}`, kind: 'tab-memory', severity: 'warn', since: last.at,
            title: `Tab using a lot of memory: ${p.tab.title}`,
            detail: `${(p.memMb / 1024).toFixed(1)} GB. ${p.tab.active ? 'Closing other tabs' : 'Sleeping it'} gives that back.`,
            tab,
          })
        }
      }
    }
    return out
  }

  function remember(entry: JournalEntry) {
    journal.unshift(entry)
    if (journal.length > limits.journal) journal.length = limits.journal
  }

  /** Re-run the rules and journal what started or stopped. */
  function refresh(now: number) {
    const next = new Map<string, Finding>()
    for (const f of diagnose(now)) {
      // Keep the original start time of an ongoing problem.
      const prev = open.get(f.key)
      next.set(f.key, prev ? { ...f, since: prev.since } : f)
      if (!prev) remember({ at: now, event: 'opened', kind: f.kind, severity: f.severity, title: f.title })
    }
    for (const [key, f] of open) {
      if (!next.has(key)) remember({ at: now, event: 'resolved', kind: f.kind, severity: f.severity, title: f.title })
    }
    open = next
  }

  return {
    addSample(sample: Sample) {
      samples.push(sample)
      if (samples.length > limits.samples) samples.splice(0, samples.length - limits.samples)
      refresh(sample.at)
    },
    tabUnresponsive(windowId: number, tabId: string, title: string, now: number) {
      const key = tabKey(windowId, tabId)
      if (!hung.has(key)) hung.set(key, { since: now, windowId, title })
    },
    tabResponsive(windowId: number, tabId: string, now: number) {
      if (hung.delete(tabKey(windowId, tabId))) refresh(now)
    },
    tabCrashed(windowId: number, tabId: string, title: string, reason: string, now: number) {
      const key = tabKey(windowId, tabId)
      hung.delete(key)
      crashed.set(key, { at: now, windowId, title, reason })
      refresh(now)
    },
    tabClosed(windowId: number, tabId: string, now: number) {
      const key = tabKey(windowId, tabId)
      const had = hung.delete(key) || crashed.delete(key)
      if (had) refresh(now)
    },
    snapshot(now: number): DoctorSnapshot {
      refresh(now)
      const findings = [...open.values()].sort((a, b) =>
        (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1) || a.since - b.since)
      const status = findings.some(f => f.severity === 'critical') ? 'critical' : findings.length ? 'warn' : 'ok'
      return { status, samples: [...samples], findings, journal: [...journal] }
    },
  }
}

export type DoctorModel = ReturnType<typeof createDoctorModel>
