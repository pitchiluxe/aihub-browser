import React, { useEffect, useRef, useState } from 'react'
import { Copy, Check, Download, X } from 'lucide-react'
import { formatRef } from '../../services/bibleService'

interface Props {
  verseRef: string
  text: string
  onClose: () => void
}

// Every URL is built from a fixed, hardcoded origin plus encodeURIComponent'd
// values — a verse containing `&`, `#`, `"` or a newline can never break out
// of its query parameter or inject extra ones. TikTok is deliberately absent:
// it has no web share-intent URL, and linking to one would just 404. Instead
// the sheet offers "Save image", which is the only thing that actually works
// for TikTok/Instagram — the user posts the exported PNG themselves.
// Fixed layout constants for saveImage()'s canvas export.
const CANVAS_WIDTH = 1080
const MIN_CANVAS_HEIGHT = 1080
const WRAP_MAX_WIDTH = 860
const VERTICAL_PADDING = 120 // breathing room above the first line and below the reference
const MAX_FONT_SIZE = 44
const MIN_FONT_SIZE = 22
const REFERENCE_GAP = 70 // gap between the last verse line and the reference line
const REFERENCE_FONT_RATIO = 34 / 44 // reference stays proportionally sized to the verse font

// Greedy word-wrap against the canvas's current font — pulled out so the
// font-size search below can re-run it cheaply at each candidate size.
function wrapWords(ctx: CanvasRenderingContext2D, words: string[], maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (ctx.measureText(`${line} ${w}`).width > maxWidth && line) { lines.push(line); line = w }
    else line = line ? `${line} ${w}` : w
  }
  if (line) lines.push(line)
  return lines
}

