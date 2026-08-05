import { join } from 'path'
import { createManagedJsonStore } from './jsonStore'

/**
 * AIHub Browser — meaning-based search over pages you have actually read.
 *
 * The Rewind archive already stores the text of every page visited; this adds
 * an embedding per page so "that article about renderer crashes" finds the
 * right page even when it never used those words. Embeddings are produced by
 * the user's local Ollama — nothing leaves the machine — and the whole feature
 * degrades to the existing keyword ranking when Ollama is not running, which
 * is the common case on a fresh install.
 *
 * The scoring core is pure and injected with its embedder, so the ranking
 * behaviour is testable without a model.
 */

export interface Embedding {
  id: string
  vector: number[]
  /** Hash of the text the vector was built from — re-embed when it changes. */
  textHash: string
  ts: number
}

export interface SearchDoc {
  id: string
  title: string
  url: string
  text: string
  ts: number
}

export interface ScoredDoc {
  id: string
  score: number
  /** Which signal produced the score, for the "smart"/"keyword" badge in the UI. */
  via: 'semantic' | 'keyword'
}

/** Cheap, stable string hash (FNV-1a) for change detection. */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Cosine similarity, clamped to [-1, 1]; 0 for empty or mismatched vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB))
  return Math.max(-1, Math.min(1, cos))
}

/** The text an embedding is built from: title first, then a slice of the body. */
export function embeddingInput(doc: SearchDoc, maxChars = 2000): string {
  const body = (doc.text || '').replace(/\s+/g, ' ').trim()
  return `${doc.title || ''}\n${doc.url || ''}\n${body}`.slice(0, maxChars)
}

/** Word-overlap score — the fallback, and the tiebreaker for exact wording. */
export function keywordScore(doc: SearchDoc, terms: string[]): number {
  if (!terms.length) return 0
  const title = (doc.title || '').toLowerCase()
  const haystack = `${title} ${(doc.url || '').toLowerCase()} ${(doc.text || '').toLowerCase()}`
  let score = 0
  for (const term of terms) {
    const hits = haystack.split(term).length - 1
    if (hits === 0) continue
    score += Math.min(hits, 10) + (title.includes(term) ? 5 : 0)
  }
  return score
}

export function tokenize(query: string): string[] {
  return String(query || '').toLowerCase().split(/\s+/).map(t => t.trim()).filter(t => t.length > 1)
}

/**
 * Rank documents against a query.
 *
 * Semantic similarity leads, but a keyword hit still contributes: a page that
 * literally contains the phrase should not lose to one that is merely
 * thematically close. Recency breaks near-ties — with two equally relevant
 * pages, the one read yesterday is nearly always the one meant.
 */
export function rankDocs(
  docs: SearchDoc[],
  query: string,
  queryVector: number[] | null,
  vectors: Map<string, number[]>,
  now = Date.now(),
): ScoredDoc[] {
  const terms = tokenize(query)
  const out: ScoredDoc[] = []
  for (const doc of docs) {
    const kw = keywordScore(doc, terms)
    const vec = vectors.get(doc.id)
    const sim = queryVector && vec ? cosineSimilarity(queryVector, vec) : 0
    // Only count a genuine semantic relationship; low cosines are noise and
    // would otherwise drag in every page in the archive.
    const semantic = sim > 0.45 ? sim : 0
    if (!semantic && !kw) continue
    const ageDays = Math.max(0, (now - (doc.ts || now)) / 86_400_000)
    const recency = Math.max(0, 1 - ageDays / 30) * 0.15
    const score = semantic * 3 + Math.min(kw, 30) / 30 + recency
    out.push({ id: doc.id, score, via: semantic >= 0.45 ? 'semantic' : 'keyword' })
  }
  return out.sort((a, b) => b.score - a.score)
}

export type Embedder = (text: string) => Promise<number[] | null>

export function createSemanticIndex(appDir: string, embed: Embedder) {
  const store = createManagedJsonStore<Record<string, Embedding>>(
    join(appDir, 'semantic-index.json'), () => ({}), { debounceMs: 5000 },
  )

  // One embedding at a time: the point is to be invisible in the background,
  // not to saturate the machine's GPU while the user is browsing.
  let running = false
  const queue: SearchDoc[] = []

  const pump = async () => {
    if (running) return
    running = true
    try {
      while (queue.length) {
        const doc = queue.shift()!
        const input = embeddingInput(doc)
        const textHash = hashText(input)
        const existing = store.get()[doc.id]
        if (existing && existing.textHash === textHash) continue
        const vector = await embed(input)
        if (!vector?.length) {
          // No model available — drop the backlog rather than spin on it. The
          // next indexable page will try again.
          queue.length = 0
          break
        }
        store.update(index => { index[doc.id] = { id: doc.id, vector, textHash, ts: Date.now() } })
      }
    } catch {
      // An embedding failure must never take down browsing; the doc simply
      // stays keyword-only.
    } finally {
      running = false
    }
  }

  return {
    /** Queue a page for background embedding. */
    index(doc: SearchDoc) {
      if (!doc?.id || !(doc.text || doc.title)) return
      if (queue.length > 200) return  // archive import or runaway — keep memory flat
      queue.push(doc)
      void pump()
    },

    /** Vectors for scoring, keyed by doc id. */
    vectors(): Map<string, number[]> {
      const map = new Map<string, number[]>()
      for (const entry of Object.values(store.get())) map.set(entry.id, entry.vector)
      return map
    },

    /** Drop vectors whose documents no longer exist. */
    prune(liveIds: Set<string>) {
      store.update(index => {
        for (const id of Object.keys(index)) if (!liveIds.has(id)) delete index[id]
      })
    },

    async search(query: string, docs: SearchDoc[], limit = 60): Promise<{ results: ScoredDoc[]; semantic: boolean }> {
      const trimmed = String(query || '').trim()
      if (!trimmed) return { results: [], semantic: false }
      let queryVector: number[] | null = null
      try { queryVector = await embed(trimmed) } catch { queryVector = null }
      const results = rankDocs(docs, trimmed, queryVector, this.vectors())
      return { results: results.slice(0, limit), semantic: !!queryVector }
    },

    stats() {
      const index = store.get()
      return { indexed: Object.keys(index).length, queued: queue.length }
    },
  }
}

export type SemanticIndex = ReturnType<typeof createSemanticIndex>
