// bookmarkSummary.ts — AI summary for individual bookmarks
import { Bookmark } from '../store/browserStore'

const SUMMARIZE_INFLIGHT = new Set<string>()

/**
 * Generate (or refresh) the AI summary for a single bookmark.
 * The IPC handler does the actual fetch + AI call; this layer just plumbs
 * the result back to the store.
 */
export async function summarizeBookmark(
  bookmark: Bookmark,
  onUpdate: (patch: Partial<Bookmark>) => void,
): Promise<void> {
  if (SUMMARIZE_INFLIGHT.has(bookmark.id)) return
  SUMMARIZE_INFLIGHT.add(bookmark.id)
  try {
    const result = await window.electronAPI.bookmarks.summarize(bookmark.id)
    if (result?.summary) {
      onUpdate({
        summary: result.summary,
        summaryAt: Date.now(),
      })
    }
  } catch {
    // Fail silently — the bookmark keeps working without a summary.
  } finally {
    SUMMARIZE_INFLIGHT.delete(bookmark.id)
  }
}

/**
 * Batch-summarize bookmarks that don't have a summary yet.
 * Limited to MAX_PER_RUN to avoid hammering the AI on large bookmark stores.
 */
const MAX_PER_RUN = 8

export async function backfillMissingSummaries(
  bookmarks: Bookmark[],
  onUpdate: (id: string, patch: Partial<Bookmark>) => void,
): Promise<number> {
  const needs = bookmarks.filter(b => !b.summary && b.url && b.url !== 'home')
    .slice(0, MAX_PER_RUN)
  let count = 0
  for (const bm of needs) {
    await summarizeBookmark(bm, patch => {
      onUpdate(bm.id, patch)
      count++
    })
  }
  return count
}
