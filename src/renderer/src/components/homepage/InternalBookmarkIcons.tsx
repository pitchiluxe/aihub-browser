import React from 'react'
import { StickyNote, FlaskConical, Bot, History, Settings } from 'lucide-react'

// Bookmarks that point at AIHub's own pages have no favicon to fetch — the
// remote favicon service 404s on an aihub:// URL — so they draw artwork from
// here instead. The flagship pages get real, full-colour icons rather than a
// monochrome glyph, since these sit in the first tiles on the home grid and a
// line-art outline reads as a placeholder next to real site favicons.
//
// `accent` drives the tile's own gradient/border/glow, replacing the bookmark's
// saved colour: a saved colour can't be corrected retroactively (it already
// lives in the user's data.json), and the tile chrome has to match the artwork.

// The Bible cover, in miniature. Same materials as the full-size cover in
// components/bible/BookCover.tsx — oxblood leather board, gilt fore-edge,
// gold-foil cross — so the bookmark and the page it opens are the same object.
function BibleIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="aihub-bible-leather" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6d2626" />
          <stop offset="45%" stopColor="#3f1212" />
          <stop offset="100%" stopColor="#280a0a" />
        </linearGradient>
        <linearGradient id="aihub-bible-gilt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7edcb" />
          <stop offset="50%" stopColor="#d8c07a" />
          <stop offset="100%" stopColor="#b99b4e" />
        </linearGradient>
      </defs>

      {/* Gilt page block, peeking out along the fore-edge */}
      <rect x="22.6" y="4.2" width="4.6" height="23.6" rx="1.4" fill="url(#aihub-bible-gilt)" />
      {/* Leather board */}
      <rect x="4.6" y="2.6" width="20" height="26.8" rx="2.4" fill="url(#aihub-bible-leather)" />
      {/* Raised spine joint */}
      <rect x="7.3" y="2.6" width="1.2" height="26.8" fill="#000" opacity="0.28" />
      {/* Foil cross, centred on the cover face rather than the whole board —
          the spine strip is a hinge, not part of the printed face. */}
      <rect x="15.2" y="7.7" width="2.9" height="16" rx="0.5" fill="url(#aihub-bible-gilt)" />
      <rect x="11.4" y="12.3" width="10.5" height="2.9" rx="0.5" fill="url(#aihub-bible-gilt)" />
      {/* Light catching the top-left of the board */}
      <path d="M4.6 5a2.4 2.4 0 0 1 2.4-2.4h15.2a2.4 2.4 0 0 1 2.4 2.4v2.3C18 4.7 10.6 4.5 4.6 6.9Z" fill="#fff" opacity="0.07" />
    </svg>
  )
}

// A mail envelope in the Google palette the mail page actually signs into.
function MailIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="aihub-mail-body">
          <rect x="3" y="7" width="26" height="18" rx="3" />
        </clipPath>
      </defs>

      <rect x="3" y="7" width="26" height="18" rx="3" fill="#fdfdfd" />
      <g clipPath="url(#aihub-mail-body)">
        {/* The fold of the envelope flap, drawn as two thick strokes meeting in
            the valley — the round join is what keeps the seam clean at 30px. */}
        <path d="M5 8.4 16 17.6" stroke="#EA4335" strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M27 8.4 16 17.6" stroke="#FBBC04" strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
        {/* Side panels, full height, drawn over the stroke ends */}
        <rect x="3" y="7" width="4.6" height="18" fill="#4285F4" />
        <rect x="24.4" y="7" width="4.6" height="18" fill="#34A853" />
      </g>
      <rect x="3" y="7" width="26" height="18" rx="3" fill="none" stroke="#000" strokeOpacity="0.12" />
    </svg>
  )
}

// Lucide glyphs are fine for the secondary pages — they're rarely bookmarked and
// read correctly as utility icons.
function glyph(Icon: React.ComponentType<any>, accent: string) {
  return {
    accent,
    Icon: ({ size = 28 }: { size?: number }) => (
      <Icon size={size} strokeWidth={1.7} style={{ color: accent }} />
    ),
  }
}

const INTERNAL_ICONS: Record<string, { Icon: React.ComponentType<{ size?: number }>; accent: string }> = {
  // Gold rather than the saved red: it lifts the leather artwork instead of
  // washing a red tile with a red-brown book.
  bible:    { Icon: BibleIcon, accent: '#C9A227' },
  mail:     { Icon: MailIcon,  accent: '#4285F4' },
  notes:    glyph(StickyNote,  '#facc15'),
  research: glyph(FlaskConical,'#34d399'),
  agents:   glyph(Bot,         '#a78bfa'),
  history:  glyph(History,     '#60a5fa'),
  settings: glyph(Settings,    '#94a3b8'),
}

export function getInternalBookmarkIcon(url?: string) {
  if (!url?.startsWith('aihub://')) return undefined
  return INTERNAL_ICONS[url.slice('aihub://'.length)]
}
