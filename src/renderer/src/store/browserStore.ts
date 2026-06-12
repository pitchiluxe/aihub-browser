import { create } from 'zustand'

export interface Bookmark { id: string; url: string; title: string; favicon: string; category: string; addedAt: number; color: string }
export interface Tab { id: string; url: string; title: string; favicon: string; isLoading: boolean; isHome: boolean; fromHome?: boolean; pageType?: 'browser'|'settings'|'history'|'downloads'|'wifi' }
export interface AIMessage { role: 'user'|'assistant'|'system'; content: string }
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
  addTab: (url?: string, pageType?: Tab['pageType']) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, u: Partial<Tab>) => void

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
  isAILoading: boolean
  setAILoading: (v: boolean) => void
  ollamaStatus: { running: boolean; models: string[] } | null
  setOllamaStatus: (v: { running: boolean; models: string[] }) => void

  // Downloads live updates
  downloads: DownloadItem[]
  setDownloads: (d: DownloadItem[]) => void
  upsertDownload: (d: DownloadItem) => void
}

let tabN = 1

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
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    if (tabs.length === 1) {
      const newId = `tab-${++tabN}`
      set({ tabs: [{ id: newId, url: 'home', title: 'New Tab', favicon: '', isLoading: false, isHome: true, pageType: 'browser' }], activeTabId: newId, canGoBack: false, canGoForward: false })
      return
    }
    const idx = tabs.findIndex(t => t.id === id)
    const newTabs = tabs.filter(t => t.id !== id)
    const newActive = activeTabId === id ? newTabs[Math.max(0, idx - 1)].id : activeTabId
    set({ tabs: newTabs, activeTabId: newActive })
  },

  setActiveTab: (id) => {
    set(s => {
      const tab = s.tabs.find(t => t.id === id)
      return { activeTabId: id, canGoBack: false, canGoForward: false }
    })
  },

  updateTab: (id, u) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, ...u } : t) })),

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
}))
