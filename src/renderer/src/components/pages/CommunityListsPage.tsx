// CommunityListsPage.tsx — F10: Community Reading Lists
// Curated public link collections. Browse curated lists, subscribe to authors,
// and manage your own reading lists. AI-generated summaries help decide whether
// a list is worth your time.

import React, { useState, useCallback } from 'react'
import {
  Plus, Search, Users, BookOpen, Sparkles, ExternalLink,
  Trash2, Check, X, Loader2,
} from 'lucide-react'
import {
  useReadingLists, uniqueThemes, type ReadingList, type ReadingListItem,
  createList, deleteList, updateList, addItem, removeItem, toggleSubscribe,
} from '../../services/readingLists'
import { useBrowserStore } from '../../store/browserStore'

// ─── AI summary prompt ────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = `You are a reading-list curator. You read the URLs provided and produce a concise 2-3 sentence summary of what this list is about, who it's for, and why the links are worth saving. Be specific about the themes and angle.`

const SUMMARY_USER = (list: ReadingList) => {
  const links = list.items.map(i => `- ${i.title}: ${i.url}${i.note ? ` — "${i.note}"` : ''}`).join('\n')
  return `Summarise this reading list in 2-3 sentences.\n\nTitle: ${list.title}\nDescription: ${list.description}\nLinks:\n${links}`
}

async function aiSummarise(list: ReadingList): Promise<string> {
  const api = (window as any).electronAPI?.ai
  if (!api) return 'AI summarisation unavailable — no AI provider configured.'
  try {
    const out = await api.chat({ messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user',   content: SUMMARY_USER(list) },
    ]})
    return out?.text?.trim() || 'No summary generated.'
  } catch {
    return 'Summary generation failed.'
  }
}

// ─── Add-to-list drawer ────────────────────────────────────────────────────────

function AddToListDrawer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const { lists } = useReadingLists()
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const handleAdd = useCallback((listId: string) => {
    addItem(listId, { url, title })
    setAdded(prev => ({ ...prev, [listId]: true }))
  }, [url, title])

  const handleCreate = () => {
    if (!newTitle.trim()) return
    const list = createList({
      title: newTitle.trim(),
      description: '',
      theme: 'General',
      visibility: 'private',
      author: 'you',
    })
    addItem(list.id, { url, title })
    setNewTitle('')
    setCreating(false)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 2147483100,
      background: 'rgba(4,7,15,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
      paddingTop: '12vh',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(480px, 94vw)', borderRadius: 16,
        background: 'var(--ds-panel-bg, rgba(16,20,34,0.98))',
        border: '1px solid var(--ds-border, rgba(255,255,255,0.06))',
        boxShadow: '0 30px 90px rgba(0,0,0,0.65)', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--ds-border-sm)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'rgb(var(--ds-text-1))' }}>Add to list</div>
            <div style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', marginTop: 1 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{url.slice(0, 60)}{url.length > 60 ? '…' : ''}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ds-glass-sm)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={13} style={{ color: 'rgb(var(--ds-text-4))' }} />
          </button>
        </div>
        <div style={{ padding: '12px 16px', maxHeight: '50vh', overflowY: 'auto' }}>
          {lists.map(list => {
            const already = list.items.some(i => i.url === url) || added[list.id]
            return (
              <div key={list.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--ds-border-sm)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgb(var(--ds-text-2))' }}>{list.title}</div>
                  <div style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))' }}>{list.items.length} link{list.items.length !== 1 ? 's' : ''}</div>
                </div>
                <button
                  onClick={() => !already && handleAdd(list.id)}
                  disabled={already}
                  style={{
                    padding: '4px 10px', borderRadius: 8, border: 'none', cursor: already ? 'default' : 'pointer',
                    fontSize: 11, fontWeight: 600,
                    background: already ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.15)',
                    color: already ? '#4ade80' : '#4ade80',
                  }}
                >
                  {already ? <><Check size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> Added</> : 'Add'}
                </button>
              </div>
            )
          })}
          {creating ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                placeholder="List name…"
                autoFocus
                style={{ flex: 1, background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'rgb(var(--ds-text-2))', outline: 'none' }}
              />
              <button onClick={handleCreate} style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setCreating(false)} style={{ padding: '6px 8px', borderRadius: 8, background: 'var(--ds-glass-sm)', border: 'none', color: 'rgb(var(--ds-text-4))', cursor: 'pointer' }}><X size={13} /></button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} style={{ marginTop: 8, padding: '6px 12px', borderRadius: 8, background: 'var(--ds-glass-sm)', border: '1px dashed var(--ds-border)', color: 'rgb(var(--ds-text-4))', fontSize: 11.5, cursor: 'pointer', width: '100%' }}>
              <Plus size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              New list
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── List card ────────────────────────────────────────────────────────────────

