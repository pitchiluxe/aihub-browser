import { installPrivateStorage } from './privateStorage'

/**
 * Whether this renderer is the UI of an Incognito window.
 *
 * Presentation only. The value comes from a switch the main process put on
 * this renderer's command line when it created the window; the main process
 * enforces every privacy rule from its own record and never asks the renderer.
 */
export const IS_INCOGNITO: boolean =
  typeof window !== 'undefined' && !!(window as any).electronAPI?.incognito?.isIncognito

export const INCOGNITO_TITLE = 'AIHub Browser — Incognito'

/**
 * Private windows always wear the neutral dark "Graphite" palette, whatever
 * theme normal windows use, so a private window is recognisable at a glance —
 * the same reason Chrome's Incognito is always dark.
 */
export const INCOGNITO_THEME = 'graphite'

/** The theme id to paint with: the user's choice, except in a private window. */
export function effectiveThemeId(userTheme: string): string {
  return IS_INCOGNITO ? INCOGNITO_THEME : userTheme
}

/**
 * Prepare a private window before any app module reads storage or paints:
 * swap in the copy-on-write localStorage, mark the document for the private
 * visual treatment, and title it. Imported first by main.tsx.
 */
export function bootIncognitoWindow(): void {
  if (!IS_INCOGNITO) return
  const storageIsolated = installPrivateStorage(window)
  const root = document.documentElement
  root.classList.add('ds-incognito')
  // Kept on the element so the private new-tab page can be honest if the
  // engine ever refused the swap, instead of claiming a guarantee it lacks.
  root.dataset.privateStorage = storageIsolated ? 'isolated' : 'unavailable'
  document.title = INCOGNITO_TITLE
}
