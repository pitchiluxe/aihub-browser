import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, X, Send, Loader2, Sparkles, FileText, Trash2, AlertCircle, Zap, Paperclip, Download, BookmarkPlus, Check, Newspaper } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

interface Props { currentUrl?: string; currentTitle?: string; getPageContent?: () => Promise<string> }

interface SummaryState { title: string; url: string; mdContent: string }

const SUGGESTIONS = [
  'What can AIHub Browser do?',
  'Latest AI news and articles',
  'Summarize the current page',
  'How does the Bookmark Sphere work?',
]

const AI_NEWS_INTENT = /latest\s+ai|ai\s+news|ai\s+articles?|ai\s+updates?|what.?s\s+new\s+in\s+ai|recent\s+ai|top\s+ai/i

export default function AIAssistant({ currentUrl, currentTitle, getPageContent }: Props) {
  const {
    isAIPanelOpen, toggleAIPanel,
    aiMessages, addAIMessage, clearAIMessages,
    isAILoading, setAILoading,
    ollamaStatus, setOllamaStatus,
  } = useBrowserStore()

  const [input,            setInput]            = useState('')
  const [lastSummary,      setLastSummary]      = useState<SummaryState | null>(null)
  const [savingMd,         setSavingMd]         = useState(false)
  const [savedBookmark,    setSavedBookmark]    = useState(false)
  const [fetchingNews,     setFetchingNews]     = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [aiMessages])

  useEffect(() => {
    if (isAIPanelOpen) {
      checkOllama()
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isAIPanelOpen])

  // Reset summary state when URL changes
  useEffect(() => {
    setLastSummary(null)
    setSavedBookmark(false)
  }, [currentUrl])

  const checkOllama = async () => {
    try {
      const status = await window.electronAPI.ollama.status()
      setOllamaStatus(status)
    } catch {}
  }

  const buildSystemPrompt = () => {
    const pageCtx = currentUrl && currentUrl !== 'home'
      ? `\n\nCurrent page: "${currentTitle || currentUrl}" — ${currentUrl}`
      : '\n\nUser is on the AIHub Browser home page.'

    return `You are AIHub Browser Assistant — a smart, knowledgeable AI built directly into AIHub Browser.

You help users:
• Navigate and discover great content on the web
• Summarize and deeply analyze web pages
• Research topics by synthesizing information from multiple sources
• Manage their bookmarks using the AI-powered 3D Bookmark Sphere
• Write, translate, generate code, and create documents
• Get the most out of every AIHub Browser feature
• Stay up-to-date with the latest AI news and breakthroughs

AIHub Browser features you know well:
- **Bookmark Sphere**: Interactive 3D force-directed knowledge graph. Bookmarks cluster by category (AI, Finance, Dev, Articles, etc.). Click nodes to navigate, right-click to manage.
- **AI Assistant** (you): Powered by Ollama (local/private) or OpenRouter (cloud fallback). Switch models in Settings → AI Configuration.
- **Article Summarizer**: Summarize any page and save it as a Markdown file or add it to the Articles cluster in the Bookmark Sphere.
- **Research Mode**: Open multiple tabs, cross-reference sources, generate reports.
- **Agent Mode**: Automate web tasks — form filling, data gathering, site monitoring.
- **Smart Bookmarks**: Auto-deduplicated, AI-categorized, color-coded by topic.
- **History**: Semantic search across your browsing history.
- **Settings → AI Configuration**: Set OpenRouter API key, choose model, or point to Ollama URL.

Be concise, warm, and genuinely helpful. Use bullet points for lists. Keep responses focused.${pageCtx}`
  }

  const sendMessage = async () => {
    const msg = input.trim()
    if (!msg || isAILoading) return
    setInput('')
    addAIMessage({ role: 'user', content: msg })
    setAILoading(true)
    try {
      let systemPrompt = buildSystemPrompt()

      // Inject live HN AI news when user asks for it
      if (AI_NEWS_INTENT.test(msg)) {
        setFetchingNews(true)
        try {
          const news = await (window.electronAPI as any).ai.getLatestNews()
          if (news.success && news.articles.length > 0) {
            const list = news.articles
              .map((a: any, i: number) => `${i + 1}. **${a.title}** (${a.score} pts on HN)\n   ${a.url}`)
              .join('\n\n')
            systemPrompt += `\n\n## LIVE AI NEWS FROM HACKER NEWS (fetched just now)\n\n${list}\n\nPresent these real articles to the user. Tell them you fetched these live from Hacker News right now. For each article, give a one-sentence summary of what it's likely about based on the title. Also suggest they can click the links to read them in AIHub Browser.`
          }
        } catch {}
        setFetchingNews(false)
      }

      const history = [
        { role: 'system', content: systemPrompt },
        ...aiMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: msg },
      ]
      const result = await window.electronAPI.ai.chat(history)
      addAIMessage({ role: 'assistant', content: result.content })
      if (result.provider === 'ollama' && !ollamaStatus?.running) {
        setOllamaStatus({ running: true, models: ollamaStatus?.models || [] })
      }
    } catch {
      addAIMessage({ role: 'assistant', content: 'Connection error. Please try again.' })
    } finally {
      setAILoading(false)
      setFetchingNews(false)
    }
  }

  const summarizePage = async () => {
    if (!currentUrl || currentUrl === 'home' || isAILoading) return
    setAILoading(true)
    setLastSummary(null)
    setSavedBookmark(false)
    addAIMessage({ role: 'user', content: `📄 Summarize: ${currentTitle || currentUrl}` })
    try {
      const pageText = getPageContent ? await getPageContent() : ''
      const result = await window.electronAPI.ai.summarizePage(pageText, currentUrl)
      addAIMessage({ role: 'assistant', content: result.summary })
      const mdContent = [
        `# ${currentTitle || currentUrl}`,
        ``,
        `**URL:** ${currentUrl}`,
        `**Date:** ${new Date().toLocaleDateString()}`,
        `**Summarized by:** AIHub Browser AI`,
        ``,
        `---`,
        ``,
        result.summary,
      ].join('\n')
      setLastSummary({ title: currentTitle || 'Article Summary', url: currentUrl, mdContent })
    } catch {
      addAIMessage({ role: 'assistant', content: 'Unable to summarize at this time.' })
    } finally {
      setAILoading(false)
    }
  }

  const attachPage = async () => {
    if (!currentUrl || currentUrl === 'home' || isAILoading || !getPageContent) return
    try {
      const pageText = await getPageContent()
      if (!pageText) { addAIMessage({ role: 'assistant', content: 'Could not extract page content.' }); return }
      const snippet = pageText.slice(0, 300).replace(/\s+/g, ' ').trim()
      addAIMessage({ role: 'user', content: `📎 Attached page: "${currentTitle}"\n\n${snippet}…\n\n(Ask me anything about this page)` })
      addAIMessage({ role: 'assistant', content: `I've attached "${currentTitle}". Ask me anything about this page — I can summarize it, answer questions, extract key points, or help you research further.` })
    } catch {}
  }

  const downloadSummaryMd = async () => {
    if (!lastSummary || savingMd) return
    setSavingMd(true)
    try {
      await (window.electronAPI as any).file.saveMd({ title: lastSummary.title, content: lastSummary.mdContent })
    } finally {
      setSavingMd(false)
    }
  }

  const saveAsArticleBookmark = async () => {
    if (!lastSummary || savedBookmark) return
    try {
      await window.electronAPI.bookmarks.add({
        id: `article-${Date.now()}`,
        url: lastSummary.url,
        title: lastSummary.title,
        favicon: '',
        category: 'Articles',
        addedAt: Date.now(),
        color: '#f59e0b',
      })
      setSavedBookmark(true)
    } catch {}
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const hasUrl = !!(currentUrl && currentUrl !== 'home')

  return (
    <AnimatePresence>
      {isAIPanelOpen && (
        <motion.div
          initial={{ x: 20, opacity: 0, scale: 0.97 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: 20, opacity: 0, scale: 0.97 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="no-drag"
          style={{
            position: 'fixed',
            right: 14,
            top: 92,
            bottom: 14,
            width: 360,
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 16,
            overflow: 'hidden',
            background: 'linear-gradient(180deg, rgba(10,18,36,0.95) 0%, rgba(7,12,26,0.97) 100%)',
            backdropFilter: 'blur(28px)',
            WebkitBackdropFilter: 'blur(28px)',
            border: '1px solid rgba(59,130,246,0.18)',
            boxShadow: [
              'inset 0 1px 0 rgba(255,255,255,0.07)',
              '0 8px 48px rgba(0,0,0,0.65)',
              '0 0 80px rgba(59,130,246,0.05)',
            ].join(', '),
          }}
        >
          {/* Top Aero highlight line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 1, zIndex: 1,
            background: 'linear-gradient(90deg, transparent 5%, rgba(96,165,250,0.45) 50%, transparent 95%)',
            pointerEvents: 'none',
          }} />

          {/* ── Header ── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px 10px',
            borderBottom: '1px solid rgba(59,130,246,0.1)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(59,130,246,0.28), rgba(139,92,246,0.18))',
                border: '1px solid rgba(59,130,246,0.28)',
                boxShadow: '0 0 16px rgba(59,130,246,0.18)',
              }}>
                <Bot size={16} style={{ color: '#60a5fa' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', lineHeight: 1 }}>AIHub Assistant</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                  {ollamaStatus === null ? (
                    <>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#475569', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <span style={{ fontSize: 11, color: '#475569' }}>Connecting…</span>
                    </>
                  ) : ollamaStatus.running ? (
                    <>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block', boxShadow: '0 0 6px #34d399' }} />
                      <span style={{ fontSize: 11, color: '#34d399' }}>Local · Ollama</span>
                    </>
                  ) : (
                    <>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa', display: 'inline-block', boxShadow: '0 0 6px #60a5fa' }} />
                      <span style={{ fontSize: 11, color: '#60a5fa' }}>Cloud · OpenRouter</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <HeaderBtn onClick={clearAIMessages} title="Clear chat"><Trash2 size={13} /></HeaderBtn>
              <HeaderBtn onClick={toggleAIPanel} title="Close"><X size={14} /></HeaderBtn>
            </div>
          </div>

          {/* ── Quick actions ── */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {/* Summarize */}
              <QuickBtn
                onClick={summarizePage}
                disabled={!hasUrl || isAILoading}
                color="blue"
                icon={<FileText size={12} style={{ flexShrink: 0 }} />}
                label="Summarize"
                title="Summarize current page"
              />
              {/* Attach */}
              <QuickBtn
                onClick={attachPage}
                disabled={!hasUrl || isAILoading || !getPageContent}
                color="purple"
                icon={<Paperclip size={12} style={{ flexShrink: 0 }} />}
                label="Attach Page"
                title="Attach page content to chat"
              />
              {/* Latest AI News */}
              <QuickBtn
                onClick={() => { setInput('Latest AI news and articles'); setTimeout(() => inputRef.current?.focus(), 50) }}
                disabled={isAILoading}
                color="amber"
                icon={<Newspaper size={12} style={{ flexShrink: 0 }} />}
                label="AI News"
                title="Fetch latest AI news from Hacker News"
              />
            </div>

            {/* Post-summarize actions */}
            <AnimatePresence>
              {lastSummary && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ display: 'flex', gap: 6, marginTop: 6, overflow: 'hidden' }}
                >
                  {/* Download .md */}
                  <button
                    onClick={downloadSummaryMd}
                    disabled={savingMd}
                    title="Download summary as Markdown file"
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      padding: '6px 8px', borderRadius: 9, border: '1px solid rgba(16,185,129,0.3)',
                      background: 'rgba(16,185,129,0.08)', cursor: 'pointer',
                      color: '#34d399', fontSize: 10, fontWeight: 600,
                      opacity: savingMd ? 0.5 : 1, transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.16)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.08)' }}
                  >
                    {savingMd ? <Loader2 size={10} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Download size={10} />}
                    Download .md
                  </button>

                  {/* Save to Articles bookmark */}
                  <button
                    onClick={saveAsArticleBookmark}
                    disabled={savedBookmark}
                    title="Save to Articles cluster in Bookmark Sphere"
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      padding: '6px 8px', borderRadius: 9, border: `1px solid ${savedBookmark ? 'rgba(245,158,11,0.5)' : 'rgba(245,158,11,0.3)'}`,
                      background: savedBookmark ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.08)',
                      cursor: savedBookmark ? 'default' : 'pointer',
                      color: savedBookmark ? '#fbbf24' : '#f59e0b', fontSize: 10, fontWeight: 600,
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { if (!savedBookmark) (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.16)' }}
                    onMouseLeave={e => { if (!savedBookmark) (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.08)' }}
                  >
                    {savedBookmark ? <Check size={10} /> : <BookmarkPlus size={10} />}
                    {savedBookmark ? 'Saved to Articles' : 'Save to Articles'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Offline notice ── */}
          {ollamaStatus && !ollamaStatus.running && (
            <div style={{
              margin: '8px 12px 0', padding: '8px 12px', borderRadius: 10, flexShrink: 0,
              background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.13)',
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <AlertCircle size={13} style={{ color: '#60a5fa', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                Using <b style={{ color: '#93c5fd' }}>OpenRouter</b> (cloud). Install Ollama for private local AI.
              </span>
            </div>
          )}

          {/* ── News fetching indicator ── */}
          <AnimatePresence>
            {fetchingNews && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ margin: '6px 12px 0', padding: '6px 12px', borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
              >
                <Loader2 size={11} style={{ color: '#f59e0b', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#92400e' }}>Fetching live AI news from Hacker News…</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Messages ── */}
          <div
            ref={scrollRef}
            style={{
              flex: 1, overflowY: 'auto', padding: 12,
              scrollbarWidth: 'thin', scrollbarColor: 'rgba(59,130,246,0.2) transparent',
              userSelect: 'text', WebkitUserSelect: 'text',
            }}
          >
            {aiMessages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: '24px 0', textAlign: 'center' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))',
                  border: '1px solid rgba(59,130,246,0.2)',
                  boxShadow: '0 0 28px rgba(59,130,246,0.12)',
                }}>
                  <Sparkles size={24} style={{ color: '#60a5fa' }} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>Your AI Browser Assistant</div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6, maxWidth: 240 }}>
                    Ask me anything — web research, page summaries, latest AI news, writing, or code.
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50) }}
                      style={{
                        textAlign: 'left', padding: '9px 12px', borderRadius: 10, fontSize: 12,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                        color: '#64748b', cursor: 'pointer', transition: 'all 0.12s',
                        userSelect: 'none',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.09)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,0.2)'; (e.currentTarget as HTMLElement).style.color = '#94a3b8' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.color = '#64748b' }}
                    >
                      <span style={{ color: '#3b82f6', marginRight: 6 }}>›</span>{s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {aiMessages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16 }}
                  style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-start', gap: 8 }}
                >
                  {msg.role === 'assistant' && (
                    <div style={{
                      width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
                      background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.2)',
                    }}>
                      <Zap size={11} style={{ color: '#60a5fa' }} />
                    </div>
                  )}
                  <div
                    style={msg.role === 'user' ? {
                      maxWidth: '82%', borderRadius: 14, borderTopRightRadius: 4,
                      padding: '9px 12px', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      background: 'linear-gradient(135deg, rgba(59,130,246,0.82), rgba(99,102,241,0.72))',
                      color: '#fff',
                      boxShadow: '0 2px 14px rgba(59,130,246,0.28)',
                      userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
                    } : {
                      maxWidth: '82%', borderRadius: 14, borderTopLeftRadius: 4,
                      padding: '9px 12px', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#cbd5e1',
                      userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
                    }}
                  >
                    {msg.content}
                  </div>
                </motion.div>
              ))}
            </div>

            {isAILoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.2)',
                }}>
                  <Zap size={11} style={{ color: '#60a5fa' }} />
                </div>
                <div style={{
                  display: 'flex', gap: 4, padding: '9px 14px', borderRadius: 14, borderTopLeftRadius: 4,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  {[0, 1, 2].map(n => (
                    <span key={n} style={{
                      width: 6, height: 6, borderRadius: '50%', background: '#60a5fa', display: 'inline-block',
                      animation: `aiDotBounce 1.3s ease-in-out ${n * 0.18}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Input ── */}
          <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div
              style={{
                display: 'flex', alignItems: 'flex-end', gap: 8,
                padding: '8px 12px', borderRadius: 14,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.09)',
                transition: 'border-color 0.12s',
              }}
              onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,0.4)'}
              onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.09)'}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask AIHub Assistant…"
                rows={1}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                  fontSize: 12, color: '#e2e8f0', lineHeight: 1.5, maxHeight: 96, overflowY: 'auto',
                  userSelect: 'text',
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isAILoading}
                style={{
                  width: 30, height: 30, borderRadius: 10, border: 'none', cursor: input.trim() ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: input.trim() && !isAILoading
                    ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
                    : 'rgba(255,255,255,0.06)',
                  opacity: !input.trim() || isAILoading ? 0.35 : 1,
                  boxShadow: input.trim() && !isAILoading ? '0 2px 14px rgba(59,130,246,0.4)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {isAILoading
                  ? <Loader2 size={13} style={{ color: '#60a5fa', animation: 'spin 0.7s linear infinite' }} />
                  : <Send size={13} style={{ color: '#fff' }} />}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, padding: '0 2px' }}>
              <span style={{ fontSize: 10, color: '#334155' }}>↵ send · Shift+↵ newline</span>
              {ollamaStatus?.running
                ? <span style={{ fontSize: 10, color: 'rgba(52,211,153,0.5)' }}>● local</span>
                : <span style={{ fontSize: 10, color: 'rgba(96,165,250,0.4)' }}>● cloud</span>}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Shared quick-action button ────────────────────────────────────────────────
type BtnColor = 'blue' | 'purple' | 'amber'
const COLOR_MAP: Record<BtnColor, { normal: string; hover: string; border: string; text: string }> = {
  blue:   { normal: 'rgba(59,130,246,0.1)',   hover: 'rgba(59,130,246,0.18)',  border: 'rgba(59,130,246,0.22)',  text: '#93c5fd' },
  purple: { normal: 'rgba(139,92,246,0.1)',   hover: 'rgba(139,92,246,0.18)', border: 'rgba(139,92,246,0.22)', text: '#c4b5fd' },
  amber:  { normal: 'rgba(245,158,11,0.08)',  hover: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.22)', text: '#fbbf24' },
}

function QuickBtn({ onClick, disabled, color, icon, label, title }: {
  onClick: () => void; disabled?: boolean; color: BtnColor; icon: React.ReactNode; label: string; title?: string
}) {
  const c = COLOR_MAP[color]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        padding: '7px 6px', borderRadius: 10, border: `1px solid ${c.border}`,
        background: disabled ? 'rgba(255,255,255,0.03)' : c.normal,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? '#4a5568' : c.text, fontSize: 10, fontWeight: 500,
        opacity: disabled ? 0.5 : 1, transition: 'all 0.12s',
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = c.hover }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = c.normal }}
    >
      {icon}
      {label}
    </button>
  )
}

function HeaderBtn({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
        color: hovered ? '#e2e8f0' : '#475569', transition: 'all 0.12s',
      }}
    >
      {children}
    </button>
  )
}
