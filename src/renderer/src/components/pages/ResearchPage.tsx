import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FlaskConical, Loader2, Sparkles, ExternalLink, FileText, Download, RefreshCw, Plus, X } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

interface Props { onNavigate?: (url: string) => void }

export default function ResearchPage({ onNavigate }: Props) {
  const { tabs } = useBrowserStore()
  const [report,      setReport]      = useState('')
  const [loading,     setLoading]     = useState(false)
  const [mode,        setMode]        = useState<'summary' | 'compare' | 'bibliography'>('summary')
  const [extraUrls,   setExtraUrls]   = useState<string[]>([])
  const [urlInput,    setUrlInput]    = useState('')
  const [error,       setError]       = useState('')

  const browserTabs = tabs.filter(t => !t.isHome && t.pageType === 'browser' && t.url?.startsWith('http'))

  const addUrl = () => {
    const u = urlInput.trim()
    if (!u || extraUrls.includes(u)) { setUrlInput(''); return }
    try { new URL(u.startsWith('http') ? u : `https://${u}`) } catch { setError('Invalid URL'); return }
    setExtraUrls(prev => [...prev, u.startsWith('http') ? u : `https://${u}`])
    setUrlInput('')
    setError('')
  }

  const removeExtra = (u: string) => setExtraUrls(prev => prev.filter(x => x !== u))

  const allSources = [
    ...browserTabs.map(t => ({ url: t.url, title: t.title || t.url })),
    ...extraUrls.map(u => ({ url: u, title: u })),
  ]

  const runResearch = async () => {
    if (allSources.length === 0) { setError('Add at least one URL or open browser tabs first.'); return }
    setError('')
    setLoading(true)
    setReport('')

    const modeInstructions = {
      summary: 'Provide a comprehensive multi-source research summary covering the main themes, key points, and insights from all sources. Use markdown with headers.',
      compare: 'Compare and contrast these sources. Identify agreements, contradictions, unique perspectives, and gaps. Use a structured markdown format with a comparison table.',
      bibliography: 'Create a formatted bibliography with a brief annotation for each source. Include what each source covers and its relevance. Use markdown.',
    }

    const sourceList = allSources.map((s, i) => `${i + 1}. ${s.title}\n   URL: ${s.url}`).join('\n\n')

    const prompt = `You are a research assistant analyzing multiple web sources.\n\n**Research Task:** ${modeInstructions[mode]}\n\n**Sources to analyze:**\n\n${sourceList}\n\nGenerate a thorough research ${mode} based on these sources. Be specific, cite source numbers where relevant, and provide actionable insights.`

    try {
      const result = await window.electronAPI.ai.chat([
        { role: 'system', content: 'You are an expert research analyst. Produce well-structured, insightful reports in markdown format.' },
        { role: 'user', content: prompt },
      ])
      setReport(result.content || 'No response from AI.')
    } catch {
      setError('AI request failed. Check your AI configuration in Settings.')
    } finally {
      setLoading(false)
    }
  }

  const saveReport = async () => {
    if (!report) return
    const title = `Research Report — ${new Date().toLocaleDateString()}`
    const md = `# ${title}\n\n**Mode:** ${mode}\n\n**Sources:**\n${allSources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')}\n\n---\n\n${report}`
    await (window.electronAPI as any).file.saveMd({ title, content: md })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden page-enter"
      style={{ background: 'linear-gradient(160deg,#060a16 0%,#070b18 100%)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid rgba(59,130,246,0.10)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,rgba(56,189,248,0.2),rgba(59,130,246,0.14))', border: '1px solid rgba(56,189,248,0.25)' }}>
            <FlaskConical size={18} style={{ color: '#38bdf8' }} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">Research Mode</div>
            <div className="text-xs text-slate-600">AI-powered multi-source analysis workspace</div>
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {(['summary', 'compare', 'bibliography'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize"
              style={mode === m ? {
                background: 'rgba(56,189,248,0.16)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.22)',
              } : {
                color: '#4a6080', border: '1px solid transparent',
              }}
              onMouseEnter={e => { if (mode !== m) (e.currentTarget as HTMLElement).style.color = '#94a3b8' }}
              onMouseLeave={e => { if (mode !== m) (e.currentTarget as HTMLElement).style.color = '#4a6080' }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">

        {/* Left panel — sources */}
        <div className="w-72 shrink-0 flex flex-col border-r overflow-hidden"
          style={{ borderColor: 'rgba(59,130,246,0.08)', background: 'rgba(255,255,255,0.015)' }}>
          <div className="px-4 pt-4 pb-3 shrink-0">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">Sources</div>

            {/* Open tabs */}
            {browserTabs.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] text-slate-700 uppercase tracking-wider mb-2">Open Tabs</div>
                <div className="space-y-1.5">
                  {browserTabs.map(t => (
                    <SourceRow key={t.id} url={t.url} title={t.title || t.url} onNavigate={onNavigate} />
                  ))}
                </div>
              </div>
            )}

            {/* Extra URLs */}
            {extraUrls.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] text-slate-700 uppercase tracking-wider mb-2">Added URLs</div>
                <div className="space-y-1.5">
                  {extraUrls.map(u => (
                    <div key={u} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <img src={`https://www.google.com/s2/favicons?domain=${u}&sz=16`} className="w-3.5 h-3.5 rounded shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      <span className="flex-1 text-xs text-slate-500 truncate">{u.replace(/^https?:\/\//, '').slice(0, 30)}</span>
                      <button onClick={() => removeExtra(u)} className="shrink-0 text-slate-700 hover:text-red-400 transition-colors">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add URL input */}
            <div className="flex gap-1.5">
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addUrl() }}
                placeholder="Add URL…"
                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 placeholder:text-slate-700 outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', userSelect: 'text' }}
              />
              <button onClick={addUrl}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.22)', color: '#38bdf8' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(56,189,248,0.2)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(56,189,248,0.12)' }}>
                <Plus size={13} />
              </button>
            </div>
            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          </div>

          {/* Source count + Run button */}
          <div className="px-4 pb-4 mt-auto shrink-0">
            <div className="text-xs text-slate-700 mb-3">
              {allSources.length} source{allSources.length !== 1 ? 's' : ''} ready
            </div>
            <button
              onClick={runResearch}
              disabled={loading || allSources.length === 0}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: loading || allSources.length === 0
                  ? 'rgba(56,189,248,0.06)'
                  : 'linear-gradient(135deg,rgba(56,189,248,0.22),rgba(59,130,246,0.18))',
                border: `1px solid ${loading || allSources.length === 0 ? 'rgba(56,189,248,0.12)' : 'rgba(56,189,248,0.35)'}`,
                color: loading || allSources.length === 0 ? '#2d5060' : '#38bdf8',
                cursor: loading || allSources.length === 0 ? 'not-allowed' : 'pointer',
                boxShadow: loading || allSources.length === 0 ? 'none' : '0 4px 20px rgba(56,189,248,0.15)',
              }}
            >
              {loading
                ? <><Loader2 size={14} className="animate-spin" />Analyzing…</>
                : <><FlaskConical size={14} />Run Research</>}
            </button>
          </div>
        </div>

        {/* Right panel — report */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Report toolbar */}
          <div className="flex items-center justify-between px-5 py-3 shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2">
              <FileText size={13} className="text-slate-600" />
              <span className="text-xs text-slate-600 font-medium">Research Report</span>
            </div>
            {report && (
              <div className="flex items-center gap-2">
                <button onClick={runResearch} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                  Regenerate
                </button>
                <button onClick={saveReport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.22)', color: '#38bdf8' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(56,189,248,0.18)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(56,189,248,0.1)' }}>
                  <Download size={11} />
                  Save .md
                </button>
              </div>
            )}
          </div>

          {/* Report body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {!report && !loading && (
              <motion.div
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center h-full gap-4 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.14)' }}>
                  <Sparkles size={28} style={{ color: 'rgba(56,189,248,0.4)' }} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-500 mb-2">Ready to research</div>
                  <div className="text-xs text-slate-700 max-w-xs leading-relaxed">
                    Open tabs in the browser or add URLs on the left, then click <span className="text-sky-600">Run Research</span> to generate an AI report.
                  </div>
                </div>
              </motion.div>
            )}

            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)' }}>
                  <Loader2 size={22} className="animate-spin" style={{ color: '#38bdf8' }} />
                </div>
                <div className="text-sm text-slate-600">Analyzing {allSources.length} source{allSources.length !== 1 ? 's' : ''}…</div>
              </motion.div>
            )}

            <AnimatePresence>
              {report && !loading && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
                  className="prose prose-sm max-w-none"
                  style={{ '--tw-prose-body': '#94a3b8', '--tw-prose-headings': '#e2e8f0', '--tw-prose-code': '#38bdf8' } as any}>
                  <ReportRenderer content={report} onNavigate={onNavigate} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

function SourceRow({ url, title, onNavigate }: { url: string; title: string; onNavigate?: (u: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg group transition-all"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(56,189,248,0.18)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)' }}>
      <img src={`https://www.google.com/s2/favicons?domain=${url}&sz=16`} className="w-3.5 h-3.5 rounded shrink-0"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
      <span className="flex-1 text-xs text-slate-500 truncate">{title.slice(0, 28)}</span>
      {onNavigate && (
        <button onClick={() => onNavigate(url)}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-700 hover:text-sky-400">
          <ExternalLink size={10} />
        </button>
      )}
    </div>
  )
}

function ReportRenderer({ content, onNavigate }: { content: string; onNavigate?: (u: string) => void }) {
  const lines = content.split('\n')
  return (
    <div style={{ fontFamily: 'inherit' }}>
      {lines.map((line, i) => {
        if (line.startsWith('# '))       return <h1 key={i} style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0', marginBottom: 12, marginTop: i > 0 ? 24 : 0 }}>{line.slice(2)}</h1>
        if (line.startsWith('## '))      return <h2 key={i} style={{ fontSize: 15, fontWeight: 600, color: '#cbd5e1', marginBottom: 8, marginTop: 20 }}>{line.slice(3)}</h2>
        if (line.startsWith('### '))     return <h3 key={i} style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 6, marginTop: 16 }}>{line.slice(4)}</h3>
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} style={{ fontSize: 13, color: '#64748b', marginBottom: 4, marginLeft: 16 }}>{renderInline(line.slice(2))}</li>
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>{line.slice(2, -2)}</p>
        if (line.startsWith('---'))      return <hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.07)', margin: '16px 0' }} />
        if (line.trim() === '')          return <div key={i} style={{ height: 6 }} />
        return <p key={i} style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, marginBottom: 6 }}>{renderInline(line)}</p>
      })}
    </div>
  )
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} style={{ color: '#94a3b8', fontWeight: 600 }}>{p.slice(2, -2)}</strong>
    }
    return p
  })
}
