import { describe, it, expect } from 'vitest'
import {
  extensionOf, kindOf, formatBytes, formatProgress, percentOf,
  stateLabel, activeCount, formatWhen,
} from './downloadDisplay'

const dl = (over: Partial<any> = {}) => ({
  id: 'd1', filename: 'file.bin', url: 'https://example.com/file.bin', savePath: 'C:/dl/file.bin',
  totalBytes: 0, receivedBytes: 0, state: 'completed', startedAt: 0, ...over,
})

describe('extensionOf', () => {
  it('reads the extension without the dot, lowercased', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })
  it('is empty for files with no extension', () => {
    expect(extensionOf('LICENSE')).toBe('')
    expect(extensionOf('')).toBe('')
    expect(extensionOf('trailing.')).toBe('')
  })
  it('treats a leading dot as a hidden file, not a type', () => {
    expect(extensionOf('.bashrc')).toBe('')
  })
  it('is not fooled by dots in the folder path', () => {
    expect(extensionOf('C:/my.files/report')).toBe('')
    expect(extensionOf('C:\\my.files\\report.txt')).toBe('txt')
  })
})

describe('kindOf', () => {
  it('names the everyday types', () => {
    expect(kindOf('invoice.pdf')).toBe('Documents')
    expect(kindOf('shot.PNG')).toBe('Images')
    expect(kindOf('setup.exe')).toBe('Installers')
    expect(kindOf('bundle.tar.gz')).toBe('Archives')
  })
  it('falls back to Other for anything unrecognised', () => {
    expect(kindOf('data.qqq')).toBe('Other')
    expect(kindOf('LICENSE')).toBe('Other')
  })
})

describe('formatBytes', () => {
  it('scales the unit to the size', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
  })
  it('shows a dash rather than "0 B" for an unknown size', () => {
    expect(formatBytes(0)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
  })
})

describe('formatProgress', () => {
  it('shows received against total when the total is known', () => {
    expect(formatProgress({ receivedBytes: 1024, totalBytes: 4096 })).toBe('1.0 KB / 4.0 KB')
  })
  it('shows only what has arrived when the server sent no length', () => {
    expect(formatProgress({ receivedBytes: 1024, totalBytes: 0 })).toBe('1.0 KB')
  })
})

describe('percentOf', () => {
  it('is null without a known total, so no bar is drawn', () => {
    expect(percentOf({ receivedBytes: 900, totalBytes: 0 })).toBeNull()
  })
  it('clamps to 0–100', () => {
    expect(percentOf({ receivedBytes: 50, totalBytes: 100 })).toBe(50)
    expect(percentOf({ receivedBytes: 300, totalBytes: 100 })).toBe(100)
  })
})

describe('stateLabel', () => {
  it('phrases each terminal state, and treats anything else as in flight', () => {
    expect(stateLabel('completed')).toBe('Complete')
    expect(stateLabel('cancelled')).toBe('Cancelled')
    expect(stateLabel('interrupted')).toBe('Interrupted')
    expect(stateLabel('progressing')).toBe('Downloading…')
  })
})

describe('activeCount', () => {
  it('counts only transfers still moving', () => {
    expect(activeCount([
      dl({ id: 'a', state: 'progressing' }),
      dl({ id: 'b', state: 'completed' }),
      dl({ id: 'c', state: 'progressing' }),
      dl({ id: 'd', state: 'interrupted' }),
    ] as any)).toBe(2)
  })
})

describe('formatWhen', () => {
  const now = new Date('2026-08-31T12:00:00Z').getTime()
  it('describes the near past in words', () => {
    expect(formatWhen(now - 5_000, now)).toBe('just now')
    expect(formatWhen(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(formatWhen(now - 3 * 3_600_000, now)).toBe('3 hr ago')
    expect(formatWhen(now - 2 * 86_400_000, now)).toBe('2 d ago')
  })
  it('falls back to a date past a week', () => {
    expect(formatWhen(now - 30 * 86_400_000, now)).toMatch(/\d/)
    expect(formatWhen(now - 30 * 86_400_000, now)).not.toMatch(/ago/)
  })
  it('is empty when nothing was recorded', () => {
    expect(formatWhen(undefined, now)).toBe('')
  })
})
