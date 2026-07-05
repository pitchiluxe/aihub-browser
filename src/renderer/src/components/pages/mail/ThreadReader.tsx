import React, { useEffect, useState } from 'react'
import { Loader2, Paperclip, Reply, Download } from 'lucide-react'
import { mailGetThread, mailGetAttachment, ParsedMessage } from '../../../services/mailService'
import EmailFrame from './EmailFrame'

export default function ThreadReader({ threadId, accountEmail, onReply }: { threadId: string; accountEmail: string; onReply?: (m: ParsedMessage) => void }) {
  const [messages, setMessages] = useState<ParsedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    mailGetThread(threadId).then(r => {
      if (!alive) return
      setLoading(false)
      if (!r.ok) setError(r.error || 'Failed to load thread')
      else setMessages(r.messages || [])
    })
    return () => { alive = false }
  }, [threadId])

  const saveAttachment = async (m: ParsedMessage, aId: string, filename: string) => {
    const r = await mailGetAttachment(m.id, aId, filename)
    if (r.ok && r.savedPath) setSaved(s => ({ ...s, [aId]: r.savedPath! }))
  }

  if (loading) return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Loader2 className="animate-spin" style={{ color: 'rgb(var(--ds-accent))' }} /></div>
  if (error) return <div style={{ padding: 24, color: '#f87171' }}>{error}</div>

  return (
    <div style={{ padding: 20 }}>
      {messages.map(m => (
        <div key={m.id} style={{ marginBottom: 24, borderBottom: '1px solid var(--ds-border-sm)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'rgb(var(--ds-text-1))' }}>{m.subject || '(no subject)'}</div>
              <div style={{ fontSize: 12, color: 'rgb(var(--ds-text-4))' }}>{m.from} → {m.to}</div>
              <div style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))' }}>{m.date}</div>
            </div>
            <button onClick={() => onReply?.(m)} title="Reply"
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                background: 'rgb(var(--ds-accent) / 0.12)', color: 'rgb(var(--ds-accent-soft))', border: '1px solid rgb(var(--ds-accent) / 0.25)', fontSize: 12 }}>
              <Reply size={12} /> Reply
            </button>
          </div>
          <EmailFrame html={m.textHtml} plain={m.textPlain} />
          {m.attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {m.attachments.map(a => (
                <button key={a.attachmentId} onClick={() => saveAttachment(m, a.attachmentId, a.filename)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                    background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
                  {saved[a.attachmentId] ? <Download size={12} /> : <Paperclip size={12} />}
                  {a.filename} {saved[a.attachmentId] ? '· saved' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
