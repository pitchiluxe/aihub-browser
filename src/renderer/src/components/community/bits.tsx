import React from 'react'
import {
  BookMarked, Code2, Shield, CandlestickChart, Trophy, Clapperboard, Briefcase,
  Megaphone, Hash, LifeBuoy, Shuffle, Sparkles, Cpu, Cloud, Network,
  Volume2, MonitorPlay, MessageSquare,
} from 'lucide-react'
import { avatarDataUri } from '../../../../shared/communityAvatar'
import type { PresenceStatus } from '../../../../shared/community'

/**
 * The small shared pieces: channel icons, avatars, presence dots.
 *
 * Kept together because each is a handful of lines and splitting them into
 * eight files would make the import list longer than the code.
 */

const ICONS: Record<string, React.ElementType> = {
  BookMarked, Code2, Shield, CandlestickChart, Trophy, Clapperboard, Briefcase,
  Megaphone, Hash, LifeBuoy, Shuffle, Sparkles, Cpu, Cloud, Network,
  Volume2, MonitorPlay,
}

/** Falls back to a hash rather than nothing: an owner can type any icon name
 *  into the channel editor, and a missing glyph should not be a hole. */
export function ChannelIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Hash
  return <Icon className={className} />
}

export const PRESENCE_COLOR: Record<PresenceStatus, string> = {
  online: '#3fb950',
  idle: '#d29922',
  dnd: '#f85149',
  offline: '#6e7681',
}

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  offline: 'Offline',
}

export function Avatar({
  seed, size = 32, presence, ring,
}: {
  seed: string
  size?: number
  presence?: PresenceStatus
  /** Role colour, drawn as a thin ring. Absent for members with no role. */
  ring?: string
}) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <img
        src={avatarDataUri(seed)}
        alt=""
        width={size}
        height={size}
        className="rounded-full"
        style={ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined}
      />
      {presence && (
        <span
          // Decorative here: the member list states the status in words, so a
          // screen reader hearing "online" twice would be noise.
          aria-hidden="true"
          className="absolute rounded-full"
          style={{
            right: -1, bottom: -1,
            width: Math.max(9, size * 0.32),
            height: Math.max(9, size * 0.32),
            background: PRESENCE_COLOR[presence],
            border: '2px solid var(--cm-shell)',
          }}
        />
      )}
    </span>
  )
}

/** Empty rooms should invite, not apologise. */
export function EmptyRoom({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'color-mix(in srgb, var(--cm-accent) 14%, transparent)' }}
      >
        <MessageSquare className="h-6 w-6" style={{ color: 'var(--cm-accent)' }} />
      </div>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--cm-ink)' }}>
        This is the start of #{name}
      </h2>
      <p className="max-w-sm text-sm" style={{ color: 'var(--cm-dim)' }}>{description}</p>
    </div>
  )
}

export function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function dayOf(at: number): string {
  const date = new Date(at)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}
