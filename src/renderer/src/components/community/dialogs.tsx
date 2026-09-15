import React, { useEffect, useRef, useState } from 'react'
import { X, Monitor, AppWindow, Loader2, AlertTriangle } from 'lucide-react'
import type { Channel, ChannelType, Category } from '../../../../shared/community'

/**
 * Modal surfaces: the screen picker, the channel editor, and the two
 * confirmations that guard destructive actions.
 *
 * The modal below is deliberately plain but not careless — Escape closes it,
 * focus moves into it on open and returns where it came from on close, and the
 * backdrop is a real button so a pointer user and a keyboard user have the same
 * ways out.
 */

export function Modal({
  title, onClose, children, width = 460,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  const panel = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement
    panel.current?.querySelector<HTMLElement>('input, button, textarea, select')?.focus()

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      returnTo.current?.focus?.()
    }
  }, [onClose])

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'rgb(0 0 0 / .55)' }}
        tabIndex={-1}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-full w-full overflow-y-auto rounded-2xl p-5"
        style={{
          width, maxWidth: '100%',
          background: 'var(--cm-shell)',
          border: '1px solid var(--cm-line)',
          boxShadow: '0 24px 64px rgb(0 0 0 / .55)',
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: 'var(--cm-ink)' }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-[var(--cm-hover)]"
                  style={{ color: 'var(--cm-dim)' }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const fieldStyle: React.CSSProperties = {
  background: 'var(--cm-raise)',
  border: '1px solid var(--cm-line)',
  color: 'var(--cm-ink)',
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--cm-dim)' }}>{label}</span>
      {children}
    </label>
  )
}

export function PrimaryButton({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
      style={{ background: 'var(--cm-accent)', color: '#08131a' }}
    >
      {children}
    </button>
  )
}

// ── Screen picker ──────────────────────────────────────────────────────────

interface Source { id: string; name: string; thumbnail: string; isScreen: boolean }

/**
 * Choose what to share.
 *
 * Electron has no native picker, so this is it. That is not only a gap being
 * filled — it is the consent step: the main process refuses any share it did
 * not see chosen here, so there is no path that starts capturing a desktop
 * without someone selecting it first.
 */
