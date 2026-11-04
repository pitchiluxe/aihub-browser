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
 * Chrome's "this site is trying to download multiple files" rule.
 *
 * One click buys one download. A page may also start ONE download on its
 * own (the "your download will begin shortly" pattern). Anything beyond
 * that — a second automatic download, or a burst of files fired from a
 * single click — is held until the person allows it, so a hostile page
 * cannot drop a stream of files on disk. Chromium reports a script-driven
 * click as a gesture for every file it fires, so gestures arriving within
 * BURST_MS of an allowed download count as the same click. The allowance is
 * per tab and per origin, and resets when the tab navigates.
 */
export const BURST_MS = 1000
export function createAutoDownloadPolicy() {
  const usedAutomatic = new Set<string>()
  const lastAllowedAt = new Map<string, number>()
  const allowed = new Set<string>()
  const keyOf = (tabKey: number, origin: string) => `${tabKey}|${origin}`
  return {
    keyOf,
    decide(tabKey: number, origin: string, userGesture: boolean, now = Date.now()): 'allow' | 'hold' {
      const key = keyOf(tabKey, origin)
      if (allowed.has(key)) return 'allow'
      const last = lastAllowedAt.get(key)
      if (userGesture) {
        if (last !== undefined && now - last < BURST_MS) return 'hold'
        lastAllowedAt.set(key, now)
        return 'allow'
      }
      if (!usedAutomatic.has(key)) { usedAutomatic.add(key); lastAllowedAt.set(key, now); return 'allow' }
      return 'hold'
    },
    /** The person said yes: this tab may keep downloading from this origin. */
    allow(key: string) { allowed.add(key) },
    /** The tab navigated or closed: its page gets a fresh allowance. */
    resetTab(tabKey: number) {
      const prefix = `${tabKey}|`
      for (const k of [...usedAutomatic]) if (k.startsWith(prefix)) usedAutomatic.delete(k)
      for (const k of [...lastAllowedAt.keys()]) if (k.startsWith(prefix)) lastAllowedAt.delete(k)
      for (const k of [...allowed]) if (k.startsWith(prefix)) allowed.delete(k)
    },
  }
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
