/**
 * What a file actually is, decided from its bytes.
 *
 * Every part of the attachment path reads the type from here and nothing reads
 * it from the filename. An extension is a claim made by whoever produced the
 * file; the first few bytes are what a decoder will actually act on. The gap
 * between those two is where "screenshot.png" turns out to be an executable.
 *
 * The allowlist is short on purpose. It is not "everything that seems safe" —
 * it is the set of things a conversation needs, and anything outside it is
 * refused rather than reasoned about:
 *
 *  - Archives are refused because the interesting bytes are one extraction
 *    away from any check performed on what was uploaded.
 *  - SVG and HTML are refused because they are scripts that happen to render.
 *  - Executables are refused for the obvious reason, in every format.
 */

export type AllowedMime =
  | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  | 'application/pdf'
  | 'video/mp4' | 'video/webm'

export const ALLOWED_ATTACHMENT_MIMES: AllowedMime[] = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'video/mp4', 'video/webm',
]

const EXTENSIONS: Record<AllowedMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

const ascii = (bytes: Uint8Array, from: number, length: number): string =>
  Array.from(bytes.slice(from, from + length), b => String.fromCharCode(b)).join('')

const startsWith = (bytes: Uint8Array, magic: number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b)

/**
 * The content type of these bytes, or null if it is not something we accept.
 *
 * Null covers three different situations deliberately — unrecognised, refused,
 * and too short to tell — because the caller's response to all three is the
 * same and distinguishing them in the UI would only tell an uploader which
 * probe got closest.
 */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (!bytes || bytes.length < 12) return null

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf'

  // RIFF also fronts .wav and .avi, so the form tag at offset 8 is the part
  // that actually decides. Matching "RIFF" alone would hand any RIFF container
  // an image content type.
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'

  // ISO base media: the brand lives at offset 8, after the size and 'ftyp'.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    if (/^(isom|iso2|mp41|mp42|avc1|M4V |mmp4)$/.test(brand)) return 'video/mp4'
  }
  // Matroska/WebM EBML header. WebM and MKV share it; the codec check that
  // would separate them needs a parser, and mislabelling a video as WebM costs
  // nothing because neither is executed.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm'

  return null
}

export function isAllowedAttachment(mime: string): boolean {
  return (ALLOWED_ATTACHMENT_MIMES as string[]).includes(mime)
}

export function extensionFor(mime: string): string {
  return EXTENSIONS[mime as AllowedMime] ?? ''
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}
