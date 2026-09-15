import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Clock, X } from 'lucide-react'
import {
  EMOJI_GROUPS, EMOJI_COUNT, EMOJI_KEYWORDS, SKIN_TONE_BASES, SKIN_TONES, withSkinTone,
} from '../../../../shared/emoji'

/**
 * The emoji picker.
 *
 * One group is mounted at a time. The full set is 1,540 characters and mounting
 * all of them costs a visible pause on every open — a picker that stutters is
 * one people stop using. A group is at most ~260, which renders instantly.
 *
 * Recently used comes first, kept in localStorage, because the honest truth
 * about emoji pickers is that most people reach for the same dozen and the
 * other 1,528 exist for the day they don't.
 */

const RECENT_KEY = 'aihub.community.emoji.recent'
const TONE_KEY = 'aihub.community.emoji.tone'
const MAX_RECENT = 36

const GROUP_ICONS: Record<string, string> = {
  'Smileys & Emotion': '😀',
  'People & Body': '👋',
  'Animals & Nature': '🐶',
  'Food & Drink': '🍕',
  'Travel & Places': '✈️',
  'Activities': '⚽',
  'Objects': '💡',
  'Symbols': '❤️',
  'Flags': '🏁',
}

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(e => typeof e === 'string').slice(0, MAX_RECENT) : []
  } catch { return [] }
}

export default function EmojiPicker({
  onPick, onClose, align = 'right',
}: {
  onPick: (emoji: string) => void
  onClose: () => void
  align?: 'left' | 'right'
}) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(EMOJI_GROUPS[0].name)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [tone, setTone] = useState(() => localStorage.getItem(TONE_KEY) || '')
  const [toneOpen, setToneOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  // Escape closes, and a click anywhere else closes — the two things every
  // popover is expected to do and the two most often forgotten.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const hits: string[] = []
    for (const [emoji, keywords] of Object.entries(EMOJI_KEYWORDS)) {
      if (keywords.includes(q)) hits.push(emoji)
      if (hits.length >= 120) break
    }
    return hits
  }, [query])

  const shown = results ?? EMOJI_GROUPS.find(g => g.name === group)?.emoji ?? []

  const choose = (emoji: string) => {
    const final = withSkinTone(emoji, tone)
    onPick(final)
    const next = [final, ...recent.filter(e => e !== final)].slice(0, MAX_RECENT)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose an emoji"
      className="absolute bottom-full z-30 mb-2 w-[332px] overflow-hidden rounded-xl"
      style={{
        [align]: 0,
        background: 'var(--cm-raise)',
        border: '1px solid var(--cm-line)',
        boxShadow: '0 16px 48px rgb(0 0 0 / .5)',
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--cm-line)' }}>
        <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--cm-dim)' }} />
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${EMOJI_COUNT} emoji`}
          aria-label="Search emoji"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          style={{ color: 'var(--cm-ink)' }}
        />

        <div className="relative">
          <button
            onClick={() => setToneOpen(o => !o)}
            title="Skin tone"
            aria-label="Choose a skin tone"
            aria-expanded={toneOpen}
            className="rounded px-1 text-base leading-none hover:bg-[var(--cm-hover)]"
          >
            {withSkinTone('✋', tone)}
          </button>
          {toneOpen && (
            <div className="absolute right-0 top-full z-40 mt-1 flex gap-0.5 rounded-lg p-1"
                 style={{ background: 'var(--cm-hover)', border: '1px solid var(--cm-line)' }}>
              {SKIN_TONES.map(option => (
                <button
                  key={option || 'default'}
                  onClick={() => {
                    setTone(option); setToneOpen(false)
                    try { localStorage.setItem(TONE_KEY, option) } catch { /* private mode */ }
                  }}
                  aria-label={option ? 'Skin tone' : 'Default skin tone'}
                  aria-pressed={tone === option}
                  className="rounded px-1 text-base leading-none hover:bg-[var(--cm-raise)]"
                >
                  {withSkinTone('✋', option)}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={onClose} aria-label="Close emoji picker"
                className="rounded p-1 hover:bg-[var(--cm-hover)]" style={{ color: 'var(--cm-dim)' }}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!query && recent.length > 0 && (
        <section className="px-2 pt-2">
          <h3 className="flex items-center gap-1 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--cm-faint)' }}>
            <Clock className="h-3 w-3" /> Recently used
          </h3>
          <Grid emoji={recent} onPick={choose} tone="" />
        </section>
      )}

      <section className="cm-scroll max-h-56 overflow-y-auto px-2 py-2">
        {!query && (
          <h3 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--cm-faint)' }}>
            {group}
          </h3>
        )}
        {query && !shown.length && (
          <p className="px-1 py-6 text-center text-xs" style={{ color: 'var(--cm-dim)' }}>
            No emoji named “{query}”. Search covers the common ones — the rest are in the groups below.
          </p>
        )}
        <Grid emoji={shown} onPick={choose} tone={tone} />
      </section>

      <nav className="flex items-center justify-between px-2 py-1.5"
           style={{ borderTop: '1px solid var(--cm-line)' }} aria-label="Emoji groups">
        {EMOJI_GROUPS.map(entry => (
          <button
            key={entry.name}
            onClick={() => { setGroup(entry.name); setQuery('') }}
            title={entry.name}
            aria-label={entry.name}
            aria-pressed={!query && group === entry.name}
            className="rounded px-1 py-0.5 text-base leading-none transition-opacity"
            style={{ opacity: !query && group === entry.name ? 1 : 0.45 }}
          >
            {GROUP_ICONS[entry.name] ?? '•'}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Grid({ emoji, onPick, tone }: { emoji: string[]; onPick: (e: string) => void; tone: string }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emoji.map((entry, index) => {
        const shown = SKIN_TONE_BASES.has(entry) ? withSkinTone(entry, tone) : entry
        return (
          <button
            key={`${entry}-${index}`}
            onClick={() => onPick(entry)}
            className="rounded p-1 text-xl leading-none hover:bg-[var(--cm-hover)]"
            aria-label={EMOJI_KEYWORDS[entry] ? `${shown} — ${EMOJI_KEYWORDS[entry].split(' ')[0]}` : shown}
          >
            {shown}
          </button>
        )
      })}
    </div>
  )
}
