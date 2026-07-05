import { b64urlEncode, b64urlDecode } from './base64url'

export interface MailAttachment { filename: string; mimeType: string; attachmentId: string; size: number }
export interface ParsedMessage {
  id: string; threadId: string; from: string; to: string; cc: string;
  subject: string; date: string; snippet: string; unread: boolean;
  textHtml: string; textPlain: string; attachments: MailAttachment[];
  messageIdHeader: string; references: string;
}

function header(headers: any[], name: string): string {
  const h = (headers || []).find(x => x.name?.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

function walk(part: any, out: { html: string; plain: string; atts: MailAttachment[] }) {
  if (!part) return
  const mime = part.mimeType || ''
  if (part.filename && part.body?.attachmentId) {
    out.atts.push({ filename: part.filename, mimeType: mime, attachmentId: part.body.attachmentId, size: part.body.size || 0 })
  } else if (mime === 'text/html' && part.body?.data) {
    out.html = out.html || b64urlDecode(part.body.data).toString('utf-8')
  } else if (mime === 'text/plain' && part.body?.data) {
    out.plain = out.plain || b64urlDecode(part.body.data).toString('utf-8')
  }
  for (const child of part.parts || []) walk(child, out)
}

export function parseGmailMessage(raw: any): ParsedMessage {
  const payload = raw.payload || {}
  const headers = payload.headers || []
  const acc = { html: '', plain: '', atts: [] as MailAttachment[] }
  walk(payload, acc)
  return {
    id: raw.id, threadId: raw.threadId,
    from: header(headers, 'From'), to: header(headers, 'To'), cc: header(headers, 'Cc'),
    subject: header(headers, 'Subject'), date: header(headers, 'Date'),
    snippet: raw.snippet || '', unread: (raw.labelIds || []).includes('UNREAD'),
    textHtml: acc.html, textPlain: acc.plain, attachments: acc.atts,
    messageIdHeader: header(headers, 'Message-ID'), references: header(headers, 'References'),
  }
}

export function buildRawMessage(opts: {
  from: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
  ]
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`)
  if (opts.references) lines.push(`References: ${opts.references}`)
  const message = lines.join('\r\n') + '\r\n\r\n' + opts.body
  return b64urlEncode(Buffer.from(message, 'utf-8'))
}
