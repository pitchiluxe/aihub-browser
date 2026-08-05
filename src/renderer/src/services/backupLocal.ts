/**
 * AIHub Browser — merging the parts of a backup that live in localStorage.
 *
 * Custom themes, window styles and generated extensions are renderer state,
 * so the main process hands them back untouched at import and they are merged
 * here, where localStorage actually exists. Kept on this side of the boundary
 * deliberately: the renderer must not import main-process modules.
 */

/** Merge two localStorage blobs holding JSON arrays; local entries win. */
export function mergeLocalJsonArrays(
  current: string | undefined,
  incoming: string | undefined,
  idField = 'id',
): string | undefined {
  const parse = (raw?: string): any[] => {
    if (!raw) return []
    try { const value = JSON.parse(raw); return Array.isArray(value) ? value : [] } catch { return [] }
  }

  const byId = new Map<string, any>()
  // Local first: a theme the user has here keeps its name and colours even if
  // the backup holds an older edit of the same id.
  for (const item of [...parse(current), ...parse(incoming)]) {
    const id = item?.[idField]
    if (id === undefined || id === null) continue
    if (!byId.has(String(id))) byId.set(String(id), item)
  }

  const merged = [...byId.values()]
  return merged.length ? JSON.stringify(merged) : current
}