export function ScreenPicker({
  onPick, onClose, load,
}: {
  onPick: (sourceId: string) => void
  onClose: () => void
  load: () => Promise<{ ok: boolean; sources?: Source[]; error?: string }>
}) {
  const [sources, setSources] = useState<Source[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    load().then(result => {
      if (cancelled) return
      if (result.ok) setSources(result.sources ?? [])
      else setError(result.error ?? 'Could not list your screens.')
    })
    return () => { cancelled = true }
  }, [load])

  return (
    <Modal title="Share your screen" onClose={onClose} width={640}>
      {error && <p className="text-sm" style={{ color: 'var(--cm-danger)' }}>{error}</p>}

      {!sources && !error && (
        <p className="flex items-center gap-2 py-8 text-sm" style={{ color: 'var(--cm-dim)' }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Looking for screens and windows…
        </p>
      )}

      {sources && !sources.length && (
        <p className="py-8 text-sm" style={{ color: 'var(--cm-dim)' }}>
          Nothing available to share. On macOS, grant screen recording permission to AIHub in
          System Settings, then reopen this window.
        </p>
      )}

      {!!sources?.length && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {sources.map(source => (
            <button
              key={source.id}
              onClick={() => onPick(source.id)}
              className="overflow-hidden rounded-xl text-left transition-colors hover:bg-[var(--cm-hover)]"
              style={{ border: '1px solid var(--cm-line)' }}
            >
              <img src={source.thumbnail} alt="" className="h-24 w-full object-cover" style={{ background: 'var(--cm-void)' }} />
              <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs" style={{ color: 'var(--cm-ink)' }}>
                {source.isScreen ? <Monitor className="h-3.5 w-3.5 shrink-0" /> : <AppWindow className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{source.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ── Channel editor ─────────────────────────────────────────────────────────

export function ChannelEditor({
  channel, categoryId, categories, onClose, onSave, onDelete, onRestore, onPurge, error,
}: {
  channel?: Channel
  categoryId: string
  categories: Category[]
  onClose: () => void
  onSave: (input: { name: string; description: string; topic: string; categoryId: string; type: ChannelType }) => void
  onDelete?: () => void
  onRestore?: () => void
  onPurge?: (confirmSlug: string) => void
  error: string
}) {
  const [name, setName] = useState(channel?.name ?? '')
  const [description, setDescription] = useState(channel?.description ?? '')
  const [topic, setTopic] = useState(channel?.topic ?? '')
  const [category, setCategory] = useState(channel?.categoryId ?? categoryId)
  const [type, setType] = useState<ChannelType>(channel?.type ?? 'text')
  const [purging, setPurging] = useState(false)
  const [confirmSlug, setConfirmSlug] = useState('')

  return (
    <Modal title={channel ? `Edit ${channel.name}` : 'New channel'} onClose={onClose}>
      {error && (
        <p className="mb-3 rounded-lg px-3 py-2 text-xs" role="alert"
           style={{ background: 'color-mix(in srgb, var(--cm-danger) 12%, transparent)', color: 'var(--cm-danger)' }}>
          {error}
        </p>
      )}

      <Field label="Name">
        <input value={name} onChange={e => setName(e.target.value)}
               className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={fieldStyle} />
      </Field>

      {channel && (
        <p className="-mt-1 mb-3 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
          Address stays <span className="cm-slug">#{channel.slug}</span> — renaming never moves existing messages.
        </p>
      )}

      <Field label="Description">
        <input value={description} onChange={e => setDescription(e.target.value)}
               placeholder="One line, shown in the sidebar and above an empty room"
               className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={fieldStyle} />
      </Field>

      <Field label="Topic">
        <textarea value={topic} onChange={e => setTopic(e.target.value)} rows={2}
                  placeholder="The longer note in the channel header"
                  className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none" style={fieldStyle} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select value={category} onChange={e => setCategory(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={fieldStyle}>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Kind">
          <select value={type} onChange={e => setType(e.target.value as ChannelType)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={fieldStyle}>
            <option value="text">Text</option>
            <option value="voice">Voice</option>
            <option value="announcement">Announcement</option>
          </select>
        </Field>
      </div>

      {type === 'announcement' && (
        <p className="mb-3 text-[11px]" style={{ color: 'var(--cm-dim)' }}>
          Members can read but not post. You can still post here.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <PrimaryButton onClick={() => onSave({ name, description, topic, categoryId: category, type })} disabled={!name.trim()}>
          {channel ? 'Save changes' : 'Create channel'}
        </PrimaryButton>

        {channel && !channel.archivedAt && onDelete && (
          <button onClick={onDelete} className="rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[var(--cm-hover)]"
                  style={{ color: 'var(--cm-danger)' }}>
            Delete
          </button>
        )}
        {channel?.archivedAt && onRestore && (
          <button onClick={onRestore} className="rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[var(--cm-hover)]"
                  style={{ color: 'var(--cm-dim)' }}>
            Restore
          </button>
        )}
      </div>

      {channel && (
        <p className="mt-3 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
          Deleting hides the channel and keeps every message. Nothing is lost until you purge it.
        </p>
      )}

      {channel?.archivedAt && onPurge && (
        <div className="mt-4 rounded-xl p-3" style={{ border: '1px solid var(--cm-danger)' }}>
          {!purging ? (
            <button onClick={() => setPurging(true)} className="flex items-center gap-2 text-xs"
                    style={{ color: 'var(--cm-danger)' }}>
              <AlertTriangle className="h-3.5 w-3.5" /> Permanently delete this channel and its messages
            </button>
          ) : (
            <>
              <p className="mb-2 text-xs" style={{ color: 'var(--cm-danger)' }}>
                This destroys every message in the channel and cannot be undone.
                Type <span className="cm-slug">{channel.slug}</span> to confirm.
              </p>
              <div className="flex gap-2">
                <input value={confirmSlug} onChange={e => setConfirmSlug(e.target.value)}
                       className="cm-slug flex-1 rounded-lg px-3 py-1.5 text-sm outline-none" style={fieldStyle}
                       aria-label="Type the channel address to confirm" />
                <button onClick={() => onPurge(confirmSlug)} disabled={confirmSlug !== channel.slug}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                        style={{ background: 'var(--cm-danger)', color: '#fff' }}>
                  Purge
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Timeout ────────────────────────────────────────────────────────────────

const DURATIONS = [
  { label: '5 minutes', ms: 5 * 60_000 },
  { label: '1 hour', ms: 60 * 60_000 },
  { label: '1 day', ms: 24 * 60 * 60_000 },
  { label: '1 week', ms: 7 * 24 * 60 * 60_000 },
]

export function TimeoutDialog({
  handle, onClose, onApply,
}: {
  handle: string
  onClose: () => void
  onApply: (durationMs: number, reason: string) => void
}) {
  const [duration, setDuration] = useState(DURATIONS[1].ms)
  const [reason, setReason] = useState('')

  return (
    <Modal title={`Time out ${handle}`} onClose={onClose}>
      <p className="mb-3 text-sm" style={{ color: 'var(--cm-dim)' }}>
        They keep reading and stop posting. The timeout lifts by itself.
      </p>

      <Field label="For how long">
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map(option => (
            <button
              key={option.ms}
              onClick={() => setDuration(option.ms)}
              aria-pressed={duration === option.ms}
              className="rounded-lg px-3 py-1.5 text-xs transition-colors"
              style={{
                background: duration === option.ms ? 'color-mix(in srgb, var(--cm-accent) 18%, transparent)' : 'var(--cm-raise)',
                color: duration === option.ms ? 'var(--cm-accent)' : 'var(--cm-dim)',
                border: '1px solid var(--cm-line)',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Reason (they will see this)">
        <input value={reason} onChange={e => setReason(e.target.value)}
               className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={fieldStyle} />
      </Field>

      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={() => onApply(duration, reason)}>Apply timeout</PrimaryButton>
        <button onClick={() => onApply(0, '')} className="rounded-lg px-3 py-2 text-sm hover:bg-[var(--cm-hover)]"
                style={{ color: 'var(--cm-dim)' }}>
          Clear existing timeout
        </button>
      </div>
    </Modal>
  )
}
