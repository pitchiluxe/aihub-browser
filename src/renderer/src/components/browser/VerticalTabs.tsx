import React, { useEffect, useState } from 'react'
import { X, Plus, Home, ChevronDown, ChevronRight, Globe, Layers, Columns2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'
import { buildStripRows } from '../../services/tabGroups'

/**
 * The left-hand tab strip.
 *
 * A vertical strip is the answer to the horizontal one's failure mode: past
 * roughly a dozen tabs, titles collapse to favicons and the strip becomes a
 * memory test. Here every tab keeps its title at a readable width no matter how
 * many are open, and groups fold away the ones not in use.
 *
 * The strip is host HTML beside the content area, so the tab BrowserViews are
 * unaffected — their bounds come from the content element's own geometry, which
 * simply gets narrower.
 */
export default function VerticalTabs() {
  const {
    tabs, activeTabId, tabGroups, splitTabId,
    setActiveTab, closeTab, addTab, toggleGroupCollapsed, ungroup, autoGroupTabs, setSplitTab,
  } = useBrowserStore(useShallow(s => ({
    tabs: s.tabs, activeTabId: s.activeTabId, tabGroups: s.tabGroups, splitTabId: s.splitTabId,
    setActiveTab: s.setActiveTab, closeTab: s.closeTab, addTab: s.addTab,
    toggleGroupCollapsed: s.toggleGroupCollapsed, ungroup: s.ungroup,
    autoGroupTabs: s.autoGroupTabs, setSplitTab: s.setSplitTab,
  })))

  const [hovered, setHovered] = useState<string | null>(null)
  const [containers, setContainers] = useState<{ id: string; name: string; color: string }[]>([])
  useEffect(() => { window.electronAPI.containers.list().then(setContainers).catch(() => {}) }, [])
  const containerColor = (id: string) => containers.find(c => c.id === id)?.color || '#888'
  const rows = buildStripRows(tabs, tabGroups)

  return (
    <div
      className="flex flex-col shrink-0 h-full border-r border-aihub-border/25 bg-aihub-surface/40"
      style={{ width: 232 }}
    >
      <div className="flex items-center gap-1 px-2 py-2 border-b border-aihub-border/20">
        <button
          onClick={() => addTab()}
          className="flex items-center gap-1.5 flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-aihub-text hover:bg-aihub-border/25 transition-colors"
          title="New tab (Ctrl+T)"
        >
          <Plus size={13} /> New tab
        </button>
        <button
          onClick={() => autoGroupTabs()}
          className="p-1.5 rounded-lg text-aihub-muted hover:text-aihub-text hover:bg-aihub-border/25 transition-colors"
          title="Group tabs by site"
        >
          <Layers size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {rows.map(row => {
          if (row.kind === 'group' && row.group) {
            const group = row.group
            return (
              <div key={`g-${group.id}`} className="flex items-center gap-1 px-2 mt-1.5 mb-0.5 group/head">
                <button
                  onClick={() => toggleGroupCollapsed(group.id)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 px-1 py-1 rounded-md hover:bg-aihub-border/20 transition-colors"
                >
                  {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: group.color }}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: group.color }}>
                    {group.name}
                  </span>
                  <span className="text-[10px] text-aihub-muted shrink-0">{row.count}</span>
                </button>
                <button
                  onClick={() => ungroup(group.id)}
                  title="Ungroup (keeps the tabs)"
                  className="p-1 rounded-md text-aihub-muted opacity-0 group-hover/head:opacity-100 hover:text-aihub-text hover:bg-aihub-border/25 transition-all"
                >
                  <X size={11} />
                </button>
              </div>
            )
          }

          const tab = row.tab!
          const isActive = tab.id === activeTabId
          const isSplit = tab.id === splitTabId
          return (
            <div
              key={tab.id}
              onMouseEnter={() => setHovered(tab.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setActiveTab(tab.id)}
              onAuxClick={e => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
              className={`flex items-center gap-2 mx-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                isActive ? 'bg-aihub-card text-aihub-text' : 'text-aihub-muted hover:bg-aihub-border/20 hover:text-aihub-text'
              }`}
              style={row.group ? { marginLeft: 18, borderLeft: `2px solid ${row.group.color}66`, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 } : undefined}
              title={tab.isHome ? 'Home' : tab.url}
            >
              {/* Container colour: which cookie jar this tab is signed into. */}
              {tab.containerId && (
                <span
                  className="shrink-0 rounded-full"
                  style={{ width: 6, height: 6, background: containerColor(tab.containerId) }}
                  title={`Container: ${tab.containerId}`}
                />
              )}
              {tab.isHome
                ? <Home size={13} className="shrink-0" />
                : tab.favicon
                  ? <img src={tab.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} className="shrink-0" />
                  : <Globe size={13} className="shrink-0" />}

              <span className="flex-1 min-w-0 truncate text-xs">
                {tab.title || (tab.isHome ? 'New Tab' : tab.url)}
              </span>

              {isSplit && <Columns2 size={11} className="shrink-0 text-aihub-accent" />}

              <button
                onClick={e => { e.stopPropagation(); setSplitTab(isSplit ? null : tab.id) }}
                title={isSplit ? 'Leave split view' : 'Show beside the current tab'}
                className={`p-0.5 rounded transition-opacity hover:bg-aihub-border/40 ${
                  hovered === tab.id && !isActive ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <Columns2 size={11} />
              </button>

              <button
                onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                title="Close tab"
                className={`p-0.5 rounded transition-opacity hover:bg-aihub-border/40 ${
                  hovered === tab.id || isActive ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <X size={11} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