const TARGETS = [
  { id: 'facebook', label: 'Facebook', url: (t: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://bible.com')}&quote=${encodeURIComponent(t)}` },
  { id: 'x',        label: 'X',        url: (t: string) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}` },
  { id: 'whatsapp', label: 'WhatsApp', url: (t: string) => `https://api.whatsapp.com/send?text=${encodeURIComponent(t)}` },
  { id: 'linkedin', label: 'LinkedIn', url: (t: string) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(t)}` },
  { id: 'telegram', label: 'Telegram', url: (t: string) => `https://t.me/share/url?url=${encodeURIComponent('https://bible.com')}&text=${encodeURIComponent(t)}` },
  { id: 'reddit',   label: 'Reddit',   url: (t: string) => `https://www.reddit.com/submit?title=${encodeURIComponent(t.slice(0, 280))}` },
  { id: 'email',    label: 'Email',    url: (t: string) => `mailto:?subject=${encodeURIComponent('A verse for you')}&body=${encodeURIComponent(t)}` },
]

export default function ShareSheet({ verseRef, text, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const payload = `"${text}"\n\n— ${formatRef(verseRef)} (WEB)`

  // Escape dismisses; nothing here traps focus, so a Tab press can still
  // leave the modal at any time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard permission denied — nothing else to do */ }
  }

  // Opens external share links through the main-process shell.openExternal
  // bridge, same as the rest of the app (e.g. Google OAuth consent) — the
  // link opens in the user's real browser, never inside the app shell.
  const openTarget = (url: string) => {
    window.electronAPI?.openExternal?.(url)
  }

  const saveImage = () => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return

    // Long verses (Esther 8:9, the Revelation 21 wall-measurement verses,
    // etc.) wrap to more lines than a fixed 1080px canvas can hold at the
    // default font size. Shrink the font — and its proportional line
    // height / reference size — until the wrapped verse plus the reference
    // line fit the available height, down to a readable floor. If even the
    // floor doesn't fit, grow the canvas instead of cropping: the
    // reference line must always end up visible.
    const words = text.split(' ')
    const availableHeight = MIN_CANVAS_HEIGHT - VERTICAL_PADDING * 2
    let fontSize = MAX_FONT_SIZE
    let lines: string[] = []
    let lineHeight = 0
    let refFontSize = 0
    let textBlockHeight = 0
    for (; fontSize >= MIN_FONT_SIZE; fontSize -= 2) {
      ctx.font = `${fontSize}px Georgia, serif`
      lines = wrapWords(ctx, words, WRAP_MAX_WIDTH)
      lineHeight = fontSize * 1.5
      refFontSize = Math.round(fontSize * REFERENCE_FONT_RATIO)
      textBlockHeight = lines.length * lineHeight
      if (textBlockHeight + REFERENCE_GAP + refFontSize <= availableHeight) break
    }
    // If the loop ran to completion without an early break (still doesn't
    // fit at the floor), its `-= 2` update fires once more before the
    // condition fails, leaving fontSize one step below MIN_FONT_SIZE even
    // though lines/lineHeight/refFontSize above were computed at the
    // floor. Clamp it back so rendering matches what was measured.
    fontSize = Math.max(fontSize, MIN_FONT_SIZE)

    const requiredHeight = textBlockHeight + REFERENCE_GAP + refFontSize + VERTICAL_PADDING * 2
    const canvasHeight = Math.max(MIN_CANVAS_HEIGHT, requiredHeight)
    // Assigning width/height clears the canvas and resets context state,
    // so everything below (fillStyle, font, textAlign) is re-applied fresh.
    c.width = CANVAS_WIDTH; c.height = canvasHeight

    const grad = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, canvasHeight)
    grad.addColorStop(0, '#1e1b4b'); grad.addColorStop(1, '#4c1d95')
    ctx.fillStyle = grad; ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight)

    ctx.fillStyle = '#fdf6e3'
    ctx.font = `${fontSize}px Georgia, serif`
    ctx.textAlign = 'center'

    const centerX = CANVAS_WIDTH / 2
    const startY = canvasHeight / 2 - (lines.length - 1) * (lineHeight / 2)
    lines.forEach((l, i) => ctx.fillText(l, centerX, startY + i * lineHeight))

    ctx.font = `bold ${refFontSize}px Georgia, serif`
    ctx.fillStyle = '#fbbf24'
    ctx.fillText(formatRef(verseRef), centerX, startY + lines.length * lineHeight + REFERENCE_GAP)

    // A blob URL, not a data URL: the main process records `item.getURL()`
    // verbatim into downloads.json, so a data URL would park a 150-400KB
    // base64 string in that file — re-read, re-written on every progress
    // tick, broadcast over IPC and string-compared for duplicates. A blob:
    // URL is a few dozen characters.
    c.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.download = `${verseRef.replace(/\./g, '-')}.png`
      a.href = url
      a.click()
      // The blob has to outlive the click: Electron resolves the URL
      // asynchronously when it starts the download, and revoking it in the
      // same tick would cancel the save.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }, 'image/png')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[420px] rounded-2xl border border-aihub-border/40 bg-aihub-surface p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-aihub-text">Share {formatRef(verseRef)}</h3>
          <button onClick={onClose} className="text-aihub-muted hover:text-aihub-text"><X size={16} /></button>
        </div>

        <p className="mb-4 rounded-xl bg-aihub-bg/60 p-3 text-xs italic leading-relaxed text-aihub-muted whitespace-pre-line">
          {payload}
        </p>

        <div className="mb-3 grid grid-cols-4 gap-2">
          {TARGETS.map(t => (
            <button
              key={t.id}
              onClick={() => openTarget(t.url(payload))}
              className="rounded-xl border border-aihub-border/40 py-2 text-[11px] font-semibold text-aihub-text hover:border-aihub-accent/50 hover:text-aihub-accent"
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={copy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-aihub-border/20 py-2.5 text-xs font-semibold text-aihub-text hover:bg-aihub-border/30"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={saveImage}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-aihub-accent py-2.5 text-xs font-bold text-white hover:bg-aihub-accent-glow"
          >
            <Download size={14} /> Save image
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-aihub-muted/70">
          TikTok and Instagram don&apos;t accept shared links — post the image instead.
        </p>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  )
}
