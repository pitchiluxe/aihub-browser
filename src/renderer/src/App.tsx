import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useBrowserStore, type Tab } from './store/browserStore'
import TabBar from './components/browser/TabBar'
import NavigationBar from './components/browser/NavigationBar'
import Sidebar from './components/browser/Sidebar'
import HomePage from './components/homepage/HomePage'
import AIAssistant from './components/ai/AIAssistant'
import SettingsPage from './components/pages/SettingsPage'
import HistoryPage from './components/pages/HistoryPage'
import DownloadsPage from './components/pages/DownloadsPage'
import WifiPage from './components/pages/WifiPage'
import VpnPage from './components/pages/VpnPage'
import ResearchPage from './components/pages/ResearchPage'
import AgentsPage from './components/pages/AgentsPage'
import ExtensionsPage from './components/pages/ExtensionsPage'
import { EXTENSION_DEFS } from './extensions/extensionDefs'
import AddBookmarkModal from './components/homepage/AddBookmarkModal'
import AnnotationCanvas from './components/browser/AnnotationCanvas'
import { loadBookmarks } from './services/bookmarkService'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: HTMLWebViewElement
    }
  }
  interface Window {
    electronAPI: any
  }
}
export default function App() {
  const {
    tabs, activeTabId, updateTab, setActiveTab,
    canGoBack, canGoForward, setNavState,
    isAIPanelOpen, addTab, setBookmarks,
    isAnnotationMode,
  } = useBrowserStore()

  // Map of tabId → actual webview HTMLElement
  const webviewMap = useRef<Map<string, HTMLElement>>(new Map())

  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeWv = activeTabId ? (webviewMap.current.get(activeTabId) as any) : null

  // ── Nav actions ──────────────────────────────────────────
  const goBack    = useCallback(() => { try { activeWv?.goBack() } catch {} }, [activeWv])
  const goForward = useCallback(() => { try { activeWv?.goForward() } catch {} }, [activeWv])
  const reload    = useCallback(() => { try { activeWv?.reload() } catch {} }, [activeWv])

  // Live canGoBack check — reads directly from the webview, never stale
  const liveCanGoBack = useCallback((): boolean => {
    if (!activeTabId) return false
    const wv = webviewMap.current.get(activeTabId) as any
    try { return wv?.canGoBack?.() ?? false } catch { return false }
  }, [activeTabId])

  // ── Navigate to URL ──────────────────────────────────────
  const navigate = useCallback((url: string) => {
    if (!activeTabId) return

    if (url === 'home') {
      updateTab(activeTabId, { url: 'home', title: 'New Tab', isHome: true, isLoading: false, pageType: 'browser', fromHome: false })
      setNavState({ canGoBack: false, canGoForward: false })
      return
    }

    // Internal aihub:// pages (research, agents, extensions, history, etc.)
    if (url.startsWith('aihub://')) {
      const pageType = url.replace('aihub://', '') as Tab['pageType']
      const { addTab: storeAddTab } = useBrowserStore.getState()
      storeAddTab(`aihub://${pageType}`, pageType)
      return
    }

    let finalUrl = url.trim()
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`
    }

    // Remember if we came from the home page so the back button can return there
    const wasHome = useBrowserStore.getState().tabs.find(t => t.id === activeTabId)?.isHome ?? false

    // Set a readable title immediately (hostname) while the page loads —
    // avoids the tab staying as "New Tab" the whole time.
    let tempTitle = finalUrl
    try { tempTitle = new URL(finalUrl).hostname.replace(/^www\./, '') } catch {}

    updateTab(activeTabId, { url: finalUrl, title: tempTitle, isHome: false, isLoading: true, pageType: 'browser', fromHome: wasHome })
    setNavState({ canGoBack: false, canGoForward: false })

    // If webview already exists (tab was already in browser mode), navigate directly.
    // If not, the webview will mount fresh and did-attach will call loadURL.
    const wv = webviewMap.current.get(activeTabId) as any
    if (wv?.loadURL) {
      try { wv.loadURL(finalUrl) } catch {}
    }
  }, [activeTabId, updateTab, setNavState])

  // ── Open special pages ───────────────────────────────────
  const openSpecialPage = useCallback((pageType: 'settings' | 'history' | 'downloads' | 'wifi' | 'vpn' | 'research' | 'agents' | 'extensions') => {
    const { addTab } = useBrowserStore.getState()
    addTab(`aihub://${pageType}`, pageType)
  }, [])

  // Extracts visible text from the active webview for AI context attachment
  const getPageContent = useCallback(async (): Promise<string> => {
    if (!activeTabId) return ''
    const wv = webviewMap.current.get(activeTabId) as any
    if (!wv?.executeJavaScript) return ''
    try {
      const text: string = await wv.executeJavaScript(
        `(function(){var s=document.body.innerText||document.body.textContent||'';return s.slice(0,8000);})()`
      )
      return text.trim()
    } catch { return '' }
  }, [activeTabId])

  // ── Wire webview events when active tab changes ──────────
  useEffect(() => {
    if (!activeTabId) return
    const tab = tabs.find(t => t.id === activeTabId)
    if (!tab || tab.isHome || tab.pageType !== 'browser') {
      setNavState({ canGoBack: false, canGoForward: false })
      return
    }

    const wv = webviewMap.current.get(activeTabId) as any
    if (!wv) return

    const updateNav = () => {
      try {
        setNavState({ canGoBack: wv.canGoBack?.() ?? false, canGoForward: wv.canGoForward?.() ?? false })
      } catch {}
    }

    // Debounce isLoading so brief Google ?zx= redirects don't cause the loading
    // indicator to flash. Only show loading if it persists > 250ms.
    let loadingTimer: ReturnType<typeof setTimeout> | null = null
    const onLoadStart = () => {
      loadingTimer = setTimeout(() => updateTab(activeTabId, { isLoading: true }), 250)
    }
    const onLoadStop = () => {
      if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null }
      updateTab(activeTabId, { isLoading: false })
      try {
        const title   = wv.getTitle?.() || tab.url
        const url     = wv.getURL?.() || tab.url
        const favicon = `https://www.google.com/s2/favicons?domain=${url}&sz=32`
        updateTab(activeTabId, { title, url, favicon, isLoading: false })
        // Save to history
        window.electronAPI?.history?.add({ url, title, favicon })
      } catch {}
      updateNav()
    }
    const onTitleUpdate   = (e: any) => updateTab(activeTabId, { title: e.title || tab.url })
    const onFaviconUpdate = (e: any) => { if (e.favicons?.[0]) updateTab(activeTabId, { favicon: e.favicons[0] }) }
    // Filter in-page navigation that only changes ephemeral query params (e.g. Google's ?zx=)
    // so we don't thrash the URL bar or trigger re-renders needlessly.
    const onNavigate = (e: any) => {
      const newUrl = e.url || tab.url
      try {
        const cur = new URL(useBrowserStore.getState().tabs.find(t => t.id === activeTabId)?.url || '')
        const nxt = new URL(newUrl)
        // Skip update if only ephemeral query params changed on the same page
        if (cur.hostname === nxt.hostname && cur.pathname === nxt.pathname) {
          const curZx = cur.searchParams.get('zx') || cur.searchParams.get('ved')
          const nxtZx = nxt.searchParams.get('zx') || nxt.searchParams.get('ved')
          if (curZx !== null || nxtZx !== null) return
        }
      } catch {}
      updateTab(activeTabId, { url: newUrl })
      updateNav()
    }

    wv.addEventListener('did-start-loading',     onLoadStart)
    wv.addEventListener('did-stop-loading',      onLoadStop)
    wv.addEventListener('page-title-updated',    onTitleUpdate)
    wv.addEventListener('page-favicon-updated',  onFaviconUpdate)
    wv.addEventListener('did-navigate',          onNavigate)
    wv.addEventListener('did-navigate-in-page',  onNavigate)

    return () => {
      if (loadingTimer) clearTimeout(loadingTimer)
      wv.removeEventListener('did-start-loading',    onLoadStart)
      wv.removeEventListener('did-stop-loading',     onLoadStop)
      wv.removeEventListener('page-title-updated',   onTitleUpdate)
      wv.removeEventListener('page-favicon-updated', onFaviconUpdate)
      wv.removeEventListener('did-navigate',         onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigate)
    }
  }, [activeTabId])

  // ── Load bookmarks on mount ──────────────────────────────
  useEffect(() => {
    loadBookmarks().then(setBookmarks)
  }, [])

  // ── Apply glass-mode CSS class based on transparency setting ─────────
  useEffect(() => {
    const applyMode = (mode: string) => {
      document.body.classList.toggle('glass-mode', mode !== 'none')
    }
    // Read initial setting
    window.electronAPI.settings.get().then((s: any) => applyMode(s.transparency || 'none'))
    // Live updates when user changes it in Settings
    const off = window.electronAPI.theme?.onTransparency?.(applyMode)
    return () => { try { off?.() } catch {} }
  }, [])

  // ── Apply light/dark theme ─────────────────────────────────────────
  useEffect(() => {
    const applyTheme = (theme: string) => {
      document.body.classList.toggle('light-mode', theme === 'light')
    }
    window.electronAPI.settings.get().then((s: any) => applyTheme(s.theme || 'dark'))
    const handler = (e: Event) => {
      applyTheme((e as CustomEvent).detail)
    }
    document.addEventListener('aihub-theme-change', handler)
    return () => document.removeEventListener('aihub-theme-change', handler)
  }, [])

  // ── IPC: main process requests a new tab (e.g. window.open from shell) ──
  useEffect(() => {
    const off = window.electronAPI?.ipc?.on?.('open-in-new-tab', (_e: any, url: string) => {
      if (url) useBrowserStore.getState().addTab(url, 'browser')
    })
    return () => { try { off?.() } catch {} }
  }, [])

  const currentUrl   = activeTab?.isHome ? undefined : activeTab?.url
  const currentTitle = activeTab?.title

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none"
      style={{ background: 'linear-gradient(180deg, rgb(23,24,43) 0%, rgb(19,20,38) 100%)' }}>
      {/* Tab bar — draggable title bar + tabs */}
      <div className="drag-region">
        <TabBar />
      </div>

      {/* Navigation bar */}
      <NavigationBar
        onNavigate={navigate}
        onHome={() => navigate('home')}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        liveCanGoBack={liveCanGoBack}
      />

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <Sidebar onNavigate={navigate} onOpenPage={openSpecialPage} />

        {/* Content */}
        <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
          <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
            {/* Home pages */}
            {tabs.map(tab => (
              tab.isHome && tab.pageType === 'browser' && (
                <div key={`home-${tab.id}`} className="absolute inset-0"
                  style={{ display: tab.id === activeTabId ? 'block' : 'none' }}>
                  <HomePage onNavigate={navigate} />
                </div>
              )
            ))}

            {/* Special pages */}
            {tabs.map(tab => (
              tab.pageType && tab.pageType !== 'browser' && (
                <div key={`page-${tab.id}`} className="absolute inset-0 overflow-auto"
                  style={{ display: tab.id === activeTabId ? 'block' : 'none' }}>
                  {tab.pageType === 'settings'  && <SettingsPage />}
                  {tab.pageType === 'history'   && <HistoryPage onNavigate={navigate} />}
                  {tab.pageType === 'downloads' && <DownloadsPage />}
                  {tab.pageType === 'wifi'      && <WifiPage />}
                  {tab.pageType === 'vpn'       && <VpnPage />}
                  {tab.pageType === 'research'    && <ResearchPage onNavigate={navigate} />}
                  {tab.pageType === 'agents'      && <AgentsPage />}
                  {tab.pageType === 'extensions'  && <ExtensionsPage />}
                </div>
              )
            ))}

            {/* Webviews */}
            {tabs.filter(t => !t.isHome && t.pageType === 'browser').map(tab => (
              <div key={`wv-${tab.id}`} className="flex-1 h-full"
                style={{ display: tab.id === activeTabId ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
                <webview
                  ref={el => {
                    if (el) {
                      webviewMap.current.set(tab.id, el)
                      const wv = el as any
                      const tid = tab.id

                      // ── new-window → open as in-app tab ──────────────────
                      if (!wv.__newWindowHandled) {
                        wv.__newWindowHandled = true
                        wv.addEventListener('new-window', (e: any) => {
                          e.preventDefault()
                          const url: string = e.url || ''
                          if (url && !url.startsWith('devtools://') && !url.startsWith('chrome-extension://')) {
                            useBrowserStore.getState().addTab(url, 'browser')
                          }
                        })
                      }

                      // ── spinner + title + favicon safety-nets ────────────
                      if (!wv.__metaHandled) {
                        wv.__metaHandled = true

                        const clearSpinner = () => {
                          useBrowserStore.getState().updateTab(tid, { isLoading: false })
                        }
                        wv.addEventListener('did-stop-loading', clearSpinner)
                        wv.addEventListener('did-fail-load',    clearSpinner)

                        wv.addEventListener('page-title-updated', (e: any) => {
                          if (e.title) useBrowserStore.getState().updateTab(tid, { title: e.title })
                        })

                        wv.addEventListener('page-favicon-updated', (e: any) => {
                          const fav = e.favicons?.[0]
                          if (fav) useBrowserStore.getState().updateTab(tid, { favicon: fav })
                        })

                        wv.addEventListener('did-stop-loading', () => {
                          try {
                            const title = (wv as any).getTitle?.()
                            const url   = (wv as any).getURL?.()
                            if (title) useBrowserStore.getState().updateTab(tid, { title })
                            if (url)   useBrowserStore.getState().updateTab(tid, { url })

                            const wcId: number | undefined = (wv as any).getWebContentsId?.()
                            if (wcId) useBrowserStore.getState().setTabWcId(tid, wcId)

                            const { extensionStates } = useBrowserStore.getState()
                            EXTENSION_DEFS.forEach(ext => {
                              const state = extensionStates[ext.id]
                              if (state?.enabled) {
                                const script = ext.inject(state.settings || {})
                                window.electronAPI?.webview?.execScript?.(wcId, script)?.catch?.(() => {})
                              }
                            })
                          } catch {}
                        })
                      }
                    } else {
                      webviewMap.current.delete(tab.id)
                    }
                  }}
                  src={tab.url && tab.url !== 'home' ? tab.url : 'about:blank'}
                  style={{ width: '100%', flex: 1, display: 'block', height: '100%' }}
                  allowpopups={true}
                  partition="persist:main"
                  webpreferences="contextIsolation=true,webSecurity=no"
                />
              </div>
            ))}

            {/* Annotation toolbar — canvas is injected into the webview page */}
            {isAnnotationMode && <AnnotationCanvas webview={activeTabId ? (webviewMap.current.get(activeTabId) as any) ?? null : null} />}
          </div>

          {/* AI panel */}
          <AIAssistant currentUrl={currentUrl} currentTitle={currentTitle} getPageContent={getPageContent} />
        </div>
      </div>

      {/* Bookmark modal (global) */}
      <AddBookmarkModal />

      {/* Footer clock — bottom-right corner */}
      <FooterClock />
    </div>
  )
}

function FooterClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div style={{
      position: 'fixed', bottom: 10, right: 14,
      zIndex: 180, pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1,
    }}>
      <span style={{
        fontSize: 13, fontWeight: 600, letterSpacing: '0.03em',
        color: 'rgba(159,132,255,0.90)',
        textShadow: '0 0 12px rgba(107,78,255,0.50)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {time}
      </span>
      <span style={{
        fontSize: 9.5, fontWeight: 500, letterSpacing: '0.04em',
        color: 'rgba(96,102,130,0.70)',
        textTransform: 'uppercase',
      }}>
        {date}
      </span>
    </div>
  )
}
