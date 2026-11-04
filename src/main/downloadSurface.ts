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
 * Chrome's DownloadRequestLimiter, as a small state machine. A tab starts
 * able to download ONE file. A download spends that. Real input to the tab
 * — a mouse press, a key, a tap, reported by the browser and impossible for
 * page script to forge — earns it back. Anything else is held until the
 * person allows it, so a hostile page cannot drop a stream of files on disk.
 *
 * Chromium's own hasUserGesture() is NOT used: it reports a page's timer-
 * driven `a.click()` as a gesture too, which would let a script click a
 * hidden link forever.
 *
 * The allowance belongs to the tab and its TOP-LEVEL site — never the origin
 * that fired the download, or every cross-origin iframe on a page would claim
 * its own free download. Moving to a different site starts the tab afresh; a
 * page reloading or navigating itself within its own site does not, so a
 * reload loop cannot mint free downloads either.
 */
export function createAutoDownloadPolicy() {
  const spent = new Set<string>()
  const allowed = new Set<string>()
  const siteOfTab = new Map<number, string>()
  const keyOf = (tabKey: number, site: string) => `${tabKey}|${site}`
  const clearTab = (tabKey: number) => {
    const prefix = `${tabKey}|`
    for (const k of [...spent]) if (k.startsWith(prefix)) spent.delete(k)
    for (const k of [...allowed]) if (k.startsWith(prefix)) allowed.delete(k)
  }
  return {
    keyOf,
    /** The tab committed a page on `site`. Only a change of site resets it. */
    navigated(tabKey: number, site: string) {
      const prev = siteOfTab.get(tabKey)
      if (prev !== undefined && prev !== site) clearTab(tabKey)
      siteOfTab.set(tabKey, site)
    },
    /** Real input reached the tab: it may download one more file. */
    userInput(tabKey: number) {
      const prefix = `${tabKey}|`
      for (const k of [...spent]) if (k.startsWith(prefix)) spent.delete(k)
    },
    decide(tabKey: number, site: string): 'allow' | 'hold' {
      const key = keyOf(tabKey, site)
      if (allowed.has(key)) return 'allow'
      if (spent.has(key)) return 'hold'
      spent.add(key)
      return 'allow'
    },
    /** The person said yes: this tab may keep downloading from this origin. */
    allow(key: string) { allowed.add(key) },
    /** The tab closed. */
    forgetTab(tabKey: number) { clearTab(tabKey); siteOfTab.delete(tabKey) },
  }
}

/**
 * The site a page belongs to, for the download allowance: the registrable
 * domain (news.example.co.uk → example.co.uk), or the bare host for IP
 * addresses and single-label hosts, where "last two labels" means nothing.
 */
export function downloadSiteOf(url: string, registrableDomain: (u: string) => string): string {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return '' }
  if (!host) return ''
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':') || host.startsWith('[') || !host.includes('.')) return host
  return registrableDomain(host) || host
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
