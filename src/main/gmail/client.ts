import { getAccessToken } from './oauth'
import { httpJson } from './http'
import { parseGmailMessage, buildRawMessage, ParsedMessage } from './mime'
import { b64urlDecode } from './base64url'
import { GMAIL_API_BASE } from './config'

export interface ThreadRow { id: string; from: string; subject: string; snippet: string; date: string; unread: boolean }

async function apiGet(path: string): Promise<any> {
  let token = await getAccessToken()
  let res = await httpJson('GET', `${GMAIL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) { token = await getAccessToken(); res = await httpJson('GET', `${GMAIL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }) }
  if (res.status >= 400) throw new Error(`Gmail API ${res.status}: ${res.body.slice(0, 200)}`)
  return JSON.parse(res.body)
}

async function apiPost(path: string, body: object): Promise<any> {
  let token = await getAccessToken()
  const opts = () => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let res = await httpJson('POST', `${GMAIL_API_BASE}${path}`, opts())
  if (res.status === 401) { token = await getAccessToken(); res = await httpJson('POST', `${GMAIL_API_BASE}${path}`, opts()) }
  if (res.status >= 400) throw new Error(`Gmail API ${res.status}: ${res.body.slice(0, 200)}`)
  return JSON.parse(res.body)
}

function h(headers: any[], name: string): string {
  return (headers || []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

export async function listThreads(q: string, pageToken?: string): Promise<{ threads: ThreadRow[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ maxResults: '25' })
  if (q) params.set('q', q)
  if (pageToken) params.set('pageToken', pageToken)
  const list = await apiGet(`/users/me/threads?${params.toString()}`)
  const rows: ThreadRow[] = []
  for (const t of list.threads || []) {
    // metadata-only fetch keeps list payloads small
    const meta = await apiGet(`/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    const first = meta.messages?.[0]
    const headers = first?.payload?.headers || []
    rows.push({
      id: t.id, from: h(headers, 'From'), subject: h(headers, 'Subject'),
      snippet: t.snippet || first?.snippet || '', date: h(headers, 'Date'),
      unread: (meta.messages || []).some((m: any) => (m.labelIds || []).includes('UNREAD')),
    })
  }
  return { threads: rows, nextPageToken: list.nextPageToken }
}

export async function getThread(id: string): Promise<ParsedMessage[]> {
  const t = await apiGet(`/users/me/threads/${id}?format=full`)
  return (t.messages || []).map(parseGmailMessage)
}

export async function getAttachmentData(messageId: string, attachmentId: string): Promise<Buffer> {
  const a = await apiGet(`/users/me/messages/${messageId}/attachments/${attachmentId}`)
  return b64urlDecode(a.data)
}

export async function sendMessage(opts: {
  from: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string
}): Promise<void> {
  const raw = buildRawMessage(opts)
  await apiPost('/users/me/messages/send', opts.threadId ? { raw, threadId: opts.threadId } : { raw })
}
