import type { Tab } from '../store/browserStore'

const HOUR_MS = 60 * 60 * 1000
const BUSY_TAB_COUNT = 12
const VERY_BUSY_TAB_COUNT = 30
const EXTREME_TAB_COUNT = 50

export interface TabSleepPolicyInput {
  tabs: readonly Tab[]
  activeTabId: string | null
  liveViewIds: ReadonlySet<string>
  lastUseAt: ReadonlyMap<string, number>
  now: number
}

/** Idle threshold for progressively larger browsing sessions. */
export function getTabSleepIdleLimit(tabCount: number): number {
  const count = Number.isFinite(tabCount) ? Math.max(0, Math.floor(tabCount)) : 0
  if (count >= EXTREME_TAB_COUNT) return 5 * 60 * 1000
  if (count >= VERY_BUSY_TAB_COUNT) return 10 * 60 * 1000
  if (count >= BUSY_TAB_COUNT) return 30 * 60 * 1000
  return 2 * HOUR_MS
}

/** Sleep-check cadence scales with open tabs while keeping small sessions quiet. */
export function getTabSleepCheckInterval(tabCount: number): number {
  const count = Number.isFinite(tabCount) ? Math.max(0, Math.floor(tabCount)) : 0
  if (count >= EXTREME_TAB_COUNT) return 30 * 1000
  if (count >= VERY_BUSY_TAB_COUNT) return 60 * 1000
  if (count >= BUSY_TAB_COUNT) return 2 * 60 * 1000
  return 5 * 60 * 1000
}

/** Return live background browser tabs safe to release at this check. */
export function selectTabsToSleep({ tabs, activeTabId, liveViewIds, lastUseAt, now }: TabSleepPolicyInput): string[] {
  if (!Number.isFinite(now) || !activeTabId) return []
  const idleLimit = getTabSleepIdleLimit(tabs.length)
  const ids: string[] = []

  for (const tab of tabs) {
    if (tab.id === activeTabId || tab.asleep || tab.isLoading || tab.isAudible) continue
    if (tab.isHome || tab.pageType !== 'browser' || !liveViewIds.has(tab.id)) continue
    const seen = lastUseAt.get(tab.id)
    if (typeof seen !== 'number' || !Number.isFinite(seen)) continue
    const idleFor = Math.max(0, now - seen)
    if (idleFor >= idleLimit) ids.push(tab.id)
  }

  return ids
}

/** Drop activity timestamps for tabs that have been closed. */
export function pruneTabActivity(lastUseAt: ReadonlyMap<string, number>, liveTabIds: ReadonlySet<string>): Map<string, number> {
  const pruned = new Map<string, number>()
  for (const [tabId, timestamp] of lastUseAt) {
    if (liveTabIds.has(tabId)) pruned.set(tabId, timestamp)
  }
  return pruned
}
