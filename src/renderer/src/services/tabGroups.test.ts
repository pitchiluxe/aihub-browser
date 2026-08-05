import { describe, it, expect } from 'vitest'
import {
  groupKeyForUrl, labelForGroupKey, proposeGroups, buildStripRows,
  groupColorFor, GROUP_COLORS, type TabGroup,
} from './tabGroups'
import type { Tab } from '../store/browserStore'

const tab = (id: string, url: string, extra: Partial<Tab> = {}): Tab => ({
  id, url, title: url, favicon: '', isLoading: false, isHome: false, pageType: 'browser', ...extra,
})

describe('groupKeyForUrl', () => {
  it('collapses subdomains onto the site', () => {
    expect(groupKeyForUrl('https://docs.github.com/en/actions')).toBe('github.com')
    expect(groupKeyForUrl('https://www.github.com')).toBe('github.com')
    expect(groupKeyForUrl('https://github.com')).toBe('github.com')
  })
  it('handles two-label public suffixes', () => {
    expect(groupKeyForUrl('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
    expect(groupKeyForUrl('https://shop.example.com.au/x')).toBe('example.com.au')
  })
  it('returns null for things that are not web urls', () => {
    expect(groupKeyForUrl('home')).toBeNull()
    expect(groupKeyForUrl('')).toBeNull()
  })
})

describe('labelForGroupKey', () => {
  it('capitalises the site stem', () => {
    expect(labelForGroupKey('github.com')).toBe('Github')
    expect(labelForGroupKey('bbc.co.uk')).toBe('Bbc')
  })
})

describe('proposeGroups', () => {
  it('groups tabs that share a site', () => {
    const groups = proposeGroups([
      tab('1', 'https://github.com/a'),
      tab('2', 'https://docs.github.com/b'),
      tab('3', 'https://example.com'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Github')
    expect(groups[0].tabIds).toEqual(['1', '2'])
  })

  it('ignores single tabs — a group of one hides nothing', () => {
    expect(proposeGroups([tab('1', 'https://a.com'), tab('2', 'https://b.com')])).toEqual([])
  })

  it('skips the home tab and app pages', () => {
    const groups = proposeGroups([
      tab('h1', 'home', { isHome: true }),
      tab('h2', 'home', { isHome: true }),
      tab('s1', 'aihub://settings', { pageType: 'settings' }),
      tab('s2', 'aihub://settings', { pageType: 'settings' }),
    ])
    expect(groups).toEqual([])
  })

  it('orders by size, then alphabetically, and assigns distinct colours', () => {
    const groups = proposeGroups([
      tab('1', 'https://zed.dev/a'), tab('2', 'https://zed.dev/b'),
      tab('3', 'https://github.com/a'), tab('4', 'https://github.com/b'), tab('5', 'https://github.com/c'),
      tab('6', 'https://apple.com/a'), tab('7', 'https://apple.com/b'),
    ])
    expect(groups.map(g => g.name)).toEqual(['Github', 'Apple', 'Zed'])
    expect(new Set(groups.map(g => g.color)).size).toBe(3)
  })

  it('respects a custom minimum size', () => {
    expect(proposeGroups([tab('1', 'https://a.com')], 1)).toHaveLength(1)
  })
})

describe('groupColorFor', () => {
  it('cycles through the palette instead of running out', () => {
    expect(groupColorFor(0)).toBe(GROUP_COLORS[0])
    expect(groupColorFor(GROUP_COLORS.length)).toBe(GROUP_COLORS[0])
  })
})

describe('buildStripRows', () => {
  const group: TabGroup = { id: 'g1', name: 'Github', color: '#6B4EFF' }

  it('puts a header above each group and leaves ungrouped tabs after', () => {
    const rows = buildStripRows(
      [tab('1', 'https://github.com/a', { groupId: 'g1' }), tab('2', 'https://example.com')],
      [group],
    )
    expect(rows.map(r => r.kind)).toEqual(['group', 'tab', 'tab'])
    expect(rows[0].count).toBe(1)
    expect(rows[2].tab?.id).toBe('2')
  })

  it('hides members of a collapsed group but keeps its header and count', () => {
    const rows = buildStripRows(
      [tab('1', 'https://github.com/a', { groupId: 'g1' }), tab('2', 'https://github.com/b', { groupId: 'g1' })],
      [{ ...group, collapsed: true }],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('group')
    expect(rows[0].count).toBe(2)
  })

  it('drops a group whose tabs have all been closed', () => {
    expect(buildStripRows([tab('2', 'https://example.com')], [group])).toEqual([
      { kind: 'tab', tab: tab('2', 'https://example.com') },
    ])
  })

  it('never loses or duplicates a tab', () => {
    const tabs = [
      tab('1', 'https://github.com/a', { groupId: 'g1' }),
      tab('2', 'https://example.com'),
      tab('3', 'https://github.com/b', { groupId: 'g1' }),
      tab('4', 'https://other.com', { groupId: 'missing-group' }),
    ]
    const rendered = buildStripRows(tabs, [group]).filter(r => r.kind === 'tab').map(r => r.tab!.id)
    expect(rendered.slice().sort()).toEqual(['1', '2', '3', '4'])
  })
})
