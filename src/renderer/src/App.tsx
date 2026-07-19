import React, { Suspense, lazy, useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore, type Tab } from './store/browserStore'
import TabBar from './components/browser/TabBar'
import NavigationBar from './components/browser/NavigationBar'
import Sidebar from './components/browser/Sidebar'
import HomePage from './components/homepage/HomePage'
import { EXTENSION_DEFS } from './extensions/extensionDefs'

// Special pages are code-split — none are needed at startup, so keeping them
// out of the entry chunk makes first paint faster.
const SettingsPage   = lazy(() => import('./components/pages/SettingsPage'))
const HistoryPage    = lazy(() => import('./components/pages/HistoryPage'))
const DownloadsPage  = lazy(() => import('./components/pages/DownloadsPage'))
const WifiPage       = lazy(() => import('./components/pages/WifiPage'))
const VpnPage        = lazy(() => import('./components/pages/VpnPage'))
const ResearchPage   = lazy(() => import('./components/pages/ResearchPage'))
const AgentsPage     = lazy(() => import('./components/pages/AgentsPage'))
const ExtensionsPage = lazy(() => import('./components/pages/ExtensionsPage'))
const MailPage       = lazy(() => import('./components/pages/MailPage'))
import AddBookmarkModal from './components/homepage/AddBookmarkModal'
import QRCodeModal from './components/browser/QRCodeModal'
import UpdateNotification from './components/browser/UpdateNotification'
import AnnotationCanvas from './components/browser/AnnotationCanvas'
import AIAssistant from './components/ai/AIAssistant'
import { loadBookmarks } from './services/bookmarkService'
import { buildPageExtractionScript } from './services/pageExtractor'
import { loadCustomExts } from './extensions/customExts'
import { applyThemeToDom } from './services/themeService'

declare global {
  interface Window {
    electronAPI: any
  }
}

// A tab needs a native tab content view when it has left the home screen and
// isn't one of the special aihub:// pages.
function needsTabView(tab: Tab | undefined): boolean {
  return !!tab && !tab.isHome && tab.pageType === 'browser'
}

