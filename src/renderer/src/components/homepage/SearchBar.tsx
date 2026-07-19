import React, { useState, useRef, useEffect } from 'react'
import { Search, Globe, BookOpen, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBrowserStore } from '../../store/browserStore'

const ENGINES = [
  { id: 'google', label: 'Google', url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: 'bing', label: 'Bing', url: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { id: 'perplexity', label: 'Perplexity', url: (q: string) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}` },
  { id: 'duckduckgo', label: 'DuckDuckGo', url: (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` }
]

interface Props {
  onNavigate: (url: string) => void
}

function isUrl(s: string): boolean {
  try {
    const u = s.includes('://') ? s : `https://${s}`
    new URL(u)
    return /\.[a-z]{2,}/.test(s) || s.startsWith('http')
  } catch {
    return false
  }
}

export default function SearchBar({ onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [engine, setEngine] = useState(ENGINES[0])
  const [focused, setFocused] = useState(false)
  const bookmarks = useBrowserStore(s => s.bookmarks)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredBookmarks = query
    ? bookmarks.filter(
        (b) =>
          b.title.toLowerCase().includes(query.toLowerCase()) ||
          b.url.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 4)
    : []

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    const q = query.trim()
    if (isUrl(q)) {
      onNavigate(q.startsWith('http') ? q : `https://${q}`)
    } else {
      onNavigate(engine.url(q))
    }
    setQuery('')
    setFocused(false)
  }

  const handleBookmarkClick = (url: string) => {
    onNavigate(url)
    setQuery('')
    setFocused(false)
  }

  // Global shortcut: Ctrl+L
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit}>
        <div
          className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all duration-300 border border-aihub-border/30 ${
            focused
              ? 'bg-aihub-card shadow-lg shadow-aihub-accent/10'
              : 'bg-aihub-card/70 hover:bg-aihub-card/90'
          }`}
        >
          <Search size={18} className={`shrink-0 transition-colors ${focused ? 'text-aihub-accent' : 'text-aihub-muted'}`} />

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Search the web or enter URL…"
            className="flex-1 bg-transparent outline-none text-aihub-text placeholder:text-aihub-muted/50 text-sm no-drag"
            style={{ userSelect: 'text' }}
          />

          <div className="flex items-center gap-1 shrink-0">
            {ENGINES.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEngine(e)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all no-drag ${
                  engine.id === e.id
                    ? 'bg-aihub-accent text-white'
                    : 'text-aihub-muted hover:text-aihub-text hover:bg-aihub-surface'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </form>

      {/* Suggestions dropdown */}
      <AnimatePresence>
        {focused && filteredBookmarks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-full mt-2 w-full glass rounded-2xl border border-aihub-border/60 overflow-hidden shadow-xl z-20"
          >
            <div className="px-3 py-2 text-xs text-aihub-muted font-medium border-b border-aihub-border/30">
              Bookmarks
            </div>
            {filteredBookmarks.map((b) => (
              <button
                key={b.id}
                type="button"
                onMouseDown={() => handleBookmarkClick(b.url)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-aihub-accent/10 transition-colors text-left no-drag"
              >
                <div className="w-6 h-6 rounded-md overflow-hidden shrink-0 bg-aihub-surface flex items-center justify-center">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${b.url}&sz=32`}
                    className="w-4 h-4"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-aihub-text truncate">{b.title}</div>
                  <div className="text-xs text-aihub-muted truncate">{b.url}</div>
                </div>
                <Globe size={13} className="text-aihub-muted shrink-0" />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
