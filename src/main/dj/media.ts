/** Pure helpers for the DJ library — no Electron imports, so they unit-test. */
import path from 'path'

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus', '.webm', '.weba'])
/** Music videos play on a deck too; the console's monitor shows their picture. */
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv'])

/** Anything a deck can play: audio files and music videos. */
export function isAudioFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase()
  return AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())
}

/** Every query word must appear somewhere in the file name. */
export function matchesQuery(name: string, query: string): boolean {
  const hay = name.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}

/**
 * Parse an HTTP Range header against a file size.
 * Returns null for "send everything", or 'invalid' when unsatisfiable.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return null
  let start: number
  let end: number
  if (!m[1]) { // suffix: last N bytes
    const n = parseInt(m[2], 10)
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = parseInt(m[1], 10)
    end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
  }
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}