export default function App() {
  // Narrow subscription — App is the root; re-rendering it on every store
  // mutation (AI streaming chunks, download ticks) cascaded through the tree.
  const {
    tabs, activeTabId, updateTab,
    canGoBack, canGoForward, setNavState, setBookmarks,
    isAnnotationMode, isAddBookmarkOpen, isAIPanelOpen,
  } = useBrowserStore(useShallow(s => ({
    tabs: s.tabs, activeTabId: s.activeTabId, updateTab: s.updateTab,
    canGoBack: s.canGoBack, canGoForward: s.canGoForward, setNavState: s.setNavState, setBookmarks: s.setBookmarks,
    isAnnotationMode: s.isAnnotationMode, isAddBookmarkOpen: s.isAddBookmarkOpen, isAIPanelOpen: s.isAIPanelOpen,
  })))

  const activeTab = tabs.find(t => t.id === activeTabId)
  const currentUrl   = activeTab?.isHome ? undefined : activeTab?.url
  const currentTitle = activeTab?.title

  // Tab ids for which we've already called tabView.create() in the main process.
  const createdViewIds = useRef<Set<string>>(new Set())
  // Per-tab "just started loading" debounce timers, so a fast navigation
  // doesn't flash the loading spinner.
  const loadTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const contentAreaRef = useRef<HTMLDivElement>(null)

  // URL for the "Create QR Code" page context-menu action (null = modal closed)
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  // ── Nav actions — the tab's WebContents lives in the main process now, so
  // these are fire-and-forget IPC calls rather than direct method calls. ────
  const goBack = useCallback(() => {
    if (activeTabId) window.electronAPI.tabView.goBack(activeTabId)
  }, [activeTabId])
  const goForward = useCallback(() => {
    if (activeTabId) window.electronAPI.tabView.goForward(activeTabId)
  }, [activeTabId])
  const reload = useCallback(() => {
    if (activeTabId) window.electronAPI.tabView.reload(activeTabId)
  }, [activeTabId])

  // ── Navigate ───────────────────────────────────────────────────────────────
  const navigate = useCallback((url: string) => {
    if (!activeTabId) return

    if (url === 'home') {
      updateTab(activeTabId, { url: 'home', title: 'New Tab', isHome: true, isLoading: false, pageType: 'browser', fromHome: false })
      setNavState({ canGoBack: false, canGoForward: false })
      return
    }

    if (url.startsWith('aihub://')) {
      const pageType = url.replace('aihub://', '') as Tab['pageType']
      useBrowserStore.getState().addTab(`aihub://${pageType}`, pageType)
      return
    }

    let finalUrl = url.trim()
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`
    }

    const wasHome = useBrowserStore.getState().tabs.find(t => t.id === activeTabId)?.isHome ?? false
    let tempTitle = finalUrl
    try { tempTitle = new URL(finalUrl).hostname.replace(/^www\./, '') } catch {}

    updateTab(activeTabId, { url: finalUrl, title: tempTitle, isHome: false, isLoading: true, pageType: 'browser', fromHome: wasHome })
    setNavState({ canGoBack: false, canGoForward: false })

    // If a view already exists for this tab, drive it directly. Otherwise the
    // tab-lifecycle effect below will create it with this URL once state settles.
    if (createdViewIds.current.has(activeTabId)) {
      window.electronAPI.tabView.navigate(activeTabId, finalUrl)
    }
  }, [activeTabId, updateTab, setNavState])

  // ── Special pages ──────────────────────────────────────────────────────────
  const openSpecialPage = useCallback((pageType: 'settings' | 'history' | 'downloads' | 'wifi' | 'vpn' | 'research' | 'agents' | 'extensions' | 'mail') => {
    useBrowserStore.getState().addTab(`aihub://${pageType}`, pageType)
  }, [])

  // ── Page content for AI assistant — runs in the tab's BrowserView via IPC ──
  const getPageContent = useCallback(async (): Promise<string> => {
    if (!activeTabId) return ''
    const wcId = useBrowserStore.getState().tabWcIds[activeTabId]
    if (!wcId) return ''
    try {
      const res = await window.electronAPI.webview.execScript(wcId, buildPageExtractionScript())
      return res?.ok ? String(res.result || '').trim() : ''
    } catch { return '' }
  }, [activeTabId])

  // ── Bookmarks + theme + IPC ────────────────────────────────────────────────
  useEffect(() => { loadBookmarks().then(setBookmarks) }, [])

  // ── Extension re-hydration — if renderer storage was cleared (cache clear,
  // profile wipe), restore custom extensions + toggle states from the disk
  // mirror so installed extensions survive restarts until the user deletes
  // them. Disk only fills gaps; live localStorage stays authoritative. ──────
  useEffect(() => {
    ;(async () => {
      try {
        const disk = await window.electronAPI.extStore?.load?.()
        if (!disk) return
        const localExts = loadCustomExts()
        if (Array.isArray(disk.customExts) && disk.customExts.length > 0 && localExts.length === 0) {
          localStorage.setItem('aihub-custom-exts', JSON.stringify(disk.customExts))
        } else if (localExts.length > 0 && (!disk.customExts || disk.customExts.length === 0)) {
          // Backfill: extensions created before the disk mirror existed live
          // only in localStorage — push them to disk now, not on next save.
          window.electronAPI.extStore?.save?.({ customExts: localExts })
        }
        const localStates = localStorage.getItem('aihub-extensions')
        if (disk.states && Object.keys(disk.states).length > 0 && !localStates) {
          useBrowserStore.getState().hydrateExtensionStates(disk.states)
        }
        // Custom themes: same restore/backfill dance, then re-apply the saved
        // theme — it may BE one of these customs, unresolvable until now.
        const localThemes = JSON.parse(localStorage.getItem('aihub-custom-themes') || '[]')
        if (Array.isArray(disk.customThemes) && disk.customThemes.length > 0 && localThemes.length === 0) {
          localStorage.setItem('aihub-custom-themes', JSON.stringify(disk.customThemes))
          const s = await window.electronAPI.settings.get()
          applyThemeToDom(s.theme || 'dark')
        } else if (localThemes.length > 0 && (!disk.customThemes || disk.customThemes.length === 0)) {
          window.electronAPI.extStore?.save?.({ customThemes: localThemes })
        }
        // Custom window styles: same restore/backfill dance as themes.
        const localWinStyles = JSON.parse(localStorage.getItem('aihub-custom-window-styles') || '[]')
        if (Array.isArray(disk.customWindowStyles) && disk.customWindowStyles.length > 0 && localWinStyles.length === 0) {
          localStorage.setItem('aihub-custom-window-styles', JSON.stringify(disk.customWindowStyles))
        } else if (localWinStyles.length > 0 && (!disk.customWindowStyles || disk.customWindowStyles.length === 0)) {
          window.electronAPI.extStore?.save?.({ customWindowStyles: localWinStyles })
        }
      } catch { /* mirror unavailable — localStorage path still works */ }
    })()
  }, [])

  useEffect(() => {
    const applyMode = (mode: string) => document.body.classList.toggle('glass-mode', mode !== 'none')
    window.electronAPI.settings.get().then((s: any) => {
      applyMode(s.transparency || 'none')
      document.body.dataset.glass = s.glassIntensity || 'medium'
    })
    const off = window.electronAPI.theme?.onTransparency?.(applyMode)
    return () => { try { off?.() } catch {} }
  }, [])

  useEffect(() => {
    window.electronAPI.settings.get().then((s: any) => applyThemeToDom(s.theme || 'dark'))
    const handler = (e: Event) => applyThemeToDom((e as CustomEvent).detail)
    document.addEventListener('aihub-theme-change', handler)
    return () => document.removeEventListener('aihub-theme-change', handler)
  }, [])

  useEffect(() => {
    const off = window.electronAPI?.ipc?.on?.('open-in-new-tab', (_e: any, url: string) => {
      if (url) useBrowserStore.getState().addTab(url, 'browser')
    })
    return () => { try { off?.() } catch {} }
  }, [])

  // ── Page right-click menu actions forwarded from the main process ─────────
  // (AI / Research / Agent / Annotation / Sphere / Add to Sphere / QR). The
  // native menu is built in main; app-feature items are dispatched here.
  useEffect(() => {
    const off = window.electronAPI?.ipc?.on?.('page-context-action', (_e: any, data: { action: string; url?: string; selection?: string }) => {
      const store = useBrowserStore.getState()
      switch (data.action) {
        case 'ai':
          if (!store.isAIPanelOpen) store.toggleAIPanel()
          if (data.selection) {
            document.dispatchEvent(new CustomEvent('aihub-ai-prefill', { detail: data.selection }))
          }
          break
        case 'annotation':
          if (!store.isAnnotationMode) store.toggleAnnotationMode()
          break
        case 'research':
          store.addTab('aihub://research', 'research')
          break
        case 'agent':
          store.addTab('aihub://agents', 'agents')
          break
        case 'sphere':
          store.addTab('home', 'browser')
          break
        case 'add-to-sphere':
          store.setBookmarkPrefill(data.url || '')
          store.setAddBookmarkOpen(true)
          break
        case 'qr':
          if (data.url) setQrUrl(data.url)
          break
      }
    })
    return () => { try { off?.() } catch {} }
  }, [])

  // ── Browser keyboard shortcuts, forwarded from main (work even while a
  // BrowserView page has focus): Ctrl+T/W, Ctrl+Tab, Ctrl+L, Ctrl+R ────────
  useEffect(() => {
    const off = window.electronAPI?.ipc?.on?.('app-shortcut', (_e: any, action: string) => {
      const store = useBrowserStore.getState()
      switch (action) {
        case 'new-tab':
          store.addTab()
          break
        case 'close-tab':
          if (store.activeTabId) store.closeTab(store.activeTabId)
          break
        case 'next-tab':
        case 'prev-tab': {
          const { tabs: t, activeTabId: cur } = store
          const idx = t.findIndex(tb => tb.id === cur)
          if (idx === -1 || t.length < 2) break
          const next = action === 'next-tab' ? (idx + 1) % t.length : (idx - 1 + t.length) % t.length
          store.setActiveTab(t[next].id)
          break
        }
        case 'focus-url':
          document.dispatchEvent(new CustomEvent('aihub-focus-url'))
          break
        case 'reload-tab': {
          const id = store.activeTabId
          const tab = store.tabs.find(tb => tb.id === id)
          if (id && tab && !tab.isHome && tab.pageType === 'browser') {
            window.electronAPI.tabView.reload(id)
          }
          break
        }
      }
    })
    return () => { try { off?.() } catch {} }
  }, [])

  // ── Measure content area → tell main where to position the active tab's
  // native view. Position/size are in window client coordinates, which match
  // viewport coordinates 1:1 since the window is frameless (frame: false).
  // The native view always paints above our HTML, so the docked AI panel
  // would be invisible behind it unless we carve out a gutter for it here.
  // The annotation toolbar doesn't need this — it's injected into the page
  // itself (see AnnotationCanvas.tsx), not rendered as host HTML. ──────────
  useLayoutEffect(() => {
    const rightReserve = isAIPanelOpen ? 388 : 0
    const sync = () => {
      if (!contentAreaRef.current) return
      const r = contentAreaRef.current.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        window.electronAPI.tabView.setBounds({
          x: r.left, y: r.top,
          width: Math.max(0, r.width - rightReserve), height: r.height,
        })
      }
    }
    sync()
    requestAnimationFrame(sync)
    window.addEventListener('resize', sync)
    const ro = new ResizeObserver(sync)
    if (contentAreaRef.current) ro.observe(contentAreaRef.current)
    return () => { window.removeEventListener('resize', sync); ro.disconnect() }
  }, [isAIPanelOpen])

  // ── Create/destroy native tab views as tabs come and go ───────────────────
  useEffect(() => {
    const known = createdViewIds.current
    const qualifying = new Set<string>()
    tabs.forEach(t => {
      if (needsTabView(t)) {
        qualifying.add(t.id)
        if (!known.has(t.id)) {
          known.add(t.id)
          window.electronAPI.tabView.create(t.id, t.url)
        }
      }
    })
    known.forEach(id => {
      if (!qualifying.has(id)) {
        known.delete(id)
        window.electronAPI.tabView.destroy(id)
        useBrowserStore.getState().removeTabWcId(id)
        const timer = loadTimers.current.get(id)
        if (timer) { clearTimeout(timer); loadTimers.current.delete(id) }
      }
    })
  }, [tabs])

  // ── Show/hide the active tab's native view + refresh its nav state ────────
  useEffect(() => {
    const show = needsTabView(activeTab)
    window.electronAPI.tabView.setActive(show ? activeTabId : null)
    if (show && activeTabId) {
      window.electronAPI.tabView.getNavState(activeTabId)
        .then((s: { canGoBack: boolean; canGoForward: boolean }) => setNavState(s))
        .catch(() => {})
    } else {
      setNavState({ canGoBack: false, canGoForward: false })
    }
  }, [activeTabId, activeTab?.isHome, activeTab?.pageType, setNavState])

  // ── Hide the native view while a host HTML overlay must render above it —
  // BrowserView always paints above the window's own webContents, so there's
  // no CSS z-index that can put AddBookmarkModal in front of it. The docked
  // AI panel doesn't need this — it gets a permanent side gutter instead
  // (see the bounds effect above). ──────────────────────────────────────────
  useEffect(() => {
    // Any host-HTML overlay (Add-to-Sphere modal, QR modal) must detach the
    // active tab's BrowserView, which otherwise always paints on top of and
    // steals clicks from our HTML — making the modal look frozen/invisible.
    window.electronAPI.tabView.setOverlayHidden(isAddBookmarkOpen || !!qrUrl)
  }, [isAddBookmarkOpen, qrUrl])

  // ── Single listener for all tab content events, forwarded from main ───────
  useEffect(() => {
    const off = window.electronAPI.tabView.onEvent((tabId: string, type: string, payload: any) => {
      const store = useBrowserStore.getState()

      switch (type) {
        case 'wc-id':
          store.setTabWcId(tabId, payload.wcId)
          break

        case 'did-start-loading': {
          const existing = loadTimers.current.get(tabId)
          if (existing) clearTimeout(existing)
          loadTimers.current.set(tabId, setTimeout(() => {
            useBrowserStore.getState().updateTab(tabId, { isLoading: true })
          }, 200))
          break
        }

        case 'did-fail-load': {
          const t = loadTimers.current.get(tabId)
          if (t) { clearTimeout(t); loadTimers.current.delete(tabId) }
          store.updateTab(tabId, { isLoading: false })
          break
        }

        case 'did-navigate': {
          const t = loadTimers.current.get(tabId)
          if (t) { clearTimeout(t); loadTimers.current.delete(tabId) }
          const url = payload.url
          if (!url || url === 'about:blank') break
          store.updateTab(tabId, { url })
          if (tabId === store.activeTabId) {
            window.electronAPI.tabView.getNavState(tabId).then((s: any) => store.setNavState(s)).catch(() => {})
          }
          break
        }

        case 'did-navigate-in-page': {
          const newUrl = payload.url
          if (!newUrl) break
          try {
            const curUrl = store.tabs.find(t => t.id === tabId)?.url || ''
            const cur = new URL(curUrl)
            const nxt = new URL(newUrl)
            if (cur.hostname === nxt.hostname && cur.pathname === nxt.pathname) {
              const curNoise = cur.searchParams.get('zx') || cur.searchParams.get('ved')
              const nxtNoise = nxt.searchParams.get('zx') || nxt.searchParams.get('ved')
              if (curNoise !== null || nxtNoise !== null) break
            }
          } catch {}
          store.updateTab(tabId, { url: newUrl })
          if (tabId === store.activeTabId) {
            window.electronAPI.tabView.getNavState(tabId).then((s: any) => store.setNavState(s)).catch(() => {})
          }
          break
        }

        case 'page-title-updated':
          if (payload.title) store.updateTab(tabId, { title: payload.title })
          break

        case 'page-favicon-updated': {
          const fav = payload.favicons?.[0]
          if (fav) store.updateTab(tabId, { favicon: fav })
          break
        }

        case 'did-stop-loading': {
          const t = loadTimers.current.get(tabId)
          if (t) { clearTimeout(t); loadTimers.current.delete(tabId) }

          const { title, url } = payload
          const favicon = url ? `https://www.google.com/s2/favicons?domain=${url}&sz=32` : ''
          if (title) store.updateTab(tabId, { title })
          if (url)   store.updateTab(tabId, { url, isLoading: false })
          if (favicon) store.updateTab(tabId, { favicon })
          if (url && url !== 'about:blank') {
            window.electronAPI?.history?.add({ url, title: title || url, favicon })
          }

          const wcId = store.tabWcIds[tabId]
          if (wcId) {
            const { extensionStates } = store
            EXTENSION_DEFS.forEach(ext => {
              const state = extensionStates[ext.id]
              if (state?.enabled) {
                const script = ext.inject(state.settings || {})
                window.electronAPI?.webview?.execScript?.(wcId, script)?.catch?.(() => {})
              }
            })
            loadCustomExts().forEach(ext => {
              if (extensionStates[ext.id]?.enabled) {
                window.electronAPI?.webview?.execScript?.(wcId, ext.injectCode)?.catch?.(() => {})
              }
            })
          }

          if (tabId === store.activeTabId) {
            window.electronAPI.tabView.getNavState(tabId).then((s: any) => store.setNavState(s)).catch(() => {})
          }
          break
        }
      }
    })
    return () => { try { off?.() } catch {} }
  }, [])

  return (
    <div className="ds-app-root flex flex-col h-screen w-screen overflow-hidden select-none">
      <div className="drag-region">
        <TabBar />
      </div>

      <NavigationBar
        onNavigate={navigate}
        onHome={() => navigate('home')}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar onNavigate={navigate} onOpenPage={openSpecialPage} />

        <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
          <div ref={contentAreaRef} className="relative flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">

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
                  <Suspense fallback={null}>
                    {tab.pageType === 'settings'   && <SettingsPage />}
                    {tab.pageType === 'history'    && <HistoryPage onNavigate={navigate} />}
                    {tab.pageType === 'downloads'  && <DownloadsPage />}
                    {tab.pageType === 'wifi'       && <WifiPage />}
                    {tab.pageType === 'vpn'        && <VpnPage />}
                    {tab.pageType === 'research'   && <ResearchPage onNavigate={navigate} />}
                    {tab.pageType === 'agents'     && <AgentsPage />}
                    {tab.pageType === 'extensions' && <ExtensionsPage />}
                    {tab.pageType === 'mail'       && <MailPage />}
                  </Suspense>
                </div>
              )
            ))}

            {/* Browser tab content renders in a main-process BrowserView layered
                directly over this element's screen bounds (see the bounds-sync
                effect above) — there is no DOM node for it here. */}

            {isAnnotationMode && <AnnotationCanvas />}
          </div>

          <AIAssistant currentUrl={currentUrl} currentTitle={currentTitle} getPageContent={getPageContent} />
        </div>
      </div>

      <AddBookmarkModal />
      <QRCodeModal url={qrUrl} onClose={() => setQrUrl(null)} />
      <UpdateNotification />
    </div>
  )
}
