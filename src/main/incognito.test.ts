import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import {
  createIncognitoManager, incognitoPartition, isIncognitoPartition, canMoveBetweenWindows,
  PRIVATE_BLOCKED_CHANNELS, PRIVATE_SUBSTITUTED_READS, INCOGNITO_PARTITION_PREFIX,
  type PrivateSession,
} from './incognito'
import { partitionFor, DEFAULT_PARTITION, newBurnerId } from './containers'

/** A session that records every clear step, standing in for Electron's. */
function fakeSession(partition: string, persistent = false) {
  const cleared: string[] = []
  const session: PrivateSession & { partition: string; cleared: string[] } = {
    partition,
    cleared,
    isPersistent: () => persistent,
    clearStorageData: async () => { cleared.push('storage') },
    clearCache: async () => { cleared.push('http-cache') },
    clearAuthCache: async () => { cleared.push('http-auth') },
    clearHostResolverCache: async () => { cleared.push('host-resolver') },
    clearCodeCaches: async () => { cleared.push('code-cache') },
    closeAllConnections: async () => { cleared.push('connections') },
  }
  return session
}

function makeManager(opts: { persistent?: boolean } = {}) {
  const created: ReturnType<typeof fakeSession>[] = []
  const ended: { partition: string; failures: string[] }[] = []
  const onCreated = vi.fn()
  const manager = createIncognitoManager({
    fromPartition: (p) => {
      const s = fakeSession(p, opts.persistent)
      created.push(s)
      return s
    },
    onSessionCreated: onCreated,
    onSessionEnded: (e) => { ended.push(e) },
  })
  return { manager, created, ended, onCreated }
}

describe('incognito partitions', () => {
  it('are never persistent partitions', () => {
    for (const n of [1, 2, 99]) {
      const p = incognitoPartition(n)
      expect(p.startsWith('persist:')).toBe(false)
      expect(isIncognitoPartition(p)).toBe(true)
    }
  })

  it('cannot collide with the normal jar, a container or a burner tab', () => {
    const p = incognitoPartition(1)
    expect(p).not.toBe(DEFAULT_PARTITION)
    expect(isIncognitoPartition(DEFAULT_PARTITION)).toBe(false)
    expect(isIncognitoPartition(partitionFor('work'))).toBe(false)
    expect(isIncognitoPartition(partitionFor(newBurnerId(1)))).toBe(false)
    // A user-typed container literally named after the prefix still lands in
    // its own persist:container-* jar, never in the private one.
    expect(isIncognitoPartition(partitionFor(`${INCOGNITO_PARTITION_PREFIX}1`))).toBe(false)
  })

  it('sanitises a nonsense generation instead of producing a shared name', () => {
    expect(incognitoPartition(0)).toBe(incognitoPartition(1))
    expect(incognitoPartition(NaN)).toBe(incognitoPartition(1))
  })
})

