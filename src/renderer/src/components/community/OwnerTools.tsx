import React, { useEffect, useState } from 'react'
import { Crown, FolderPlus, Trash2, Plus, ScrollText, ShieldCheck, Loader2 } from 'lucide-react'
import { ALL_PERMISSIONS, type AuditEntry, type Category, type Permission, type Role } from '../../../../shared/community'
import { Modal, Field, PrimaryButton, fieldStyle } from './dialogs'

/**
 * Community settings — ownership, categories, roles, and the audit log.
 *
 * The ownership panel is the one screen in the app that explains where
 * authority comes from, so it says it plainly: ownership is proved by signing
 * in with the owner's Google account, and nothing here can grant it. When
 * Google is not configured it says that too, rather than presenting a button
 * that fails for reasons the user cannot see.
 */

type Tab = 'ownership' | 'categories' | 'roles' | 'audit'

interface Props {
  isOwner: boolean
  ownership: { memberId: string; email: string; verifiedAt: number } | null
  googleConnected: boolean
  categories: Category[]
  roles: Role[]
  onClose: () => void
  api: any
  onChanged: () => void
}

export default function OwnerTools(props: Props) {
  const { isOwner, ownership, googleConnected, categories, roles, onClose, api, onChanged } = props
  const [tab, setTab] = useState<Tab>(isOwner ? 'categories' : 'ownership')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<any>) => {
    setError('')
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (result && result.ok === false) setError(result.error ?? 'That did not work.')
    else onChanged()
    return result
  }

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: 'ownership', label: 'Ownership', show: true },
    { id: 'categories', label: 'Categories', show: isOwner },
    { id: 'roles', label: 'Roles', show: isOwner },
    { id: 'audit', label: 'Audit log', show: true },
  ]

  return (
    <Modal title="Community settings" onClose={onClose} width={560}>
      <div className="mb-4 flex gap-1" role="tablist">
        {tabs.filter(t => t.show).map(entry => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: tab === entry.id ? 'color-mix(in srgb, var(--cm-accent) 16%, transparent)' : 'transparent',
              color: tab === entry.id ? 'var(--cm-accent)' : 'var(--cm-dim)',
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 rounded-lg px-3 py-2 text-xs" role="alert"
           style={{ background: 'color-mix(in srgb, var(--cm-danger) 12%, transparent)', color: 'var(--cm-danger)' }}>
          {error}
        </p>
      )}

      {tab === 'ownership' && (
        <OwnershipTab
          isOwner={isOwner} ownership={ownership} googleConnected={googleConnected}
          busy={busy} api={api} run={run}
        />
      )}
      {tab === 'categories' && <CategoriesTab categories={categories} api={api} run={run} />}
      {tab === 'roles' && <RolesTab roles={roles} api={api} run={run} />}
      {tab === 'audit' && <AuditTab api={api} />}
    </Modal>
  )
}

// ── Ownership ──────────────────────────────────────────────────────────────

