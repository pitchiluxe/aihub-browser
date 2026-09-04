// F1 — AI Reading Mode
// A clean, distraction-free reader that takes over the page region and
// displays a parsed article with configurable typography, themes, and
// text-to-speech. Closes with Esc, the close button, or the X in the
// floating toolbar.

import React, { useEffect, useState, useCallback } from 'react'
import {
  X, Play, Pause, Square, Volume2, Settings, Loader2,
  ChevronUp, ChevronDown, Bookmark,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'
import { buildReaderScript, type ReaderArticle, EMPTY_ARTICLE } from '../../services/readingModeExtractor'

type Theme = 'light' | 'sepia' | 'dark' | 'black'
type Font = 'serif' | 'sans' | 'mono'

interface TtsState {
  status: 'idle' | 'loading' | 'playing' | 'paused'
  utterance: SpeechSynthesisUtterance | null
  currentChunk: number
}

const THEMES: Record<Theme, { bg: string; text: string; accent: string; muted: string; label: string }> = {
  light: { bg: '#ffffff', text: '#1a1a1a', accent: '#7c3aed', muted: '#666',    label: 'Light' },
  sepia: { bg: '#f4ecd8', text: '#5b4636', accent: '#a0522d', muted: '#8b7355', label: 'Sepia' },
  dark:  { bg: '#1a1a1f', text: '#e5e5e5', accent: '#a78bfa', muted: '#999',    label: 'Dark'  },
  black: { bg: '#000000', text: '#c0c0c0', accent: '#7c3aed', muted: '#777',    label: 'Black' },
}

const FONTS: Record<Font, { family: string; label: string }> = {
  serif: { family: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif', label: 'Serif' },
  sans:  { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', label: 'Sans' },
  mono:  { family: '"SF Mono", Menlo, Consolas, "Courier New", monospace', label: 'Mono' },
}

export default function ReaderView() {
  const {
    isReaderOpen, setReaderOpen, activeTabId, tabs, tabWcIds, addBookmark,
  } = useBrowserStore(useShallow(s => ({
    isReaderOpen: s.isReaderOpen,
    setReaderOpen: s.setReaderOpen,
    activeTabId: s.activeTabId,
    tabs: s.tabs,
    tabWcIds: s.tabWcIds,
    addBookmark: s.addBookmark,
  })))

  const activeTab = tabs.find(t => t.id === activeTabId)
  const wcId = activeTabId ? tabWcIds[activeTabId] : null

  // ── State ───────────────────────────────────────────────────────────────
  const [article, setArticle] = useState<ReaderArticle>(EMPTY_ARTICLE)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')
  const [font, setFont] = useState<Font>('serif')
  const [fontSize, setFontSize] = useState(18)
  const [lineHeight, setLineHeight] = useState(1.7)
  const [width, setWidth] = useState(680)
  const [showSettings, setShowSettings] = useState(false)
  const [showToolbar] = useState(true)
  const [bookmarked, setBookmarked] = useState(false)
  const [tts, setTts] = useState<TtsState>({ status: 'idle', utterance: null, currentChunk: 0 })

  // Persist user preferences across sessions.
  useEffect(() => {
    const saved = localStorage.getItem('aihub-reader-prefs')
    if (saved) {
      try {
        const prefs = JSON.parse(saved)
        if (prefs.theme) setTheme(prefs.theme)
        if (prefs.font) setFont(prefs.font)
        if (prefs.fontSize) setFontSize(prefs.fontSize)
        if (prefs.lineHeight) setLineHeight(prefs.lineHeight)
        if (prefs.width) setWidth(prefs.width)
      } catch {}
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('aihub-reader-prefs', JSON.stringify({ theme, font, fontSize, lineHeight, width }))
  }, [theme, font, fontSize, lineHeight, width])

  // ── Article extraction ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isReaderOpen || !activeTabId || !wcId) return
    setLoading(true)
    setError('')
    setArticle(EMPTY_ARTICLE)

    const extract = async () => {
      try {
        const script = buildReaderScript()
        const result = await window.electronAPI.webview.execScript(wcId, script)
        // The IPC layer wraps responses as { ok, result } or { error }.
        // The injected script itself returned a JSON string.
        if (result?.error) {
          setError(result.error)
          setLoading(false)
          return
        }
        const jsonString = typeof result?.result === 'string' ? result.result : null
        if (!jsonString) {
          setError("The page didn't return any readable content.")
          setLoading(false)
          return
        }
        let parsed: any
        try {
          parsed = JSON.parse(jsonString)
        } catch (e: any) {
          setError(`Couldn't parse the page: ${e?.message || e}`)
          setLoading(false)
          return
        }
        if (parsed.error) {
          setError(parsed.error)
        } else {
          setArticle(parsed)
        }
      } catch (e: any) {
        setError(e?.message || "Couldn't read this page.")
      } finally {
        setLoading(false)
      }
    }

    extract()
  }, [isReaderOpen, activeTabId, wcId])

  // ── Text-to-speech ──────────────────────────────────────────────────────
  const stopTts = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setTts({ status: 'idle', utterance: null, currentChunk: 0 })
  }, [])

  const toggleTts = useCallback(() => {
    if (tts.status === 'playing') {
      window.speechSynthesis.pause()
      setTts(s => ({ ...s, status: 'paused' }))
      return
    }
    if (tts.status === 'paused') {
      window.speechSynthesis.resume()
      setTts(s => ({ ...s, status: 'playing' }))
      return
    }

    if (!('speechSynthesis' in window) || !article.textContent) return

    // Split into chunks at sentence boundaries to allow pausing at logical
    // points. Without this, a 10,000-word article becomes one long utterance
    // that can't be paused/restarted cleanly.
    const sentences = article.textContent.match(/[^.!?]+[.!?]+/g) || [article.textContent]
    let idx = 0

    const speakNext = () => {
      if (idx >= sentences.length) {
        setTts({ status: 'idle', utterance: null, currentChunk: 0 })
        return
      }
      const utt = new SpeechSynthesisUtterance(sentences[idx].trim())
      utt.rate = 1
      utt.pitch = 1
      utt.onend = () => {
        idx++
        if (idx < sentences.length) speakNext()
        else setTts({ status: 'idle', utterance: null, currentChunk: 0 })
      }
      setTts({ status: 'playing', utterance: utt, currentChunk: idx })
      window.speechSynthesis.speak(utt)
    }
    speakNext()
  }, [tts.status, article.textContent])

  // Cleanup on unmount.
  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isReaderOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopTts()
        setReaderOpen(false)
      }
      // Font size: Ctrl/Cmd + / -
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        setFontSize(s => Math.min(32, s + 1))
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        setFontSize(s => Math.max(12, s - 1))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isReaderOpen, setReaderOpen, stopTts])

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isReaderOpen) return null

  const theme_ = THEMES[theme]
  const font_ = FONTS[font]

  return (
    <div
      style={{
        position: 'fixed',
        top: 52, // Below the nav bar
        left: 0, right: 0, bottom: 0,
        background: theme_.bg,
        color: theme_.text,
        zIndex: 50,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top toolbar */}
      {showToolbar && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '8px 12px',
          borderBottom: `1px solid ${theme_.muted}22`,
          background: theme_.bg,
          flexShrink: 0,
        }}>
          <button onClick={() => { stopTts(); setReaderOpen(false) }} title="Close (Esc)" style={iconBtn(theme_)}>
            <X size={14} />
          </button>
          <div style={{ width: 1, height: 18, background: `${theme_.muted}44`, margin: '0 4px' }} />

          {/* Theme switcher */}
          <div style={{ display: 'flex', gap: 2, padding: '0 4px' }}>
            {(['light', 'sepia', 'dark', 'black'] as Theme[]).map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                title={THEMES[t].label}
                style={{
                  width: 22, height: 22, borderRadius: 11, cursor: 'pointer',
                  background: THEMES[t].bg,
                  border: theme === t ? `2px solid ${theme_.accent}` : `1px solid ${theme_.muted}44`,
                }}
              />
            ))}
          </div>

          <div style={{ width: 1, height: 18, background: `${theme_.muted}44`, margin: '0 4px' }} />

          {/* Font family */}
          <select
            value={font}
            onChange={e => setFont(e.target.value as Font)}
            style={{ ...selectStyle(theme_), width: 80 }}
            title="Font family"
          >
            <option value="serif">Serif</option>
            <option value="sans">Sans</option>
            <option value="mono">Mono</option>
          </select>

          {/* Font size controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button onClick={() => setFontSize(s => Math.max(12, s - 1))} title="Smaller (Ctrl+-)" style={iconBtn(theme_)}>
              <ChevronDown size={12} />
            </button>
            <span style={{ minWidth: 32, textAlign: 'center', fontSize: 11, color: theme_.muted, fontVariantNumeric: 'tabular-nums' }}>
              {fontSize}px
            </span>
            <button onClick={() => setFontSize(s => Math.min(32, s + 1))} title="Larger (Ctrl++)" style={iconBtn(theme_)}>
              <ChevronUp size={12} />
            </button>
          </div>

          <div style={{ width: 1, height: 18, background: `${theme_.muted}44`, margin: '0 4px' }} />

          {/* TTS controls */}
          {tts.status === 'playing' ? (
            <>
              <button onClick={toggleTts} title="Pause" style={iconBtn(theme_, true)}>
                <Pause size={13} />
              </button>
              <button onClick={stopTts} title="Stop" style={iconBtn(theme_)}>
                <Square size={12} fill="currentColor" />
              </button>
            </>
          ) : (
            <button
              onClick={toggleTts}
              title={tts.status === 'paused' ? 'Resume' : 'Read aloud'}
              disabled={!article.textContent}
              style={{ ...iconBtn(theme_), opacity: article.textContent ? 1 : 0.3 }}
            >
              {tts.status === 'paused' ? <Play size={13} /> : <Volume2 size={13} />}
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* Site name */}
          <span style={{ fontSize: 11, color: theme_.muted, fontWeight: 500 }}>
            {article.siteName}
          </span>

          <div style={{ width: 1, height: 18, background: `${theme_.muted}44`, margin: '0 4px' }} />

          {/* Bookmark */}
          <button
            onClick={() => {
              if (bookmarked) return
              if (!activeTab) return
              const existing = useBrowserStore.getState().bookmarks.find(b => b.url === activeTab.url)
              if (existing) { setBookmarked(true); return }
              addBookmark({
                id: `bm-${Date.now()}`,
                url: activeTab.url,
                title: article.title || activeTab.title || '',
                category: 'Reading',
                tags: [],
                notes: '',
                createdAt: Date.now(),
              } as any)
              setBookmarked(true)
            }}
            title={bookmarked ? 'Saved to sphere' : 'Save to sphere'}
            style={{ ...iconBtn(theme_), color: bookmarked ? theme_.accent : undefined }}
          >
            <Bookmark size={13} fill={bookmarked ? 'currentColor' : 'none'} />
          </button>

          <button onClick={() => setShowSettings(s => !s)} title="Settings" style={iconBtn(theme_, showSettings)}>
            <Settings size={13} />
          </button>
        </div>
      )}

      {/* Settings panel (advanced) */}
      {showSettings && showToolbar && (
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${theme_.muted}22`,
          background: theme_.bg,
          display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
          flexShrink: 0,
        }}>
          <label style={labelStyle(theme_)}>
            Width
            <input
              type="range" min={500} max={1000} value={width}
              onChange={e => setWidth(parseInt(e.target.value))}
              style={{ marginLeft: 6, verticalAlign: 'middle' }}
            />
            <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums', minWidth: 40, display: 'inline-block' }}>
              {width}px
            </span>
          </label>
          <label style={labelStyle(theme_)}>
            Line height
            <input
              type="range" min={1.3} max={2.2} step={0.1} value={lineHeight}
              onChange={e => setLineHeight(parseFloat(e.target.value))}
              style={{ marginLeft: 6, verticalAlign: 'middle' }}
            />
            <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums', minWidth: 40, display: 'inline-block' }}>
              {lineHeight.toFixed(1)}
            </span>
          </label>
        </div>
      )}

      {/* Article content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        <div style={{
          maxWidth: width,
          margin: '0 auto',
          padding: '40px 32px 120px',
          fontFamily: font_.family,
          fontSize: fontSize,
          lineHeight: lineHeight,
          color: theme_.text,
          direction: article.dir as any,
        }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 60, justifyContent: 'center', color: theme_.muted }}>
              <Loader2 size={18} className="animate-spin" />
              <span>Extracting article…</span>
            </div>
          )}

          {!loading && error && (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Can't read this page</div>
              <div style={{ color: theme_.muted, fontSize: 14 }}>
                {error === 'not an article' && "This doesn't look like an article — try a blog post, news story, or essay."}
                {error === 'too short to be an article' && 'This page is too short to read in clean mode.'}
                {error === 'page has no readable article content' && 'No readable text found on this page.'}
                {!['not an article', 'too short to be an article', 'page has no readable article content'].includes(error) && error}
              </div>
              <button
                onClick={() => setReaderOpen(false)}
                style={{
                  marginTop: 20, padding: '8px 18px', borderRadius: 8,
                  background: theme_.accent, color: '#fff', border: 'none',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Back to page
              </button>
            </div>
          )}

          {!loading && !error && article.content && (
            <article>
              {/* Hero image */}
              {article.heroImage && (
                <img
                  src={article.heroImage}
                  alt=""
                  style={{
                    width: '100%', maxHeight: 400, objectFit: 'cover',
                    borderRadius: 8, marginBottom: 24,
                  }}
                />
              )}

              {/* Title */}
              <h1 style={{
                fontSize: fontSize * 2.2, lineHeight: 1.2, fontWeight: 700,
                margin: '0 0 12px', color: theme_.text,
              }}>
                {article.title}
              </h1>

              {/* Byline + meta */}
              {(article.byline || article.excerpt) && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  marginBottom: 32, paddingBottom: 16,
                  borderBottom: `1px solid ${theme_.muted}33`,
                }}>
                  {article.byline && (
                    <div style={{ fontSize: fontSize * 0.9, color: theme_.muted, fontStyle: 'italic' }}>
                      By {article.byline}
                    </div>
                  )}
                  <div style={{ fontSize: fontSize * 0.8, color: theme_.muted, display: 'flex', gap: 12 }}>
                    {article.readingMinutes > 0 && <span>{article.readingMinutes} min read</span>}
                    {article.textContent && (
                      <span>{article.textContent.split(/\s+/).filter(Boolean).length} words</span>
                    )}
                  </div>
                  {article.excerpt && (
                    <div style={{
                      fontSize: fontSize * 1.05, color: theme_.muted, fontStyle: 'italic',
                      lineHeight: 1.5, marginTop: 4,
                    }}>
                      {article.excerpt}
                    </div>
                  )}
                </div>
              )}

              {/* Body */}
              <div
                className="reader-content"
                style={{}}
                dangerouslySetInnerHTML={{ __html: article.content }}
              />

              {/* End marker */}
              <div style={{
                marginTop: 64, paddingTop: 24,
                borderTop: `1px solid ${theme_.muted}33`,
                textAlign: 'center', fontSize: 13, color: theme_.muted,
              }}>
                End of article — {article.textContent.split(/\s+/).filter(Boolean).length} words
              </div>
            </article>
          )}
        </div>
      </div>

      {/* Inject the article's typography styles */}
      <style>{`
        .reader-content h1 { font-size: ${fontSize * 1.8}em; line-height: 1.25; font-weight: 700; margin: 1.5em 0 0.6em; }
        .reader-content h2 { font-size: ${fontSize * 1.5}em; line-height: 1.3; font-weight: 700; margin: 1.5em 0 0.5em; }
        .reader-content h3 { font-size: ${fontSize * 1.25}em; line-height: 1.35; font-weight: 600; margin: 1.4em 0 0.4em; }
        .reader-content h4 { font-size: ${fontSize * 1.1}em; line-height: 1.4; font-weight: 600; margin: 1.3em 0 0.4em; }
        .reader-content p { margin: 0 0 1em; }
        .reader-content a { color: ${theme_.accent}; text-decoration: underline; text-underline-offset: 2px; }
        .reader-content blockquote {
          margin: 1.5em 0; padding: 0.5em 1.5em;
          border-left: 3px solid ${theme_.accent};
          font-style: italic; color: ${theme_.muted};
        }
        .reader-content blockquote cite { display: block; margin-top: 0.5em; font-size: 0.85em; }
        .reader-content ul, .reader-content ol { margin: 1em 0; padding-left: 1.5em; }
        .reader-content li { margin-bottom: 0.4em; }
        .reader-content img { max-width: 100%; height: auto; border-radius: 6px; margin: 1.5em auto; display: block; }
        .reader-content figure { margin: 1.5em 0; }
        .reader-content figcaption { font-size: 0.85em; color: ${theme_.muted}; text-align: center; margin-top: 0.5em; font-style: italic; }
        .reader-content pre {
          background: ${theme === 'dark' || theme === 'black' ? '#ffffff11' : '#00000011'};
          padding: 1em; border-radius: 6px; overflow-x: auto;
          font-family: ${FONTS.mono.family};
          font-size: 0.85em; margin: 1.5em 0;
        }
        .reader-content code { font-family: ${FONTS.mono.family}; font-size: 0.9em; }
        .reader-content table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.9em; }
        .reader-content th, .reader-content td { padding: 0.5em; border: 1px solid ${theme_.muted}33; }
        .reader-content .table-wrapper { overflow-x: auto; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}

function iconBtn(theme_: typeof THEMES[Theme], active = false): React.CSSProperties {
  return {
    width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: 6, cursor: 'pointer',
    background: active ? `${theme_.accent}22` : 'transparent',
    color: active ? theme_.accent : theme_.text,
  }
}

function selectStyle(theme_: typeof THEMES[Theme]): React.CSSProperties {
  return {
    height: 28, padding: '0 8px',
    background: `${theme_.muted}11`,
    color: theme_.text,
    border: `1px solid ${theme_.muted}33`,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    outline: 'none',
  }
}

function labelStyle(theme_: typeof THEMES[Theme]): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center',
    fontSize: 12, color: theme_.muted, fontWeight: 500,
  }
}
