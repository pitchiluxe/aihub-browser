import fs from 'fs'
import { dirname } from 'path'

/**
 * AIHub Browser — append-only record log for large, id-keyed collections.
 *
 * createJsonStore rewrites the whole file on every change. That is fine for
 * small state, but Rewind holds ~12 MB of page text at its cap, and every
 * page dwell paid a synchronous 70 ms JSON.stringify of the entire archive on
 * the main thread (measured on the real profile) — felt as tab-switch and
 * typing lag across every window.
 *
 * Here each change appends ONE line (newline-delimited JSON, a few KB) with a
 * synchronous append, which costs well under a millisecond and lands on disk
 * immediately, so there is nothing to flush at quit. Replaying the lines on
 * load rebuilds the collection: a record line inserts or replaces by id (and
 * becomes the newest), a tombstone removes. A crash mid-append leaves at most
 * a torn final line, which replay skips.
 *
 * Obsolete lines (replaced records, tombstones, evicted entries) pile up, so
 * the file is compacted once it holds noticeably more lines than live
 * records. Compaction serializes in small slices, yielding to the event loop
 * between them, then swaps the file in with an atomic rename — the main
 * thread is never blocked for the whole archive at once.
 */
export interface RecordLog<T extends { id: string }> {
  /** Every live record, newest first. Treat as read-only. */
  all(): readonly T[]
  /** Insert, or replace the record with the same id; it becomes the newest. */
  put(record: T): void
  remove(id: string): void
  clear(): void
  /** Resolves when any in-flight compaction has finished. For tests and shutdown. */
  idle(): Promise<void>
}

export interface RecordLogOptions<T> {
  /** Keep at most this many records; the oldest are dropped. */
  cap?: number
  /** One-time import of a legacy whole-file store (array, newest first). */
  legacy?: { file: string; read: (raw: string) => T[] }
  /** Records serialized per slice during compaction. Default 50. */
  sliceSize?: number
}

const TOMBSTONE = '$deleted'

export function createRecordLog<T extends { id: string }>(
  file: string,
  options: RecordLogOptions<T> = {},
): RecordLog<T> {
  const { cap = Infinity, legacy, sliceSize = 50 } = options

  // Insertion order = age: the first key is the oldest record.
  let records: Map<string, T> | null = null
  let newestFirst: T[] | null = null
  let linesOnDisk = 0
  let compacting: Promise<void> | null = null
  // Bumped by clear(), so a compaction that started before it never swaps
  // its stale snapshot in over the emptied file.
  let generation = 0
  // Lines appended while a compaction is writing the replacement file. They
  // are newer than its snapshot, so they are re-appended after the swap.
  let appendedDuringCompaction: string[] | null = null

  const ensureDir = () => {
    const dir = dirname(file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  const evictOverCap = (map: Map<string, T>) => {
    while (map.size > cap) map.delete(map.keys().next().value as string)
  }

  const replay = (raw: string, map: Map<string, T>): number => {
    let lines = 0
    for (const line of raw.split('\n')) {
      if (!line) continue
      lines++
      let parsed: any
      try { parsed = JSON.parse(line) } catch { continue } // torn tail after a crash
      if (!parsed || typeof parsed.id !== 'string') continue
      map.delete(parsed.id)
      // Evict per line, exactly as put() did live. Capping only at the end
      // would resurrect records evicted before a later removal freed a slot.
      if (!parsed[TOMBSTONE]) { map.set(parsed.id, parsed as T); evictOverCap(map) }
    }
    return lines
  }

  const load = (): Map<string, T> => {
    if (records) return records
    const map = new Map<string, T>()
    // The legacy file is deleted only after a compaction has written the full
    // log, so while it exists the migration is unfinished: import it first and
    // replay any lines appended since on top (an app quit before the first
    // compaction must not hide the whole archive behind those few lines).
    const migrating = !!legacy && fs.existsSync(legacy.file)
    if (migrating) {
      try {
        const old = legacy!.read(fs.readFileSync(legacy!.file, 'utf-8'))
        // Legacy arrays are newest first; the map wants oldest first.
        for (let i = old.length - 1; i >= 0; i--) {
          const r = old[i]
          if (r && typeof r.id === 'string') { map.delete(r.id); map.set(r.id, r) }
        }
      } catch { /* unreadable legacy file: start empty rather than not start */ }
    }
    try { linesOnDisk = replay(fs.readFileSync(file, 'utf-8'), map) } catch { /* no log yet */ }
    // Forces the compaction below, which writes the complete log.
    if (migrating) linesOnDisk = Infinity
    evictOverCap(map)
    records = map
    if (needsCompaction()) void compact()
    return map
  }

  const append = (line: string) => {
    appendedDuringCompaction?.push(line)
    try {
      ensureDir()
      fs.appendFileSync(file, line + '\n')
      linesOnDisk++
    } catch {
      // Disk full or locked: memory stays correct; the next compaction
      // rewrites everything from memory and repairs the file.
      linesOnDisk = Infinity
    }
  }

  const needsCompaction = () =>
    !compacting && records !== null && linesOnDisk > records.size * 1.5 + 200

  const yieldToLoop = () => new Promise<void>(r => setImmediate(r))

  const compact = (): Promise<void> => {
    if (compacting) return compacting
    const snapshot = [...load().values()]
    const startedAt = generation
    appendedDuringCompaction = []
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    compacting = (async () => {
      try {
        const parts: string[] = []
        for (let i = 0; i < snapshot.length; i += sliceSize) {
          let chunk = ''
          for (const r of snapshot.slice(i, i + sliceSize)) chunk += JSON.stringify(r) + '\n'
          parts.push(chunk)
          await yieldToLoop()
        }
        ensureDir()
        await fs.promises.writeFile(tmp, parts.join(''))
        if (generation !== startedAt) throw new Error('cleared during compaction')
        // Synchronous from here on: nothing may append between the swap and
        // re-appending the lines that arrived during the write.
        fs.renameSync(tmp, file)
        const late = appendedDuringCompaction ?? []
        linesOnDisk = snapshot.length + late.length
        if (late.length) {
          try { fs.appendFileSync(file, late.join('\n') + '\n') } catch { linesOnDisk = Infinity }
        }
        if (legacy) { try { fs.unlinkSync(legacy.file) } catch { /* already gone */ } }
      } catch {
        try { fs.unlinkSync(tmp) } catch { /* never created, or already renamed */ }
      } finally {
        appendedDuringCompaction = null
        compacting = null
      }
    })()
    return compacting
  }

  const changed = () => {
    newestFirst = null
    if (needsCompaction()) void compact()
  }

  return {
    all() {
      if (!newestFirst) newestFirst = [...load().values()].reverse()
      return newestFirst
    },
    put(record) {
      const map = load()
      map.delete(record.id)
      map.set(record.id, record)
      evictOverCap(map)
      append(JSON.stringify(record))
      changed()
    },
    remove(id) {
      const map = load()
      if (!map.delete(id)) return
      append(JSON.stringify({ id, [TOMBSTONE]: true }))
      changed()
    },
    clear() {
      records = new Map()
      newestFirst = null
      generation++
      try { ensureDir(); fs.writeFileSync(file, '') } catch { /* next compaction repairs */ }
      linesOnDisk = 0
      if (legacy) { try { fs.unlinkSync(legacy.file) } catch { /* already gone */ } }
    },
    idle() { return compacting ?? Promise.resolve() },
  }
}
