// ResearchPage.tsx — F5: Research Workspace Mode
// Split-view workspace: notepad (left) + sources/tiles (center) + report (right).
// Auto-saves notes to localStorage. AI extracts key points from active tabs.

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FlaskConical, Loader2, Sparkles, ExternalLink, FileText,
  Download, RefreshCw, Plus, X, Lightbulb, StickyNote,
  LayoutGrid, ArrowRight, Save,
} from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { cleanNarration } from '../../services/agentTools'
import { buildPageExtractionScript } from '../../services/pageExtractor'
import Markdown from '../ai/Markdown'
import Favicon from '../common/Favicon'

interface Props { onNavigate?: (url: string) => void }

// ─── Types ────────────────────────────────────────────────────────────────────

interface NoteEntry {
  id: string
  text: string
  sourceTitle?: string
  sourceUrl?: string
  pageType?: string
  addedAt: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOTE_STORAGE_KEY = 'aihub-research-notes-v1'

function loadNotes(): NoteEntry[] {
  try {
    const raw = localStorage.getItem(NOTE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveNotes(notes: NoteEntry[]) {
  try { localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(notes)) } catch {}
}

const NOTEPAD_SYSTEM = `You are a research notepad assistant. You help extract concise, citeable key points from web page text.

Extract 1-3 "note cards" from the provided page text. Each note card should be:
- A factual insight (1-2 sentences)
- Something a researcher would want to remember
- General enough to be useful, specific enough to be precise

Return ONLY valid JSON wrapped in triple-backtick json fences:
{
  "notes": [
    {
      "text": "The key insight from this page...",
      "sourceTitle": "Page Title Here",
      "sourceUrl": "https://...",
      "pageType": "article|product|documentation|other"
    }
  ]
}

If the page has no useful content, return empty notes array.`

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResearchPage({ onNavigate }: Props) {
  const { tabs } = useBrowserStore()

  // ── Notepad state ──
  const [notes,     setNotes]     = useState<NoteEntry[]>(loadNotes)
  const [draft,     setDraft]     = useState('')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // ── Sources / tabs state ──
  const [mode,      setMode]      = useState<'summary' | 'compare' | 'bibliography'>('summary')
  const [extraUrls, setExtraUrls] = useState<string[]>([])
  const [urlInput,  setUrlInput]  = useState('')
  const [error,     setError]     = useState('')

  // ── Extracting state (per tab) ──
  const [extractingTab, setExtractingTab] = useState<string | null>(null)
  const [extractedUrls, setExtractedUrls] = useState<Set<string>>(new Set())

  // ── Report state ──
  const [report,  setReport]  = useState('')
  const [loading, setLoading] = useState(false)

  // ── Layout ──
  const [view, setView] = useState<'workspace' | 'report'>('workspace')

  const browserTabs = tabs.filter(t => !t.isHome && t.pageType === 'browser' && t.url?.startsWith('http'))

  // Auto-save notes on change
  useEffect(() => { saveNotes(notes) }, [notes])

  // ── Add note ──
  const addNote = useCallback((entry: NoteEntry) => {
    setNotes(prev => [entry, ...prev])
    setLastSaved(new Date())
  }, [])

  // ── Delete note ──
  const deleteNote = useCallback((id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id))
  }, [])

  // ── Save draft as note ──
  const saveDraft = () => {
    const text = draft.trim()
    if (!text) return
    addNote({ id: `manual-${Date.now()}`, text, addedAt: Date.now() })
    setDraft('')
    setLastSaved(new Date())
  }

  // ── Extract from tab ──
  const extractFromTab = useCallback(async (tab: typeof browserTabs[0]) => {
    if (extractingTab || extractedUrls.has(tab.url)) return
    setExtractingTab(tab.id)

    let text = ''
    const wcId = useBrowserStore.getState().tabWcIds[tab.id]

    if (wcId) {
      try {
        const result = await window.electronAPI.webview.execScript(wcId, buildPageExtractionScript())
        if ((result as any)?.result) {
          text = String((result as any).result).slice(0, 4000)
        }
      } catch { text = '' }
    }

    if (!text || text.length < 80) {
      text = `Title: ${tab.title || tab.url}\nURL: ${tab.url}`
    }

    try {
      const api = (window as any).electronAPI?.ai
      if (!api?.chat) throw new Error('No AI API')

      const response = await api.chat([
        { role: 'system', content: NOTEPAD_SYSTEM },
        { role: 'user', content: text },
      ])

      const raw = typeof response === 'string' ? response : JSON.stringify(response)
      const match = raw.match(/```json\s*([\s\S]*?)\s*```/) ||
        raw.match(/\{[\s\S]*?"notes"[\s\S]*?\}/)
      if (match) {
        const parsed = JSON.parse(match[1] || match[0])
        const newNotes: NoteEntry[] = (parsed.notes || []).slice(0, 3).map((n: any) => ({
          id: `extracted-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: String(n.text || '').trim(),
          sourceTitle: n.sourceTitle || tab.title,
          sourceUrl:   n.sourceUrl   || tab.url,
          pageType:    n.pageType    || 'other',
          addedAt:     Date.now(),
        }))
        for (const n of newNotes) addNote(n)
      }
    } catch {
      // Fallback: add the title as a note
      if (tab.title && tab.title !== tab.url) {
        addNote({
          id: `fallback-${Date.now()}`,
          text: tab.title,
          sourceTitle: tab.title,
          sourceUrl: tab.url,
          addedAt: Date.now(),
        })
      }
    } finally {
      setExtractingTab(null)
      setExtractedUrls(prev => new Set([...prev, tab.url]))
    }
  }, [extractingTab, extractedUrls, addNote])

  // ── Sources ──
  const addUrl = () => {
    const u = urlInput.trim()
    if (!u || extraUrls.includes(u)) { setUrlInput(''); return }
    try { new URL(u.startsWith('http') ? u : `https://${u}`) } catch { setError('Invalid URL'); return }
    setExtraUrls(prev => [...prev, u.startsWith('http') ? u : `https://${u}`])
    setUrlInput('')
    setError('')
  }

  const allSources = [
    ...browserTabs.map(t => ({ url: t.url, title: t.title || t.url })),
    ...extraUrls.map(u => ({ url: u, title: u })),
  ]

  // ── Run research ──
  const runResearch = async () => {
    if (allSources.length === 0 && notes.length === 0) {
      setError('Add sources or take notes first.')
      return
    }
    setError('')
    setLoading(true)
    setReport('')

    const modeInstructions = {
      summary:    'Provide a comprehensive multi-source research summary covering the main themes, key points, and insights from all sources. Use markdown with headers.',
      compare:    'Compare and contrast these sources. Identify agreements, contradictions, unique perspectives, and gaps. Use a structured markdown format with a comparison table.',
      bibliography: 'Create a formatted bibliography with a brief annotation for each source. Include what each source covers and its relevance. Use markdown.',
    }

    const noteLines = notes
      .filter(n => n.sourceUrl)
      .map(n => `- ${n.text}${n.sourceUrl ? ` [Source](${n.sourceUrl})` : ''}`)
      .join('\n')

    const sourceList = allSources.map((s, i) => `${i + 1}. ${s.title}\n   URL: ${s.url}`).join('\n\n')

    const noteSection = noteLines ? `\n**Research Notes:**\n${noteLines}\n` : ''

    const prompt = `You are a research assistant analyzing multiple web sources.\n\n**Research Task:** ${modeInstructions[mode]}\n\n**Sources to analyze:**\n\n${sourceList}\n${noteSection}Generate a thorough research ${mode} based on these sources. Be specific, cite source numbers where relevant, and provide actionable insights.`

    try {
      const result = await window.electronAPI.ai.chat([
        { role: 'system', content: 'You are an expert research analyst. Produce well-structured, insightful reports in GitHub-flavored markdown: ## sections, **bold** key terms, and a markdown table wherever you are comparing options, specifications, prices or any other multi-attribute data. End with a Sources section of [title](url) links to what you actually read.' },
        { role: 'user', content: prompt },
      ])
      setReport(cleanNarration(result.content || '') || 'No response from AI.')
      setView('report')
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

  // ── Render ──
  return (
    <div className="flex flex-col h-full overflow-hidden page-enter"
      style={{ background: 'var(--ds-page-bg)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(59,130,246,0.10)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,rgba(56,189,248,0.2),rgba(59,130,246,0.14))', border: '1px solid rgba(56,189,248,0.25)' }}>
            <FlaskConical size={16} style={{ color: '#38bdf8' }} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">Research Workspace</div>
            <div className="text-xs text-slate-600">{notes.length} note{notes.length !== 1 ? 's' : ''} · {allSources.length} source{allSources.length !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode selector */}
          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
            {(['summary', 'compare', 'bibliography'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className="px-3 py-1 rounded-lg text-xs font-semibold transition-all capitalize"
                style={mode === m ? {
                  background: 'rgba(56,189,248,0.16)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.22)',
                } : {
                  color: '#4a6080', border: '1px solid transparent',
                }}>
                {m}
              </button>
            ))}
          </div>

          {report && (
            <button onClick={() => setView(v => v === 'workspace' ? 'report' : 'workspace')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.22)', color: '#38bdf8' }}>
              {view === 'workspace' ? <><FileText size={11} /> View Report</> : <><LayoutGrid size={11} /> View Workspace</>}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {view === 'workspace' ? (
        <div className="flex flex-1 min-h-0">

          {/* ── Left: Notepad ── */}
          <div className="w-72 shrink-0 flex flex-col border-r overflow-hidden"
            style={{ borderColor: 'rgba(59,130,246,0.08)', background: 'rgba(255,255,255,0.015)' }}>
            <div className="px-4 pt-4 pb-2 shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StickyNote size={12} style={{ color: '#facc15' }} />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-600">Research Notes</span>
              </div>
              {lastSaved && (
                <span className="text-[10px] text-slate-700 flex items-center gap-1">
                  <Save size={9} /> Saved
                </span>
              )}
            </div>

            {/* Note list */}
            <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-2">
              {notes.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
                  <Lightbulb size={20} style={{ color: 'rgba(250,204,21,0.3)' }} />
                  <p className="text-xs text-center px-4">Click "Extract" on any tab to capture key points here</p>
                </div>
              )}
              {notes.map(note => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onDelete={deleteNote}
                  onNavigate={onNavigate}
                />
              ))}
            </div>

            {/* Draft input */}
            <div className="px-3 pb-3 shrink-0">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveDraft() }
                }}
                placeholder="Quick note… (Ctrl+Enter to save)"
                rows={3}
                className="w-full px-3 py-2 rounded-xl text-xs text-slate-300 placeholder:text-slate-700 resize-none outline-none"
                style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', userSelect: 'text' }}
              />
              <button onClick={saveDraft} disabled={!draft.trim()}
                className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: draft.trim() ? 'rgba(250,204,21,0.1)' : 'transparent',
                  border: `1px solid ${draft.trim() ? 'rgba(250,204,21,0.25)' : 'transparent'}`,
                  color: draft.trim() ? '#facc15' : '#2d3550',
                  cursor: draft.trim() ? 'pointer' : 'not-allowed',
                }}>
                <Plus size={11} /> Add note
              </button>
            </div>
          </div>

          {/* ── Center: Sources + tabs ── */}
          <div className="w-80 shrink-0 flex flex-col border-r overflow-hidden"
            style={{ borderColor: 'rgba(59,130,246,0.08)' }}>
            <div className="px-4 pt-4 pb-3 shrink-0">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">Sources</div>

              {browserTabs.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <LayoutGrid size={9} /> Open Tabs ({browserTabs.length})
                  </div>
                  <div className="space-y-1.5">
                    {browserTabs.map(t => (
                      <TabSourceRow
                        key={t.id}
                        tab={t}
                        extracting={extractingTab === t.id}
                        extracted={extractedUrls.has(t.url)}
                        onExtract={() => extractFromTab(t)}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                </div>
              )}

              {extraUrls.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] text-slate-700 uppercase tracking-wider mb-2">Added URLs</div>
                  <div className="space-y-1.5">
                    {extraUrls.map(u => (
                      <div key={u} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                        style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
                        <Favicon url={u} size={14} className="w-3.5 h-3.5 rounded shrink-0" />
                        <span className="flex-1 text-xs text-slate-500 truncate">{u.replace(/^https?:\/\//, '').slice(0, 30)}</span>
                        <button onClick={() => setExtraUrls(prev => prev.filter(x => x !== u))}
                          className="shrink-0 text-slate-700 hover:text-red-400 transition-colors">
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add URL */}
              <div className="flex gap-1.5">
                <input
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addUrl() }}
                  placeholder="Add URL…"
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 placeholder:text-slate-700 outline-none"
                  style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', userSelect: 'text' }}
                />
                <button onClick={addUrl}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                  style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.22)', color: '#38bdf8' }}>
                  <Plus size={13} />
                </button>
              </div>
              {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            </div>

            {/* Run button */}
            <div className="px-4 pb-4 mt-auto shrink-0">
              <div className="text-xs text-slate-700 mb-3">
                {allSources.length} source{allSources.length !== 1 ? 's' : ''} · {notes.length} note{notes.length !== 1 ? 's' : ''}
              </div>
              <button
                onClick={runResearch}
                disabled={loading || (allSources.length === 0 && notes.length === 0)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: loading || (allSources.length === 0 && notes.length === 0)
                    ? 'rgba(56,189,248,0.06)'
                    : 'linear-gradient(135deg,rgba(56,189,248,0.22),rgba(59,130,246,0.18))',
                  border: `1px solid ${loading || (allSources.length === 0 && notes.length === 0) ? 'rgba(56,189,248,0.12)' : 'rgba(56,189,248,0.35)'}`,
                  color: loading || (allSources.length === 0 && notes.length === 0) ? '#2d5060' : '#38bdf8',
                  cursor: loading || (allSources.length === 0 && notes.length === 0) ? 'not-allowed' : 'pointer',
                  boxShadow: loading || (allSources.length === 0 && notes.length === 0) ? 'none' : '0 4px 20px rgba(56,189,248,0.15)',
                }}
              >
                {loading
                  ? <><Loader2 size={14} className="animate-spin" />Analyzing…</>
                  : <><ArrowRight size={14} />Generate Report</>}
              </button>
            </div>
          </div>

          {/* ── Right: Preview / empty ── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center justify-center h-full">
              <motion.div
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center gap-4 text-center px-8">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.14)' }}>
                  <Sparkles size={24} style={{ color: 'rgba(56,189,248,0.4)' }} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-500 mb-2">Research workspace ready</div>
                  <div className="text-xs text-slate-700 max-w-xs leading-relaxed">
                    Add tabs and notes, then click <span className="text-sky-600">Generate Report</span> to create an AI research document.
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Report view ── */
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 shrink-0"
              style={{ borderBottom: '1px solid var(--ds-glass-sm)' }}>
              <div className="flex items-center gap-2">
                <FileText size={13} className="text-slate-600" />
                <span className="text-xs text-slate-600 font-medium">Research Report</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded text-slate-600"
                  style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
                  {mode}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setView('workspace')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  style={{ border: '1px solid var(--ds-border-sm)' }}>
                  <LayoutGrid size={11} /> Back to workspace
                </button>
                <button onClick={runResearch} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  style={{ border: '1px solid var(--ds-border-sm)' }}>
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                  Regenerate
                </button>
                <button onClick={saveReport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.22)', color: '#38bdf8' }}>
                  <Download size={11} /> Save .md
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-64 gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)' }}>
                    <Loader2 size={22} className="animate-spin" style={{ color: '#38bdf8' }} />
                  </div>
                  <div className="text-sm text-slate-600">Analyzing {allSources.length + notes.length} item{(allSources.length + notes.length) !== 1 ? 's' : ''}…</div>
                </motion.div>
              )}

              {!loading && !report && (
                <div className="flex flex-col items-center justify-center h-64 gap-4 text-center text-slate-700">
                  <FileText size={32} style={{ opacity: 0.3 }} />
                  <p className="text-sm">No report generated yet</p>
                </div>
              )}

              <AnimatePresence>
                {report && !loading && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
                    className="prose prose-sm max-w-none"
                    style={{ '--tw-prose-body': 'rgb(var(--ds-text-3))', '--tw-prose-headings': 'rgb(var(--ds-text-2))', '--tw-prose-code': '#38bdf8' } as any}>
                    <ReportRenderer content={report} onNavigate={onNavigate} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const PAGE_TYPE_COLORS: Record<string, string> = {
  article:      '#38bdf8',
  product:      '#f97316',
  documentation:'#a78bfa',
  video:        '#ef4444',
  other:        '#64748b',
}

function NoteCard({ note, onDelete, onNavigate }: {
  note: NoteEntry
  onDelete: (id: string) => void
  onNavigate?: (url: string) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
      className="p-3 rounded-xl relative group"
      style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
      <div className="text-xs text-slate-400 leading-relaxed pr-6" style={{ userSelect: 'text' }}>
        {note.text}
      </div>
      {note.sourceUrl && (
        <button
          onClick={() => onNavigate?.(note.sourceUrl!)}
          className="mt-1.5 flex items-center gap-1 text-[10px] transition-colors"
          style={{ color: PAGE_TYPE_COLORS[note.pageType || 'other'] || '#64748b' }}>
          <ExternalLink size={9} />
          <span className="truncate max-w-[160px]">{note.sourceTitle || note.sourceUrl}</span>
        </button>
      )}
      <button
        onClick={() => onDelete(note.id)}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded transition-all"
        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
        <X size={9} />
      </button>
    </motion.div>
  )
}

function TabSourceRow({ tab, extracting, extracted, onExtract, onNavigate }: {
  tab: { id: string; url: string; title?: string }
  extracting: boolean
  extracted: boolean
  onExtract: () => void
  onNavigate?: (url: string) => void
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg group transition-all"
      style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
      <Favicon url={tab.url} size={14} className="w-3.5 h-3.5 rounded shrink-0" />
      <span className="flex-1 text-xs text-slate-500 truncate">{tab.title?.slice(0, 26) || tab.url.slice(0, 26)}</span>
      {onNavigate && (
        <button onClick={() => onNavigate(tab.url)}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-700 hover:text-sky-400">
          <ExternalLink size={10} />
        </button>
      )}
      <button
        onClick={onExtract}
        disabled={extracting || extracted}
        title={extracted ? 'Extracted' : 'Extract key points to notes'}
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all"
        style={{
          background: extracted ? 'rgba(34,197,94,0.1)' : extracting ? 'rgba(56,189,248,0.1)' : 'transparent',
          border: `1px solid ${extracted ? 'rgba(34,197,94,0.25)' : extracting ? 'rgba(56,189,248,0.2)' : 'transparent'}`,
          color: extracted ? '#22c55e' : extracting ? '#38bdf8' : 'transparent',
          cursor: extracted || extracting ? 'default' : 'pointer',
        }}>
        {extracting ? <Loader2 size={10} className="animate-spin" /> : extracted ? '✓' : <Lightbulb size={10} style={{ color: '#facc15' }} />}
      </button>
    </div>
  )
}

function ReportRenderer({ content, onNavigate }: { content: string; onNavigate?: (u: string) => void }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7, color: 'rgb(var(--ds-text-3))', userSelect: 'text' }}>
      <Markdown content={content} onNavigate={onNavigate || (() => {})} />
    </div>
  )
}
