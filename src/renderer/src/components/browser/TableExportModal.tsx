import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Table, Download, X, Loader2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'
import {
  buildTableExtractionScript, cleanTables, toCsv, csvFileName,
  type CleanTable, type RawTable,
} from '../../../../shared/tableExtract'

/**
 * Pull the tables off a page and hand them over as CSV.
 *
 * Copying a web table by hand is miserable — the selection collects sort
 * arrows and footnote markers, merged cells collapse, and every number arrives
 * as text. The extraction understands colspan and rowspan, so a merged header
 * does not shift the columns underneath it.
 *
 * Host HTML over a BrowserView, so the store flag detaches the native view
 * while this is open, exactly as the bookmarks and downloads panels do.
 */
export default function TableExportModal() {
  const { isTableExportOpen, setTableExportOpen, activeTabId, tabs, tabWcIds } =
    useBrowserStore(useShallow(s => ({
      isTableExportOpen: s.isTableExportOpen,
      setTableExportOpen: s.setTableExportOpen,
      activeTabId: s.activeTabId,
      tabs: s.tabs,
      tabWcIds: s.tabWcIds,
    })))

  const [tables, setTables] = useState<CleanTable[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const pageTitle = tabs.find(t => t.id === activeTabId)?.title || ''

  useEffect(() => {
    if (!isTableExportOpen) { setTables([]); setError(''); setSaved(''); return }
    const wcId = activeTabId ? tabWcIds[activeTabId] : null
    if (!wcId) { setError('Open a page first — there is nothing to read.'); return }

    setLoading(true)
    window.electronAPI.webview.execScript(wcId, buildTableExtractionScript())
      .then((res: any) => {
        let raw: RawTable[] = []
        try { raw = JSON.parse(String(res?.result || '[]')) } catch {}
        const clean = cleanTables(raw)
        setTables(clean)
        if (!clean.length) setError('No data tables on this page.')
      })
      .catch(() => setError("Couldn't read this page."))
      .finally(() => setLoading(false))
  }, [isTableExportOpen, activeTabId, tabWcIds])

  if (!isTableExportOpen) return null

  const save = async (table: CleanTable) => {
    const res = await window.electronAPI.file.saveText({
      filename: csvFileName(table.label, pageTitle),
      content: toCsv(table),
    })
    if (res?.success) {
      setSaved(table.label)
      setTimeout(() => setSaved(''), 2500)
    } else if (res?.error) {
      setError(res.error)
    }
    // A cancelled dialog reports neither — stay silent, like every other
    // file:save* caller here.
  }

  return createPortal(
    <div
      onClick={() => setTableExportOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', maxHeight: '76vh', display: 'flex', flexDirection: 'column',
          borderRadius: 18, overflow: 'hidden',
          background: 'var(--ds-glass-lg, rgb(var(--ds-bg-2)))',
          border: '1px solid var(--ds-border-sm)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '14px 16px',
          borderBottom: '1px solid var(--ds-border-sm)',
        }}>
          <Table size={15} style={{ color: 'rgb(var(--ds-accent-soft))' }} />
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: 'rgb(var(--ds-text-2))' }}>
            Export a table
          </span>
          <button onClick={() => setTableExportOpen(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 12 }}>
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 30, color: 'rgb(var(--ds-text-4))' }}>
              <Loader2 size={18} style={{ animation: 'aihubSpin 1s linear infinite' }} />
              <style>{'@keyframes aihubSpin{to{transform:rotate(360deg)}}'}</style>
            </div>
          )}

          {!loading && error && (
            <div style={{ padding: '26px 12px', textAlign: 'center', fontSize: 12.5, color: 'rgb(var(--ds-text-4))' }}>
              {error}
            </div>
          )}

          {tables.map((t, i) => (
            <div key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                borderRadius: 12, marginBottom: 6,
                background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5, fontWeight: 600, color: 'rgb(var(--ds-text-2))',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.label}
                </div>
                <div style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', marginTop: 2 }}>
                  {t.rows.length} rows × {t.columns} columns
                  {saved === t.label && <span style={{ color: '#4ade80', marginLeft: 8 }}>· saved</span>}
                </div>
                {/* The first row, so the right table is obvious without opening it. */}
                <div style={{
                  fontSize: 10.5, color: 'rgb(var(--ds-text-4))', opacity: 0.75, marginTop: 3,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.rows[0]?.slice(0, 6).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => save(t)}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 11px', borderRadius: 9, cursor: 'pointer',
                  background: 'rgb(var(--ds-accent) / 0.18)',
                  border: '1px solid rgb(var(--ds-accent) / 0.3)',
                  color: 'rgb(var(--ds-accent-soft))', fontSize: 11.5, fontWeight: 650,
                }}
              >
                <Download size={11} /> CSV
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