function ListCard({ list, onDelete, onAddItem }: {
  list: ReadingList
  onDelete?: () => void
  onAddItem?: (item: ReadingListItem) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [summarising, setSummarising] = useState(false)
  const [summary, setSummary] = useState(list.aiSummary)
  const isOwn = list.author === 'you' || list.visibility === 'private'

  const handleSummarise = async () => {
    if (summary) { setSummary(undefined); return }
    setSummarising(true)
    const text = await aiSummarise(list)
    setSummary(text)
    setSummarising(false)
    // Persist
    updateList(list.id, l => ({ ...l, aiSummary: text }))
  }

  const themeColors: Record<string, string> = {
    AI: '#a78bfa', Trading: '#34d399', Bible: '#fbbf24', General: '#94a3b8',
  }
  const themeColor = themeColors[list.theme] || '#94a3b8'

  return (
    <div style={{
      borderRadius: 14, border: '1px solid var(--ds-border)', background: 'var(--ds-glass-sm)',
      overflow: 'hidden', transition: 'border-color 0.2s',
    }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${themeColor}22`, color: themeColor, border: `1px solid ${themeColor}44` }}>
                {list.theme}
              </span>
              {list.visibility === 'private' && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 20, background: 'rgba(148,163,184,0.1)', color: 'rgb(var(--ds-text-4))' }}>private</span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'rgb(var(--ds-text-1))', lineHeight: 1.3 }}>{list.title}</div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {onDelete && (
              <button onClick={onDelete} title="Delete list" style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={12} style={{ color: '#f87171' }} />
              </button>
            )}
          </div>
        </div>

        {list.description && (
          <div style={{ fontSize: 12, color: 'rgb(var(--ds-text-3))', marginBottom: 8, lineHeight: 1.5 }}>
            {list.description}
          </div>
        )}

        {/* AI summary */}
        {list.aiSummary || summarising ? (
          <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <Sparkles size={10} style={{ color: '#a78bfa', flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa' }}>AI summary</span>
            </div>
            {summarising ? (
              <Loader2 size={12} style={{ color: '#a78bfa', animation: 'spin 1s linear infinite' }} />
            ) : (
              <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-3))', lineHeight: 1.55 }}>{summary}</div>
            )}
          </div>
        ) : (
          <button onClick={handleSummarise} style={{ marginBottom: 8, padding: '4px 10px', borderRadius: 8, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', color: '#a78bfa', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={10} />
            Generate AI summary
          </button>
        )}

        {/* Footer row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'rgb(var(--ds-text-4))' }}>
          <span>{list.items.length} link{list.items.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>by {list.author}</span>
          {!isOwn && (
            <>
              <span>·</span>
              <span><Users size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />{list.followers}</span>
            </>
          )}
          <button
            onClick={() => toggleSubscribe(list.id)}
            style={{ marginLeft: 'auto', padding: '3px 8px', borderRadius: 8, background: list.subscribed ? 'rgba(34,197,94,0.12)' : 'var(--ds-glass-sm)', border: list.subscribed ? '1px solid rgba(34,197,94,0.25)' : '1px solid var(--ds-border-sm)', color: list.subscribed ? '#4ade80' : 'rgb(var(--ds-text-4))', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}
          >
            {list.subscribed ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>

      {/* Expandable items */}
      {expanded && list.items.length > 0 && (
        <div style={{ borderTop: '1px solid var(--ds-border-sm)', padding: '10px 16px' }}>
          {list.items.map(item => (
            <div key={item.url} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
              <ExternalLink size={11} style={{ color: 'rgb(var(--ds-text-4))', flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'rgb(var(--ds-text-2))' }}>{item.title}</div>
                {item.note && <div style={{ fontSize: 10.5, color: 'rgb(var(--ds-text-4))', marginTop: 1, fontStyle: 'italic' }}>{item.note}</div>}
              </div>
              {onAddItem && (
                <button onClick={() => onAddItem(item)} title="Remove from list" style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <X size={10} style={{ color: '#f87171' }} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {list.items.length > 0 && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ width: '100%', padding: '8px', borderTop: '1px solid var(--ds-border-sm)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'rgb(var(--ds-text-4))', textAlign: 'center' }}
        >
          {expanded ? '▲ hide links' : `▼ show ${list.items.length} link${list.items.length !== 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}

// ─── Create-list form ─────────────────────────────────────────────────────────

function CreateListForm({ onClose }: { onClose: (list?: ReadingList) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [theme, setTheme] = useState('General')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')

  const THEMES = ['AI', 'Trading', 'Bible', 'Technology', 'Business', 'Education', 'General']

  const handleCreate = () => {
    if (!title.trim()) return
    const list = createList({
      title: title.trim(),
      description: description.trim(),
      theme,
      visibility,
      author: 'you',
    })
    onClose(list)
  }

  return (
    <div style={{
      borderRadius: 14, border: '1px solid rgba(167,139,250,0.3)',
      background: 'var(--ds-glass-sm)', padding: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--ds-text-1))' }}>New reading list</span>
        <button onClick={() => onClose()} style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--ds-glass-sm)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={12} style={{ color: 'rgb(var(--ds-text-4))' }} />
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', marginBottom: 4, display: 'block' }}>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Best reads on AI safety" style={{ width: '100%', background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, color: 'rgb(var(--ds-text-2))', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', marginBottom: 4, display: 'block' }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What's this list for? Who is it for?" rows={2} style={{ width: '100%', background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, color: 'rgb(var(--ds-text-2))', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', marginBottom: 4, display: 'block' }}>Theme</label>
            <select value={theme} onChange={e => setTheme(e.target.value)} style={{ width: '100%', background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'rgb(var(--ds-text-3))', outline: 'none', boxSizing: 'border-box' }}>
              {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', marginBottom: 4, display: 'block' }}>Visibility</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['private', 'public'] as const).map(v => (
                <button key={v} onClick={() => setVisibility(v)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: visibility === v ? '1px solid rgba(167,139,250,0.4)' : '1px solid var(--ds-border-sm)', background: visibility === v ? 'rgba(167,139,250,0.1)' : 'var(--ds-glass-sm)', color: visibility === v ? '#a78bfa' : 'rgb(var(--ds-text-4))', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button onClick={handleCreate} disabled={!title.trim()} style={{ padding: '9px', borderRadius: 10, background: title.trim() ? 'rgba(167,139,250,0.2)' : 'var(--ds-glass-sm)', border: title.trim() ? '1px solid rgba(167,139,250,0.35)' : '1px solid var(--ds-border-sm)', color: title.trim() ? '#a78bfa' : 'rgb(var(--ds-text-4))', fontSize: 12.5, fontWeight: 700, cursor: title.trim() ? 'pointer' : 'default' }}>
          Create list
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CommunityListsPage() {
  const [activeTab, setActiveTab] = useState<'my' | 'explore'>('my')
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [themeFilter, setThemeFilter] = useState<string | null>(null)
  const [addToListUrl, setAddToListUrl] = useState<{ url: string; title: string } | null>(null)

  const { lists } = useReadingLists()
  const activeTab_ = useBrowserStore(s => s.tabs.find(t => t.id === s.activeTabId))

  const myLists = lists.filter(l => l.author === 'you')
  const publicLists = lists.filter(l => l.visibility === 'public')
  const subscribedLists = lists.filter(l => l.subscribed && l.author !== 'you')

  const themes = uniqueThemes(lists)

  const filteredLists = (activeTab === 'my' ? myLists : publicLists).filter(l => {
    if (search) {
      const q = search.toLowerCase()
      if (!l.title.toLowerCase().includes(q) && !l.description.toLowerCase().includes(q) && !l.theme.toLowerCase().includes(q)) return false
    }
    if (themeFilter && l.theme !== themeFilter) return false
    return true
  })

  const handleAddCurrentPage = () => {
    const tab = activeTab_
    if (!tab?.url || tab.url === 'home' || tab.url.startsWith('aihub://')) return
    setAddToListUrl({ url: tab.url, title: tab.title || tab.url })
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ds-bg)', overflow: 'hidden' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ padding: '14px 20px 0', borderBottom: '1px solid var(--ds-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <BookOpen size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'rgb(var(--ds-text-1))' }}>Community Reading Lists</div>
            <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-4))' }}>Curated link collections — yours and the community's</div>
          </div>
          <button
            onClick={handleAddCurrentPage}
            title="Add current page to a list"
            style={{ padding: '6px 12px', borderRadius: 9, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Plus size={12} /> Add current page
          </button>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['my', 'explore'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '7px 14px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
                fontSize: 12.5, fontWeight: 600,
                background: activeTab === tab ? 'var(--ds-bg)' : 'transparent',
                color: activeTab === tab ? '#a78bfa' : 'rgb(var(--ds-text-4))',
                borderBottom: activeTab === tab ? '2px solid #a78bfa' : '2px solid transparent',
                marginBottom: -1,
                transition: 'all 0.15s',
              }}
            >
              {tab === 'my' ? 'My Lists' : 'Explore'}
              {tab === 'my' && myLists.length > 0 && (
                <span style={{ marginLeft: 5, fontSize: 10, padding: '1px 5px', borderRadius: 10, background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>
                  {myLists.length}
                </span>
              )}
              {tab === 'explore' && (
                <span style={{ marginLeft: 5, fontSize: 10, padding: '1px 5px', borderRadius: 10, background: 'rgba(52,211,153,0.15)', color: '#34d399' }}>
                  {subscribedLists.length} following
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgb(var(--ds-text-4))' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search lists…"
            style={{ width: '100%', background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border)', borderRadius: 8, padding: '7px 10px 7px 32px', fontSize: 12.5, color: 'rgb(var(--ds-text-2))', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {themes.map(t => (
            <button key={t} onClick={() => setThemeFilter(themeFilter === t ? null : t)} style={{ padding: '5px 10px', borderRadius: 8, background: themeFilter === t ? 'rgba(167,139,250,0.15)' : 'var(--ds-glass-sm)', border: themeFilter === t ? '1px solid rgba(167,139,250,0.3)' : '1px solid var(--ds-border-sm)', color: themeFilter === t ? '#a78bfa' : 'rgb(var(--ds-text-4))', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>

        {activeTab === 'my' && (
          <>
            {/* Create form */}
            {showCreate ? (
              <div style={{ marginBottom: 20 }}>
                <CreateListForm onClose={list => { setShowCreate(false); if (list) setActiveTab('my') }} />
              </div>
            ) : (
              <button onClick={() => setShowCreate(true)} style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 12, background: 'rgba(167,139,250,0.08)', border: '1px dashed rgba(167,139,250,0.3)', color: '#a78bfa', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={14} />
                New reading list
              </button>
            )}

            {filteredLists.length === 0 && !showCreate && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgb(var(--ds-text-4))' }}>
                <BookOpen size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                <div style={{ fontSize: 13 }}>No lists yet.</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Create your first reading list above.</div>
              </div>
            )}
          </>
        )}

        {activeTab === 'explore' && subscribedLists.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--ds-text-4))', marginBottom: 10 }}>
              Following
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, marginBottom: 24 }}>
              {subscribedLists.map(l => (
                <ListCard
                  key={l.id} list={l}
                  onDelete={l.author === 'you' ? () => deleteList(l.id) : undefined}
                />
              ))}
            </div>
          </>
        )}

        {/* All filtered lists */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--ds-text-4))', marginBottom: 10 }}>
          {activeTab === 'my' ? 'Your lists' : 'All public lists'}
          {filteredLists.length > 0 && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--ds-glass-sm)', padding: '1px 6px', borderRadius: 10 }}>{filteredLists.length}</span>}
        </div>

        {filteredLists.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgb(var(--ds-text-4))' }}>
            <Search size={28} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
            <div style={{ fontSize: 13 }}>No lists match your search.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {filteredLists.map(l => (
              <ListCard
                key={l.id} list={l}
                onDelete={l.author === 'you' ? () => deleteList(l.id) : undefined}
                onAddItem={l.author === 'you' ? (item) => removeItem(l.id, item.url) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add-to-list drawer */}
      {addToListUrl && (
        <AddToListDrawer
          url={addToListUrl.url}
          title={addToListUrl.title}
          onClose={() => setAddToListUrl(null)}
        />
      )}
    </div>
  )
}
