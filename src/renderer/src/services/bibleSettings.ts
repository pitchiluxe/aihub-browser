import { useEffect, useState } from 'react'

// Reader preferences. Renderer-only and small, so they live in localStorage
// alongside the extension states rather than going through IPC — there is no
// main-process consumer for any of them.
export interface BibleSettings {
  fontScale: number        // 0.85 – 1.5, multiplies the base verse size
  paper: 'aged' | 'clean'  // aged parchment, or plain modern stock
  justify: boolean         // justified columns like a printed Bible
  animateTurn: boolean     // 3D page turn, or an instant change
  showCover: boolean       // open on the closed book, or straight into the text
  verseNumbers: boolean    // superscript verse numbers
}

export const DEFAULT_BIBLE_SETTINGS: BibleSettings = {
  fontScale: 1,
  paper: 'aged',
  justify: true,
  animateTurn: true,
  showCover: true,
  verseNumbers: true,
}

const KEY = 'aihub-bible-settings'
// Same-document storage events don't fire, so components share changes through
// this instead. Keeps Settings and an open reader in step without a reload.
const EVT = 'aihub-bible-settings-changed'

export function loadBibleSettings(): BibleSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_BIBLE_SETTINGS
    return { ...DEFAULT_BIBLE_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_BIBLE_SETTINGS
  }
}

export function saveBibleSettings(next: BibleSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
  window.dispatchEvent(new CustomEvent(EVT, { detail: next }))
}

// Live-updating view of the settings, for both the reader and the Settings page.
export function useBibleSettings(): [BibleSettings, (patch: Partial<BibleSettings>) => void] {
  const [settings, setSettings] = useState<BibleSettings>(loadBibleSettings)

  useEffect(() => {
    const onChange = (e: Event) => setSettings((e as CustomEvent).detail as BibleSettings)
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setSettings(loadBibleSettings()) }
    window.addEventListener(EVT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const update = (patch: Partial<BibleSettings>) => {
    const next = { ...loadBibleSettings(), ...patch }
    saveBibleSettings(next)
    setSettings(next)
  }

  return [settings, update]
}
