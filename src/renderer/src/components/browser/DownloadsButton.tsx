import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Download, FolderOpen, FileText, Image as ImageIcon, Film, Music, Archive,
  Package, Code2, CheckCircle2, XCircle, Loader2, Trash2, ExternalLink,
  type LucideIcon,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore, DownloadItem } from '../../store/browserStore'
import {
  kindOf, formatProgress, percentOf, stateLabel, activeCount, formatWhen,
  type DownloadKind,
} from '../../services/downloadDisplay'

/**
 * Toolbar downloads menu — what just landed on this machine, without leaving
 * the page that produced it.
 *
 * The full Downloads page still exists and is still where a long history is
 * read; this is the glance. It sits beside the bookmark and capture buttons
 * because those are the three "I made something out of this page" actions, and
 * a download that only shows up in a tab you have to go open is a download
 * people assume never started.
 *
 * Like the bookmarks and VPN panels, this is host HTML, so while it is open the
 * store flag makes App detach the active tab's BrowserView — otherwise the page
 * paints straight over it.
 */

const KIND_ICON: Record<DownloadKind, LucideIcon> = {
  Documents:  FileText,
  Images:     ImageIcon,
  Video:      Film,
  Audio:      Music,
  Archives:   Archive,
  Installers: Package,
  Code:       Code2,
  Other:      FileText,
}

