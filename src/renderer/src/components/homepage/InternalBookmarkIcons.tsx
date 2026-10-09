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

// The Community lounge: a group of people on an emerald badge, in the same
// #34d399 the sidebar's Community entry already uses, so the tile and the rail
// item read as the same destination.
//
// Depth instead of outlines: the two companions sit behind at reduced opacity,
// and the front figure is separated from them by a dark rim painted *under* its
// own fill (paint-order="stroke"). Stroking the silhouette this way keeps the
// separation at 30px, where a hairline gap between two whites disappears.
function CommunityIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="aihub-community-field" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5eecb0" />
          <stop offset="45%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#0d8f7d" />
        </linearGradient>
        <linearGradient id="aihub-community-figure" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dcf7ec" />
        </linearGradient>
      </defs>

      {/* Badge */}
      <rect x="2.6" y="2.6" width="26.8" height="26.8" rx="8.4" fill="url(#aihub-community-field)" />
      {/* Light rolling off the top-left, shadow pooling at the bottom */}
      <path d="M2.6 11a8.4 8.4 0 0 1 8.4-8.4h10A8.4 8.4 0 0 1 29.4 11v1.6C22 8.2 9.6 8.6 2.6 14.4Z" fill="#fff" opacity="0.16" />
      <path d="M2.6 24.2c7.4 3.4 19.4 3.4 26.8 0V21a8.4 8.4 0 0 1-8.4 8.4h-10A8.4 8.4 0 0 1 2.6 21Z" fill="#053b33" opacity="0.10" />

      {/* Companions, behind */}
      <g fill="url(#aihub-community-figure)" opacity="0.66">
        <circle cx="8.9" cy="13" r="3.2" />
        <path d="M4 22.6a4.9 4.9 0 0 1 9.8 0Z" />
        <circle cx="23.1" cy="13" r="3.2" />
        <path d="M18.2 22.6a4.9 4.9 0 0 1 9.8 0Z" />
      </g>

      {/* Front figure, rimmed against them */}
      <g fill="url(#aihub-community-figure)" stroke="#065f52" strokeOpacity="0.42" strokeWidth="1.7" strokeLinejoin="round" paintOrder="stroke">
        <circle cx="16" cy="14.6" r="4.2" />
        <path d="M9.7 26.6a6.3 6.3 0 0 1 12.6 0Z" />
      </g>
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
  community:{ Icon: CommunityIcon, accent: '#34d399' },
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