describe('incognito session lifecycle', () => {
  it('creates one in-memory session on first use and configures it once', () => {
    const { manager, created, onCreated } = makeManager()
    const a = manager.acquire(10)
    expect(created).toHaveLength(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(a.partition).toBe(incognitoPartition(1))
    expect(manager.isIncognitoWindow(10)).toBe(true)
    expect(manager.isIncognitoSession(a.session)).toBe(true)
  })

  it('refuses a session that would be written to disk', () => {
    const { manager } = makeManager({ persistent: true })
    expect(() => manager.acquire(1)).toThrow(/persistent/)
    expect(manager.current()).toBeNull()
  })

  it('shares one private session across every open Incognito window', () => {
    const { manager, created } = makeManager()
    const a = manager.acquire(1)
    const b = manager.acquire(2)
    expect(b.session).toBe(a.session)
    expect(created).toHaveLength(1)
    expect(manager.windowCount()).toBe(2)
  })

  it('keeps the session alive while any Incognito window remains', async () => {
    const { manager, created, ended } = makeManager()
    manager.acquire(1)
    manager.acquire(2)
    expect(await manager.release(1)).toBeNull()
    expect(ended).toHaveLength(0)
    expect(created[0].cleared).toEqual([])
    expect(manager.current()).not.toBeNull()
  })

  it('wipes every kind of private data when the last window closes', async () => {
    const { manager, created, ended } = makeManager()
    manager.acquire(1)
    manager.acquire(2)
    await manager.release(1)
    const result = await manager.release(2)
    expect(result).toEqual({ partition: incognitoPartition(1), failures: [] })
    expect(created[0].cleared).toEqual(['storage', 'http-cache', 'http-auth', 'host-resolver', 'code-cache', 'connections'])
    expect(ended).toHaveLength(1)
    expect(manager.current()).toBeNull()
  })

  it('gives the next Incognito window a partition that has never existed', async () => {
    const { manager, created } = makeManager()
    const first = manager.acquire(1)
    await manager.release(1)
    const second = manager.acquire(3)
    expect(created).toHaveLength(2)
    expect(second.partition).not.toBe(first.partition)
    expect(second.session).not.toBe(first.session)
    // Ended sessions are still recognised as private for late events.
    expect(manager.isIncognitoSession(first.session)).toBe(true)
  })

  it('does not hand a window the session that is being wiped', () => {
    const { manager } = makeManager()
    const first = manager.acquire(1)
    // Release without awaiting: the teardown is still running.
    void manager.release(1)
    const next = manager.acquire(2)
    expect(next.session).not.toBe(first.session)
  })

  it('reports clear steps that failed rather than pretending they succeeded', async () => {
    const manager = createIncognitoManager({
      fromPartition: (p) => ({
        ...fakeSession(p),
        clearCache: async () => { throw new Error('boom') },
      }),
    })
    manager.acquire(1)
    const result = await manager.release(1)
    expect(result?.failures).toEqual(['http-cache'])
  })

  it('ignores releasing a window that was never private', async () => {
    const { manager, ended } = makeManager()
    manager.acquire(1)
    expect(await manager.release(42)).toBeNull()
    expect(ended).toHaveLength(0)
    expect(manager.windowCount()).toBe(1)
  })

  it('does not classify arbitrary sessions as private', () => {
    const { manager } = makeManager()
    manager.acquire(1)
    expect(manager.isIncognitoSession(fakeSession('persist:main'))).toBe(false)
    expect(manager.isIncognitoSession(null)).toBe(false)
  })

  it('closes popups that belong to the private session when it ends', async () => {
    const { manager } = makeManager()
    manager.acquire(1)
    const closePopup = vi.fn()
    const closeUntracked = vi.fn()
    manager.trackDisposable(closePopup)
    const untrack = manager.trackDisposable(closeUntracked)
    untrack()
    await manager.release(1)
    expect(closePopup).toHaveBeenCalledTimes(1)
    expect(closeUntracked).not.toHaveBeenCalled()
  })
})

describe('incognito downloads', () => {
  const row = (id: string, state = 'progressing') => ({
    id, filename: `${id}.pdf`, url: `https://example.test/${id}`, savePath: '', totalBytes: 10,
    receivedBytes: 0, state, startedAt: 1, completedAt: null,
  })

  it('keeps the list in memory and drops it with the session', async () => {
    const { manager } = makeManager()
    manager.acquire(1)
    manager.upsertDownload(row('a'))
    manager.upsertDownload({ ...row('a'), state: 'completed', receivedBytes: 10 })
    manager.upsertDownload(row('b'))
    const list = manager.listDownloads()
    expect(list.map(d => d.id)).toEqual(['b', 'a'])
    expect(list.every(d => d.incognito)).toBe(true)
    await manager.release(1)
    expect(manager.listDownloads()).toEqual([])
  })

  it('clears finished rows but not transfers in flight', () => {
    const { manager } = makeManager()
    manager.upsertDownload(row('done', 'completed'))
    manager.upsertDownload(row('live', 'progressing'))
    manager.clearFinishedDownloads()
    expect(manager.listDownloads().map(d => d.id)).toEqual(['live'])
  })

  it('cancels private transfers still running when the session ends', async () => {
    const { manager } = makeManager()
    manager.acquire(1)
    const cancel = vi.fn()
    manager.trackActiveDownload('x', cancel)
    manager.trackActiveDownload('y', vi.fn())
    manager.settleDownload('y')
    expect(manager.activeDownloadCount()).toBe(1)
    await manager.release(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(manager.activeDownloadCount()).toBe(0)
  })
})

describe('moving tabs between windows', () => {
  it('only allows moves within the same privacy mode', () => {
    expect(canMoveBetweenWindows({ incognito: false }, { incognito: false })).toBe(true)
    expect(canMoveBetweenWindows({ incognito: true }, { incognito: true })).toBe(true)
    expect(canMoveBetweenWindows({ incognito: true }, { incognito: false })).toBe(false)
    expect(canMoveBetweenWindows({ incognito: false }, { incognito: true })).toBe(false)
  })

  it('refuses when either window is unknown', () => {
    expect(canMoveBetweenWindows(undefined, { incognito: false })).toBe(false)
    expect(canMoveBetweenWindows({ incognito: false }, undefined)).toBe(false)
  })
})

/**
 * The guard is only as good as its wiring. These read the main process source
 * and fail if a persistence channel is registered without the private-sender
 * guard — the regression that would silently put Incognito URLs back on disk.
 */
describe('main-process wiring', () => {
  const source = fs.readFileSync(join(__dirname, 'index.ts'), 'utf-8')

  it.each([...PRIVATE_BLOCKED_CHANNELS])('registers %s through the persistence guard', (channel) => {
    expect(source.includes(`handlePersistent('${channel}'`)).toBe(true)
    expect(source.includes(`ipcMain.handle('${channel}'`)).toBe(false)
  })

  it.each([...PRIVATE_SUBSTITUTED_READS])('answers %s differently for private windows', (channel) => {
    expect(source.includes(`handlePersistent('${channel}'`)).toBe(true)
    expect(source.includes(`ipcMain.handle('${channel}'`)).toBe(false)
  })

  it('routes incognito tabs through the private session, not the renderer-chosen container', () => {
    expect(source).toMatch(/ctx\.incognito\s*\?\s*privateSessionFor\(ctx\)\.partition\s*:\s*partitionFor\(containerId\)/)
  })
})
