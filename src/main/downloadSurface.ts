/**
 * How a download shows itself outside the toolbar: the Windows taskbar
 * progress bar, and the blank tab or popup a "Download" button leaves behind.
 *
 * Pure functions so the rules can be tested without Electron.
 */

/**
 * True when a page exists only because it started this download.
 *
 * Many sites wire their Download button as `target="_blank"` or
 * `window.open(fileUrl)`. The new tab's first navigation turns into a
 * download, so it never commits a page — the person is left looking at an
 * empty tab and reads it as "nothing happened". Chrome closes that tab; so do
 * we. A tab that already showed a page (the download came from a link on it)
 * keeps its content and stays open.
 */
export function isDownloadOnlyPage(committedUrl: string, historyLength: number): boolean {
  const url = String(committedUrl || '')
  const blank = url === '' || url === 'about:blank'
  return blank && historyLength <= 1
}

export interface TransferProgress { receivedBytes: number; totalBytes: number }

/**
 * Taskbar progress for every transfer in flight, as Electron's
 * setProgressBar expects it:
 *   -1  nothing in flight — remove the bar
 *    2  something in flight but no server sent a length — indeterminate
 *  0–1  combined fraction of the transfers whose size is known
 */
export function taskbarProgress(active: Iterable<TransferProgress>): number {
  let any = false
  let received = 0
  let total = 0
  for (const t of active) {
    any = true
    if (t.totalBytes > 0) {
      received += Math.min(t.receivedBytes, t.totalBytes)
      total += t.totalBytes
    }
  }
  if (!any) return -1
  if (total <= 0) return 2
  return Math.max(0, Math.min(1, received / total))
}

/**
 * A save path that does not overwrite anything already on disk:
 * "report.pdf" → "report (1).pdf" → "report (2).pdf", as Chrome names them.
 * `taken` is consulted for each candidate (fs.existsSync in production) and
 * also covers transfers still in flight that have not created their file yet.
 */
export function uniqueSavePath(dir: string, filename: string, taken: (path: string) => boolean, sep = '/'): string {
  const name = String(filename || 'download').replace(/[\\/:*?"<>|]/g, '_') || 'download'
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const join = (n: string) => (dir.endsWith(sep) ? dir + n : dir + sep + n)
  let candidate = join(name)
  for (let i = 1; taken(candidate) && i < 10_000; i++) candidate = join(`${stem} (${i})${ext}`)
  return candidate
}
