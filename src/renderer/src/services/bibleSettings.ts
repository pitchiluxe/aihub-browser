import { useEffect, useState } from 'react'
import type { TranslationId } from './bibleService'

// Reader preferences. Renderer-only and small, so they live in localStorage
// alongside the extension states rather than going through IPC — there is no
// main-process consumer for any of them.
export interface BibleSettings {
  // Which version is open. Type-only import from bibleService, so this stays
  // a leaf module — bibleService reads its own state back out of here.
  translation: TranslationId
  fontScale: number        // 0.85 – 1.5, multiplies the base verse size
  // 'linen' and 'midnight' are earned in the study room — see bibleRewards.
  paper: 'aged' | 'clean' | 'linen' | 'midnight'
  cover: 'oxblood' | 'forest' | 'midnight'  // the closed book's binding
  justify: boolean         // justified columns like a printed Bible
  animateTurn: boolean     // 3D page turn, or an instant change
  showCover: boolean       // open on the closed book, or straight into the text
  verseNumbers: boolean    // superscript verse numbers
}

export const DEFAULT_BIBLE_SETTINGS: BibleSettings = {
  translation: 'WEB',
  fontScale: 1,
  paper: 'aged',
  cover: 'oxblood',
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
  // Guarded so the settings can be read and written under vitest's node
  // environment, where there is no window to dispatch on.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVT, { detail: next }))
  }
}

/**
 * Subscribe to preference changes outside React. The reader's hook below is
 * built on the same two events; this exists for plain modules — bibleService
 * mirrors the chosen translation through it.
 */
export function onBibleSettingsChange(fn: (next: BibleSettings) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onChange = (e: Event) => fn((e as CustomEvent).detail as BibleSettings)
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) fn(loadBibleSettings()) }
  window.addEventListener(EVT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

// Live-updating view of the settings, for both the reader and the Settings page.
export function useBibleSettings(): [BibleSettings, (patch: Partial<BibleSettings>) => void] {
  const [settings, setSettings] = useState<BibleSettings>(loadBibleSettings)

  useEffect(() => onBibleSettingsChange(setSettings), [])

  const update = (patch: Partial<BibleSettings>) => {
    const next = { ...loadBibleSettings(), ...patch }
    saveBibleSettings(next)
    setSettings(next)
  }

  return [settings, update]
}
