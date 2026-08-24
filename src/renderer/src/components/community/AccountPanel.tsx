import React, { useState } from 'react'
import { KeyRound, Trash2, AlertTriangle, Copy, Check } from 'lucide-react'

/**
 * The member's own controls: their identity key, and deleting everything.
 *
 * Delete-my-data is a real deletion, not a flag, so it is behind a typed
 * confirmation and it reports what it removed. A screen that says "deleted"
 * without saying how much is asking not to be believed.
 */

export default function AccountPanel({ me, onGone }: { me: any; onGone: () => void }) {
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [exported, setExported] = useState('')
  const api = (window as any).electronAPI?.community

  const armed = confirm.trim().toLowerCase() === 'delete'

  const exportKey = async () => {
    setError('')
    try {
      const out = await api.exportKey()
      if (out?.ok) setExported(out.key || '')
      else setError(out?.error || 'Could not export the key.')
    } catch (e: any) { setError(e?.message || 'Could not export the key.') }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { setError('Could not copy. Select the text and copy it manually.') }
  }

  const wipe = async () => {
    if (!armed) return
    setBusy(true); setError('')
    try {
      const out = await api.deleteMyData()
      if (out?.ok) onGone()
      else setError(out?.error || 'Nothing was deleted.')
    } catch (e: any) { setError(e?.message || 'Nothing was deleted.') }
    finally { setBusy(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '18px 22px', maxWidth: 620 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Your identity</h2>
      <p style={{ color: 'rgb(var(--ds-muted))', fontSize: 12.5, lineHeight: 1.6, marginBottom: 18 }}>
        You are <strong style={{ color: 'rgb(var(--ds-text))' }}>{me?.handle}</strong>. There is no
        email and no password behind that name — this device holds a key, and the key is the
        account.
      </p>

      <Section
        icon={<KeyRound size={15} style={{ color: '#38bdf8' }} />}
        title="Move to another computer"
        body="Export the key here and import it there, and the same name and history follow you.
              Anyone holding this text can post as you, so treat it like a password."
      >
        {!exported ? (
          <Btn onClick={exportKey} color="#38bdf8">Show my key</Btn>
        ) : (
          <>
            <textarea
              readOnly
              value={exported}
              rows={3}
              onFocus={e => e.currentTarget.select()}
              style={{
                width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 11,
                padding: 10, borderRadius: 8, resize: 'vertical',
                background: 'rgb(var(--ds-bg))', color: 'rgb(var(--ds-text))',
                border: '1px solid rgb(var(--ds-border))',
              }}
            />
            <Btn onClick={copy} color="#38bdf8">
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </Btn>
          </>
        )}
      </Section>

      <Section
        icon={<Trash2 size={15} style={{ color: '#f87171' }} />}
        title="Delete everything"
        body="Removes your name, every message you posted, every reaction you left and every
              report you filed, then forgets this device's key. It cannot be undone and nothing
              is kept."
        danger
      >
        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
          <input
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Type delete to confirm"
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 7, fontSize: 12.5,
              background: 'rgb(var(--ds-bg))', color: 'rgb(var(--ds-text))',
              border: '1px solid rgb(var(--ds-border))',
            }}
          />
          <button
            onClick={wipe}
            disabled={!armed || busy}
            style={{
              fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 7,
              whiteSpace: 'nowrap',
              color: armed ? '#2b0b0b' : 'rgb(var(--ds-muted))',
              background: armed ? '#f87171' : 'rgb(var(--ds-surface))',
              border: `1px solid ${armed ? '#f87171' : 'rgb(var(--ds-border))'}`,
              cursor: armed && !busy ? 'pointer' : 'not-allowed',
            }}>
            {busy ? 'Deleting…' : 'Delete everything'}
          </button>
        </div>
      </Section>

      {error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 12 }}>{error}</div>}
    </div>
  )
}

function Section({ icon, title, body, danger, children }: {
  icon: React.ReactNode; title: string; body: string; danger?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{
      borderRadius: 10, padding: 14, marginBottom: 14,
      background: 'rgb(var(--ds-surface))',
      border: `1px solid ${danger ? 'rgba(248,113,113,0.30)' : 'rgb(var(--ds-border))'}`,
    }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        {danger ? <AlertTriangle size={15} style={{ color: '#f87171' }} /> : icon}
        <strong style={{ fontSize: 13.5 }}>{title}</strong>
      </div>
      <p style={{ color: 'rgb(var(--ds-muted))', fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
        {body}
      </p>
      {children}
    </div>
  )
}

function Btn({ children, color, ...rest }: {
  children: React.ReactNode; color: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="flex items-center gap-1.5"
      style={{
        fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 7, marginTop: 8,
        color, background: `${color}14`, border: `1px solid ${color}38`, cursor: 'pointer',
      }}>
      {children}
    </button>
  )
}
