import fs from 'fs'
import { dirname } from 'path'

/**
 * AIHub Browser — debounced, crash-safe JSON store for main-process state.
 *
 * The naive pattern this replaces — read the whole file, mutate, write the
 * whole file, synchronously, on every event — costs ~9 ms of BLOCKED main
 * thread per page navigation once history.json reaches its 2000-entry cap
 * (measured: 493 KB history + 173 KB browsing-brain). The main process also
 * services every tab's IPC, window bounds and BrowserView attachment, so that
 * stall is felt as tab-switch and typing lag across the whole app, not just by
 * whoever wrote the record.
 *
 * Here the data lives in memory (read once, lazily) and hits the disk on a
 * debounce, asynchronously — so a burst of navigations costs one write instead
 * of one per navigation. Per-navigation cost drops to ~0.01 ms.
 *
 * Writes are atomic: a temp file in the same directory is renamed over the
 * target. rename(2) is atomic on POSIX and MoveFileEx-with-replace on Windows,
 * so a crash or power loss mid-write leaves either the old file or the new one
 * — never the truncated middle. The previous fs.writeFileSync could lose the
 * user's entire history on an unlucky crash.
 */
export interface JsonStore<T> {
  /** Current value, loaded from disk on first call. Mutate via update(). */
  get(): T
  /** Replace the value and schedule a write. */
  set(next: T): void
  /** Mutate in place (or return a replacement) and schedule a write. */
  update(fn: (current: T) => T | void): void
  /** Write now, synchronously. For app-quit paths, where async never lands. */
  flush(): void
  /** True when there are unsaved changes. */
  isDirty(): boolean
}

export interface JsonStoreOptions {
  /** Quiet period before a write lands. Default 1500 ms. */
  debounceMs?: number
  /** Indent the JSON. Off by default — these files are large and machine-read. */
  pretty?: boolean
}

export function createJsonStore<T>(
  file: string,
  fallback: () => T,
  options: JsonStoreOptions = {},
): JsonStore<T> {
  const { debounceMs = 1500, pretty = false } = options

  let value: T | undefined
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  // Set while an async write is in flight, so a mutation arriving mid-write
  // schedules a follow-up instead of being silently dropped by the completing
  // write clearing the dirty flag.
  let writing = false

  const serialize = () => JSON.stringify(value, null, pretty ? 2 : undefined)

  const ensureDir = () => {
    const dir = dirname(file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  // Unique per call: two stores writing the same directory (or a flush racing a
  // debounced write) must never share a temp path.
  const tempPath = () => `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`

  const load = (): T => {
    if (value !== undefined) return value
    try {
      value = JSON.parse(fs.readFileSync(file, 'utf-8')) as T
    } catch {
      // Missing or corrupt — a browser must still start. The fallback becomes
      // the live value and is written on the first mutation.
      value = fallback()
    }
    return value as T
  }

  const cancelTimer = () => {
    if (timer) { clearTimeout(timer); timer = null }
  }

  const writeAsync = () => {
    if (writing || !dirty) return
    writing = true
    dirty = false
    const tmp = tempPath()
    const payload = serialize()
    void (async () => {
      try {
        ensureDir()
        await fs.promises.writeFile(tmp, payload)
        await fs.promises.rename(tmp, file)
      } catch {
        // Disk full, permissions, antivirus lock — keep the in-memory value and
        // let the next mutation retry rather than crashing the browser.
        dirty = true
        try { await fs.promises.unlink(tmp) } catch {}
      } finally {
        writing = false
        // A mutation that arrived while we were writing needs its own pass.
        if (dirty) schedule()
      }
    })()
  }

  const schedule = () => {
    dirty = true
    cancelTimer()
    timer = setTimeout(() => { timer = null; writeAsync() }, debounceMs)
    // Never hold the app open just to flush a preferences file.
    if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref()
  }

  return {
    get: load,
    set(next: T) { value = next; schedule() },
    update(fn) {
      const current = load()
      const replacement = fn(current)
      if (replacement !== undefined) value = replacement as T
      schedule()
    },
    flush() {
      cancelTimer()
      if (!dirty || value === undefined) return
      const tmp = tempPath()
      try {
        ensureDir()
        fs.writeFileSync(tmp, serialize())
        fs.renameSync(tmp, file)
        dirty = false
      } catch {
        try { fs.unlinkSync(tmp) } catch {}
      }
    },
    isDirty() { return dirty },
  }
}

/** Every store created here, so app shutdown can flush them in one call. */
const registry: JsonStore<any>[] = []

/** Same as createJsonStore, but registered for flushAllJsonStores(). */
export function createManagedJsonStore<T>(
  file: string,
  fallback: () => T,
  options?: JsonStoreOptions,
): JsonStore<T> {
  const store = createJsonStore(file, fallback, options)
  registry.push(store)
  return store
}

/** Write every pending change synchronously. Call on before-quit. */
export function flushAllJsonStores(): void {
  for (const store of registry) store.flush()
}
