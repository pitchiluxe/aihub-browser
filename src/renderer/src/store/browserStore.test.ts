// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { useBrowserStore } from './browserStore'

describe('restoring a large session', () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({ url: `https://example.com/${i}`, title: `Page ${i}`, pageType: 'browser' as const }))
  it('loads only the selected website, retaining every other tab for later', () => {
    useBrowserStore.getState().restoreTabs(entries, 7)
    const state = useBrowserStore.getState()
    expect(state.tabs).toHaveLength(40)
    expect(state.activeTabId).toBe(state.tabs[7].id)
    expect(state.tabs.filter(t => !t.asleep)).toEqual([state.tabs[7]])
    expect(state.tabs.map(t => t.url)).toEqual(entries.map(t => t.url))
  })
  it('wakes a deferred tab on selection without waking its neighbours', () => {
    useBrowserStore.getState().restoreTabs(entries, 0)
    const id = useBrowserStore.getState().tabs[9].id
    useBrowserStore.getState().setActiveTab(id)
    const state = useBrowserStore.getState()
    expect(state.tabs[9]).toMatchObject({ asleep: false, isLoading: true })
    expect(state.tabs.filter(t => !t.asleep)).toHaveLength(2)
  })
  it('keeps internal pages usable and clamps the active index', () => {
    useBrowserStore.getState().restoreTabs([...entries, { url: 'home', title: 'New Tab', pageType: 'browser' }], 999)
    const state = useBrowserStore.getState()
    expect(state.activeTabId).toBe(state.tabs[40].id)
    expect(state.tabs[40].asleep).not.toBe(true)
    expect(state.tabs.slice(0, 40).every(t => t.asleep)).toBe(true)
  })

  it('clears stale audio state when a background tab is manually slept', () => {
    useBrowserStore.getState().restoreTabs(entries.slice(0, 2), 0)
    const backgroundId = useBrowserStore.getState().tabs[1].id
    useBrowserStore.getState().updateTab(backgroundId, { isAudible: true })
    useBrowserStore.getState().sleepTab(backgroundId)
    expect(useBrowserStore.getState().tabs[1]).toMatchObject({ asleep: true, isAudible: false })
  })

  it('sleeps a batch of background tabs in one store update and never sleeps the active tab', () => {
    useBrowserStore.getState().restoreTabs(entries.slice(0, 4), 0)
    const ids = useBrowserStore.getState().tabs.map(tab => tab.id)
    let notifications = 0
    const unsubscribe = useBrowserStore.subscribe(() => { notifications++ })
    useBrowserStore.getState().sleepTabs(ids)
    unsubscribe()
    const state = useBrowserStore.getState()
    expect(state.tabs[0].asleep).toBe(false)
    expect(state.tabs.slice(1).every(tab => tab.asleep && !tab.isAudible)).toBe(true)
    expect(notifications).toBe(1)
  })
})
