import zlib from 'zlib'

/**
 * AIHub Browser — reading the words out of a PDF.
 *
 * Chromium renders PDFs, but it renders them in a plugin: there is no DOM to
 * scrape, so the assistant's usual read_page finds an empty page and the whole
 * AI layer goes dark exactly where the dense documents live — papers, invoices,
 * contracts, manuals.
 *
 * This extracts the text directly from the file's bytes. It is deliberately a
 * small, dependency-free reader rather than a full PDF implementation, and it
 * is honest about that: it understands uncompressed and Flate-compressed
 * content streams and the text-showing operators (Tj, TJ, ', "), which is what
 * ordinary text PDFs are made of. It does not do encryption, and it cannot
 * recover text from a scanned page, because a scan contains no text to recover
 * — it contains a picture of some. Callers get an empty string and say so,
 * rather than being handed silence that looks like an empty document.
 *
 * Everything here is pure: bytes in, text out.
 */

/** How the extraction went, so callers can explain themselves to a user. */
export interface PdfText {
  text: string
  /** Content streams found, and how many yielded any text. */
  streams: number
  decoded: number
  /** True when the file announced encryption, which we do not attempt. */
  encrypted: boolean
}

const ASCII = (bytes: Uint8Array, from: number, len: number): string => {
  let out = ''
  for (let i = from; i < Math.min(from + len, bytes.length); i++) out += String.fromCharCode(bytes[i])
  return out
}

/** A PDF at all? The header is the only cheap, reliable signal. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return !!bytes && bytes.length > 5 && ASCII(bytes, 0, 5) === '%PDF-'
}

/**
 * Undo the PDF string escapes inside a ( ... ) literal.
 *
 * Written as its own function because getting this wrong is invisible: a
 * missed \( silently swallows the rest of a paragraph, and the output still
 * looks like plausible text.
 */
export function unescapePdfString(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c !== '\\') { out += c; continue }
    const next = raw[++i]
    if (next === undefined) break
    switch (next) {
      case 'n': out += '\n'; break
      case 'r': out += '\r'; break
      case 't': out += '\t'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case '(': out += '('; break
      case ')': out += ')'; break
      case '\\': out += '\\'; break
      case '\n': break // a backslash-newline is a line continuation
      default:
        // \ddd octal character code
        if (next >= '0' && next <= '7') {
          let oct = next
          while (oct.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i]
          out += String.fromCharCode(parseInt(oct, 8))
        } else {
          out += next
        }
    }
  }
  return out
}

/**
 * Pull the shown text out of one decoded content stream.
 *
 * PDF text is a sequence of operators, and only a few of them put glyphs on
 * the page: Tj and ' and " show one string, TJ shows an array of strings with
 * kerning numbers between them. Everything else — positioning, fonts, colour,
 * paths — is skipped. Line structure is approximated from the text-positioning
 * operators (Td, TD, T*, and the ' and " forms, which all begin a new line),
 * because a wall of words with no breaks is unreadable to a person and worse
 * to a model.
 */
export function extractTextFromStream(content: string): string {
  let out = ''
  let i = 0

  const readLiteral = (): string => {
    // Assumes content[i] === '('. Nesting is legal and common.
    let depth = 0
    let raw = ''
    for (; i < content.length; i++) {
      const c = content[i]
      if (c === '\\') { raw += c + (content[i + 1] ?? ''); i++; continue }
      if (c === '(') { depth++; if (depth === 1) continue }
      if (c === ')') { depth--; if (depth === 0) { i++; return raw } }
      raw += c
    }
    return raw
  }

  const readHex = (): string => {
    // Assumes content[i] === '<'. Hex strings encode bytes directly.
    let hex = ''
    for (i++; i < content.length && content[i] !== '>'; i++) {
      if (/[0-9a-fA-F]/.test(content[i])) hex += content[i]
    }
    i++
    if (hex.length % 2) hex += '0'
    let s = ''
    for (let h = 0; h < hex.length; h += 2) s += String.fromCharCode(parseInt(hex.slice(h, h + 2), 16))
    return s
  }

  // Strings are collected as they are met, then flushed when an operator says
  // what they were for. A string is only text if a showing operator follows.
  let pending: string[] = []

  while (i < content.length) {
    const c = content[i]

    if (c === '(') { pending.push(unescapePdfString(readLiteral())); continue }
    if (c === '<' && content[i + 1] !== '<') { pending.push(readHex()); continue }

    // Operators are runs of letters, with ' and " as their own operators.
    if (/[A-Za-z'"*]/.test(c)) {
      let op = ''
      while (i < content.length && /[A-Za-z0-9'"*]/.test(content[i])) op += content[i++]

      if (op === 'Tj' || op === 'TJ') {
        out += pending.join('')
        pending = []
      } else if (op === "'" || op === '"') {
        out += '\n' + pending.join('')
        pending = []
      } else if (op === 'Td' || op === 'TD' || op === 'T*') {
        if (out && !out.endsWith('\n')) out += '\n'
        pending = []
      } else if (op === 'ET') {
        if (out && !out.endsWith('\n')) out += '\n'
        pending = []
      } else {
        pending = []
      }
      continue
    }

    i++
  }

  return out
}

/**
 * Every content stream in the file, decompressed where we can.
 *
 * This walks `stream ... endstream` pairs rather than following the xref
 * table. Following xref properly means implementing object streams, cross
 * reference streams and incremental updates — a real PDF parser — for a
 * result that is no better for our purpose, since we want *all* the text and
 * not a particular object. A stream we cannot inflate is skipped, not fatal.
 */
export function decodeStreams(bytes: Uint8Array): { contents: string[]; total: number } {
  const contents: string[] = []
  const haystack = ASCII(bytes, 0, bytes.length)
  let total = 0
  let at = 0

  while (true) {
    const start = haystack.indexOf('stream', at)
    if (start === -1) break
    // 'endstream' also contains 'stream'; skip those matches.
    if (start >= 3 && haystack.slice(start - 3, start + 6) === 'endstream') { at = start + 6; continue }

    let from = start + 'stream'.length
    if (haystack[from] === '\r') from++
    if (haystack[from] === '\n') from++

    const end = haystack.indexOf('endstream', from)
    if (end === -1) break
    at = end + 'endstream'.length
    total++

    const slice = bytes.slice(from, end)
    try {
      contents.push(zlib.inflateSync(Buffer.from(slice)).toString('latin1'))
      continue
    } catch {
      // Not Flate — either raw, or a filter we do not implement.
    }
    const raw = ASCII(slice, 0, slice.length)
    // Only keep a raw stream if it actually looks like page content; image
    // and font bytes would otherwise arrive as mojibake.
    if (/\bT[Jj]\b|\bTd\b|\bBT\b/.test(raw)) contents.push(raw)
  }

  return { contents, total }
}

/** Collapse the runs of whitespace a page's operators leave behind. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The document's words, best effort, with enough detail to explain a miss. */
export function extractPdfText(bytes: Uint8Array): PdfText {
  if (!looksLikePdf(bytes)) return { text: '', streams: 0, decoded: 0, encrypted: false }

  const encrypted = ASCII(bytes, 0, bytes.length).includes('/Encrypt')
  const { contents, total } = decodeStreams(bytes)

  let text = ''
  let decoded = 0
  for (const content of contents) {
    const part = extractTextFromStream(content)
    if (part.trim()) { decoded++; text += part + '\n' }
  }

  return { text: tidy(text), streams: total, decoded, encrypted }
}
