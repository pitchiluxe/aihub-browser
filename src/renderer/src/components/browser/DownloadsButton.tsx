import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Download, FolderOpen, FileText, Image as ImageIcon, Film, Music, Archive,
  Package, Code2, CheckCircle2, XCircle, Loader2, Trash2, ExternalLink,
  type LucideIcon,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore, DownloadItem } from '../../store/browserStore'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import DownloadSecurity from './DownloadSecurity'
import {
  kindOf, formatProgress, percentOf, stateLabel, activeCount, formatWhen, overallPercent,
  type DownloadKind,
} from '../../services/downloadDisplay'

const RING_LEN = 2 * Math.PI * 14

/** How long a finished file stays named in the toolbar before the pill folds. */
const LINGER_MS = 4500

/**
 * Which download the toolbar is announcing, plus counters that restart the
 * one-shot animations: `burstKey` when a new transfer starts, `landedKey`
 * when one finishes.
 *
 * Only transfers that begin while this window is open are announced — the
 * list restored from disk at startup is history, not news. Small files often
 * finish inside one progress tick, so a transfer that is first seen already
 * completed still counts as new and gets both the burst and the "Done" pill;
 * otherwise a quick download would come and go with nothing on screen.
 */
function useDownloadSpotlight(downloads: DownloadItem[]) {
  const mountedAt = useRef(Date.now())
  const seen = useRef<Map<string, string>>(new Map())
  const [spotId, setSpotId] = useState<string | null>(null)
  const [burstKey, setBurstKey] = useState(0)
  const [landedKey, setLandedKey] = useState(0)
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let started: DownloadItem | null = null
    let landed = false
    for (const d of downloads) {
      const prev = seen.current.get(d.id)
      if (prev === d.state) continue
      seen.current.set(d.id, d.state)
      const fresh = (d.startedAt || 0) >= mountedAt.current - 1000
      if (!fresh) continue
      if (prev === undefined) started = started && started.startedAt > d.startedAt ? started : d
      if (d.state === 'completed' && prev !== 'completed') landed = true
    }
    if (started) {
      if (lingerTimer.current) { clearTimeout(lingerTimer.current); lingerTimer.current = null }
      setSpotId(started.id)
      setBurstKey(k => k + 1)
    }
    if (landed) setLandedKey(k => k + 1)
  }, [downloads])

  const spotlight = spotId ? downloads.find(d => d.id === spotId) || null : null

  // Hand the pill to another transfer still moving, or fold it a few seconds
  // after the announced one settles.
  useEffect(() => {
    if (!spotId) return
    if (!spotlight) { setSpotId(null); return }
    if (spotlight.state === 'progressing') return
    if (lingerTimer.current) clearTimeout(lingerTimer.current)
    lingerTimer.current = setTimeout(() => {
      lingerTimer.current = null
      // Read at fire time: other transfers may have started or ended since.
      const next = useBrowserStore.getState().downloads.find(d =>
        d.state === 'progressing' && (d.startedAt || 0) >= mountedAt.current - 1000)
      setSpotId(next ? next.id : null)
    }, LINGER_MS)
    // Keyed on the state only — progress ticks of other transfers must not
    // keep restarting the linger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotId, spotlight?.state])

  useEffect(() => () => { if (lingerTimer.current) clearTimeout(lingerTimer.current) }, [])

  return { spotlight, burstKey, landedKey }
}

const DOWNLOAD_CSS = `
@keyframes aihubDlBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(1.5px)}}
@keyframes aihubSpin{to{transform:rotate(360deg)}}
@keyframes aihubDlDrop{0%{transform:translateY(-14px) scale(1.25);opacity:0}55%{transform:translateY(2px) scale(1);opacity:1}75%{transform:translateY(-2px)}100%{transform:translateY(0)}}
@keyframes aihubDlBurst{0%{transform:scale(.6);opacity:.85}100%{transform:scale(2.3);opacity:0}}
@keyframes aihubDlLanded{0%{box-shadow:0 0 0 0 rgba(74,222,128,.75);background:rgba(74,222,128,.28)}100%{box-shadow:0 0 0 12px rgba(74,222,128,0);background:rgba(74,222,128,0)}}
@keyframes aihubDlRingSpin{to{transform:rotate(360deg)}}
@keyframes aihubDlSlide{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
.aihub-dl-drop{animation:aihubDlDrop .7s cubic-bezier(.3,1.4,.5,1) both}
.aihub-dl-burst{position:absolute;inset:0;border-radius:12px;border:2px solid rgb(var(--ds-accent));pointer-events:none;animation:aihubDlBurst .8s ease-out both}
.aihub-dl-landed{position:absolute;inset:-1px;border-radius:12px;pointer-events:none;animation:aihubDlLanded 1.1s ease-out both}
.aihub-dl-ring-fill{transition:stroke-dashoffset .45s ease}
.aihub-dl-ring-spin{transform-origin:16px 16px;animation:aihubDlRingSpin 1s linear infinite}
.aihub-dl-pill{position:relative;overflow:hidden;display:flex;align-items:center;gap:6px;height:28px;border-radius:14px;
  max-width:0;padding:0;opacity:0;border:1px solid transparent;cursor:pointer;white-space:nowrap;
  background:rgb(var(--ds-accent) / .12);color:rgb(var(--ds-accent-soft));font-size:11px;font-weight:600;
  transition:max-width .35s cubic-bezier(.2,.8,.2,1),padding .35s,opacity .25s,background .3s,border-color .3s}
.aihub-dl-pill[data-show="true"]{max-width:230px;padding:0 10px;opacity:1;border-color:rgb(var(--ds-accent) / .3)}
.aihub-dl-pill[data-state="done"]{background:rgba(74,222,128,.12);border-color:rgba(74,222,128,.35);color:#86efac}
.aihub-dl-pill[data-state="failed"]{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.35);color:#fca5a5}
.aihub-dl-pill-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;color:rgb(var(--ds-text-2))}
.aihub-dl-pill-meta{font-variant-numeric:tabular-nums;opacity:.9}
.aihub-dl-pill-bar{position:absolute;left:0;bottom:0;height:2px;background:rgb(var(--ds-accent));transition:width .45s ease}
.aihub-dl-pill-bar[data-indeterminate="true"]{animation:aihubDlSlide 1.2s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){
  .aihub-dl-drop,.aihub-dl-burst,.aihub-dl-ring-spin,.aihub-dl-pill-bar{animation:none!important}
  .aihub-dl-pill{transition:none}
}
`

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
    // Re-read: a private window's clear keeps transfers still in flight.
    try { setDownloads(await window.electronAPI.downloads.getAll()) } catch { setDownloads([]) }
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

  const ringPct = useMemo(() => overallPercent(downloads), [downloads])
  const { spotlight, burstKey, landedKey } = useDownloadSpotlight(downloads)
  const spotPct = spotlight ? percentOf(spotlight) : null
  const spotDone = spotlight?.state === 'completed'
  const spotFailed = spotlight?.state === 'cancelled' || spotlight?.state === 'interrupted'

  return (
    <>
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* The file that just started, named in the toolbar: what Chrome's
            download bubble does. Lives in the toolbar strip because anything
            drawn lower would sit under the page's view and never be seen. */}
        <button
          onClick={togglePanel}
          aria-hidden={!spotlight}
          tabIndex={spotlight ? 0 : -1}
          title={spotlight ? `${spotlight.filename}\n${stateLabel(spotlight.state)}` : undefined}
          className="aihub-dl-pill"
          data-show={spotlight ? 'true' : 'false'}
          data-state={spotDone ? 'done' : spotFailed ? 'failed' : 'active'}
        >
          {spotlight && (
            <>
              {spotDone
                ? <CheckCircle2 size={12} style={{ color: '#4ade80', flexShrink: 0 }} />
                : spotFailed
                  ? <XCircle size={12} style={{ color: '#f87171', flexShrink: 0 }} />
                  : <Loader2 size={12} style={{ flexShrink: 0, animation: 'aihubSpin 1s linear infinite' }} />}
              <span className="aihub-dl-pill-name">{spotlight.filename}</span>
              <span className="aihub-dl-pill-meta">
                {spotDone ? 'Done' : spotFailed ? stateLabel(spotlight.state) : spotPct !== null ? `${Math.round(spotPct)}%` : formatProgress(spotlight)}
              </span>
              {!spotDone && !spotFailed && (
                <span className="aihub-dl-pill-bar" style={{ width: spotPct !== null ? `${spotPct}%` : '35%' }} data-indeterminate={spotPct === null ? 'true' : 'false'} />
              )}
            </>
          )}
        </button>

        <button
          ref={btnRef}
          onClick={togglePanel}
          title={title}
          aria-label={title}
          className="flex items-center justify-center rounded-xl transition-colors"
          style={{
            position: 'relative',
            width: 32, height: 32, cursor: 'pointer',
            background: open ? 'rgb(var(--ds-accent) / 0.16)' : active ? 'rgb(var(--ds-accent) / 0.10)' : 'transparent',
            border: `1px solid ${open ? 'rgb(var(--ds-accent) / 0.4)' : active ? 'transparent' : 'var(--ds-border-sm)'}`,
            color: open || active ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-3))',
          }}
        >
          {/* Progress ring — fills with the combined progress, spins when no
              server sent a size. Replaces the border while anything moves. */}
          {active > 0 && (
            <svg width={32} height={32} viewBox="0 0 32 32" aria-hidden
              style={{ position: 'absolute', inset: -1, pointerEvents: 'none', transform: 'rotate(-90deg)' }}>
              <circle cx={16} cy={16} r={14} fill="none" strokeWidth={2} stroke="rgb(var(--ds-accent) / 0.22)" />
              <circle
                cx={16} cy={16} r={14} fill="none" strokeWidth={2} strokeLinecap="round"
                stroke="rgb(var(--ds-accent))"
                strokeDasharray={RING_LEN}
                strokeDashoffset={ringPct !== null ? RING_LEN * (1 - ringPct / 100) : RING_LEN * 0.72}
                className={ringPct === null ? 'aihub-dl-ring-spin' : 'aihub-dl-ring-fill'}
              />
            </svg>
          )}
          {/* One-shot effects, restarted by changing the key. */}
          {burstKey > 0 && <span key={`b${burstKey}`} className="aihub-dl-burst" aria-hidden />}
          {landedKey > 0 && <span key={`l${landedKey}`} className="aihub-dl-landed" aria-hidden />}
          <span key={`i${burstKey}`} className={burstKey > 0 ? 'aihub-dl-drop' : undefined} style={{ display: 'flex' }}>
            <Download
              size={13}
              style={active ? { animation: 'aihubDlBounce 1.4s ease-in-out infinite' } : undefined}
            />
          </span>
          {/* Count of transfers still moving. Absent when nothing is in flight —
              a badge that is always lit stops meaning anything. */}
          {active > 1 && (
            <span style={{
              position: 'absolute', top: -4, right: -4, minWidth: 14, height: 14, padding: '0 3px',
              borderRadius: 7, background: 'rgb(var(--ds-accent))', color: '#fff',
              fontSize: 9, fontWeight: 800, lineHeight: '14px', textAlign: 'center',
              boxShadow: '0 0 10px rgb(var(--ds-accent) / 0.6)',
            }}>
              {active}
            </span>
          )}
        </button>
        <style>{DOWNLOAD_CSS}</style>
      </div>

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
                <span
                  style={{ fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--ds-text-2))' }}
                  title={IS_INCOGNITO ? 'Listed until you close every Incognito window. Files stay on your computer.' : undefined}
                >{IS_INCOGNITO ? 'Incognito downloads' : 'Downloads'}</span>
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

      {done && <DownloadSecurity scan={dl.security} />}
      {done && dl.savePath && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <button
            disabled={dl.security?.state === 'detected' || dl.security?.state === 'blocked' || dl.security?.state === 'scanning'}
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
