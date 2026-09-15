import type { DownloadItem } from '../store/browserStore'

/**
 * How a download reads in the UI.
 *
 * The toolbar panel and the full Downloads page describe the same rows, and
 * they used to describe them differently — the page said "1.4 MB", a panel
 * written on its own would have said "1.44 MB" or "1,440 KB". These are pure
 * functions so both surfaces phrase a transfer identically and the phrasing
 * can be tested without rendering anything.
 *
 * Kept out of main/downloadSorting.ts on purpose: that module reaches for
 * node's `path` to file a finished download on disk, which the renderer has
 * no business importing.
 */

export type DownloadKind =
  | 'Documents' | 'Images' | 'Video' | 'Audio' | 'Archives' | 'Installers' | 'Code' | 'Other'

const KINDS: Array<[DownloadKind, string[]]> = [
  ['Documents',  ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub', 'mobi']],
  ['Images',     ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'avif', 'heic', 'ico', 'psd']],
  ['Video',      ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg']],
  ['Audio',      ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff']],
  ['Archives',   ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso']],
  ['Installers', ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk', 'msix']],
  ['Code',       ['js', 'ts', 'tsx', 'jsx', 'json', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'php', 'sh', 'ps1', 'sql', 'yml', 'yaml', 'toml', 'xml', 'html', 'css']],
]

const BY_EXTENSION = new Map<string, DownloadKind>()
for (const [kind, extensions] of KINDS) for (const ext of extensions) BY_EXTENSION.set(ext, kind)

/** Extension of a filename, lowercase, without the dot. '' when there is none. */
export function extensionOf(filename: string): string {
  // Strip any directory first, or a dot in a folder name ("C:/my.files/report")
  // reads as the file's type.
  const name = String(filename || '').split(/[\\/]/).pop() || ''
  // A dot that starts the name (".bashrc") marks a hidden file, not a type,
  // and a trailing dot names nothing.
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function kindOf(filename: string): DownloadKind {
  return BY_EXTENSION.get(extensionOf(filename)) || 'Other'
}

/** A byte count a person can read at a glance. */
export function formatBytes(bytes: number): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** "1.4 MB / 6.0 MB" while a size is known, otherwise just what has arrived. */
export function formatProgress(dl: Pick<DownloadItem, 'receivedBytes' | 'totalBytes'>): string {
  if (dl.totalBytes > 0) return `${formatBytes(dl.receivedBytes)} / ${formatBytes(dl.totalBytes)}`
  return formatBytes(dl.receivedBytes)
}

/**
 * 0–100, or null when the server never sent a length — a progress bar that
 * invents a width is worse than no bar at all.
 */
export function percentOf(dl: Pick<DownloadItem, 'receivedBytes' | 'totalBytes'>): number | null {
  if (!(dl.totalBytes > 0)) return null
  const pct = (dl.receivedBytes / dl.totalBytes) * 100
  return Math.max(0, Math.min(100, pct))
}

export function stateLabel(state: string): string {
  switch (state) {
    case 'completed':   return 'Complete'
    case 'cancelled':   return 'Cancelled'
    case 'interrupted': return 'Interrupted'
    default:            return 'Downloading…'
  }
}

/** Downloads still moving — what the toolbar badge counts. */
export function activeCount(downloads: DownloadItem[]): number {
  return downloads.filter(d => d.state === 'progressing').length
}

/**
 * Age in words. Downloads are looked at soon after they happen, so the near
 * past is what needs the resolution; anything older than a week is a date.
 */
export function formatWhen(ts: number | undefined, now = Date.now()): string {
  if (!ts) return ''
  const secs = Math.max(0, Math.round((now - ts) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(ts).toLocaleDateString()
}
