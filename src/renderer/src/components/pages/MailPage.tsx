import React, { useEffect, useState, useCallback } from 'react'
import { Mail, RefreshCw, Loader2, LogOut, Search } from 'lucide-react'
import {
  mailStatus, mailConnect, mailDisconnect, mailListThreads, mailMarkRead, onMailConnected, ThreadRow, ParsedMessage,
} from '../../services/mailService'
import ThreadReader from './mail/ThreadReader'
import Compose from './mail/Compose'

export default function MailPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [nextToken, setNextToken] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [compose, setCompose] = useState<null | { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }>(null)

  const refreshStatus = useCallback(async () => {
    const s = await mailStatus()
    setConnected(s.connected); setEmail(s.email)
  }, [])

  useEffect(() => { refreshStatus() }, [refreshStatus])
  useEffect(() => onMailConnected(e => { setConnected(true); setEmail(e.email); load('') }), [])

  const load = useCallback(async (query: string, token?: string) => {
    setLoading(true); setError('')
    const r = await mailListThreads(query, token)
    setLoading(false)
    if (!r.ok) { setError(r.error || 'Failed to load'); return }
    setThreads(prev => token ? [...prev, ...(r.threads || [])] : (r.threads || []))
    setNextToken(r.nextPageToken)
  }, [])

  useEffect(() => { if (connected) load('') }, [connected, load])

  const connect = async () => {
    setConnecting(true); setError('')
    const r = await mailConnect()
    setConnecting(false)
    if (!r.ok) setError(r.error || 'Connect failed')
    else { setConnected(true); setEmail(r.email || null) }
  }

  const disconnect = async () => { await mailDisconnect(); setConnected(false); setEmail(null); setThreads([]); setActiveId(null) }

  // Opening a message marks it read: drop the unread dot and un-bold it
  // immediately, then tell Gmail to remove the UNREAD label.
  const openThread = (t: ThreadRow) => {
    setActiveId(t.id)
    if (t.unread) {
      setThreads(prev => prev.map(x => x.id === t.id ? { ...x, unread: false } : x))
      mailMarkRead(t.id).catch(() => {})
    }
  }

  const handleReply = (m: ParsedMessage) => setCompose({
    to: m.from,
    subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`,
    body: `\n\n---- On ${m.date}, ${m.from} wrote: ----\n${m.textPlain}`,
    inReplyTo: m.messageIdHeader,
    references: (m.references ? m.references + ' ' : '') + m.messageIdHeader,
    threadId: m.threadId,
  })

  if (connected === null) {
    return <div className="flex items-center justify-center h-full text-aihub-muted"><Loader2 className="animate-spin" /></div>
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8" style={{ background: 'linear-gradient(160deg, rgb(var(--ds-bg)) 0%, rgb(var(--ds-bg-3)) 100%)' }}>
        <Mail size={44} style={{ color: 'rgb(var(--ds-accent))' }} />
        <div style={{ fontSize: 18, fontWeight: 700, color: 'rgb(var(--ds-text-1))' }}>Connect your Gmail</div>
        <div style={{ fontSize: 13, color: 'rgb(var(--ds-text-4))', maxWidth: 380 }}>
          Sign in opens once in your system browser (Google blocks in-app sign-in). After that, read and send mail right here.
        </div>
        <button onClick={connect} disabled={connecting}
          style={{ padding: '10px 20px', borderRadius: 12, fontWeight: 600, cursor: 'pointer',
            background: 'rgb(var(--ds-accent))', color: '#fff', border: 'none', opacity: connecting ? 0.7 : 1 }}>
          {connecting ? 'Waiting for browser…' : 'Connect Gmail'}
        </button>
        {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
      </div>
    )
  }

  return (
    <div className="flex h-full" style={{ background: 'rgb(var(--ds-bg))', color: 'rgb(var(--ds-text-1))' }}>
      {/* Left: inbox list */}
      <div style={{ width: 360, borderRight: '1px solid var(--ds-border-sm)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--ds-border-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'rgb(var(--ds-text-4))' }}>{email}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button title="Compose" onClick={() => setCompose({ to: '', subject: '', body: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-accent-soft))' }}>✎</button>
              <button title="Refresh" onClick={() => load(q)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))' }}><RefreshCw size={14} /></button>
              <button title="Disconnect" onClick={disconnect} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))' }}><LogOut size={14} /></button>
            </div>
          </div>
          <form onSubmit={e => { e.preventDefault(); load(q) }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 10, background: 'var(--ds-glass-xs)' }}>
            <Search size={13} style={{ color: 'rgb(var(--ds-text-4))' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search mail (e.g. is:unread)"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'rgb(var(--ds-text-2))', fontSize: 12 }} />
          </form>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {error && <div style={{ padding: 12, color: '#f87171', fontSize: 12 }}>{error}</div>}
          {threads.map(t => (
            <button key={t.id} onClick={() => openThread(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', cursor: 'pointer',
                borderBottom: '1px solid var(--ds-border-sm)', background: activeId === t.id ? 'var(--ds-glass-sm)' : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: t.unread ? 700 : 500, color: 'rgb(var(--ds-text-2))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.from || '(unknown)'}</span>
                {t.unread && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgb(var(--ds-accent))', flexShrink: 0, marginTop: 4 }} />}
              </div>
              <div style={{ fontSize: 12.5, color: 'rgb(var(--ds-text-3))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject || '(no subject)'}</div>
              <div style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.snippet}</div>
            </button>
          ))}
          {loading && <div style={{ padding: 12, textAlign: 'center' }}><Loader2 className="animate-spin" size={16} style={{ color: 'rgb(var(--ds-accent))' }} /></div>}
          {!loading && nextToken && <button onClick={() => load(q, nextToken)} style={{ width: '100%', padding: 10, fontSize: 12, background: 'none', border: 'none', color: 'rgb(var(--ds-accent-soft))', cursor: 'pointer' }}>Load more</button>}
          {!loading && threads.length === 0 && !error && <div style={{ padding: 24, textAlign: 'center', color: 'rgb(var(--ds-text-4))', fontSize: 13 }}>No messages</div>}
        </div>
      </div>
      {/* Right: reader */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeId ? <ThreadReader threadId={activeId} accountEmail={email || ''} onReply={handleReply} /> : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--ds-text-4))' }}>Select a message</div>}
      </div>
      {compose && <Compose initial={compose} onClose={() => setCompose(null)} onSent={() => load(q)} />}
    </div>
  )
}
