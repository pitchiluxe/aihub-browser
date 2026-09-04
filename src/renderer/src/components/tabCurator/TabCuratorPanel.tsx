import React, { useState, useEffect } from 'react'
import { Wand2, Check, X, ChevronRight, Loader2 } from 'lucide-react'
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

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.3)',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        width: 'min(520px, 90vw)',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '80vh',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <Wand2 size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Tab Curator</span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, borderRadius: 4, color: 'var(--text-muted)',
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              justifyContent: 'center', padding: '32px 0', color: 'var(--text-muted)',
            }}>
              <Loader2 size={18} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13 }}>Analyzing tabs…</span>
            </div>
          )}

          {!loading && clusters === null && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Could not analyze tabs. Make sure you have at least 2 browser tabs open.
            </div>
          )}

          {!loading && clusters !== null && clusters.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Not enough tabs to group. Open a few more tabs first.
            </div>
          )}

          {!loading && clusters && clusters.length > 0 && (
            <>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                {totalTabs} tab{totalTabs !== 1 ? 's' : ''} grouped into {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}.
                Click "Apply Groups" to organize your tabs.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {clusters.map((cluster, i) => {
                  const clusterTabs = tabs.filter(t => cluster.tabIds.includes(t.id))
                  return (
                    <div key={i} style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      borderLeft: `3px solid ${cluster.color}`,
                      overflow: 'hidden',
                    }}>
                      {/* Cluster header */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 12px',
                        background: 'var(--bg-secondary)',
                      }}>
                        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                          {cluster.name}
                        </span>
                        <span style={{
                          fontSize: 11, color: 'var(--text-muted)',
                          background: 'var(--bg-tertiary)',
                          padding: '2px 8px', borderRadius: 99,
                        }}>
                          {cluster.tabIds.length} tab{cluster.tabIds.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Tab list */}
                      <div style={{ padding: '6px 12px' }}>
                        {clusterTabs.map(tab => (
                          <div key={tab.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '4px 0',
                            fontSize: 12, color: 'var(--text-secondary)',
                            borderBottom: '1px solid var(--border)',
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
                          padding: '6px 12px 8px',
                          fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
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
            display: 'flex', gap: 8, padding: 12,
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: 6, background: 'var(--bg-secondary)',
                color: 'var(--text)', fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applied}
              style={{
                flex: 2, padding: '8px 12px',
                border: 'none', borderRadius: 6,
                background: applied ? '#22c55e' : 'var(--accent)',
                color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
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
    </>
  )
}
