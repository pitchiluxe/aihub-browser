import { create } from 'zustand'

export interface Bookmark { id: string; url: string; title: string; favicon: string; category: string; addedAt: number; color: string }
export interface Tab { id: string; url: string; title: string; favicon: string; isLoading: boolean; isHome: boolean; fromHome?: boolean; pageType?: 'browser'|'settings'|'history'|'downloads'|'wifi'|'vpn'|'research'|'agents'|'extensions' }
export interface AIMessage { role: 'user'|'assistant'|'system'; content: string; steps?: { label: string; status: 'pending' | 'done' | 'error' }[] }
export interface HistoryItem { id: string; url: string; title: string; favicon?: string; timestamp: number }
export interface DownloadItem { id: string; filename: string; url: string; savePath: string; totalBytes: number; receivedBytes: number; state: string; startedAt: number; completedAt?: number }

interface BrowserState {
  // Bookmarks
  bookmarks: Bookmark[]
  setBookmarks: (b: Bookmark[]) => void
  addBookmark: (b: Bookmark) => void
  removeBookmark: (id: string) => void

  // Tabs
  tabs: Tab[]
  activeTabId: string | null
  addTab: (url?: string, pageType?: Tab['pageType']) => string
  closeTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  closeTabsToRight: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, u: Partial<Tab>) => void
  reorderTabs: (fromId: string, toId: string) => void

  // Navigation state (per active tab)
  canGoBack: boolean
  canGoForward: boolean
  setNavState: (v: { canGoBack: boolean; canGoForward: boolean }) => void

  // UI
  isAIPanelOpen: boolean
  toggleAIPanel: () => void
  isAddBookmarkOpen: boolean
  setAddBookmarkOpen: (v: boolean) => void
  isSidebarOpen: boolean
  toggleSidebar: () => void
  isAnnotationMode: boolean
  toggleAnnotationMode: () => void

  // AI
  aiMessages: AIMessage[]
  addAIMessage: (m: AIMessage) => void
  clearAIMessages: () => void
  setAIMessageStepStatus: (msgIndex: number, stepIndex: number, status: 'done' | 'error') => void
  isAILoading: boolean
  setAILoading: (v: boolean) => void
  ollamaStatus: { running: boolean; models: string[] } | null
  setOllamaStatus: (v: { running: boolean; models: string[] }) => void

  // Downloads live updates
  downloads: DownloadItem[]
  setDownloads: (d: DownloadItem[]) => void
  upsertDownload: (d: DownloadItem) => void

  // Extensions
  extensionStates: Record<string, { enabled: boolean; settings: Record<string, any> }>
  setExtensionEnabled: (id: string, enabled: boolean) => void
  setExtensionSettings: (id: string, settings: Record<string, any>) => void
  hydrateExtensionStates: (states: Record<string, { enabled: boolean; settings: Record<string, any> }>) => void

  // WebContentsId per browser tab (for extension injection)
  tabWcIds: Record<string, number>
  setTabWcId: (tabId: string, wcId: number) => void
  removeTabWcId: (tabId: string) => void
}

let tabN = 1

