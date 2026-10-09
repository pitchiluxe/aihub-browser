/**
 * Minimal ID3v2 reader for the DJ library.
 *
 * Only the frames a DJ browser shows are decoded: title, artist, album, BPM,
 * key, length and the front cover. Anything malformed yields what was read so
 * far rather than throwing — a broken tag must never stop a track from loading.
 */

export interface TrackTags {
  title?: string
  artist?: string
  album?: string
  bpm?: number
  key?: string
  /** Milliseconds, from TLEN — rarely present. */
  lengthMs?: number
  cover?: { mime: string; data: Buffer }
}

/** Bytes needed to read the whole tag, or 0 when the buffer has no ID3v2 header. */
export function id3TagSize(head: Buffer): number {
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return 0
  const size = synchsafe(head, 6)
  const hasFooter = (head[5] & 0x10) !== 0
  return 10 + size + (hasFooter ? 10 : 0)
}

function synchsafe(b: Buffer, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
}

/** Undo ID3 unsynchronisation (0xFF 0x00 → 0xFF). */
function unsync(b: Buffer): Buffer {
  const out: number[] = []
  for (let i = 0; i < b.length; i++) {
    out.push(b[i])
    if (b[i] === 0xff && b[i + 1] === 0x00) i++
  }
  return Buffer.from(out)
}

function decodeText(enc: number, b: Buffer): string {
  let s: string
  switch (enc) {
    case 1: { // UTF-16 with BOM
      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) s = swap16(b.subarray(2)).toString('utf16le')
      else if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) s = b.subarray(2).toString('utf16le')
      else s = b.toString('utf16le')
      break
    }
    case 2: s = swap16(b).toString('utf16le'); break // UTF-16BE, no BOM
    case 3: s = b.toString('utf8'); break
    default: s = b.toString('latin1')
  }
  // Multiple values are NUL-separated in v2.4; show the first.
  return s.split('\u0000').filter(Boolean)[0]?.trim() ?? ''
}

function swap16(b: Buffer): Buffer {
  const c = Buffer.from(b.subarray(0, b.length - (b.length % 2)))
  return c.swap16()
}

/** Index just past a NUL terminator for the given text encoding. */
function skipTerminated(b: Buffer, start: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i + 2
    return b.length
  }
  const i = b.indexOf(0, start)
  return i < 0 ? b.length : i + 1
}

export function parseId3(buf: Buffer): TrackTags {
  const tags: TrackTags = {}
  const total = id3TagSize(buf)
  if (!total) return tags
  const major = buf[3]
  if (major < 2 || major > 4) return tags
  const flags = buf[5]
  let body = buf.subarray(10, Math.min(buf.length, total))
  if ((flags & 0x80) && major < 4) body = unsync(body)

  let pos = 0
  // Skip the extended header.
  if (flags & 0x40) {
    const extSize = major === 4 ? synchsafe(body, 0) : body.readUInt32BE(0) + 4
    pos = extSize
  }

  const idLen = major === 2 ? 3 : 4
  const hdrLen = major === 2 ? 6 : 10
  while (pos + hdrLen <= body.length) {
    const id = body.toString('latin1', pos, pos + idLen)
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break // padding
    let size: number
    if (major === 2) size = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5]
    else if (major === 4) size = synchsafe(body, pos + 4)
    else size = body.readUInt32BE(pos + 4)
    const frameFlags = major === 2 ? 0 : body[pos + 9]
    const start = pos + hdrLen
    const end = start + size
    if (size <= 0 || end > body.length) break
    let data = body.subarray(start, end)
    if (major === 4 && (frameFlags & 0x02)) data = unsync(data)
    readFrame(tags, id, data)
    pos = end
  }
  return tags
}

function readFrame(tags: TrackTags, id: string, data: Buffer): void {
  if (!data.length) return
  const text = () => decodeText(data[0], data.subarray(1))
  switch (id) {
    case 'TIT2': case 'TT2': tags.title = text() || tags.title; break
    case 'TPE1': case 'TP1': tags.artist = text() || tags.artist; break
    case 'TALB': case 'TAL': tags.album = text() || tags.album; break
    case 'TKEY': case 'TKE': tags.key = text() || tags.key; break
    case 'TBPM': case 'TBP': {
      const n = parseFloat(text())
      if (n > 0 && n < 400) tags.bpm = n
      break
    }
    case 'TLEN': case 'TLE': {
      const n = parseInt(text(), 10)
      if (n > 0) tags.lengthMs = n
      break
    }
    case 'APIC': {
      if (tags.cover) break
      const enc = data[0]
      const mimeEnd = data.indexOf(0, 1)
      if (mimeEnd < 0) break
      let mime = data.toString('latin1', 1, mimeEnd).toLowerCase() || 'image/jpeg'
      if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime}`
      const descStart = mimeEnd + 2 // picture type byte
      const imgStart = skipTerminated(data, descStart, enc)
      if (imgStart < data.length) tags.cover = { mime, data: data.subarray(imgStart) }
      break
    }
    case 'PIC': { // v2.2: 3-char format instead of MIME
      if (tags.cover) break
      const enc = data[0]
      const fmt = data.toString('latin1', 1, 4).toLowerCase()
      const imgStart = skipTerminated(data, 5, enc)
      if (imgStart < data.length) tags.cover = { mime: fmt === 'png' ? 'image/png' : 'image/jpeg', data: data.subarray(imgStart) }
      break
    }
  }
}