function OwnershipTab({
  isOwner, ownership, googleConnected, busy, api, run,
}: {
  isOwner: boolean
  ownership: Props['ownership']
  googleConnected: boolean
  busy: boolean
  api: any
  run: (action: () => Promise<any>) => Promise<any>
}) {
  if (isOwner) {
    return (
      <div>
        <p className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
           style={{ background: 'color-mix(in srgb, var(--cm-warn) 12%, transparent)', color: 'var(--cm-warn)' }}>
          <Crown className="h-4 w-4 shrink-0" />
          You are the Community Owner.
        </p>
        <dl className="space-y-1 text-xs" style={{ color: 'var(--cm-faint)' }}>
          <div className="flex justify-between gap-3">
            <dt>Verified account</dt>
            <dd className="cm-slug" style={{ color: 'var(--cm-dim)' }}>{ownership?.email}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Claimed</dt>
            <dd style={{ color: 'var(--cm-dim)' }}>
              {ownership ? new Date(ownership.verifiedAt).toLocaleString() : '—'}
            </dd>
          </div>
        </dl>
        <button
          onClick={() => run(() => api.releaseOwnership())}
          className="mt-4 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[var(--cm-hover)]"
          style={{ color: 'var(--cm-danger)' }}
        >
          Release ownership
        </button>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
          Hands the community back so another device can claim it by signing in with the same account.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-3 text-sm" style={{ color: 'var(--cm-dim)' }}>
        Ownership is proved, not granted. Signing in with the owner's Google account binds it to this
        device; nothing on this screen can hand it out.
      </p>

      {ownership && (
        <p className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--cm-raise)', color: 'var(--cm-dim)' }}>
          Already claimed by <span className="cm-slug">{ownership.email}</span> on another device.
          Release it there first.
        </p>
      )}

      {!googleConnected && (
        <p className="mb-3 rounded-lg px-3 py-2 text-xs"
           style={{ background: 'color-mix(in srgb, var(--cm-warn) 12%, transparent)', color: 'var(--cm-warn)' }}>
          Google sign-in is not configured yet. Add a Desktop OAuth client ID in Settings → Google,
          then come back — the sign-in window opens in your real browser.
        </p>
      )}

      <PrimaryButton onClick={() => run(() => api.claimOwnership())} disabled={busy || !!ownership}>
        {busy ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for Google…</span>
          : 'Sign in with Google to claim ownership'}
      </PrimaryButton>
    </div>
  )
}

// ── Categories ─────────────────────────────────────────────────────────────

