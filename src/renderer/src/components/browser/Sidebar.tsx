import React, { memo } from 'react'
import { Home, History, Download, Settings, Plus, Sparkles, Wifi, Shield } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

interface Props {
  onNavigate: (url: string) => void
  onOpenPage: (pageType: 'settings' | 'history' | 'downloads' | 'wifi' | 'vpn') => void
}

function Sidebar({ onNavigate, onOpenPage }: Props) {
  const { isSidebarOpen, bookmarks, setAddBookmarkOpen, tabs, activeTabId } = useBrowserStore()
  const activeTab = tabs.find(t => t.id === activeTabId)

  return (
    <div
      className="h-full bg-aihub-surface/60 border-r border-aihub-border/30 overflow-hidden shrink-0 flex flex-col"
      style={{
        width: isSidebarOpen ? 200 : 0,
        minWidth: isSidebarOpen ? 200 : 0,
        transition: 'width 0.18s cubic-bezier(0.4,0,0.2,1), min-width 0.18s cubic-bezier(0.4,0,0.2,1)',
        opacity: isSidebarOpen ? 1 : 0,
        pointerEvents: isSidebarOpen ? 'auto' : 'none',
        willChange: 'width',
      }}
    >
      {/* Nav items */}
      <div className="px-2 pt-3 pb-2 space-y-0.5 shrink-0">
        <SidebarItem icon={<Home size={14} />} label="Home"
          active={!!(activeTab?.isHome && activeTab?.pageType === 'browser')}
          onClick={() => onNavigate('home')} />
        <SidebarItem icon={<History size={14} />} label="History"
          active={activeTab?.pageType === 'history'}
          onClick={() => onOpenPage('history')} />
        <SidebarItem icon={<Download size={14} />} label="Downloads"
          active={activeTab?.pageType === 'downloads'}
          onClick={() => onOpenPage('downloads')} />
        <SidebarItem icon={<Wifi size={14} />} label="Free WiFi"
          active={activeTab?.pageType === 'wifi'}
          onClick={() => onOpenPage('wifi')} />
        <SidebarItem icon={<Shield size={14} />} label="VPN / Proxy"
          active={activeTab?.pageType === 'vpn'}
          onClick={() => onOpenPage('vpn')} />
        <SidebarItem icon={<Settings size={14} />} label="Settings"
          active={activeTab?.pageType === 'settings'}
          onClick={() => onOpenPage('settings')} />
      </div>

      <div className="h-px bg-aihub-border/30 mx-3 my-1 shrink-0" />

      {/* Bookmarks */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <span className="text-xs text-aihub-muted font-semibold uppercase tracking-wider whitespace-nowrap">Bookmarks</span>
        <button onClick={() => setAddBookmarkOpen(true)}
          className="w-5 h-5 rounded flex items-center justify-center text-aihub-muted hover:text-aihub-accent hover:bg-aihub-accent/10 transition-all">
          <Plus size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
        {bookmarks.map(bm => (
          <button key={bm.id} onClick={() => onNavigate(bm.url)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-aihub-card/60 transition-colors group">
            <div className="w-4 h-4 rounded shrink-0 overflow-hidden flex items-center justify-center"
              style={{ background: `${bm.color}22` }}>
              <img src={`https://www.google.com/s2/favicons?domain=${bm.url}&sz=16`} className="w-3 h-3"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
            <span className="flex-1 text-xs text-aihub-muted group-hover:text-aihub-text transition-colors truncate whitespace-nowrap">{bm.title}</span>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-aihub-border/30 shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-aihub-muted/50">
          <Sparkles size={10} className="text-aihub-accent/60" />
          <span className="whitespace-nowrap">AIHub Browser</span>
        </div>
      </div>
    </div>
  )
}

export default memo(Sidebar)

function SidebarItem({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm transition-all whitespace-nowrap ${
        active ? 'bg-aihub-accent/20 text-aihub-accent' : 'text-aihub-muted hover:bg-aihub-card/60 hover:text-aihub-text'
      }`}>
      {icon}
      <span className="font-medium text-xs">{label}</span>
    </button>
  )
}
