import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft, ChevronRight, RotateCw, Home, Bookmark, Bot,
  Lock, AlertTriangle, PanelLeft, Pencil, Search, Globe, Camera, Video, Square, X,
  Crop, Monitor, BookOpen, GitCompare,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'
import { addBookmarkWithAI } from '../../services/bookmarkService'
import BookmarksButton from './BookmarksButton'
import DownloadsButton from './DownloadsButton'
import VpnButton from './VpnButton'
import { TradingCoachButton } from '../trading/TradingCoach'
import CaptureOverlay from './CaptureOverlay'
import {
  toPixels, regionInStream, toEvenSize,
  type FractionRect, type Rect,
} from '../../../../shared/captureRegion'

interface Props {
  onNavigate: (url: string) => void
  onHome:     () => void
  onBack:     () => void
  onForward:  () => void
  onReload:   () => void
  onStop:     () => void
  isLoading:  boolean
  canGoBack:    boolean
  canGoForward: boolean
}

function isUrl(s: string): boolean {
  if (s.startsWith('http://') || s.startsWith('https://')) return true
  if (/^[\w-]+\.[\w.-]+/.test(s)) return true
  return false
}

export default function NavigationBar({
  onNavigate, onHome, onBack, onForward, onReload, onStop, isLoading,
  canGoBack, canGoForward,
}: Props) {
  // Narrow subscription — keeps the nav bar out of unrelated store churn
  // (AI streaming, download progress) that used to re-render it constantly.
  const {
    tabs, activeTabId, toggleAIPanel, isAIPanelOpen,
    bookmarks, addBookmark, removeBookmark, toggleSidebar, isSidebarOpen,
    isAnnotationMode, toggleAnnotationMode, tabWcIds, setCaptureOverlayOpen,
    setReaderOpen, isReaderOpen, isCompareOpen, setCompareOpen,
  } = useBrowserStore(useShallow(s => ({
    tabs: s.tabs, activeTabId: s.activeTabId, toggleAIPanel: s.toggleAIPanel, isAIPanelOpen: s.isAIPanelOpen,
    bookmarks: s.bookmarks, addBookmark: s.addBookmark, removeBookmark: s.removeBookmark,
    toggleSidebar: s.toggleSidebar, isSidebarOpen: s.isSidebarOpen,
    isAnnotationMode: s.isAnnotationMode, toggleAnnotationMode: s.toggleAnnotationMode, tabWcIds: s.tabWcIds,
    setCaptureOverlayOpen: s.setCaptureOverlayOpen,
    setReaderOpen: s.setReaderOpen, isReaderOpen: s.isReaderOpen,
    isCompareOpen: s.isCompareOpen, setCompareOpen: s.setCompareOpen,
  })))

  const activeTab = tabs.find(t => t.id === activeTabId)

  const [urlInput,  setUrlInput]  = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [bmToast,   setBmToast]   = useState('')
  const [bmBusy,    setBmBusy]    = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showBmToast = (msg: string) => {
    setBmToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setBmToast(''), 2200)
  }

  const displayUrl    = activeTab?.url === 'home' || !activeTab?.url ? '' : activeTab.url
  const isSecure      = activeTab?.url?.startsWith('https://')
  const normUrl = (u?: string) => (u || '').replace(/\/+$/, '').toLowerCase()
  const curBookmark   = activeTab?.url ? bookmarks.find(b => normUrl(b.url) === normUrl(activeTab.url)) : undefined
  const isBookmarked  = !!curBookmark
  const isSpecialPage = !!(activeTab?.pageType && activeTab.pageType !== 'browser')

  useEffect(() => { if (!isEditing) setUrlInput(displayUrl) }, [activeTab?.url, isEditing])

  // Smart-navigate any text: a URL goes straight there, anything else becomes
  // a Google search. Shared by Enter, Paste-and-Go, and the middle-click paste.
  const go = (raw: string) => {
    const q = raw.trim()
    if (!q) return
    const url = isUrl(q)
      ? (q.startsWith('http') ? q : `https://${q}`)
      : `https://www.google.com/search?q=${encodeURIComponent(q)}`
    onNavigate(url)
    setIsEditing(false)
    inputRef.current?.blur()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    go(urlInput)
  }

  // Paste-and-Go: read the clipboard and navigate in one step. Fed by the
  // address-bar right-click menu, middle-click, and Ctrl+Shift+V.
  const pasteAndGo = async (text?: string) => {
    let clip = text
    if (clip == null) {
      try { clip = await navigator.clipboard.readText() } catch { clip = '' }
    }
    if (clip && clip.trim()) go(clip)
  }

  const handleUrlContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const el = inputRef.current
    const hasText = !!(el && el.selectionStart !== el.selectionEnd)
    window.electronAPI.urlbar.showContextMenu(hasText)
  }

  // Ctrl+Shift+V / menu "Paste and Go" arrive from the main process with the
  // clipboard text already attached.
  useEffect(() => {
    const off = window.electronAPI?.ipc?.on?.('urlbar-paste-and-go', (_e: any, text: string) => {
      pasteAndGo(text)
    })
    return () => { try { off?.() } catch {} }
  }, [onNavigate])

  // One-click add the current page to the sphere (or remove it if already in).
  const handleToggleBookmark = async () => {
    if (bmBusy) return
    const url = activeTab?.url
    if (!url || isSpecialPage) return

    if (curBookmark) {
      removeBookmark(curBookmark.id)
      showBmToast('Removed from sphere')
      return
    }

    setBmBusy(true)
    showBmToast('Adding to sphere…')
    try {
      const result = await addBookmarkWithAI(url, activeTab?.title || '', bookmarks)
      if (result.success && result.bookmark) {
        addBookmark(result.bookmark)
        showBmToast(result.warning ? 'Already in sphere — updated' : 'Added to sphere')
        // Keep a copy of the page while it still exists. Deliberately not
        // awaited and deliberately silent: archiving is a courtesy the
        // bookmark does not depend on, and a page that refuses to be saved
        // must not turn a successful bookmark into an error message.
        if (activeTabId) {
          window.electronAPI.vault?.capture?.({
            tabId: activeTabId, url,
            title: activeTab?.title || '', favicon: activeTab?.favicon || '',
            origin: 'auto',
          }).catch(() => {})
        }
      } else {
        showBmToast(result.error || "Couldn't add page")
      }
    } catch (e: any) {
      showBmToast(`Couldn't add: ${e?.message || e}`)
    } finally {
      setBmBusy(false)
    }
  }

  // Ctrl+L now arrives via the main process (works even when a page inside
  // the BrowserView has focus) as this custom event — see App.tsx.
  useEffect(() => {
    const h = () => {
      inputRef.current?.focus()
      setTimeout(() => inputRef.current?.select(), 10)
    }
    document.addEventListener('aihub-focus-url', h)
    return () => document.removeEventListener('aihub-focus-url', h)
  }, [])

  // ── Capture ───────────────────────────────────────────────────────────
  // Both captures now ask "all of it, or part of it?". A region is chosen on
  // a still of the page rather than on the page itself, because the tab is a
  // BrowserView and nothing host-side can be drawn over it — see
  // CaptureOverlay, where that constraint turns out to be the better
  // behaviour anyway.
  const [pickingFor, setPickingFor] = useState<null | 'screenshot' | 'recording'>(null)
  const [still, setStill] = useState<string>('')

  useEffect(() => { setCaptureOverlayOpen(!!still) }, [still, setCaptureOverlayOpen])

  const pageStill = async (): Promise<string> => {
    const wcId = activeTabId ? tabWcIds[activeTabId] : null
    if (!wcId) return ''
    try { return (await window.electronAPI.webview.capture(wcId)) || '' } catch { return '' }
  }

  const saveScreenshot = async (dataUrl: string) => {
    const result = await (window.electronAPI as any).file.saveImage({ dataUrl, baseName: 'screenshot' })
    if (result?.success) showBmToast('Screenshot saved')
    else if (result?.error) showBmToast(`Couldn't save: ${result.error}`)
    // A cancelled dialog reports neither — silent, like every file:save* caller.
  }

  const takeScreenshot = async () => {
    const dataUrl = await pageStill()
    if (!dataUrl) { showBmToast("No page to capture"); return }
    await saveScreenshot(dataUrl)
  }

  /** Crop the still to the chosen region and save that instead. */
  const cropAndSave = (dataUrl: string, region: FractionRect) => {
    const img = new Image()
    img.onload = () => {
      const box = toPixels(region, img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = box.width
      canvas.height = box.height
      const ctx = canvas.getContext('2d')
      if (!ctx) { showBmToast("Couldn't crop that"); return }
      ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
      void saveScreenshot(canvas.toDataURL('image/png'))
    }
    img.onerror = () => showBmToast("Couldn't read the capture")
    img.src = dataUrl
  }

  const beginRegionCapture = async (what: 'screenshot' | 'recording') => {
    const dataUrl = await pageStill()
    if (!dataUrl) { showBmToast('No page to capture'); return }
    setPickingFor(what)
    setStill(dataUrl)
  }

  const cancelRegion = () => { setStill(''); setPickingFor(null) }

  const onRegionChosen = (region: FractionRect) => {
    const what = pickingFor
    const dataUrl = still
    cancelRegion()
    if (what === 'screenshot') cropAndSave(dataUrl, region)
    else if (what === 'recording') void startRecording(region)
  }

  // ── Tab recording ────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  const [recSeconds,  setRecSeconds]  = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recStreamRef     = useRef<MediaStream | null>(null)
  const recChunksRef     = useRef<Blob[]>([])
  const recTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  const formatRecTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // A cropped recording is the window stream painted through a canvas, one
  // frame at a time, with only the chosen rectangle copied across. MediaRecorder
  // cannot crop a track itself, and re-encoding afterwards would mean shipping
  // a video pipeline for what is three lines of drawImage.
  const cropRafRef   = useRef<number | null>(null)
  const cropVideoRef = useRef<HTMLVideoElement | null>(null)

  const stopCropLoop = () => {
    if (cropRafRef.current !== null) { cancelAnimationFrame(cropRafRef.current); cropRafRef.current = null }
    if (cropVideoRef.current) { cropVideoRef.current.srcObject = null; cropVideoRef.current = null }
  }

  const startRecording = async (region?: FractionRect) => {
    try {
      const sourceId = await (window.electronAPI as any).recorder.getSourceId()
      if (!sourceId) { showBmToast("Couldn't start recording"); return }
      // Electron's desktopCapturer audio has no per-window/per-tab scoping —
      // 'desktop' is the only source and it's a system-wide loopback of
      // whatever's playing through the output device, not isolated to this
      // window. Video stays scoped to the window via sourceId; audio can't be.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop' } },
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
      } as any)
      recStreamRef.current = stream
      recChunksRef.current = []

      // Which pixels of the stream to keep. Null means all of them.
      let crop: Rect | null = null
      let recorded: MediaStream = stream

      if (region) {
        const track = stream.getVideoTracks()[0]
        const settings = track?.getSettings?.() || {}
        const layout = await window.electronAPI.tabView.getLayout().catch(() => null)
        const streamSize = {
          width: Number(settings.width) || 0,
          height: Number(settings.height) || 0,
        }
        const mapped = layout?.primary && layout?.window
          ? regionInStream(region, layout.primary, layout.window, streamSize)
          : null

        if (!mapped) {
          // Geometry we cannot trust records the whole window rather than a
          // confidently wrong rectangle, and says so instead of pretending.
          showBmToast('Recording the whole tab — region unavailable')
        } else {
          crop = toEvenSize(mapped)
          const canvas = document.createElement('canvas')
          canvas.width = crop.width
          canvas.height = crop.height
          const ctx = canvas.getContext('2d')
          const video = document.createElement('video')
          video.srcObject = new MediaStream([track])
          video.muted = true
          await video.play().catch(() => {})
          cropVideoRef.current = video

          const draw = () => {
            if (ctx && crop && video.readyState >= 2) {
              ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
            }
            cropRafRef.current = requestAnimationFrame(draw)
          }
          draw()

          const cropped = canvas.captureStream(30)
          for (const audio of stream.getAudioTracks()) cropped.addTrack(audio)
          recorded = cropped
        }
      }

      const recorder = new MediaRecorder(recorded, { mimeType: 'video/webm;codecs=vp9,opus' })
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        const blob = new Blob(recChunksRef.current, { type: 'video/webm' })
        recChunksRef.current = []
        const buffer = await blob.arrayBuffer()
        const result = await (window.electronAPI as any).file.saveVideo({ buffer })
        if (result?.success) showBmToast('Recording saved')
        else if (result?.error) showBmToast(`Couldn't save: ${result.error}`)
        stopCropLoop()
        recStreamRef.current?.getTracks().forEach(t => t.stop())
        recStreamRef.current = null
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecSeconds(0)
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000)
    } catch (e: any) {
      showBmToast(`Couldn't start recording: ${e?.message || e}`)
    }
  }

  const stopRecording = () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
    setIsRecording(false)
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
  }

  // Safety net: if the nav bar unmounts mid-recording, stop the stream
  // rather than leaking an active capture.
  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    stopCropLoop()
    recStreamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  return (
    <div
      className="drag-region flex items-center ds-navbar"
      style={{ height: 52, padding: '0 10px', gap: 8, position: 'relative' }}
    >
      {/* Indeterminate load bar across the bottom of the nav bar — the single
          clearest "the page is loading" signal, like every real browser. It
          sits just above the page content and disappears the moment the load
          finishes (held on a short floor by App so fast loads still flash). */}
      {isLoading && (
        <div
          className="no-drag"
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 3,
            overflow: 'hidden', zIndex: 70, pointerEvents: 'none',
          }}
        >
          <div style={{
            position: 'absolute', top: 0, height: '100%', width: '40%', borderRadius: 2,
            background: 'linear-gradient(90deg, transparent, rgb(var(--ds-accent-soft)), transparent)',
            animation: 'aihubLoadSlide 1.1s ease-in-out infinite',
          }} />
          <style>{`@keyframes aihubLoadSlide{0%{left:-40%}100%{left:100%}}
            @keyframes aihubSpin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      {/* Add-to-sphere toast — rendered inside the nav-bar chrome (above the
          BrowserView, which always paints over host HTML placed in the page
          region), vertically centered and anchored left of the action group. */}
      {bmToast && (
        <div
          className="no-drag"
          style={{
            position: 'absolute', top: '50%', right: 130, transform: 'translateY(-50%)',
            zIndex: 60, pointerEvents: 'none',
            background: 'rgba(139,92,246,0.95)', color: '#fff',
            borderRadius: 8, padding: '5px 12px', fontSize: 11.5, fontWeight: 700,
            boxShadow: '0 6px 22px rgba(139,92,246,0.4)', whiteSpace: 'nowrap',
          }}
        >
          {bmToast}
        </div>
      )}

      {still && pickingFor && (
        <CaptureOverlay
          image={still}
          mode={pickingFor}
          onSelect={onRegionChosen}
          onCancel={cancelRegion}
        />
      )}

      {/* Sidebar toggle */}
      <div className="no-drag">
        <NavBtn onClick={toggleSidebar} title="Toggle sidebar" active={isSidebarOpen}>
          <PanelLeft size={14} />
        </NavBtn>
      </div>

      <Divider />

      {/* Navigation cluster */}
      <div className="flex items-center gap-1 no-drag">
        <NavBtn
          onClick={() => {
            if (canGoBack) onBack()
            else if (activeTab?.fromHome) onHome()
          }}
          disabled={(!canGoBack && !activeTab?.fromHome) || isSpecialPage}
          title="Back (Alt+Left)"
        >
          <ChevronLeft size={16} />
        </NavBtn>

        <NavBtn onClick={onForward} disabled={!canGoForward || isSpecialPage} title="Forward (Alt+Right)">
          <ChevronRight size={16} />
        </NavBtn>

        {/* Refresh/Stop button: spins while loading to make reload unmistakably
            "doing something", even fast refreshes (App holds spinner visible for
            minimum 350ms floor). The spinning icon is the clearest UX signal. */}
        <button
          onClick={isLoading ? onStop : onReload}
          disabled={isSpecialPage}
          title={isLoading ? 'Stop loading (Esc)' : 'Reload (Ctrl+R)'}
          className="no-drag flex items-center gap-1 rounded-xl"
          style={{
            height: 32, padding: '0 8px', cursor: isSpecialPage ? 'default' : 'pointer',
            opacity: isSpecialPage ? 0.2 : 1,
            color: 'rgb(var(--ds-text-4))',
            background: 'transparent',
            border: '1px solid transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {isLoading ? (
              <RotateCw size={13} style={{ animation: 'aihubSpin 1s linear infinite' }} />
            ) : (
              <RotateCw size={13} />
            )}
          </span>
          {isLoading && <X size={12} style={{ marginLeft: 4, opacity: 0.7 }} />}
          <style>{`@keyframes aihubSpin { to { transform: rotate(360deg); } }`}</style>
        </button>

        <NavBtn onClick={onHome} title="Home">
          <Home size={13} />
        </NavBtn>
      </div>

      {/* Floating URL bar */}
      <form onSubmit={handleSubmit} className="no-drag" style={{ flex: 1, padding: '0 4px' }}>
        <div
          className="ds-urlbar"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            height: 36, padding: '0 14px',
          }}
        >
          {/* Protocol / status icon */}
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {isSpecialPage ? (
              <span style={{
                fontSize: 9, color: 'rgb(var(--ds-accent-soft))',
                textShadow: '0 0 8px rgb(var(--ds-accent) / 0.6)',
              }}>◆</span>
            ) : activeTab?.url && activeTab.url !== 'home' ? (
              isSecure
                ? <Lock size={10} style={{ color: 'rgba(52,211,153,0.80)' }} />
                : <AlertTriangle size={10} style={{ color: 'rgba(251,191,36,0.80)' }} />
            ) : (
              <Globe size={11} style={{ color: 'rgb(var(--ds-text-4) / 0.7)' }} />
            )}
          </span>

          <input
            ref={inputRef}
            value={isEditing
              ? urlInput
              : (isSpecialPage ? `aihub://${activeTab?.pageType}` : displayUrl)}
            onChange={e => setUrlInput(e.target.value)}
            onFocus={() => {
              setIsEditing(true)
              setUrlInput(displayUrl)
              setTimeout(() => inputRef.current?.select(), 10)
            }}
            onBlur={() => setIsEditing(false)}
            onContextMenu={handleUrlContextMenu}
            onMouseDown={e => { if (e.button === 1) { e.preventDefault(); pasteAndGo() } }}
            placeholder="Search or enter URL…  ·  right-click for Paste & Go"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 12.5, fontWeight: 450,
              textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: isEditing
                ? 'rgb(var(--ds-text-1))'
                : displayUrl
                  ? 'rgb(var(--ds-text-3))'
                  : 'rgb(var(--ds-text-4))',
              letterSpacing: isEditing ? '0' : '0.01em',
              userSelect: 'text',
            }}
          />

          {/* Search icon visible when editing */}
          {isEditing && (
            <span style={{ flexShrink: 0 }}>
              <Search size={10} style={{ color: 'rgb(var(--ds-accent) / 0.6)' }} />
            </span>
          )}
        </div>
      </form>

      {/* Right-side action buttons */}
      <div className="flex items-center gap-1 no-drag">
        <NavBtn
          onClick={handleToggleBookmark}
          title={isSpecialPage ? 'Open a page to add it' : isBookmarked ? 'Remove from sphere' : 'Add this page to the sphere'}
          active={isBookmarked}
          disabled={isSpecialPage || bmBusy}
        >
          <Bookmark size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
        </NavBtn>

        <NavBtn
          onClick={() => activeTabId && setReaderOpen(!isReaderOpen, activeTabId)}
          title={isReaderOpen ? 'Close reading mode' : 'Read in clean mode (F1)'}
          active={isReaderOpen}
          disabled={isSpecialPage}
        >
          <BookOpen size={13} />
        </NavBtn>

        <NavBtn
          onClick={toggleAnnotationMode}
          title="Annotate page"
          active={isAnnotationMode}
        >
          <Pencil size={13} />
        </NavBtn>

        {/* F8: Cross-Tab AI Comparison — pick 2+ tabs and get a comparison table */}
        <NavBtn
          onClick={() => setCompareOpen(!isCompareOpen)}
          title="Compare pages (AI)"
          active={isCompareOpen}
        >
          <GitCompare size={13} />
        </NavBtn>

        {/* Every saved bookmark, one click away — the sphere is for exploring,
            this is for opening the one you already have in mind. */}
        <BookmarksButton onNavigate={onNavigate} />

        {/* Everything this browser has pulled down, with live progress — the
            same list as the downloads page, at a glance. */}
        <DownloadsButton />

        <CaptureButton
          title="Screenshot"
          icon={<Camera size={13} />}
          disabled={isSpecialPage || !activeTabId}
          wholeLabel="Whole page"
          regionLabel="Select an area…"
          onWhole={takeScreenshot}
          onRegion={() => void beginRegionCapture('screenshot')}
        />

        {isRecording ? (
          <button
            onClick={stopRecording}
            title="Stop recording"
            className="no-drag flex items-center gap-1.5 rounded-xl"
            style={{
              height: 32, padding: '0 10px', cursor: 'pointer',
              background: 'rgba(239,68,68,0.16)', border: '1px solid rgba(239,68,68,0.4)',
              color: '#f87171',
            }}
          >
            <Square size={11} fill="currentColor" />
            <span style={{ fontSize: 11, fontWeight: 700 }}>{formatRecTime(recSeconds)}</span>
          </button>
        ) : (
          <CaptureButton
            title="Record tab"
            icon={<Video size={13} />}
            disabled={isSpecialPage || !activeTabId}
            wholeLabel="Whole tab"
            regionLabel="Select an area…"
            onWhole={() => void startRecording()}
            onRegion={() => void beginRegionCapture('recording')}
          />
        )}

        {/* VPN quick-toggle — green while protected, right-click to switch country */}
        <VpnButton />

        {/* Trading Coach — gold accent — only renders on TradingView chart
            URLs. Lives in the navbar so it is above the chart's BrowserView,
            which would otherwise paint over any host HTML. */}
        <TradingCoachButton />

        {/* AI assistant button — purple accent — opens the full docked panel */}
        <AIButton onClick={toggleAIPanel} active={isAIPanelOpen} />
      </div>
    </div>
  )
}

function AIButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const lit = hovered || active
  return (
    <button
      onClick={onClick}
      title="AI Assistant (Ctrl+Shift+A)"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="no-drag flex items-center gap-1.5 rounded-xl"
      style={{
        height: 32, padding: '0 12px', cursor: 'pointer',
        background: lit
          ? 'linear-gradient(135deg, rgb(var(--ds-accent)), rgb(var(--ds-accent-2)))'
          : 'linear-gradient(135deg, rgb(var(--ds-accent) / 0.22), rgba(126,92,255,0.16))',
        border: `1px solid ${lit ? 'rgb(var(--ds-accent-soft) / 0.50)' : 'rgb(var(--ds-accent) / 0.32)'}`,
        color: lit ? '#fff' : 'rgb(var(--ds-accent-soft))',
        boxShadow: lit
          ? '0 4px 20px rgb(var(--ds-accent) / 0.45), 0 0 0 1px rgb(var(--ds-accent-soft) / 0.2)'
          : '0 2px 10px rgb(var(--ds-accent) / 0.20)',
        transition: 'all 0.18s cubic-bezier(0.34,1.2,0.64,1)',
        transform: hovered ? 'translateY(-1px) scale(1.02)' : 'translateY(0) scale(1)',
      }}
    >
      <Bot size={13} />
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.02em' }}>AI</span>
    </button>
  )
}