function CategoriesTab({
  categories, api, run,
}: { categories: Category[]; api: any; run: (action: () => Promise<any>) => Promise<any> }) {
  const [name, setName] = useState('')

  return (
    <div>
      <ul className="mb-4 space-y-1">
        {categories.map(category => (
          <li key={category.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5"
              style={{ background: 'var(--cm-raise)' }}>
            <input
              defaultValue={category.name}
              onBlur={e => {
                if (e.target.value.trim() && e.target.value !== category.name) {
                  void run(() => api.updateCategory(category.id, e.target.value))
                }
              }}
              aria-label={`Rename ${category.name}`}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--cm-ink)' }}
            />
            <button
              onClick={() => run(() => api.deleteCategory(category.id))}
              aria-label={`Delete ${category.name}`}
              className="rounded p-1 hover:bg-[var(--cm-hover)]"
              style={{ color: 'var(--cm-danger)' }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <p className="mb-3 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
        Deleting a category moves its channels to the first remaining one. No channel is ever left
        without somewhere to live.
      </p>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New category"
          aria-label="New category name"
          className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          style={fieldStyle}
        />
        <PrimaryButton
          onClick={async () => { await run(() => api.createCategory(name)); setName('') }}
          disabled={!name.trim()}
        >
          <span className="inline-flex items-center gap-1.5"><FolderPlus className="h-3.5 w-3.5" /> Add</span>
        </PrimaryButton>
      </div>
    </div>
  )
}

// ── Roles ──────────────────────────────────────────────────────────────────

const PERMISSION_LABELS: Record<Permission, string> = {
  send_messages: 'Send messages',
  attach_files: 'Attach files',
  add_reactions: 'Add reactions',
  mention_everyone: 'Mention everyone',
  use_voice: 'Join voice',
  use_video: 'Use video',
  screen_share: 'Share screen',
  manage_messages: 'Delete any message',
  manage_members: 'Ban and time out',
  manage_channels: 'Manage channels',
  manage_roles: 'Manage roles',
  view_audit_log: 'View audit log',
}

function RolesTab({
  roles, api, run,
}: { roles: Role[]; api: any; run: (action: () => Promise<any>) => Promise<any> }) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Permission[]>(['send_messages'])

  return (
    <div>
      <ul className="mb-4 space-y-2">
        {roles.map(role => (
          <li key={role.id} className="rounded-lg px-3 py-2" style={{ background: 'var(--cm-raise)' }}>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: role.color }} aria-hidden="true" />
              <span className="flex-1 text-sm font-medium" style={{ color: 'var(--cm-ink)' }}>{role.name}</span>
              {role.system
                ? <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--cm-faint)' }}>Built in</span>
                : (
                  <button onClick={() => run(() => api.deleteRole(role.id))} aria-label={`Delete ${role.name}`}
                          className="rounded p-1 hover:bg-[var(--cm-hover)]" style={{ color: 'var(--cm-danger)' }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
            </div>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
              {role.permissions.length
                ? role.permissions.map(p => PERMISSION_LABELS[p]).join(' · ')
                : 'No permissions'}
            </p>
          </li>
        ))}
      </ul>

      <p className="mb-3 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
        Built-in roles cannot be edited — they are the floor the permission engine stands on, and an
        owner who could empty the owner role would be locked out for good.
      </p>

      <Field label="New role">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name"
               className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={fieldStyle} />
      </Field>

      <div className="mb-3 flex flex-wrap gap-1">
        {ALL_PERMISSIONS.map(permission => {
          const on = picked.includes(permission)
          return (
            <button
              key={permission}
              onClick={() => setPicked(prev => on ? prev.filter(p => p !== permission) : [...prev, permission])}
              aria-pressed={on}
              className="rounded px-2 py-1 text-[11px] transition-colors"
              style={{
                background: on ? 'color-mix(in srgb, var(--cm-accent) 16%, transparent)' : 'var(--cm-raise)',
                color: on ? 'var(--cm-accent)' : 'var(--cm-dim)',
              }}
            >
              {PERMISSION_LABELS[permission]}
            </button>
          )
        })}
      </div>

      <PrimaryButton
        onClick={async () => {
          await run(() => api.createRole({ name, permissions: picked }))
          setName('')
        }}
        disabled={!name.trim()}
      >
        <span className="inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Create role</span>
      </PrimaryButton>
    </div>
  )
}

// ── Audit ──────────────────────────────────────────────────────────────────

const ACTION_TEXT: Record<string, string> = {
  'ownership.claimed': 'claimed ownership',
  'channel.created': 'created channel',
  'channel.updated': 'updated channel',
  'channel.deleted': 'deleted channel',
  'channel.reordered': 'reordered channels',
  'category.created': 'created category',
  'category.updated': 'renamed category',
  'category.deleted': 'deleted category',
  'role.created': 'created role',
  'role.updated': 'updated role',
  'role.deleted': 'deleted role',
  'role.assigned': 'assigned a role to',
  'role.revoked': 'revoked a role from',
  'message.removed': 'removed a message',
  'member.banned': 'banned',
  'member.unbanned': 'unbanned',
  'member.timeout': 'timed out',
  'report.resolved': 'resolved a report about',
}

function AuditTab({ api }: { api: any }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.auditLog(200).then((result: any) => {
      if (result?.ok) setEntries(result.entries)
      else setError(result?.error ?? 'The audit log is not available to you.')
    })
  }, [api])

  if (error) return <p className="py-6 text-sm" style={{ color: 'var(--cm-dim)' }}>{error}</p>
  if (!entries) return <p className="py-6 text-sm" style={{ color: 'var(--cm-dim)' }}>Loading…</p>
  if (!entries.length) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm" style={{ color: 'var(--cm-dim)' }}>
        <ShieldCheck className="h-4 w-4" /> Nothing has happened yet.
      </p>
    )
  }

  return (
    <ul className="cm-scroll max-h-80 space-y-1 overflow-y-auto">
      {entries.map(entry => (
        <li key={entry.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs"
            style={{ background: 'var(--cm-raise)' }}>
          <ScrollText className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--cm-faint)' }} />
          <span className="flex-1" style={{ color: 'var(--cm-dim)' }}>
            <span style={{ color: 'var(--cm-ink)' }}>{ACTION_TEXT[entry.action] ?? entry.action}</span>{' '}
            <span className="cm-slug">{entry.targetId}</span>
            {entry.meta?.name && <span> · {String(entry.meta.name)}</span>}
          </span>
          <time className="cm-slug shrink-0 text-[10px]" style={{ color: 'var(--cm-faint)' }}>
            {new Date(entry.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </time>
        </li>
      ))}
    </ul>
  )
}
