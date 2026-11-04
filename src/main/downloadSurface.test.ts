import { describe, it, expect } from 'vitest'
import { isDownloadOnlyPage, taskbarProgress } from './downloadSurface'

describe('isDownloadOnlyPage', () => {
  it('flags a fresh tab that never committed a page', () => {
    expect(isDownloadOnlyPage('', 0)).toBe(true)
    expect(isDownloadOnlyPage('about:blank', 1)).toBe(true)
  })
  it('keeps a tab that is showing a page', () => {
    expect(isDownloadOnlyPage('https://example.com/files', 1)).toBe(false)
  })
  it('keeps a blank tab the person navigated through before', () => {
    expect(isDownloadOnlyPage('about:blank', 3)).toBe(false)
  })
})

describe('taskbarProgress', () => {
  it('removes the bar when nothing is in flight', () => {
    expect(taskbarProgress([])).toBe(-1)
  })
  it('is indeterminate when no size is known', () => {
    expect(taskbarProgress([{ receivedBytes: 500, totalBytes: 0 }])).toBe(2)
  })
  it('combines known sizes', () => {
    expect(taskbarProgress([
      { receivedBytes: 50, totalBytes: 100 },
      { receivedBytes: 150, totalBytes: 300 },
      { receivedBytes: 999, totalBytes: 0 },
    ])).toBeCloseTo(0.5)
  })
  it('never overshoots when a server under-reports length', () => {
    expect(taskbarProgress([{ receivedBytes: 200, totalBytes: 100 }])).toBe(1)
  })
})

import { uniqueSavePath, createAutoDownloadPolicy, downloadSiteOf } from './downloadSurface'

describe('createAutoDownloadPolicy', () => {
  it('allows one download, then holds until real input', () => {
    const p = createAutoDownloadPolicy()
    expect(p.decide(1, 'a.com')).toBe('allow')
    expect(p.decide(1, 'a.com')).toBe('hold')
    expect(p.decide(1, 'a.com')).toBe('hold')
    p.userInput(1)
    expect(p.decide(1, 'a.com')).toBe('allow')
    expect(p.decide(1, 'a.com')).toBe('hold')
  })
  it('separate clicks each earn one download', () => {
    const p = createAutoDownloadPolicy()
    for (let i = 0; i < 4; i++) { p.userInput(1); expect(p.decide(1, 'a.com')).toBe('allow') }
  })
  it('keeps tabs apart', () => {
    const p = createAutoDownloadPolicy()
    p.decide(1, 'a.com')
    expect(p.decide(2, 'a.com')).toBe('allow')
  })
  it('remembers an allowance until the tab moves to another site', () => {
    const p = createAutoDownloadPolicy()
    p.navigated(1, 'a.com')
    p.decide(1, 'a.com')
    p.allow(p.keyOf(1, 'a.com'))
    expect(p.decide(1, 'a.com')).toBe('allow')
    expect(p.decide(1, 'a.com')).toBe('allow')
    p.navigated(1, 'b.com')
    p.navigated(1, 'a.com')
    expect(p.decide(1, 'a.com')).toBe('allow')
    expect(p.decide(1, 'a.com')).toBe('hold')
  })
  it('a page reloading itself does not earn a fresh download', () => {
    const p = createAutoDownloadPolicy()
    p.navigated(1, 'evil.com')
    expect(p.decide(1, 'evil.com')).toBe('allow')
    for (let i = 0; i < 5; i++) {
      p.navigated(1, 'evil.com')
      expect(p.decide(1, 'evil.com')).toBe('hold')
    }
  })
  it('forgets a closed tab', () => {
    const p = createAutoDownloadPolicy()
    p.navigated(1, 'a.com')
    p.decide(1, 'a.com')
    p.forgetTab(1)
    expect(p.decide(1, 'a.com')).toBe('allow')
  })
})

describe('downloadSiteOf', () => {
  const reg = (h: string) => h.split('.').slice(-2).join('.')
  it('groups subdomains and keeps IPs whole', () => {
    expect(downloadSiteOf('https://cdn.files.example.com/x', reg)).toBe('example.com')
    expect(downloadSiteOf('http://127.0.0.1:8080/', reg)).toBe('127.0.0.1')
    expect(downloadSiteOf('http://localhost/', reg)).toBe('localhost')
    expect(downloadSiteOf('not a url', reg)).toBe('')
  })
})
describe('uniqueSavePath', () => {
  it('keeps a free name', () => {
    expect(uniqueSavePath('C:/dl', 'a.pdf', () => false)).toBe('C:/dl/a.pdf')
  })
  it('numbers around existing files', () => {
    const taken = new Set(['C:/dl/a.pdf', 'C:/dl/a (1).pdf'])
    expect(uniqueSavePath('C:/dl', 'a.pdf', p => taken.has(p))).toBe('C:/dl/a (2).pdf')
  })
  it('handles names without an extension and unsafe characters', () => {
    expect(uniqueSavePath('C:/dl', 'READ:ME', p => p === 'C:/dl/READ_ME')).toBe('C:/dl/READ_ME (1)')
  })
})