/**
 * A capture button that asks what to capture.
 *
 * Both captures used to mean "everything", which is the wrong default more
 * often than not — the useful thing is usually one chart or one error dialog,
 * and cropping afterwards in another application is the step that stops people
 * bothering. Neither option is buried behind a modifier key, because neither
 * is secondary.
 */
function CaptureButton({ title, icon, disabled, wholeLabel, regionLabel, onWhole, onRegion }: {
  title: string
  icon: React.ReactNode
  disabled?: boolean
  wholeLabel: string
  regionLabel: string
  onWhole: () => void
  onRegion: () => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState({ top: 52, right: 14 })
  const btnRef = useRef<HTMLButtonElement>(null)

  // The menu drops below the nav bar into the page region, where the tab's
  // BrowserView paints over host HTML — without this it is drawn correctly
  // and hidden behind the page, which is exactly how it shipped in 1.58.5.
  const { pushHostOverlay, popHostOverlay } = useBrowserStore(useShallow(s => ({
    pushHostOverlay: s.pushHostOverlay,
    popHostOverlay: s.popHostOverlay,
  })))
  useEffect(() => {
    if (!open) return
    pushHostOverlay()
    return () => popHostOverlay()
  }, [open, pushHostOverlay, popHostOverlay])

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) })
    setOpen(o => !o)
  }

  const pick = (run: () => void) => { setOpen(false); run() }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={disabled}
        title={title}
        className="ds-navbtn"
        style={{
          opacity: disabled ? 0.2 : 1,
          color: open ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-4))',
          background: open ? 'rgb(var(--ds-accent) / 0.16)' : 'transparent',
          border: `1px solid ${open ? 'rgb(var(--ds-accent) / 0.28)' : 'transparent'}`,
        }}
      >
        {icon}
      </button>

      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', top: anchor.top, right: anchor.right, zIndex: 9999,
            width: 208, padding: 5, borderRadius: 13, overflow: 'hidden',
            background: 'var(--ds-glass-lg, rgb(var(--ds-bg-2)))',
            border: '1px solid var(--ds-border-sm)',
            boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
            backdropFilter: 'blur(18px)',
          }}>
            <MenuRow icon={<Monitor size={13} />} label={wholeLabel} onClick={() => pick(onWhole)} />
            <MenuRow icon={<Crop size={13} />} label={regionLabel} onClick={() => pick(onRegion)} />
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function MenuRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%',
        padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
        background: hovered ? 'rgb(var(--ds-accent) / 0.12)' : 'transparent',
        border: 'none', textAlign: 'left',
        color: hovered ? 'rgb(var(--ds-text-2))' : 'rgb(var(--ds-text-3))',
        fontSize: 12.5, fontWeight: 550,
      }}
    >
      <span style={{ display: 'flex', color: 'rgb(var(--ds-accent-soft))' }}>{icon}</span>
      {label}
    </button>
  )
}

function NavBtn({ onClick, disabled, title, children, active = false }: {
  onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode; active?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`ds-navbtn${active ? ' active' : ''}`}
      style={{
        opacity: disabled ? 0.2 : 1,
        color: active || (hovered && !disabled)
          ? 'rgb(var(--ds-accent-soft))'
          : 'rgb(var(--ds-text-4))',
        background: active
          ? 'rgb(var(--ds-accent) / 0.16)'
          : hovered && !disabled
            ? 'rgb(var(--ds-accent) / 0.10)'
            : 'transparent',
        border: `1px solid ${active ? 'rgb(var(--ds-accent) / 0.28)' : 'transparent'}`,
        boxShadow: active ? '0 0 14px rgb(var(--ds-accent) / 0.22)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

function Divider() {
  return (
    <div style={{
      width: 1, height: 18, flexShrink: 0, margin: '0 2px',
      background: 'linear-gradient(180deg, transparent, rgb(var(--ds-accent) / 0.25), transparent)',
    }} />
  )
}
