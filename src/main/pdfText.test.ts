import { describe, it, expect } from 'vitest'
import zlib from 'zlib'
import {
  looksLikePdf, unescapePdfString, extractTextFromStream, decodeStreams, tidy, extractPdfText,
} from './pdfText'

/** A minimal but genuinely well-formed PDF carrying one content stream. */
function buildPdf(streamBody: string, opts: { compress?: boolean; encrypt?: boolean } = {}): Uint8Array {
  const body = opts.compress
    ? zlib.deflateSync(Buffer.from(streamBody, 'latin1'))
    : Buffer.from(streamBody, 'latin1')
  const head = Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n` +
    (opts.encrypt ? `2 0 obj<</Encrypt 3 0 R>>endobj\n` : '') +
    `4 0 obj<</Length ${body.length}${opts.compress ? '/Filter/FlateDecode' : ''}>>\nstream\n`,
    'latin1')
  const tail = Buffer.from(`\nendstream\nendobj\n%%EOF\n`, 'latin1')
  return new Uint8Array(Buffer.concat([head, body, tail]))
}

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'))

describe('looksLikePdf', () => {
  it('accepts a real header and rejects everything else', () => {
    expect(looksLikePdf(bytes('%PDF-1.7\nrest'))).toBe(true)
    expect(looksLikePdf(bytes('<html>'))).toBe(false)
    expect(looksLikePdf(new Uint8Array())).toBe(false)
  })
})

describe('unescapePdfString', () => {
  it('resolves the escapes that would otherwise swallow text', () => {
    expect(unescapePdfString('a\\(b\\)c')).toBe('a(b)c')
    expect(unescapePdfString('line\\nnext')).toBe('line\nnext')
    expect(unescapePdfString('back\\\\slash')).toBe('back\\slash')
  })
  it('reads octal character codes', () => {
    expect(unescapePdfString('\\101\\102')).toBe('AB')
  })
  it('treats a backslash-newline as a line continuation, not a character', () => {
    expect(unescapePdfString('one\\\ntwo')).toBe('onetwo')
  })
})

describe('extractTextFromStream', () => {
  it('reads a simple Tj', () => {
    expect(extractTextFromStream('BT /F1 12 Tf (Hello world) Tj ET')).toContain('Hello world')
  })
  it('reads a TJ array, dropping the kerning numbers', () => {
    const out = extractTextFromStream('BT [(Ka) -20 (mi) 15 (kaze)] TJ ET')
    expect(out).toContain('Kamikaze')
    expect(out).not.toMatch(/-20|15/)
  })
  it('starts a new line on the positioning operators', () => {
    const out = extractTextFromStream('BT (first) Tj 0 -14 Td (second) Tj ET')
    expect(out.split('\n').map(s => s.trim()).filter(Boolean)).toEqual(['first', 'second'])
  })
  it("treats ' as show-on-a-new-line", () => {
    const out = extractTextFromStream("BT (one) Tj (two) ' ET")
    expect(out).toContain('one')
    expect(out).toContain('two')
    expect(out.indexOf('two')).toBeGreaterThan(out.indexOf('\n'))
  })
  it('handles nested parentheses inside a string', () => {
    expect(extractTextFromStream('BT (a (nested) tail) Tj ET')).toContain('a (nested) tail')
  })
  it('decodes hex strings', () => {
    expect(extractTextFromStream('BT <48656C6C6F> Tj ET')).toContain('Hello')
  })
  it('ignores strings that no showing operator claims', () => {
    // A string used as an operand to something else must not become page text.
    expect(extractTextFromStream('BT (/Metadata) /Type ET').trim()).toBe('')
  })
  it('is not confused by a dictionary opener', () => {
    expect(extractTextFromStream('<</Type/Page>> BT (body) Tj ET')).toContain('body')
  })
})

describe('decodeStreams', () => {
  it('finds an uncompressed content stream', () => {
    const { contents, total } = decodeStreams(buildPdf('BT (plain) Tj ET'))
    expect(total).toBe(1)
    expect(contents.join('')).toContain('plain')
  })
  it('inflates a FlateDecode stream', () => {
    const { contents } = decodeStreams(buildPdf('BT (squeezed) Tj ET', { compress: true }))
    expect(contents.join('')).toContain('squeezed')
  })
  it('does not mistake endstream for another stream', () => {
    expect(decodeStreams(buildPdf('BT (once) Tj ET')).total).toBe(1)
  })
  it('skips binary streams that are not page content', () => {
    // Font/image bytes contain no text operators and must not reach the output.
    const { contents } = decodeStreams(buildPdf('\x00\x01\x02\x03 not text at all'))
    expect(contents).toEqual([])
  })
})

describe('tidy', () => {
  it('collapses the whitespace page operators leave behind', () => {
    expect(tidy('a   b\n\n\n\nc  \n  d')).toBe('a b\n\nc\nd')
  })
})

describe('extractPdfText', () => {
  it('reads an uncompressed document end to end', () => {
    const res = extractPdfText(buildPdf('BT (The quick brown fox) Tj ET'))
    expect(res.text).toBe('The quick brown fox')
    expect(res.decoded).toBe(1)
    expect(res.encrypted).toBe(false)
  })
  it('reads a compressed document end to end', () => {
    const res = extractPdfText(buildPdf('BT (Compressed body) Tj ET', { compress: true }))
    expect(res.text).toBe('Compressed body')
  })
  it('reports encryption rather than pretending the file is empty', () => {
    const res = extractPdfText(buildPdf('BT (hidden) Tj ET', { encrypt: true }))
    expect(res.encrypted).toBe(true)
  })
  it('returns nothing for a file that is not a PDF', () => {
    expect(extractPdfText(bytes('<html><body>hi</body></html>'))).toEqual({
      text: '', streams: 0, decoded: 0, encrypted: false,
    })
  })
  it('reports zero decoded streams for a scan, which has no text to find', () => {
    // A page of pure image data: streams exist, none of them yield words.
    const res = extractPdfText(buildPdf('\x89PNG\x00\x00 binary image bytes here'))
    expect(res.text).toBe('')
    expect(res.decoded).toBe(0)
  })
})
