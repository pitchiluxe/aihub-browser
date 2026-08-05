import type { Tab } from '../store/browserStore'

/**
 * AIHub Browser — tab grouping.
 *
 * Groups are how 40 open tabs stop being a wall of favicons. Two ways in:
 * the user names one by hand, or the browser proposes groups from what is
 * already open. The proposal logic lives here, away from React, because the
 * interesting part is the rule — what counts as "the same thing" — not the
 * rendering.
 */

export interface TabGroup {
  id: string
  name: string
  /** CSS colour for the group's rail and label. */
  color: string
  collapsed?: boolean
}

/** Muted, distinguishable hues that survive both light and dark themes. */
export const GROUP_COLORS = [
  '#6B4EFF', '#38BDF8', '#34D399', '#FB923C', '#F43F5E', '#A3E635', '#FBBF24', '#C084FC',
]

export function groupColorFor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length]
}

/** Registrable-ish host for grouping: "docs.github.com" → "github.com". */
export function groupKeyForUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    const parts = host.split('.')
    if (parts.length <= 2) return host
    // Handle the common two-label public suffixes so "bbc.co.uk" doesn't
    // become "co.uk" — a full PSL is overkill for a grouping heuristic.
    const twoLevel = ['co.uk', 'com.au', 'co.jp', 'co.nz', 'com.br', 'co.za', 'co.in', 'com.mx']
    const lastTwo = parts.slice(-2).join('.')
    return twoLevel.includes(lastTwo) ? parts.slice(-3).join('.') : parts.slice(-2).join('.')
  } catch {
    return null
  }
}

/** Human label for a group key: "github.com" → "Github". */
export function labelForGroupKey(key: string): string {
  const stem = key.split('.')[0] || key
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

export interface ProposedGroup {
  name: string
  color: string
  tabIds: string[]
}

/**
 * Propose groups from the open tabs. Only sites with at least `minSize` tabs
 * are worth a group — grouping a single tab adds a header and hides nothing,
 * which makes the strip longer rather than shorter.
 */
export function proposeGroups(tabs: Tab[], minSize = 2): ProposedGroup[] {
  const byKey = new Map<string, string[]>()
  for (const tab of tabs) {
    if (tab.isHome || tab.pageType !== 'browser') continue
    const key = groupKeyForUrl(tab.url)
    if (!key) continue
    const list = byKey.get(key)
    if (list) list.push(tab.id)
    else byKey.set(key, [tab.id])
  }

  return [...byKey.entries()]
    .filter(([, ids]) => ids.length >= minSize)
    // Biggest cluster first so the most valuable group takes the first colour,
    // and ties resolve alphabetically for a stable order between runs.
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, tabIds], i) => ({ name: labelForGroupKey(key), color: groupColorFor(i), tabIds }))
}

/**
 * Order tabs for a grouped strip: grouped tabs sit under their group in the
 * group's own order, ungrouped tabs keep their position at the end. Returns a
 * flat render list so the strip can stay a simple map().
 */
export interface StripRow {
  kind: 'group' | 'tab'
  group?: TabGroup
  tab?: Tab
  /** Tabs inside this group, for the count on a collapsed header. */
  count?: number
}

export function buildStripRows(tabs: Tab[], groups: TabGroup[]): StripRow[] {
  const rows: StripRow[] = []
  const claimed = new Set<string>()

  for (const group of groups) {
    const members = tabs.filter(t => t.groupId === group.id)
    if (!members.length) continue           // an emptied group disappears
    rows.push({ kind: 'group', group, count: members.length })
    members.forEach(t => claimed.add(t.id))
    if (group.collapsed) continue
    for (const tab of members) rows.push({ kind: 'tab', tab, group })
  }

  for (const tab of tabs) {
    if (!claimed.has(tab.id)) rows.push({ kind: 'tab', tab })
  }
  return rows
}
