import { describe, it, expect } from 'vitest'
import { parseGmailMessage, buildRawMessage } from './mime'
import { b64urlEncode, b64urlDecode } from './base64url'

const msg = {
  id: 'm1', threadId: 't1', snippet: 'Hello there', labelIds: ['UNREAD', 'INBOX'],
  payload: {
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: 'Alice <alice@example.com>' },
      { name: 'To', value: 'bob@example.com' },
      { name: 'Subject', value: 'Hi Bob' },
      { name: 'Date', value: 'Mon, 01 Jul 2026 10:00:00 -0000' },
      { name: 'Message-ID', value: '<abc@mail.example.com>' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64urlEncode('plain body') } },
      { mimeType: 'text/html', body: { data: b64urlEncode('<b>html body</b>') } },
      { mimeType: 'application/pdf', filename: 'doc.pdf', body: { attachmentId: 'att1', size: 1234 } },
    ],
  },
}

describe('parseGmailMessage', () => {
  it('extracts headers, bodies, unread flag, attachments', () => {
    const p = parseGmailMessage(msg)
    expect(p.from).toBe('Alice <alice@example.com>')
    expect(p.subject).toBe('Hi Bob')
    expect(p.textPlain).toBe('plain body')
    expect(p.textHtml).toBe('<b>html body</b>')
    expect(p.unread).toBe(true)
    expect(p.messageIdHeader).toBe('<abc@mail.example.com>')
    expect(p.attachments).toEqual([{ filename: 'doc.pdf', mimeType: 'application/pdf', attachmentId: 'att1', size: 1234 }])
  })
  it('handles a single-part text/plain payload', () => {
    const single = { id: 'm2', threadId: 't2', snippet: 's', labelIds: ['INBOX'],
      payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'x' }], body: { data: b64urlEncode('just text') } } }
    const p = parseGmailMessage(single)
    expect(p.textPlain).toBe('just text')
    expect(p.unread).toBe(false)
  })
})

describe('buildRawMessage', () => {
  it('produces a decodable RFC 2822 message with reply headers', () => {
    const raw = buildRawMessage({ from: 'me@example.com', to: 'you@example.com', subject: 'Re: Hi', body: 'reply text', inReplyTo: '<abc@mail.example.com>', references: '<abc@mail.example.com>' })
    const decoded = b64urlDecode(raw).toString('utf-8')
    expect(decoded).toContain('To: you@example.com')
    expect(decoded).toContain('Subject: Re: Hi')
    expect(decoded).toContain('In-Reply-To: <abc@mail.example.com>')
    expect(decoded).toContain('\r\n\r\nreply text')
  })
})
