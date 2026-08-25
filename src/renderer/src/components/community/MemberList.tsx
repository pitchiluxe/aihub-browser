import React, { useMemo, useState } from 'react'
import { ShieldBan, Clock, X, UserMinus, Crown } from 'lucide-react'
import type { Role } from '../../../../shared/community'
import { Avatar, PRESENCE_LABEL, PRESENCE_COLOR } from './bits'
import type { CommunityMember } from './useCommunity'

/**
 * Who is here.
 *
 * Grouped by role first and presence second, which is the order people actually
 * scan: you look for the owner or a moderator when you need one, and for
 * anybody at all when you just want to know the room is alive. Offline members
 * stay listed rather than disappearing — a community of three that shows one
 * name looks abandoned even when it is not.
 */

interface Props {
  members: CommunityMember[]
  roles: Role[]
  roleFor: (memberId: string) => Role | undefined
  ownerId?: string
  viewerId: string
  canModerate: boolean
  canManageRoles: boolean
  onMessage: (memberId: string) => void
  onTimeout: (memberId: string) => void
  onBan: (memberId: string) => void
  onAssignRole: (memberId: string, roleId: string) => void
  onRevokeRole: (memberId: string, roleId: string) => void
  memberRoles: Record<string, string[]>
}

export default function MemberList(props: Props) {
  const {
    members, roles, roleFor, ownerId, viewerId, canModerate, canManageRoles,
    onMessage, onTimeout, onBan, onAssignRole, onRevokeRole, memberRoles,
  } = props

  const [open, setOpen] = useState<string | null>(null)

  const groups = useMemo(() => {
    const online = members.filter(m => m.presence !== 'offline')
    const offline = members.filter(m => m.presence === 'offline')
    const byRank = (a: CommunityMember, b: CommunityMember) =>
      (roleFor(b.id)?.position ?? 0) - (roleFor(a.id)?.position ?? 0)
        || a.handle.localeCompare(b.handle)
    return [
      { label: `Online — ${online.length}`, list: online.sort(byRank) },
      { label: `Offline — ${offline.length}`, list: offline.sort(byRank) },
    ]
  }, [members, roleFor])

  return (
    <aside className="cm-scroll h-full overflow-y-auto px-2 py-3" aria-label="Members">
      {groups.map(group => group.list.length > 0 && (
        <section key={group.label} className="mb-4">
          <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--cm-faint)' }}>
            {group.label}
          </h3>
          <ul>
            {group.list.map(member => {
              const role = roleFor(member.id)
              const isOwner = member.id === ownerId

              return (
                <li key={member.id} className="relative">
                  <button
                    onClick={() => setOpen(open === member.id ? null : member.id)}
                    aria-expanded={open === member.id}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--cm-hover)]"
                    style={{ opacity: member.presence === 'offline' ? 0.55 : 1 }}
                  >
                    <Avatar
                      seed={member.avatarSeed}
                      size={30}
                      presence={member.presence}
                      ring={role && role.id !== 'member' ? role.color : undefined}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 truncate text-sm font-medium"
                            style={{ color: role?.color ?? 'var(--cm-ink)' }}>
                        {member.handle}
                        {isOwner && <Crown className="h-3 w-3 shrink-0" />}
                      </span>
                      <span className="block truncate text-[11px]" style={{ color: 'var(--cm-faint)' }}>
                        {member.bannedAt ? 'Banned'
                          : member.timeoutUntil && member.timeoutUntil > Date.now() ? 'Timed out'
                            : PRESENCE_LABEL[member.presence]}
                      </span>
                    </span>
                  </button>

                  {open === member.id && (
                    <ProfileCard
                      member={member}
                      role={role}
                      roles={roles}
                      held={memberRoles[member.id] ?? []}
                      isOwner={isOwner}
                      isSelf={member.id === viewerId}
                      canModerate={canModerate}
                      canManageRoles={canManageRoles}
                      onClose={() => setOpen(null)}
                      onMessage={() => { onMessage(member.id); setOpen(null) }}
                      onTimeout={() => { onTimeout(member.id); setOpen(null) }}
                      onBan={() => { onBan(member.id); setOpen(null) }}
                      onAssignRole={roleId => onAssignRole(member.id, roleId)}
                      onRevokeRole={roleId => onRevokeRole(member.id, roleId)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </aside>
  )
}

function ProfileCard({
  member, role, roles, held, isOwner, canModerate, canManageRoles,
  onClose, onMessage, onTimeout, onBan, onAssignRole, onRevokeRole, isSelf,
}: {
  member: CommunityMember
  role?: Role
  roles: Role[]
  held: string[]
  isOwner: boolean
  canModerate: boolean
  canManageRoles: boolean
  onClose: () => void
  onMessage: () => void
  isSelf: boolean
  onTimeout: () => void
  onBan: () => void
  onAssignRole: (roleId: string) => void
  onRevokeRole: (roleId: string) => void
}) {
  // Only roles an owner may hand out. Ownership is proved by verifying an
  // email, so it is deliberately absent from this list.
  const assignable = roles.filter(r => r.id !== 'owner')

  return (
    <div
      className="absolute right-2 top-full z-30 mt-1 w-64 rounded-xl p-3"
      style={{ background: 'var(--cm-raise)', border: '1px solid var(--cm-line)', boxShadow: '0 12px 40px rgb(0 0 0 / .5)' }}
      role="dialog"
      aria-label={`${member.handle}'s profile`}
    >
      <button onClick={onClose} aria-label="Close profile"
              className="absolute right-2 top-2 rounded p-1 hover:bg-[var(--cm-hover)]"
              style={{ color: 'var(--cm-dim)' }}>
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-center gap-3">
        <Avatar seed={member.avatarSeed} size={44} presence={member.presence}
                ring={role && role.id !== 'member' ? role.color : undefined} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: role?.color ?? 'var(--cm-ink)' }}>
            {member.handle}
          </p>
          <p className="cm-slug truncate text-[11px]" style={{ color: 'var(--cm-faint)' }}>
            {member.handleKey}
          </p>
        </div>
      </div>

      {member.bio && (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--cm-dim)' }}>{member.bio}</p>
      )}

      <dl className="mt-3 space-y-1 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
        <div className="flex justify-between gap-2">
          <dt>Member since</dt>
          <dd style={{ color: 'var(--cm-dim)' }}>
            {new Date(member.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Status</dt>
          <dd style={{ color: PRESENCE_COLOR[member.presence] }}>{PRESENCE_LABEL[member.presence]}</dd>
        </div>
        {isOwner && (
          <div className="flex justify-between gap-2">
            <dt>Role</dt>
            <dd style={{ color: 'var(--cm-warn)' }}>Community Owner</dd>
          </div>
        )}
      </dl>

      {!isSelf && (
        <button
          onClick={onMessage}
          className="mt-3 w-full rounded-lg py-1.5 text-xs font-medium transition-colors"
          style={{ background: 'color-mix(in srgb, var(--cm-accent) 16%, transparent)', color: 'var(--cm-accent)' }}
        >
          Send a message
        </button>
      )}

      {canManageRoles && !isOwner && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--cm-line)' }}>
          <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--cm-faint)' }}>
            Roles
          </p>
          <div className="flex flex-wrap gap-1">
            {assignable.map(candidate => {
              const active = held.includes(candidate.id)
              return (
                <button
                  key={candidate.id}
                  onClick={() => active ? onRevokeRole(candidate.id) : onAssignRole(candidate.id)}
                  className="rounded px-2 py-0.5 text-[11px] transition-colors"
                  style={{
                    background: active ? `${candidate.color}22` : 'var(--cm-hover)',
                    color: active ? candidate.color : 'var(--cm-dim)',
                    border: `1px solid ${active ? candidate.color : 'transparent'}`,
                  }}
                  aria-pressed={active}
                >
                  {candidate.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {canModerate && !isOwner && (
        <div className="mt-3 flex gap-2 border-t pt-2" style={{ borderColor: 'var(--cm-line)' }}>
          <button onClick={onTimeout}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors hover:bg-[var(--cm-hover)]"
                  style={{ color: 'var(--cm-warn)' }}>
            <Clock className="h-3.5 w-3.5" /> Time out
          </button>
          <button onClick={onBan}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors hover:bg-[var(--cm-hover)]"
                  style={{ color: 'var(--cm-danger)' }}>
            {member.bannedAt ? <><UserMinus className="h-3.5 w-3.5" /> Unban</> : <><ShieldBan className="h-3.5 w-3.5" /> Ban</>}
          </button>
        </div>
      )}
    </div>
  )
}
