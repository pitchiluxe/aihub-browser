/**
 * AIHub Browser — Incognito session lifecycle.
 *
 * An Incognito window is only private if the engine underneath it is. The UI
 * treatment is the least of it; what matters is that every tab in the window
 * runs in a Chromium StoragePartition that was created in memory and is never
 * given a directory on disk. Electron hands out exactly that for any partition
 * name WITHOUT the "persist:" prefix, so cookies, localStorage, IndexedDB,
 * Cache Storage, service workers and the HTTP cache of a private tab all live
 * in RAM for as long as the partition does.
 *
 * Decisions, and why:
 *
 *  - ONE private session is shared by every Incognito window that is open at
 *    the same time, exactly like Chrome's single off-the-record profile. A
 *    sign-in in one Incognito window is visible in another; neither is visible
 *    to a normal window.
 *  - The session ends when the LAST Incognito window closes, not the first.
 *    Its storage, cache, HTTP auth, host-resolver cache, code cache and open
 *    sockets are cleared, then the manager moves to a new generation so the
 *    next Incognito window gets a partition that has never existed before.
 *    Electron has no API to free a session object, so the generation bump is
 *    what guarantees a fresh start even if a clear step were to fail.
 *  - The manager refuses a partition that reports itself persistent. That is
 *    the one mistake that would silently turn the feature into a UI costume.
 *
 * Nothing in here imports Electron: the session factory is injected, so the
 * lifecycle rules are unit-tested against a fake that records what was cleared.
 */

export const INCOGNITO_PARTITION_PREFIX = 'aihub-incognito-'

/** Partition name for one generation of the private session. Never "persist:". */
export function incognitoPartition(generation: number): string {
  const n = Number.isFinite(generation) ? Math.max(1, Math.floor(generation)) : 1
  return `${INCOGNITO_PARTITION_PREFIX}${n}`
}

export function isIncognitoPartition(partition: string | null | undefined): boolean {
  return String(partition || '').startsWith(INCOGNITO_PARTITION_PREFIX)
}

/**
 * IPC channels whose only job is to write browsing activity to disk. The main
 * process registers each of these through a guard that turns the call into a
 * no-op when the sender is an Incognito (or unrecognised) window — the
 * renderer is never asked whether it is private, it is told.
 *
 * `incognito.test.ts` reads src/main/index.ts and fails if any channel here is
 * registered without that guard, so a refactor cannot quietly drop it.
 */
export const PRIVATE_BLOCKED_CHANNELS = [
  'history:add',            // browsing history + the AI brain's visit log
  'rewind:add',             // readable page text + semantic embeddings
  'session:save',           // crash / restart recovery
  'chat:save',              // AI assistant conversation autosave
  'chat:clear',             // would wipe the NORMAL conversation from a private panel
  'agents:saveConversation',// agent conversation archive
  'siteMemory:set',         // per-origin AI memory (the model can write it)
  'trading:saveMemory',     // Trading Coach per-symbol autosave
] as const

/**
 * Read channels that answer differently for a private window, so private
 * windows neither restore nor inherit the persistent copies.
 */
export const PRIVATE_SUBSTITUTED_READS = [
  'session:getLast',
  'session:getPrevious',
  'chat:load',
] as const

/** The subset of Electron.Session this module touches. */
export interface PrivateSession {
  isPersistent(): boolean
  clearStorageData(): Promise<void>
  clearCache(): Promise<void>
  clearAuthCache(): Promise<void>
  clearHostResolverCache(): Promise<void>
  clearCodeCaches(options: { urls?: string[] }): Promise<void>
  closeAllConnections(): Promise<void>
}

/** A download started from a private tab. Lives in memory only. */
export interface PrivateDownload {
  id: string
  filename: string
  url: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  state: string
  startedAt: number
  completedAt: number | null
  /** Always true — lets the renderer label the row without guessing. */
  incognito: true
}

export interface EndedSession {
  partition: string
  /** Names of clear steps that threw. Empty when the teardown was complete. */
  failures: string[]
}

export interface IncognitoManagerDeps<S extends PrivateSession> {
  fromPartition(partition: string): S
  /** Runs once per new private session, before any window uses it. */
  onSessionCreated?(session: S, partition: string): void
  /** Runs after a private session has been torn down. */
  onSessionEnded?(ended: EndedSession): void
}

