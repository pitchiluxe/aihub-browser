import { describe, it, expect } from 'vitest'
import { sniffMime, isAllowedAttachment, extensionFor, ALLOWED_ATTACHMENT_MIMES } from './fileTypes'

/** Build a buffer that starts with the given bytes and is padded to `size`. */
function withMagic(bytes: number[], size = 64): Uint8Array {
  const out = new Uint8Array(size)
  out.set(bytes, 0)
  return out
}

const PNG = withMagic([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = withMagic([0xff, 0xd8, 0xff, 0xe0])
const GIF = withMagic([...Buffer.from('GIF89a', 'ascii')])
const PDF = withMagic([...Buffer.from('%PDF-1.7', 'ascii')])
const ZIP = withMagic([0x50, 0x4b, 0x03, 0x04])
const ELF = withMagic([0x7f, 0x45, 0x4c, 0x46])
const EXE = withMagic([0x4d, 0x5a, 0x90, 0x00])

function riff(tag: string): Uint8Array {
  const out = new Uint8Array(64)
  out.set(Buffer.from('RIFF', 'ascii'), 0)
  out.set(Buffer.from(tag, 'ascii'), 8)
  return out
}

function iso(brand: string): Uint8Array {
  const out = new Uint8Array(64)
  out.set(Buffer.from('ftyp', 'ascii'), 4)
  out.set(Buffer.from(brand, 'ascii'), 8)
  return out
}

describe('sniffMime', () => {
  it('recognises the image formats a chat actually needs', () => {
    expect(sniffMime(PNG)).toBe('image/png')
    expect(sniffMime(JPEG)).toBe('image/jpeg')
    expect(sniffMime(GIF)).toBe('image/gif')
    expect(sniffMime(riff('WEBP'))).toBe('image/webp')
  })

  it('recognises pdf and video', () => {
    expect(sniffMime(PDF)).toBe('application/pdf')
    expect(sniffMime(iso('isom'))).toBe('video/mp4')
  })

  it('does not confuse a webp with any other RIFF container', () => {
    // RIFF also fronts .wav and .avi. Matching on "RIFF" alone would hand an
    // arbitrary container an image content type.
    expect(sniffMime(riff('WAVE'))).not.toBe('image/webp')
  })

  it('returns null for an archive', () => {
    // Archives are the classic delivery vehicle: the interesting bytes are one
    // extraction away from any check made on what was uploaded.
    expect(sniffMime(ZIP)).toBeNull()
  })

  it('returns null for an executable', () => {
    expect(sniffMime(EXE)).toBeNull()
    expect(sniffMime(ELF)).toBeNull()
  })

  it('returns null for an empty or truncated file', () => {
    expect(sniffMime(new Uint8Array(0))).toBeNull()
    expect(sniffMime(new Uint8Array([0x89, 0x50]))).toBeNull()
  })

  it('ignores whatever the file claims to be', () => {
    // The whole point: an executable named screenshot.png is an executable.
    expect(sniffMime(EXE)).toBeNull()
    expect(sniffMime(PNG)).toBe('image/png')
  })
})

describe('isAllowedAttachment', () => {
  it('accepts every mime the sniffer can produce', () => {
    // Otherwise the two lists drift and a file passes one gate and fails the
    // other for reasons nobody can explain from the error message.
    for (const mime of ALLOWED_ATTACHMENT_MIMES) {
      expect(isAllowedAttachment(mime), mime).toBe(true)
    }
  })

  it('rejects anything else, including things that sound harmless', () => {
    expect(isAllowedAttachment('application/zip')).toBe(false)
    expect(isAllowedAttachment('image/svg+xml')).toBe(false)     // scriptable
    expect(isAllowedAttachment('text/html')).toBe(false)         // scriptable
    expect(isAllowedAttachment('application/x-msdownload')).toBe(false)
    expect(isAllowedAttachment('')).toBe(false)
  })
})

describe('extensionFor', () => {
  it('names the file from its sniffed type, not from what was uploaded', () => {
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('application/pdf')).toBe('pdf')
    expect(extensionFor('video/mp4')).toBe('mp4')
  })

  it('has an extension for every allowed mime', () => {
    for (const mime of ALLOWED_ATTACHMENT_MIMES) {
      expect(extensionFor(mime), mime).toBeTruthy()
    }
  })
})
