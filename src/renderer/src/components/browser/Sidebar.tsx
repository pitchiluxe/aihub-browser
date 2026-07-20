import React, { memo } from 'react'
import {
  Home, History, Download, Settings, Plus, Sparkles,
  Wifi, Shield, FlaskConical, Bot, Puzzle, LayoutGrid, Mail, StickyNote, BookOpen,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'

interface Props {
  onNavigate: (url: string) => void
  onOpenPage: (pageType: 'settings' | 'history' | 'downloads' | 'wifi' | 'vpn' | 'research' | 'agents' | 'extensions' | 'mail' | 'notes' | 'manual') => void
}

interface NavItem {
  icon: React.ElementType
  label: string
  page: null | 'settings' | 'history' | 'downloads' | 'wifi' | 'vpn' | 'research' | 'agents' | 'extensions' | 'mail' | 'notes' | 'manual'
  type: string
  accent?: string
}

const NAV_ITEMS: NavItem[] = [
  { icon: Home,         label: 'Home',        page: null,           type: 'home'       },
  { icon: FlaskConical, label: 'Research',     page: 'research',     type: 'research',   accent: '#38bdf8' },
  { icon: Bot,          label: 'Agent Mode',   page: 'agents',       type: 'agents',     accent: '#a78bfa' },
  { icon: StickyNote,   label: 'Sticky Notes', page: 'notes',        type: 'notes',      accent: '#facc15' },
  { icon: History,      label: 'History',      page: 'history',      type: 'history'    },
  { icon: Download,     label: 'Downloads',    page: 'downloads',    type: 'downloads'  },
  { icon: Puzzle,       label: 'Extensions',   page: 'extensions',   type: 'extensions', accent: '#fb923c' },
  { icon: Wifi,         label: 'Free WiFi',    page: 'wifi',         type: 'wifi'       },
  { icon: Shield,       label: 'VPN / Proxy',  page: 'vpn',          type: 'vpn'        },
  { icon: Mail,         label: 'Mail',         page: 'mail',         type: 'mail'       },
  { icon: BookOpen,     label: 'User Manual',  page: 'manual',       type: 'manual',     accent: '#5eead4' },
  { icon: Settings,     label: 'Settings',     page: 'settings',     type: 'settings'   },
]

function Sidebar({ onNavigate, onOpenPage }: Props) {
  // Narrow subscription — avoids re-rendering on unrelated store churn
  const { isSidebarOpen, bookmarks, setAddBookmarkOpen, tabs, activeTabId } = useBrowserStore(
    useShallow(s => ({
      isSidebarOpen: s.isSidebarOpen, bookmarks: s.bookmarks,
      setAddBookmarkOpen: s.setAddBookmarkOpen, tabs: s.tabs, activeTabId: s.activeTabId,
    })))
  const activeTab = tabs.find(t => t.id === activeTabId)

  const isActive = (type: string) => {
    if (type === 'home') return !!(activeTab?.isHome && activeTab?.pageType === 'browser')
    return activeTab?.pageType === type
  }

  return (
    <div
      className="h-full flex flex-col shrink-0 overflow-hidden ds-sidebar"
      style={{
        width:    isSidebarOpen ? 218 : 0,
        minWidth: isSidebarOpen ? 218 : 0,
        transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1), min-width 0.22s cubic-bezier(0.4,0,0.2,1)',
        opacity:       isSidebarOpen ? 1 : 0,
        pointerEvents: isSidebarOpen ? 'auto' : 'none',
        willChange: 'width',
      }}
    >
      {/* ── Brand ── */}
      <div style={{ padding: '14px 14px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* Logo mark */}
          <div style={{
            width: 30, height: 30, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg, #6B4EFF, #9F84FF)',
            boxShadow: '0 0 16px rgb(var(--ds-accent) / 0.50), inset 0 1px 0 rgba(255,255,255,0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={13} color="#fff" />
          </div>
          <div>
            <div style={{
              fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em',
              background: 'linear-gradient(135deg, #9F84FF, #C2AFFF)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              AIHub Browser
            </div>
            <div style={{ fontSize: 9, color: 'rgb(96,102,130)', marginTop: 1, letterSpacing: '0.05em' }}>
              AI Operating System
            </div>
          </div>
        </div>
      </div>

      {/* Divider with purple gradient */}
      <div style={{ height: 1, margin: '0 12px 8px', background: 'linear-gradient(90deg, transparent, rgb(var(--ds-accent) / 0.25), transparent)' }} />

      {/* ── Navigation ── */}
      <nav style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        {NAV_ITEMS.map(({ icon: Icon, label, page, type, accent }) => {
          const active = isActive(type)
          const activeColor = accent || 'rgb(var(--ds-accent-soft))'
          return (
            <button
              key={type}
              onClick={() => page ? onOpenPage(page) : onNavigate('home')}
              className="ds-sidebar-item"
              style={active ? {
                color: activeColor,
                background: accent ? `${accent}18` : 'rgb(var(--ds-accent) / 0.14)',
                borderColor: accent ? `${accent}30` : 'rgb(var(--ds-accent) / 0.28)',
                boxShadow: `0 0 20px ${accent || 'rgb(var(--ds-accent) / 0.1)'}20`,
              } : undefined}
            >
              <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <Icon size={14} />
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
              {active && (
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: activeColor,
                  boxShadow: `0 0 6px ${activeColor}`,
                }} />
              )}
            </button>
          )
        })}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, margin: '8px 12px', background: 'linear-gradient(90deg, transparent, var(--ds-border-sm), transparent)' }} />

      {/* ── Bookmarks section ── */}
      <div style={{ padding: '0 10px 6px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <LayoutGrid size={10} style={{ color: 'rgb(96,102,130)' }} />
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.10em', color: 'rgb(96,102,130)' }}>
            Bookmarks
          </span>
        </div>
        <button
          onClick={() => setAddBookmarkOpen(true)}
          style={{
            width: 20, height: 20, borderRadius: 7, border: '1px solid rgb(var(--ds-accent) / 0.20)',
            background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgb(96,102,130)', transition: 'all 0.14s',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'rgb(var(--ds-accent) / 0.14)'
            el.style.borderColor = 'rgb(var(--ds-accent) / 0.35)'
            el.style.color = 'rgb(var(--ds-accent-soft))'
            el.style.boxShadow = '0 0 10px rgb(var(--ds-accent) / 0.20)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'transparent'
            el.style.borderColor = 'rgb(var(--ds-accent) / 0.20)'
            el.style.color = 'rgb(96,102,130)'
            el.style.boxShadow = 'none'
          }}
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Bookmark list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}
        className="no-scrollbar">
        {bookmarks.length === 0 && (
          <div style={{ padding: '12px 8px', textAlign: 'center', color: 'rgb(96,102,130)', fontSize: 11 }}>
            No bookmarks yet
          </div>
        )}
        {bookmarks.map(bm => (
          <button
            key={bm.id}
            onClick={() => onNavigate(bm.url)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 10, border: '1px solid transparent',
              background: 'transparent', cursor: 'pointer', textAlign: 'left',
              color: 'rgb(96,102,130)',
              transition: 'all 0.13s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'rgb(var(--ds-accent) / 0.07)'
              el.style.borderColor = 'rgb(var(--ds-accent) / 0.14)'
              el.style.color = 'rgb(184,184,199)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.borderColor = 'transparent'
              el.style.color = 'rgb(96,102,130)'
            }}
          >
            {/* Favicon with color-tinted bg */}
            <div style={{
              width: 18, height: 18, borderRadius: 6, flexShrink: 0,
              background: `${bm.color || 'rgb(var(--ds-accent))'}1a`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              border: `1px solid ${bm.color || 'rgb(var(--ds-accent) / 0.2)'}30`,
            }}>
              <img
                src={`https://www.google.com/s2/favicons?domain=${bm.url}&sz=16`}
                style={{ width: 11, height: 11, objectFit: 'contain' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
            <span style={{ flex: 1, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bm.title}
            </span>
          </button>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={{
        padding: '8px 14px',
        borderTop: '1px solid rgb(var(--ds-accent) / 0.10)',
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 9, color: 'rgba(96,102,130,0.5)', letterSpacing: '0.04em' }}>
          AIHub v1.0
        </span>
        <span style={{
          fontSize: 9,
          background: 'linear-gradient(90deg, rgb(var(--ds-accent)), rgb(var(--ds-accent-soft)))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          AI OS
        </span>
      </div>
    </div>
  )
}

export default memo(Sidebar)
