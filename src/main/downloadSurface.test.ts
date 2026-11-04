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

import { uniqueSavePath } from './downloadSurface'
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
