import { join } from 'path'
import { createManagedJsonStore } from './jsonStore'

/**
 * AIHub Browser — session and workspace persistence.
 *
 * Two related ideas share one shape:
 *   - the LAST session, saved continuously so a crash or a quit never costs
 *     the user their open tabs;
 *   - named WORKSPACES ("Trading", "Client work"), saved on demand and opened
 *     later.
 *
 * The renderer owns tab state, so it publishes snapshots here rather than the
 * main process trying to reconstruct them from BrowserViews — a view can be
 * asleep or crashed and still belong in the session.
 */

export interface SessionTab {
  url: string
  title: string
  pageType?: string
  pinned?: boolean
}

export interface SavedSession {
  tabs: SessionTab[]
  activeIndex: number
  savedAt: number
}

export interface Workspace extends SavedSession {
  id: string
  name: string
}

interface SessionFile {
  last: SavedSession | null
  /** The session as it was when the app last started — "reopen previous". */
  previous: SavedSession | null
  workspaces: Workspace[]
}

const EMPTY: SessionFile = { last: null, previous: null, workspaces: [] }

/** Tabs worth restoring: real pages and app pages, never blanks or crash pages. */
export function isRestorable(tab: SessionTab): boolean {
  const url = (tab?.url || '').trim()
  if (!url) return false
  if (url.startsWith('data:')) return false          // crash page / generated doc
  if (url === 'about:blank') return false
  if (url === 'home') return true                     // the home tab is meaningful
  if (url.startsWith('aihub://')) return true         // Settings, Bible, Notes…
  return /^https?:\/\//i.test(url)
}

/**
 * Normalise a renderer snapshot into what gets stored: restorable tabs only,
 * duplicates collapsed, and an active index that still points at a real tab
 * after the filtering.
 */
export function normalizeSession(tabs: SessionTab[], activeIndex: number, cap = 200): SavedSession {
  const seen = new Set<string>()
  const kept: SessionTab[] = []
  let newActive = 0
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i]
    if (!isRestorable(tab)) continue
    const key = `${tab.pageType || 'browser'}::${tab.url}`
    if (seen.has(key)) {
      // A duplicate that was the active tab still deserves to be selected —
      // point at the copy we kept.
      if (i === activeIndex) newActive = kept.findIndex(t => `${t.pageType || 'browser'}::${t.url}` === key)
      continue
    }
    seen.add(key)
    if (i === activeIndex) newActive = kept.length
    kept.push({ url: tab.url, title: tab.title || '', pageType: tab.pageType, pinned: tab.pinned })
    if (kept.length >= cap) break
  }
  return {
    tabs: kept,
    activeIndex: kept.length ? Math.min(Math.max(newActive, 0), kept.length - 1) : 0,
    savedAt: Date.now(),
  }
}

/** True when a snapshot is worth writing — an empty or home-only set is not. */
export function isWorthSaving(session: SavedSession): boolean {
  if (!session.tabs.length) return false
  return session.tabs.some(t => t.url !== 'home')
}

export function createSessionManager(appDir: string) {
  const store = createManagedJsonStore<SessionFile>(join(appDir, 'sessions.json'), () => ({ ...EMPTY }), {
    // Tab state changes constantly (every navigation and title update). A
    // longer debounce than the default keeps this to a trickle of writes.
    debounceMs: 4000,
  })

  // Snapshot the session that existed at launch BEFORE the running app starts
  // overwriting `last`, so "reopen previous session" survives the moment the
  // new window opens its own tabs.
  const bootPrevious = () => {
    const data = store.get()
    if (data.last) {
      data.previous = data.last
      store.set({ ...data })
    }
    return data.previous
  }

  return {
    /** Call once at startup, before the renderer starts saving. */
    captureLaunchSnapshot: bootPrevious,

    save(tabs: SessionTab[], activeIndex: number) {
      const session = normalizeSession(tabs || [], activeIndex ?? 0)
      if (!isWorthSaving(session)) return null
      const data = store.get()
      data.last = session
      store.set({ ...data })
      return session
    },

    getLast(): SavedSession | null { return store.get().last },
    getPrevious(): SavedSession | null { return store.get().previous },

    listWorkspaces(): Workspace[] {
      return [...store.get().workspaces].sort((a, b) => b.savedAt - a.savedAt)
    },

    saveWorkspace(name: string, tabs: SessionTab[], activeIndex: number): Workspace | null {
      const session = normalizeSession(tabs || [], activeIndex ?? 0)
      if (!session.tabs.length) return null
      const data = store.get()
      const clean = String(name || '').trim().slice(0, 40) || 'Workspace'
      // Saving under an existing name replaces it — the alternative is a list
      // full of "Trading", "Trading (2)", "Trading (3)".
      const existing = data.workspaces.find(w => w.name.toLowerCase() === clean.toLowerCase())
      const workspace: Workspace = {
        ...session,
        id: existing?.id || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: clean,
      }
      data.workspaces = [workspace, ...data.workspaces.filter(w => w.id !== workspace.id)].slice(0, 50)
      store.set({ ...data })
      return workspace
    },

    getWorkspace(id: string): Workspace | null {
      return store.get().workspaces.find(w => w.id === id) || null
    },

    deleteWorkspace(id: string): boolean {
      const data = store.get()
      const before = data.workspaces.length
      data.workspaces = data.workspaces.filter(w => w.id !== id)
      store.set({ ...data })
      return data.workspaces.length !== before
    },

    flush() { store.flush() },
  }
}

export type SessionManager = ReturnType<typeof createSessionManager>
