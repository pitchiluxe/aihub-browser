import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Wand2, Check, X, Loader2 } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { curateTabs, TabCluster } from '../../services/tabCurator'

interface Props {
  onClose: () => void
}

export default function TabCuratorPanel({ onClose }: Props) {
  const { tabs, createGroup } = useBrowserStore(s => ({
    tabs: s.tabs,
    createGroup: s.createGroup,
  }))

  const [clusters, setClusters] = useState<TabCluster[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    curateTabs(tabs).then(results => {
      if (!cancelled) { setClusters(results); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [tabs])

  const handleApply = () => {
    if (!clusters?.length) return
    clusters.forEach(c => {
      createGroup(c.name, c.color, c.tabIds)
    })
    setApplied(true)
    setTimeout(onClose, 800)
  }

  const totalTabs = clusters?.reduce((sum, c) => sum + c.tabIds.length, 0) ?? 0

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483200,
        background: 'rgba(4,7,15,0.5)',
        backdropFilter: 'blur(3px)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="no-drag"
        style={{
          width: 'min(520px, 92vw)', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          borderRadius: 18, overflow: 'hidden',
          background: 'var(--ds-panel-bg, rgba(16,20,34,0.98))',
          backdropFilter: 'blur(34px)',
          border: '1px solid rgb(var(--ds-accent) / 0.26)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.65)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '15px 18px',
          borderBottom: '1px solid var(--ds-border-sm)',
          flexShrink: 0,
        }}>
          <Wand2 size={17} style={{ color: 'rgb(var(--ds-accent-soft))' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'rgb(var(--ds-text-1, var(--ds-text-2)))' }}>Tab Curator</div>
            <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-4))' }}>AI groups your open tabs into clusters</div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              justifyContent: 'center', padding: '32px 0', color: 'rgb(var(--ds-text-4))',
            }}>
              <Loader2 size={18} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13 }}>Analyzing tabs…</span>
            </div>
          )}

          {!loading && clusters === null && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgb(var(--ds-text-4))', fontSize: 13, lineHeight: 1.6 }}>
              Could not analyze tabs. Make sure you have at least 2 browser tabs open.
            </div>
          )}

          {!loading && clusters !== null && clusters.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgb(var(--ds-text-4))', fontSize: 13, lineHeight: 1.6 }}>
              Not enough tabs to group. Open a few more tabs first.
            </div>
          )}

          {!loading && clusters && clusters.length > 0 && (
            <>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgb(var(--ds-text-4))' }}>
                {totalTabs} tab{totalTabs !== 1 ? 's' : ''} grouped into {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}.
                Click "Apply Groups" to organize your tabs.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {clusters.map((cluster, i) => {
                  const clusterTabs = tabs.filter(t => cluster.tabIds.includes(t.id))
                  return (
                    <div key={i} style={{
                      border: '1px solid var(--ds-border-sm)',
                      borderRadius: 11,
                      borderLeft: `3px solid ${cluster.color}`,
                      overflow: 'hidden',
                    }}>
                      {/* Cluster header */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '9px 12px',
                        background: 'var(--ds-glass-sm)',
                      }}>
                        <span style={{ fontWeight: 700, fontSize: 13, flex: 1, color: 'rgb(var(--ds-text-2))' }}>
                          {cluster.name}
                        </span>
                        <span style={{
                          fontSize: 11, color: 'rgb(var(--ds-text-4))',
                          background: 'rgba(var(--ds-accent) / 0.12)',
                          padding: '2px 8px', borderRadius: 99,
                        }}>
                          {cluster.tabIds.length} tab{cluster.tabIds.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Tab list */}
                      <div style={{ padding: '5px 12px' }}>
                        {clusterTabs.map(tab => (
                          <div key={tab.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '5px 0',
                            fontSize: 12, color: 'rgb(var(--ds-text-3))',
                            borderBottom: '1px solid var(--ds-border-sm)',
                          }}>
                            <div style={{
                              width: 12, height: 12, borderRadius: '50%',
                              background: cluster.color, flexShrink: 0,
                            }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {tab.title || tab.url}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Reason */}
                      {cluster.reason && (
                        <div style={{
                          padding: '5px 12px 8px',
                          fontSize: 11, color: 'rgb(var(--ds-text-4))', fontStyle: 'italic',
                        }}>
                          {cluster.reason}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && clusters && clusters.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: 12,
            borderTop: '1px solid var(--ds-border-sm)',
            flexShrink: 0,
          }}>
            <button
              onClick={onClose}
              style={{
                padding: '9px 14px',
                border: '1px solid var(--ds-border-sm)',
                borderRadius: 11, background: 'var(--ds-glass-sm)',
                color: 'rgb(var(--ds-text-2))', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applied}
              style={{
                marginLeft: 'auto', padding: '9px 18px',
                border: 'none', borderRadius: 11,
                background: applied
                  ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                  : 'linear-gradient(135deg, rgb(var(--ds-accent)), rgb(var(--ds-accent-2)))',
                color: '#fff', fontSize: 13, fontWeight: 800, cursor: applied ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                boxShadow: applied ? '0 4px 18px rgba(34,197,94,0.4)' : '0 4px 18px rgb(var(--ds-accent) / 0.4)',
              }}
            >
              {applied ? (
                <><Check size={14} /> Applied!</>
              ) : (
                <><Wand2 size={14} /> Apply Groups</>
              )}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>,
    document.body,
  )
}
