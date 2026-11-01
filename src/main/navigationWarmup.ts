/** A small per-tab budget; speculation never fetches a document or runs its scripts. */
export function createNavigationWarmup(now = Date.now) {
  const recent = new Map<string, number>()
  let last = -Infinity
  return (candidate: unknown): string | null => {
    if (typeof candidate !== 'string' || candidate.length > 4096) return null
    let url: URL
    try { url = new URL(candidate) } catch { return null }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const time = now()
    if (time - last < 1000 || time - (recent.get(url.origin) ?? -Infinity) < 30_000) return null
    for (const [origin, ts] of recent) if (time - ts >= 30_000) recent.delete(origin)
    if (recent.size >= 8) return null
    recent.set(url.origin, time)
    last = time
    return url.origin
  }
}