export function createIncognitoManager<S extends PrivateSession>(deps: IncognitoManagerDeps<S>) {
  let generation = 0
  let current: { partition: string; session: S } | null = null
  const windows = new Set<number>()
  // Every private session ever handed out, including ended generations: a
  // download or popup event that arrives late must still be classified as
  // private rather than falling through to the persistent code path.
  const everPrivate = new WeakSet<object>()
  const disposables = new Set<() => void>()
  const activeDownloads = new Map<string, () => void>()
  let downloads: PrivateDownload[] = []
  let teardown: Promise<EndedSession | null> = Promise.resolve(null)

  function ensureSession() {
    if (current) return current
    generation += 1
    const partition = incognitoPartition(generation)
    const session = deps.fromPartition(partition)
    if (session.isPersistent()) {
      throw new Error(`Refusing to use a persistent session for Incognito (${partition})`)
    }
    everPrivate.add(session)
    current = { partition, session }
    deps.onSessionCreated?.(session, partition)
    return current
  }

  async function clearSession(partition: string, session: S): Promise<EndedSession> {
    const steps: [string, () => Promise<void>][] = [
      // Cookies, localStorage, IndexedDB, Cache Storage, service workers,
      // WebSQL, file systems and shader cache — clearStorageData's defaults.
      ['storage', () => session.clearStorageData()],
      ['http-cache', () => session.clearCache()],
      ['http-auth', () => session.clearAuthCache()],
      ['host-resolver', () => session.clearHostResolverCache()],
      ['code-cache', () => session.clearCodeCaches({})],
      // Last: a keep-alive socket to a site the user signed into must not be
      // reused by anything that follows.
      ['connections', () => session.closeAllConnections()],
    ]
    const failures: string[] = []
    for (const [name, run] of steps) {
      try { await run() } catch { failures.push(name) }
    }
    return { partition, failures }
  }

  function endSession(): Promise<EndedSession | null> {
    const ending = current
    // Cleared synchronously, before any await: an Incognito window opened while
    // the old session is still being wiped gets a brand-new generation instead
    // of the one being destroyed.
    current = null
    for (const dispose of [...disposables]) { try { dispose() } catch {} }
    disposables.clear()
    for (const cancel of [...activeDownloads.values()]) { try { cancel() } catch {} }
    activeDownloads.clear()
    downloads = []
    if (!ending) return Promise.resolve(null)
    const run = clearSession(ending.partition, ending.session).then(ended => {
      try { deps.onSessionEnded?.(ended) } catch {}
      return ended
    })
    teardown = teardown.then(() => run, () => run)
    return run
  }

  return {
    /** Register an Incognito window and return the session its tabs must use. */
    acquire(windowId: number): { partition: string; session: S } {
      const active = ensureSession()
      windows.add(windowId)
      return active
    },

    /**
     * Unregister a window. Ends the private session when it was the last one;
     * resolves with what was torn down, or null when other windows remain.
     */
    release(windowId: number): Promise<EndedSession | null> {
      if (!windows.delete(windowId)) return Promise.resolve(null)
      if (windows.size > 0) return Promise.resolve(null)
      return endSession()
    },

    isIncognitoWindow(windowId: number): boolean { return windows.has(windowId) },

    /** True for any session this manager has ever created, ended or not. */
    isIncognitoSession(session: unknown): boolean {
      return !!session && typeof session === 'object' && everPrivate.has(session as object)
    },

    /** The live private session, or null when no Incognito window is open. */
    current(): { partition: string; session: S } | null { return current },

    windowCount(): number { return windows.size },
    windowIds(): number[] { return [...windows] },

    /**
     * Something that belongs to the private session and must not outlive it —
     * an OAuth popup window, typically. Returns an unregister function.
     */
    trackDisposable(dispose: () => void): () => void {
      disposables.add(dispose)
      return () => { disposables.delete(dispose) }
    },

    // ── Downloads ─────────────────────────────────────────────────────────
    // The FILES are the user's and stay on disk. The LIST of what was fetched
    // is browsing activity, so it is kept here and dropped with the session.
    upsertDownload(dl: Omit<PrivateDownload, 'incognito'>): PrivateDownload {
      const row: PrivateDownload = { ...dl, incognito: true }
      const at = downloads.findIndex(d => d.id === row.id)
      if (at === -1) downloads.unshift(row)
      else downloads[at] = row
      if (downloads.length > 500) downloads.length = 500
      return row
    },
    listDownloads(): PrivateDownload[] { return downloads.map(d => ({ ...d })) },
    /** Chrome's "Clear all": finished rows go, transfers in flight stay. */
    clearFinishedDownloads(): void { downloads = downloads.filter(d => d.state === 'progressing') },
    trackActiveDownload(id: string, cancel: () => void): void { activeDownloads.set(id, cancel) },
    settleDownload(id: string): void { activeDownloads.delete(id) },
    activeDownloadCount(): number { return activeDownloads.size },

    /** Resolves once every teardown started so far has finished. */
    whenIdle(): Promise<void> { return teardown.then(() => undefined, () => undefined) },
  }
}

export type IncognitoManager<S extends PrivateSession = PrivateSession> = ReturnType<typeof createIncognitoManager<S>>

/**
 * Whether a tab may move from one window to another. Moving reloads the URL
 * in the target window, which would carry a private page into a window that
 * records history (or a normal page into a private jar that then signs in
 * with none of the user's cookies). Chrome refuses both; so does this.
 */
export function canMoveBetweenWindows(from: { incognito: boolean } | undefined, to: { incognito: boolean } | undefined): boolean {
  if (!from || !to) return false
  return from.incognito === to.incognito
}
