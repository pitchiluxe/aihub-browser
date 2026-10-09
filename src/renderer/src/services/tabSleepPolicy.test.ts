import { describe, expect, it } from 'vitest'
import type { Tab } from '../store/browserStore'
import { getTabSleepCheckInterval, getTabSleepIdleLimit, pruneTabActivity, selectTabsToSleep, type TabSleepPolicyInput } from './tabSleepPolicy'

const HOUR = 60 * 60 * 1000
const now = 10 * HOUR
const tab = (id: string, extra: Partial<Tab> = {}): Tab => ({
  id, url: 'https://example.com', title: id, favicon: '', isHome: false, pageType: 'browser',
  asleep: false, isLoading: false, isAudible: false, ...extra,
})
const input = (overrides: Partial<TabSleepPolicyInput> = {}): TabSleepPolicyInput => ({
  tabs: [tab('old')],
  activeTabId: 'active',
  liveViewIds: new Set(['old']),
  lastUseAt: new Map([['old', now - 3 * HOUR]]),
  now,
  ...overrides,
})

describe('adaptive tab sleeping policy', () => {
  it('uses progressively shorter idle windows as the open tab count grows', () => {
    expect(getTabSleepIdleLimit(11)).toBe(2 * HOUR)
    expect(getTabSleepIdleLimit(12)).toBe(30 * 60 * 1000)
    expect(getTabSleepIdleLimit(29)).toBe(30 * 60 * 1000)
    expect(getTabSleepIdleLimit(30)).toBe(10 * 60 * 1000)
    expect(getTabSleepIdleLimit(50)).toBe(5 * 60 * 1000)
    expect(getTabSleepIdleLimit(-4)).toBe(2 * HOUR)
  })

  it('sleeps a sufficiently idle background browser tab with a live view', () => {
    expect(selectTabsToSleep(input())).toEqual(['old'])
  })

  it.each([
    [10, 2 * HOUR + 1],
    [25, 31 * 60 * 1000],
    [50, 6 * 60 * 1000],
  ])('applies the tab-count policy to a synthetic %i-tab session', (count, idleMs) => {
    const tabs = Array.from({ length: count }, (_, index) => tab(`tab-${index}`))
    const lastUseAt = new Map(tabs.map(({ id }) => [id, now - idleMs]))
    const liveViewIds = new Set(tabs.map(({ id }) => id))
    expect(selectTabsToSleep(input({ tabs, activeTabId: 'tab-0', lastUseAt, liveViewIds }))).toHaveLength(count - 1)
  })

  it('checks more often in larger sessions to release idle memory promptly', () => {
    expect(getTabSleepCheckInterval(11)).toBe(5 * 60 * 1000)
    expect(getTabSleepCheckInterval(12)).toBe(2 * 60 * 1000)
    expect(getTabSleepCheckInterval(30)).toBe(60 * 1000)
    expect(getTabSleepCheckInterval(50)).toBe(30 * 1000)
  })

  it('fails safe when the active tab is not known', () => {
    expect(selectTabsToSleep(input({ activeTabId: null }))).toEqual([])
  })

  it.each([
    ['active', input({ activeTabId: 'old' })],
    ['asleep', input({ tabs: [tab('old', { asleep: true })] })],
    ['loading', input({ tabs: [tab('old', { isLoading: true })] })],
    ['audible', input({ tabs: [tab('old', { isAudible: true })] })],
    ['internal', input({ tabs: [tab('old', { pageType: 'settings' as Tab['pageType'] })] })],
    ['home', input({ tabs: [tab('old', { isHome: true })] })],
    ['without a live view', input({ liveViewIds: new Set() })],
    ['below its idle deadline', input({ lastUseAt: new Map([['old', now - HOUR]]) })],
  ])('does not sleep a %s tab', (_reason, scenario) => {
    expect(selectTabsToSleep(scenario as Parameters<typeof selectTabsToSleep>[0])).toEqual([])
  })

  it('does not treat missing or future last-use timestamps as idle', () => {
    expect(selectTabsToSleep(input({ lastUseAt: new Map() }))).toEqual([])
    expect(selectTabsToSleep(input({ lastUseAt: new Map([['old', now + HOUR]]) }))).toEqual([])
  })

  it('prunes closed tab activity without mutating the original map', () => {
    const previous = new Map([['open', 100], ['closed', 200]])
    const pruned = pruneTabActivity(previous, new Set(['open']))
    expect(pruned).toEqual(new Map([['open', 100]]))
    expect(previous.size).toBe(2)
  })
})
