import { apiRequest } from './rest'
import { API_BASES } from '../auth/config'
import { parseGmailMessage, buildRawMessage, ParsedMessage } from '../../gmail/mime'
import { b64urlDecode } from '../../gmail/base64url'

// Gmail API module. Depends only on the shared authenticated REST helper, so it
// carries no auth logic of its own.
export interface ThreadRow {
  id: string
  from: string
  subject: string
  snippet: string
  date: string
  unread: boolean
}

const base = API_BASES.gmail
const get = (path: string) => apiRequest('GET', `${base}${path}`)
const post = (path: string, body: object) => apiRequest('POST', `${base}${path}`, body)

function header(headers: any[], name: string): string {
  return (headers || []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

export async function listThreads(q: string, pageToken?: string): Promise<{ threads: ThreadRow[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ maxResults: '25' })
  if (q) params.set('q', q)
  if (pageToken) params.set('pageToken', pageToken)
  const list = await get(`/users/me/threads?${params.toString()}`)
  const rows: ThreadRow[] = []
  for (const t of list.threads || []) {
    const meta = await get(`/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    const first = meta.messages?.[0]
    const headers = first?.payload?.headers || []
    rows.push({
      id: t.id,
      from: header(headers, 'From'),
      subject: header(headers, 'Subject'),
      snippet: t.snippet || first?.snippet || '',
      date: header(headers, 'Date'),
      unread: (meta.messages || []).some((m: any) => (m.labelIds || []).includes('UNREAD')),
    })
  }
  return { threads: rows, nextPageToken: list.nextPageToken }
}

export async function getThread(id: string): Promise<ParsedMessage[]> {
  const t = await get(`/users/me/threads/${id}?format=full`)
  return (t.messages || []).map(parseGmailMessage)
}

// Drop the UNREAD label from a whole thread — the same effect as Gmail
// marking a conversation read once you open it.
export async function markThreadRead(id: string): Promise<void> {
  await post(`/users/me/threads/${id}/modify`, { removeLabelIds: ['UNREAD'] })
}

export async function getAttachmentData(messageId: string, attachmentId: string): Promise<Buffer> {
  const a = await get(`/users/me/messages/${messageId}/attachments/${attachmentId}`)
  return b64urlDecode(a.data)
}

export async function sendMessage(opts: {
  from: string; to: string; subject: string; body: string
  inReplyTo?: string; references?: string; threadId?: string
}): Promise<void> {
  const raw = buildRawMessage(opts)
  await post('/users/me/messages/send', opts.threadId ? { raw, threadId: opts.threadId } : { raw })
}