export default function DownloadsButton() {
  const { downloads, setDownloads, addTab, setDownloadsMenuOpen } = useBrowserStore(useShallow(s => ({
    downloads: s.downloads,
    setDownloads: s.setDownloads,
    addTab: s.addTab,
    setDownloadsMenuOpen: s.setDownloadsMenuOpen,
  })))

  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; right: number }>({ top: 52, right: 14 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setDownloadsMenuOpen(open); return () => setDownloadsMenuOpen(false) }, [open, setDownloadsMenuOpen])

  const active = useMemo(() => activeCount(downloads), [downloads])

  // Newest first. The store prepends new downloads and updates in place, so
  // progress ticks never reshuffle the list under the pointer — but a list
  // restored from disk arrives in whatever order it was written.
  const rows = useMemo(
    () => [...downloads].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)),
    [downloads],
  )

  const togglePanel = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) })
    setOpen(o => !o)
  }

  const clearAll = async () => {
    await window.electronAPI.downloads.clear()
    setDownloads([])
  }

  const openDownloadsPage = () => {
    setOpen(false)
    addTab('aihub://downloads', 'downloads')
  }

  const title = active
    ? `Downloads — ${active} in progress`
    : downloads.length
      ? `Downloads (${downloads.length})`
      : 'Downloads'

  return (
    <>
      <button
        ref={btnRef}
        onClick={togglePanel}
        title={title}
        className="no-drag flex items-center justify-center rounded-xl transition-colors"
        style={{
          position: 'relative',
          width: 32, height: 32, cursor: 'pointer',
          background: open ? 'rgb(var(--ds-accent) / 0.16)' : 'transparent',
          border: `1px solid ${open ? 'rgb(var(--ds-accent) / 0.4)' : 'var(--ds-border-sm)'}`,
          color: open || active ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-3))',
        }}
      >
        <Download
          size={13}
          style={active ? { animation: 'aihubDlBounce 1.4s ease-in-out infinite' } : undefined}
        />
        {/* Count of transfers still moving. Absent when nothing is in flight —
            a badge that is always lit stops meaning anything. */}
        {active > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3, minWidth: 14, height: 14, padding: '0 3px',
            borderRadius: 7, background: 'rgb(var(--ds-accent))', color: '#fff',
            fontSize: 9, fontWeight: 800, lineHeight: '14px', textAlign: 'center',
            boxShadow: '0 0 10px rgb(var(--ds-accent) / 0.6)',
          }}>
            {active}
          </span>
        )}
        <style>{`@keyframes aihubDlBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(1.5px)}}
          @keyframes aihubSpin{to{transform:rotate(360deg)}}`}</style>
      </button>

      {open && createPortal(
        <>
          {/* Click-away catcher, below the panel and above everything else. */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
            style={{
              position: 'fixed', top: anchor.top, right: anchor.right, zIndex: 9999,
              width: 360, maxHeight: 'min(60vh, 520px)', display: 'flex', flexDirection: 'column',
              borderRadius: 16, overflow: 'hidden',
              background: 'var(--ds-glass-lg, rgb(var(--ds-bg-2)))',
              border: '1px solid var(--ds-border-sm)',
              boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
              backdropFilter: 'blur(18px)',
            }}
          >
            <div style={{
              padding: '10px 12px', borderBottom: '1px solid var(--ds-border-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <Download size={13} style={{ color: 'rgb(var(--ds-accent-soft))', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--ds-text-2))' }}>Downloads</span>
                <span style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))' }}>
                  {active ? `${active} in progress` : `${downloads.length} ${downloads.length === 1 ? 'file' : 'files'}`}
                </span>
              </div>
              {downloads.length > 0 && (
                <button
                  onClick={clearAll}
                  title="Clear this list (the files stay on disk)"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)',
                    color: '#f87171', fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <Trash2 size={11} /> Clear
                </button>
              )}
            </div>

            <div style={{ overflowY: 'auto', padding: '4px 0', flex: 1 }}>
              {rows.map(dl => <DownloadRow key={dl.id} dl={dl} />)}

              {!rows.length && (
                <div style={{
                  padding: '30px 12px', textAlign: 'center', fontSize: 12,
                  color: 'rgb(var(--ds-text-4))', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 8,
                }}>
                  <Download size={26} style={{ opacity: 0.25 }} />
                  Nothing downloaded yet
                </div>
              )}
            </div>

            <button
              onClick={openDownloadsPage}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 12px', borderTop: '1px solid var(--ds-border-sm)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'rgb(var(--ds-text-3))', fontSize: 11.5, fontWeight: 600,
              }}
            >
              <ExternalLink size={11} /> Open the downloads page
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function DownloadRow({ dl }: { dl: DownloadItem }) {
  const [hovered, setHovered] = useState(false)
  const Icon = KIND_ICON[kindOf(dl.filename)]
  const pct = percentOf(dl)
  const done = dl.state === 'completed'
  const failed = dl.state === 'cancelled' || dl.state === 'interrupted'

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={() => { if (done && dl.savePath) window.electronAPI.downloads.openFile(dl.savePath) }}
      title={`${dl.filename}\n${dl.url}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: hovered ? 'rgb(var(--ds-accent) / 0.10)' : 'transparent',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 9, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgb(var(--ds-accent) / 0.12)', color: 'rgb(var(--ds-accent-soft))',
      }}>
        <Icon size={14} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            flex: 1, minWidth: 0, fontSize: 12, fontWeight: 550, color: 'rgb(var(--ds-text-2))',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {dl.filename}
          </span>
          {done && <CheckCircle2 size={11} style={{ color: '#4ade80', flexShrink: 0 }} />}
          {failed && <XCircle size={11} style={{ color: '#f87171', flexShrink: 0 }} />}
          {dl.state === 'progressing' && (
            <Loader2 size={11} style={{ color: 'rgb(var(--ds-accent-soft))', flexShrink: 0, animation: 'aihubSpin 1s linear infinite' }} />
          )}
        </div>

        {dl.state === 'progressing' && pct !== null && (
          <div style={{ height: 3, borderRadius: 2, margin: '4px 0 3px', background: 'rgb(var(--ds-text-4) / 0.25)' }}>
            <div style={{
              width: `${pct}%`, height: '100%', borderRadius: 2,
              background: 'rgb(var(--ds-accent))', transition: 'width 0.2s linear',
            }} />
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, marginTop: 1,
          fontSize: 10.5, color: 'rgb(var(--ds-text-4))',
        }}>
          <span>{formatProgress(dl)}</span>
          <span>·</span>
          <span>{stateLabel(dl.state)}</span>
          {(() => {
            const when = formatWhen(dl.completedAt || dl.startedAt)
            return when ? <><span>·</span><span>{when}</span></> : null
          })()}
        </div>
      </div>

      {done && dl.savePath && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <button
            onClick={() => window.electronAPI.downloads.openFile(dl.savePath)}
            title="Open this file"
            style={{
              padding: '3px 9px', borderRadius: 8, cursor: 'pointer',
              background: 'rgb(var(--ds-accent) / 0.18)', border: '1px solid rgb(var(--ds-accent) / 0.28)',
              color: 'rgb(var(--ds-accent-soft))', fontSize: 10.5, fontWeight: 600,
            }}
          >
            Open
          </button>
          <button
            onClick={() => window.electronAPI.downloads.showInFolder(dl.savePath)}
            title="Show in folder"
            style={{
              width: 24, height: 24, borderRadius: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', color: 'rgb(var(--ds-text-4))',
            }}
          >
            <FolderOpen size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