function loadExtStates(): Record<string, { enabled: boolean; settings: Record<string, any> }> {
  try { return JSON.parse(localStorage.getItem('aihub-extensions') || '{}') } catch { return {} }
}
function saveExtStates(s: Record<string, { enabled: boolean; settings: Record<string, any> }>) {
  try { localStorage.setItem('aihub-extensions', JSON.stringify(s)) } catch {}
  // Mirror to disk (main process) — survives storage clears and reinstalls.
  try { (window as any).electronAPI?.extStore?.save?.({ states: s }) } catch {}
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  bookmarks: [],
  setBookmarks: (bookmarks) => set({ bookmarks }),
  addBookmark: (b) => set(s => ({ bookmarks: [...s.bookmarks, b] })),
  removeBookmark: (id) => set(s => ({ bookmarks: s.bookmarks.filter(b => b.id !== id) })),

  tabs: [{ id: 'tab-1', url: 'home', title: 'New Tab', favicon: '', isLoading: false, isHome: true, pageType: 'browser' }],
  activeTabId: 'tab-1',

  addTab: (url = 'home', pageType = 'browser') => {
    const id = `tab-${++tabN}`
    const isHome = url === 'home' && pageType === 'browser'
    set(s => ({
      tabs: [...s.tabs, { id, url, title: isHome ? 'New Tab' : pageType !== 'browser' ? pageType.charAt(0).toUpperCase() + pageType.slice(1) : url, favicon: '', isLoading: false, isHome, pageType }],
      activeTabId: id,
      canGoBack: false,
      canGoForward: false,
    }))
    return id
  },

  closeTab: (id) => {
    const { tabs, activeTabId, tabWcIds } = get()
    const newWcIds = { ...tabWcIds }
    delete newWcIds[id]

    if (tabs.length === 1) {
      const newId = `tab-${++tabN}`
      set({ 
        tabs: [{ id: newId, url: 'home', title: 'New Tab', favicon: '', isLoading: false, isHome: true, pageType: 'browser' }], 
        activeTabId: newId, 
        canGoBack: false, 
        canGoForward: false,
        tabWcIds: {}
      })
      return
    }
    const idx = tabs.findIndex(t => t.id === id)
    const newTabs = tabs.filter(t => t.id !== id)
    const newActive = activeTabId === id ? newTabs[Math.max(0, idx - 1)].id : activeTabId
    set({ tabs: newTabs, activeTabId: newActive, tabWcIds: newWcIds })
  },

  closeOtherTabs: (id) => {
    const { tabs, tabWcIds } = get()
    const keep = tabs.find(t => t.id === id)
    if (!keep || tabs.length === 1) return
    const newWcIds: Record<string, number> = {}
    if (tabWcIds[id] != null) newWcIds[id] = tabWcIds[id]
    set({ tabs: [keep], activeTabId: id, tabWcIds: newWcIds, canGoBack: false, canGoForward: false })
  },

  closeTabsToRight: (id) => {
    const { tabs, activeTabId, tabWcIds } = get()
    const idx = tabs.findIndex(t => t.id === id)
    if (idx === -1 || idx === tabs.length - 1) return
    const kept = tabs.slice(0, idx + 1)
    const newWcIds = { ...tabWcIds }
    for (const t of tabs.slice(idx + 1)) delete newWcIds[t.id]
    const newActive = kept.some(t => t.id === activeTabId) ? activeTabId : id
    set({ tabs: kept, activeTabId: newActive, tabWcIds: newWcIds, canGoBack: false, canGoForward: false })
  },

  setActiveTab: (id) => {
    set(s => {
      const tab = s.tabs.find(t => t.id === id)
      return { activeTabId: id, canGoBack: false, canGoForward: false }
    })
  },

  updateTab: (id, u) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, ...u } : t) })),

  reorderTabs: (fromId, toId) => set(s => {
    const tabs = [...s.tabs]
    const fromIdx = tabs.findIndex(t => t.id === fromId)
    const toIdx   = tabs.findIndex(t => t.id === toId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return {}
    const [moved] = tabs.splice(fromIdx, 1)
    tabs.splice(toIdx, 0, moved)
    return { tabs }
  }),

  canGoBack: false,
  canGoForward: false,
  setNavState: (v) => set(v),

  isAIPanelOpen: false,
  toggleAIPanel: () => set(s => ({ isAIPanelOpen: !s.isAIPanelOpen })),

  isAddBookmarkOpen: false,
  setAddBookmarkOpen: (v) => set({ isAddBookmarkOpen: v }),

  isSidebarOpen: false,
  toggleSidebar: () => set(s => ({ isSidebarOpen: !s.isSidebarOpen })),

  isAnnotationMode: false,
  toggleAnnotationMode: () => set(s => ({ isAnnotationMode: !s.isAnnotationMode })),

  aiMessages: [],
  addAIMessage: (m) => set(s => ({ aiMessages: [...s.aiMessages, m] })),
  clearAIMessages: () => set({ aiMessages: [] }),
  setAIMessageStepStatus: (msgIndex, stepIndex, status) => set(s => {
    const messages = [...s.aiMessages]
    const msg = messages[msgIndex]
    if (!msg?.steps || !msg.steps[stepIndex]) return {}
    const steps = [...msg.steps]
    steps[stepIndex] = { ...steps[stepIndex], status }
    messages[msgIndex] = { ...msg, steps }
    return { aiMessages: messages }
  }),
  isAILoading: false,
  setAILoading: (v) => set({ isAILoading: v }),
  ollamaStatus: null,
  setOllamaStatus: (v) => set({ ollamaStatus: v }),

  downloads: [],
  setDownloads: (d) => set({ downloads: d }),
  upsertDownload: (d) => set(s => {
    const idx = s.downloads.findIndex(x => x.id === d.id)
    if (idx !== -1) { const arr = [...s.downloads]; arr[idx] = d; return { downloads: arr } }
    return { downloads: [d, ...s.downloads] }
  }),

  extensionStates: loadExtStates(),
  hydrateExtensionStates: (states) => {
    try { localStorage.setItem('aihub-extensions', JSON.stringify(states)) } catch {}
    set({ extensionStates: states })
  },
  setExtensionEnabled: (id, enabled) => set(s => {
    const updated = { ...s.extensionStates, [id]: { ...s.extensionStates[id], enabled, settings: s.extensionStates[id]?.settings || {} } }
    saveExtStates(updated)
    return { extensionStates: updated }
  }),
  setExtensionSettings: (id, settings) => set(s => {
    const updated = { ...s.extensionStates, [id]: { ...s.extensionStates[id], settings, enabled: s.extensionStates[id]?.enabled || false } }
    saveExtStates(updated)
    return { extensionStates: updated }
  }),

  tabWcIds: {},
  setTabWcId: (tabId, wcId) => set(s => ({ tabWcIds: { ...s.tabWcIds, [tabId]: wcId } })),
  removeTabWcId: (tabId) => set(s => { const m = { ...s.tabWcIds }; delete m[tabId]; return { tabWcIds: m } }),
}))
