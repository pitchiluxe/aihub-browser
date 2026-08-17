import { describe, it, expect } from 'vitest'
import {
  ACCEPTED_TYPES, MAX_FILE_BYTES, MAX_IMAGES, checkFile, dataUrlBytes,
  formatBytes, rejectionMessage, scaledSize,
} from './chatAttachments'

const png = (over: any = {}) => ({ name: 'shot.png', type: 'image/png', size: 1024, ...over })

describe('checkFile — what may be attached', () => {
  it('accepts every image type the composer advertises', () => {
    for (const type of ACCEPTED_TYPES) expect(checkFile(png({ type }), 0)).toBeNull()
  })

  it('rejects a document dressed up as an attachment', () => {
    expect(checkFile(png({ name: 'cv.pdf', type: 'application/pdf' }), 0)).toBe('type')
    expect(checkFile(png({ type: '' }), 0)).toBe('type')
  })

  it('is case-insensitive about the mime type', () => {
    expect(checkFile(png({ type: 'IMAGE/PNG' }), 0)).toBeNull()
  })

  it('rejects a file over the size cap, and accepts one exactly at it', () => {
    expect(checkFile(png({ size: MAX_FILE_BYTES + 1 }), 0)).toBe('size')
    expect(checkFile(png({ size: MAX_FILE_BYTES }), 0)).toBeNull()
  })

  it('stops at the per-message limit', () => {
    expect(checkFile(png(), MAX_IMAGES - 1)).toBeNull()
    expect(checkFile(png(), MAX_IMAGES)).toBe('count')
  })

  it('explains every rejection in words a user can act on', () => {
    expect(rejectionMessage('type', 'cv.pdf')).toContain('cv.pdf')
    expect(rejectionMessage('size')).toMatch(/20 MB/)
    expect(rejectionMessage('count')).toContain(String(MAX_IMAGES))
  })
})

describe('scaledSize — shrink, never enlarge', () => {
  it('leaves a small image alone', () => {
    expect(scaledSize(800, 600, 1280)).toEqual({ width: 800, height: 600 })
  })

  it('fits the longest edge to the cap, keeping the aspect ratio', () => {
    expect(scaledSize(2560, 1440, 1280)).toEqual({ width: 1280, height: 720 })
    expect(scaledSize(1440, 2560, 1280)).toEqual({ width: 720, height: 1280 })
  })

  it('does not upscale an image already at the cap', () => {
    expect(scaledSize(1280, 700, 1280)).toEqual({ width: 1280, height: 700 })
  })

  it('survives a zero-sized image rather than dividing by nothing', () => {
    expect(scaledSize(0, 0, 1280)).toEqual({ width: 0, height: 0 })
  })
})

describe('dataUrlBytes', () => {
  it('reports the decoded size, not the base64 length', () => {
    // "hello" -> aGVsbG8= : 5 bytes from 8 characters
    expect(dataUrlBytes('data:image/png;base64,aGVsbG8=')).toBe(5)
  })

  it('accounts for both padding lengths', () => {
    expect(dataUrlBytes('data:image/png;base64,aGVsbG9v')).toBe(6)   // no padding
    expect(dataUrlBytes('data:image/png;base64,aGVsbA==')).toBe(4)   // two
  })

  it('is zero for something that is not a data URL', () => {
    expect(dataUrlBytes('not a data url')).toBe(0)
    expect(dataUrlBytes('')).toBe(0)
  })
})

describe('formatBytes', () => {
  it('reads naturally at each scale', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
