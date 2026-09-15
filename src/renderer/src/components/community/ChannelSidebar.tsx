import React, { useState } from 'react'
import { ChevronDown, Plus, Settings2, Headphones, Mic, MicOff, MonitorUp } from 'lucide-react'
import type { Category, Channel } from '../../../../shared/community'
import { ChannelIcon, Avatar } from './bits'
import type { CommunityMember } from './useCommunity'

/**
 * Categories and channels.
 *
 * Voice channels list their occupants underneath, the way a room with people in
 * it should look different from an empty one — it is the single most useful
 * thing a sidebar can tell you, and the reason anyone joins a voice room at all.
 */

interface Props {
  categories: Category[]
  channels: Channel[]
  /** Direct conversations this member is part of, newest first. */
  conversations: Channel[]
  memberId: string
  activeSlug: string
  unread: Record<string, number>
  mentions: Record<string, number>
  voice: Record<string, Array<{ peerId: string; memberId: string; muted: boolean; camera: boolean; sharing: boolean }>>
  memberById: Map<string, CommunityMember>
  canManage: boolean
  onSelect: (slug: string) => void
  onJoinVoice: (slug: string) => void
  onCreateChannel: (categoryId: string) => void
  onEditChannel: (slug: string) => void
  onOpenSettings: () => void
}

export default function ChannelSidebar({
  categories, channels, conversations, memberId, activeSlug, unread, mentions, voice, memberById,
  canManage, onSelect, onJoinVoice, onCreateChannel, onEditChannel, onOpenSettings,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (id: string) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  return (
    <nav className="cm-scroll flex h-full flex-col overflow-y-auto" aria-label="Channels">
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3"
        style={{ background: 'var(--cm-shell)', borderBottom: '1px solid var(--cm-line)' }}
      >
        <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--cm-ink)' }}>
          AIHub Community
        </span>
        {canManage && (
          <button
            onClick={onOpenSettings}
            title="Community settings"
            aria-label="Community settings"
            className="rounded p-1 transition-colors hover:bg-[var(--cm-hover)]"
            style={{ color: 'var(--cm-dim)' }}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="flex flex-col gap-4 px-2 py-3">
        {/* Conversations sit above the rooms, not inside them: a DM is not a
            place in the community, it is a thread with one person. */}
        {conversations.length > 0 && (
          <section>
            <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--cm-faint)' }}>
              Direct messages
            </h2>
            <ul className="flex flex-col gap-0.5">
              {conversations.map(conversation => {
                const otherId = conversation.participants?.find(id => id !== memberId)
                const other = otherId ? memberById.get(otherId) : undefined
                const count = unread[conversation.slug] ?? 0
                return (
                  <li key={conversation.slug}>
                    <button
                      onClick={() => onSelect(conversation.slug)}
                      className="cm-channel"
                      data-active={conversation.slug === activeSlug}
                      data-unread={count > 0}
                    >
                      <Avatar seed={other?.avatarSeed ?? conversation.slug} size={20}
                              presence={other?.presence} />
                      <span className="flex-1 truncate">{conversation.name}</span>
                      {count > 0 && (
                        <span className="rounded-full px-1.5 text-[10px] font-bold leading-4 text-white"
                              style={{ background: 'var(--cm-danger)' }}>
                          {count}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {categories.map(category => {
          const inCategory = channels.filter(c => c.categoryId === category.id)
          if (!inCategory.length && !canManage) return null
          const isCollapsed = collapsed[category.id]

          return (
            <section key={category.id}>
              <div className="group flex items-center gap-1 px-2 pb-1">
                <button
                  onClick={() => toggle(category.id)}
                  aria-expanded={!isCollapsed}
                  className="flex flex-1 items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors"
                  style={{ color: 'var(--cm-faint)' }}
                >
                  <ChevronDown
                    className="h-3 w-3 transition-transform"
                    style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
                  />
                  {category.name}
                </button>
                {canManage && (
                  <button
                    onClick={() => onCreateChannel(category.id)}
                    title={`New channel in ${category.name}`}
                    aria-label={`New channel in ${category.name}`}
                    className="rounded p-0.5 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    style={{ color: 'var(--cm-dim)' }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {!isCollapsed && (
                <ul className="flex flex-col gap-0.5">
                  {inCategory.map(channel => {
                    const occupants = voice[channel.slug] ?? []
                    const count = unread[channel.slug] ?? 0
                    const pinged = mentions[channel.slug] ?? 0

                    return (
                      <li key={channel.slug}>
                        <button
                          onClick={() => channel.type === 'voice'
                            ? onJoinVoice(channel.slug)
                            : onSelect(channel.slug)}
                          className="cm-channel group"
                          data-active={channel.slug === activeSlug}
                          data-unread={count > 0}
                          aria-current={channel.slug === activeSlug ? 'page' : undefined}
                        >
                          <ChannelIcon
                            name={channel.icon}
                            className="h-4 w-4 shrink-0"
                          />
                          <span className="cm-slug flex-1 truncate">{channel.name}</span>

                          {pinged > 0 && (
                            <span
                              className="rounded-full px-1.5 text-[10px] font-bold leading-4 text-white"
                              style={{ background: 'var(--cm-danger)' }}
                            >
                              {pinged}
                            </span>
                          )}
                          {canManage && (
                            <span
                              role="button"
                              tabIndex={0}
                              title={`Edit ${channel.name}`}
                              onClick={e => { e.stopPropagation(); onEditChannel(channel.slug) }}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault(); e.stopPropagation(); onEditChannel(channel.slug)
                                }
                              }}
                              className="rounded p-0.5 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                              style={{ color: 'var(--cm-dim)' }}
                            >
                              <Settings2 className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </button>

                        {/* Who is in the room, under the room. */}
                        {occupants.length > 0 && (
                          <ul className="ml-8 mt-0.5 flex flex-col gap-1 pb-1">
                            {occupants.map(peer => {
                              const member = memberById.get(peer.memberId)
                              return (
                                <li key={peer.peerId} className="flex items-center gap-2 text-xs"
                                    style={{ color: 'var(--cm-dim)' }}>
                                  <Avatar seed={member?.avatarSeed ?? peer.memberId} size={18} />
                                  <span className="flex-1 truncate">{member?.handle ?? 'Member'}</span>
                                  {peer.sharing && <MonitorUp className="h-3 w-3" style={{ color: 'var(--cm-accent)' }} />}
                                  {peer.muted
                                    ? <MicOff className="h-3 w-3" style={{ color: 'var(--cm-danger)' }} />
                                    : <Mic className="h-3 w-3" />}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}

        {!channels.length && (
          <p className="px-3 py-6 text-sm" style={{ color: 'var(--cm-faint)' }}>
            No channels yet.
          </p>
        )}
      </div>

      <div className="mt-auto px-3 py-3 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
        <span className="inline-flex items-center gap-1.5">
          <Headphones className="h-3 w-3" />
          Voice reaches this machine and your local network.
        </span>
      </div>
    </nav>
  )
}
