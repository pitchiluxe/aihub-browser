import React, { useState } from 'react'
import { X, Send, Loader2 } from 'lucide-react'
import { mailSend } from '../../../services/mailService'

export default function Compose({ initial, onClose, onSent }: {
  initial: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }
  onClose: () => void; onSent: () => void
}) {
  const [to, setTo] = useState(initial.to)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    if (!to.trim()) { setError('Recipient required'); return }
    setSending(true); setError('')
    const r = await mailSend({ to, subject, body, inReplyTo: initial.inReplyTo, references: initial.references, threadId: initial.threadId })
    setSending(false)
    if (!r.ok) setError(r.error || 'Send failed')
    else { onSent(); onClose() }
  }

  const field: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))', fontSize: 13, outline: 'none' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 560, maxWidth: '90vw', background: 'var(--ds-panel-bg)', borderRadius: 14, border: '1px solid var(--ds-border-sm)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--ds-border-sm)' }}>
          <span style={{ fontWeight: 600, color: 'rgb(var(--ds-text-1))' }}>New message</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="To" style={field} />
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={field} />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Message" rows={10} style={{ ...field, resize: 'vertical' }} />
          {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={send} disabled={sending}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, cursor: 'pointer',
                background: 'rgb(var(--ds-accent))', color: '#fff', border: 'none', fontWeight: 600, opacity: sending ? 0.7 : 1 }}>
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
