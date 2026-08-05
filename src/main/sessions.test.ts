import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { isRestorable, normalizeSession, isWorthSaving, createSessionManager } from './sessions'

const tab = (url: string, extra: Partial<{ title: string; pageType: string }> = {}) =>
  ({ url, title: extra.title ?? url, pageType: extra.pageType })

describe('isRestorable', () => {
  it('keeps http(s) pages, the home tab and app pages', () => {
    expect(isRestorable(tab('https://example.com'))).toBe(true)
    expect(isRestorable(tab('http://example.com'))).toBe(true)
    expect(isRestorable(tab('home'))).toBe(true)
    expect(isRestorable(tab('aihub://settings'))).toBe(true)
  })
  it('drops blanks, crash pages and anything empty', () => {
    expect(isRestorable(tab(''))).toBe(false)
    expect(isRestorable(tab('   '))).toBe(false)
    expect(isRestorable(tab('about:blank'))).toBe(false)
    expect(isRestorable(tab('data:text/html,crashed'))).toBe(false)
  })
})

describe('normalizeSession', () => {
  it('keeps order and records the active tab', () => {
    const s = normalizeSession([tab('https://a.com'), tab('https://b.com'), tab('https://c.com')], 1)
    expect(s.tabs.map(t => t.url)).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
    expect(s.activeIndex).toBe(1)
  })

  it('re-points the active index after unrestorable tabs are dropped', () => {
    const s = normalizeSession([tab('about:blank'), tab('https://a.com'), tab('https://b.com')], 2)
    expect(s.tabs).toHaveLength(2)
    expect(s.tabs[s.activeIndex].url).toBe('https://b.com')
  })

  it('collapses duplicates but still selects the right tab', () => {
    const s = normalizeSession([tab('https://a.com'), tab('https://b.com'), tab('https://a.com')], 2)
    expect(s.tabs.map(t => t.url)).toEqual(['https://a.com', 'https://b.com'])
    expect(s.tabs[s.activeIndex].url).toBe('https://a.com')
  })

  it('treats the same url as different tabs when the page type differs', () => {
    const s = normalizeSession([tab('aihub://notes', { pageType: 'notes' }), tab('aihub://notes', { pageType: 'manual' })], 0)
    expect(s.tabs).toHaveLength(2)
  })

  it('never returns an active index outside the kept tabs', () => {
    expect(normalizeSession([], 5).activeIndex).toBe(0)
    expect(normalizeSession([tab('https://a.com')], 99).activeIndex).toBe(0)
    expect(normalizeSession([tab('https://a.com')], -3).activeIndex).toBe(0)
  })

  it('caps very large sessions', () => {
    const many = Array.from({ length: 300 }, (_, i) => tab(`https://site${i}.com`))
    expect(normalizeSession(many, 0, 50).tabs).toHaveLength(50)
  })
})

describe('isWorthSaving', () => {
  it('rejects an empty session and a home-only session', () => {
    expect(isWorthSaving({ tabs: [], activeIndex: 0, savedAt: 0 })).toBe(false)
    expect(isWorthSaving({ tabs: [tab('home')], activeIndex: 0, savedAt: 0 })).toBe(false)
  })
  it('accepts a session with real pages', () => {
    expect(isWorthSaving({ tabs: [tab('home'), tab('https://a.com')], activeIndex: 0, savedAt: 0 })).toBe(true)
  })
})

describe('createSessionManager', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'aihub-sess-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('round-trips the last session through disk', () => {
    const a = createSessionManager(dir)
    a.save([tab('https://a.com'), tab('https://b.com')], 1)
    a.flush()

    const b = createSessionManager(dir)
    expect(b.getLast()?.tabs.map(t => t.url)).toEqual(['https://a.com', 'https://b.com'])
    expect(b.getLast()?.activeIndex).toBe(1)
  })

  it('refuses to overwrite a good session with an empty one', () => {
    const m = createSessionManager(dir)
    m.save([tab('https://a.com')], 0)
    expect(m.save([], 0)).toBeNull()
    expect(m.getLast()?.tabs).toHaveLength(1)
  })

  it('preserves the launch snapshot even after the new session overwrites last', () => {
    const first = createSessionManager(dir)
    first.save([tab('https://yesterday.com')], 0)
    first.flush()

    const second = createSessionManager(dir)
    second.captureLaunchSnapshot()
    second.save([tab('https://today.com')], 0)

    expect(second.getLast()?.tabs[0].url).toBe('https://today.com')
    expect(second.getPrevious()?.tabs[0].url).toBe('https://yesterday.com')
  })

  it('saves, lists, opens and deletes workspaces', () => {
    const m = createSessionManager(dir)
    const ws = m.saveWorkspace('Trading', [tab('https://tradingview.com'), tab('https://binance.com')], 0)
    expect(ws?.name).toBe('Trading')
    expect(m.listWorkspaces()).toHaveLength(1)
    expect(m.getWorkspace(ws!.id)?.tabs).toHaveLength(2)
    expect(m.deleteWorkspace(ws!.id)).toBe(true)
    expect(m.listWorkspaces()).toHaveLength(0)
  })

  it('replaces a workspace saved under the same name instead of duplicating it', () => {
    const m = createSessionManager(dir)
    const first = m.saveWorkspace('Work', [tab('https://a.com')], 0)
    const second = m.saveWorkspace('work', [tab('https://a.com'), tab('https://b.com')], 1)
    expect(m.listWorkspaces()).toHaveLength(1)
    expect(second!.id).toBe(first!.id)
    expect(m.getWorkspace(first!.id)?.tabs).toHaveLength(2)
  })

  it('falls back to a name when given a blank one, and trims long ones', () => {
    const m = createSessionManager(dir)
    expect(m.saveWorkspace('   ', [tab('https://a.com')], 0)?.name).toBe('Workspace')
    expect(m.saveWorkspace('x'.repeat(80), [tab('https://a.com')], 0)?.name).toHaveLength(40)
  })

  it('will not save a workspace with nothing in it', () => {
    const m = createSessionManager(dir)
    expect(m.saveWorkspace('Empty', [tab('about:blank')], 0)).toBeNull()
  })
})
