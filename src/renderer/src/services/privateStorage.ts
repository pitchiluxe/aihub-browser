/**
 * Copy-on-write Web Storage for Incognito windows.
 *
 * Every app window's UI runs on the same Electron session, so they all share
 * one localStorage. That is fine for preferences, but some features write
 * browsing activity there too — Focus Mode keeps seconds-per-host and the last
 * URL of each host, for instance — and a private window must not add to it.
 *
 * Inside an Incognito window, `localStorage` is replaced (before any app code
 * runs) by this overlay:
 *
 *   - reads fall through to the real storage, so the theme, extension toggles
 *     and every other preference look exactly as they do in a normal window;
 *   - writes, removals and clear() land in memory only, shadow the real value
 *     for this window, and disappear with it.
 *
 * The real storage is never written from a private window, whatever feature
 * does the writing — including ones added after this was.
 */

type Base = Pick<Storage, 'getItem' | 'key' | 'length'> | null

export function createOverlayStorage(base: Base): Storage {
  const written = new Map<string, string>()
  const removed = new Set<string>()
  let cleared = false

  const baseKeys = (): string[] => {
    if (!base || cleared) return []
    const out: string[] = []
    try {
      for (let i = 0; i < base.length; i++) {
        const k = base.key(i)
        if (k !== null) out.push(k)
      }
    } catch { /* storage unavailable — overlay still works on its own */ }
    return out
  }

  const keys = (): string[] => {
    const out = baseKeys().filter(k => !removed.has(k) && !written.has(k))
    for (const k of written.keys()) out.push(k)
    return out
  }

  const api = {
    getItem(key: string): string | null {
      const k = String(key)
      if (written.has(k)) return written.get(k)!
      if (cleared || removed.has(k) || !base) return null
      try { return base.getItem(k) } catch { return null }
    },
    setItem(key: string, value: string): void {
      const k = String(key)
      written.set(k, String(value))
      removed.delete(k)
    },
    removeItem(key: string): void {
      const k = String(key)
      written.delete(k)
      removed.add(k)
    },
    clear(): void {
      written.clear()
      removed.clear()
      cleared = true
    },
    key(index: number): string | null {
      return keys()[index] ?? null
    },
    get length(): number {
      return keys().length
    },
  }

  // Storage also allows property-style access (`localStorage.foo = 'x'`).
  // A Proxy keeps that working without letting it reach the real storage.
  return new Proxy(api as unknown as Storage, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop, receiver)
      return api.getItem(prop) ?? undefined
    },
    set(target, prop, value) {
      if (typeof prop !== 'string' || prop in target) return Reflect.set(target, prop, value)
      api.setItem(prop, value)
      return true
    },
    deleteProperty(target, prop) {
      if (typeof prop !== 'string' || prop in target) return Reflect.deleteProperty(target, prop)
      api.removeItem(prop)
      return true
    },
    has(target, prop) {
      if (typeof prop !== 'string' || prop in target) return Reflect.has(target, prop)
      return api.getItem(prop) !== null
    },
    ownKeys() { return keys() },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== 'string' || prop in target) return Reflect.getOwnPropertyDescriptor(target, prop)
      const value = api.getItem(prop)
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true }
    },
  })
}

/**
 * Swap `window.localStorage` for the overlay. Returns false when the engine
 * refused the swap, so the caller can say so rather than assume privacy.
 */
export function installPrivateStorage(win: Window): boolean {
  let base: Storage | null = null
  try { base = win.localStorage } catch { base = null }
  const overlay = createOverlayStorage(base)
  try {
    Object.defineProperty(win, 'localStorage', {
      configurable: true,
      enumerable: true,
      get: () => overlay,
    })
  } catch {
    return false
  }
  try { return win.localStorage === overlay } catch { return false }
}
