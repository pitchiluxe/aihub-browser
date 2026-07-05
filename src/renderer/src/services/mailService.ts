export interface ThreadRow { id: string; from: string; subject: string; snippet: string; date: string; unread: boolean }
export interface MailAttachment { filename: string; mimeType: string; attachmentId: string; size: number }
export interface ParsedMessage {
  id: string; threadId: string; from: string; to: string; cc: string;
  subject: string; date: string; snippet: string; unread: boolean;
  textHtml: string; textPlain: string; attachments: MailAttachment[];
  messageIdHeader: string; references: string;
}
const api = () => (window as any).electronAPI.gmail

export const mailStatus = () => api().status() as Promise<{ ok: boolean; connected: boolean; email: string | null }>
export const mailConnect = () => api().connect() as Promise<{ ok: boolean; email?: string; error?: string }>
export const mailDisconnect = () => api().disconnect() as Promise<{ ok: boolean }>
export const mailSetCredentials = (id: string, secret: string) => api().setCredentials(id, secret) as Promise<{ ok: boolean; error?: string }>
export const mailListThreads = (q: string, pageToken?: string) =>
  api().listThreads(q, pageToken) as Promise<{ ok: boolean; threads?: ThreadRow[]; nextPageToken?: string; error?: string }>
export const mailGetThread = (id: string) =>
  api().getThread(id) as Promise<{ ok: boolean; messages?: ParsedMessage[]; error?: string }>
export const mailGetAttachment = (mId: string, aId: string, filename: string) =>
  api().getAttachment(mId, aId, filename) as Promise<{ ok: boolean; savedPath?: string; error?: string }>
export const mailSend = (opts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }) =>
  api().send(opts) as Promise<{ ok: boolean; error?: string }>
export const onMailConnected = (cb: (e: { email: string }) => void) => api().onConnected(cb) as () => void
