import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import {
  cosineSimilarity, hashText, embeddingInput, keywordScore, tokenize, rankDocs,
  createSemanticIndex, type SearchDoc,
} from './semantic'

const doc = (id: string, title: string, text: string, ts = Date.now()): SearchDoc =>
  ({ id, title, text, url: `https://example.com/${id}`, ts })

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('cosineSimilarity', () => {
  it('is 1 for identical direction and 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })
  it('returns 0 rather than NaN for empty, zero or mismatched vectors', () => {
    expect(cosineSimilarity([], [1])).toBe(0)
    expect(cosineSimilarity([1, 2], [1])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('hashText', () => {
  it('is stable and distinguishes different text', () => {
    expect(hashText('hello')).toBe(hashText('hello'))
    expect(hashText('hello')).not.toBe(hashText('hello!'))
  })
})

describe('embeddingInput', () => {
  it('leads with the title and collapses whitespace', () => {
    const input = embeddingInput(doc('a', 'The Title', 'body   with\n\nspaces'))
    expect(input.startsWith('The Title')).toBe(true)
    expect(input).toContain('body with spaces')
  })
  it('caps the length so one huge page cannot dominate', () => {
    expect(embeddingInput(doc('a', 't', 'x'.repeat(50_000)), 500)).toHaveLength(500)
  })
})

describe('keywordScore', () => {
  it('rewards title hits more than body hits', () => {
    const inTitle = keywordScore(doc('a', 'electron crash', 'nothing here'), ['electron'])
    const inBody = keywordScore(doc('b', 'nothing', 'electron appears once'), ['electron'])
    expect(inTitle).toBeGreaterThan(inBody)
  })
  it('is 0 with no terms or no match', () => {
    expect(keywordScore(doc('a', 't', 'b'), [])).toBe(0)
    expect(keywordScore(doc('a', 't', 'b'), ['absent'])).toBe(0)
  })
})

describe('tokenize', () => {
  it('lowercases and drops single characters and blanks', () => {
    expect(tokenize('  The A Electron Crash ')).toEqual(['the', 'electron', 'crash'])
    expect(tokenize('')).toEqual([])
  })
})

describe('rankDocs', () => {
  const now = Date.UTC(2026, 7, 5)
  const docs = [
    doc('renderer', 'Chromium renderer segfault', 'the tab process died with ACCESS_VIOLATION', now),
    doc('cooking', 'Sourdough starter guide', 'flour water and time', now),
  ]

  it('falls back to keyword ranking when there is no query vector', () => {
    const ranked = rankDocs(docs, 'segfault', null, new Map(), now)
    expect(ranked[0].id).toBe('renderer')
    expect(ranked[0].via).toBe('keyword')
  })

  it('finds a page by meaning when the words do not match', () => {
    const vectors = new Map([['renderer', [1, 0, 0]], ['cooking', [0, 1, 0]]])
    const ranked = rankDocs(docs, 'browser tab kept crashing', [0.98, 0.02, 0], vectors, now)
    expect(ranked[0].id).toBe('renderer')
    expect(ranked[0].via).toBe('semantic')
  })

  it('ignores weak similarity instead of surfacing everything', () => {
    const vectors = new Map([['cooking', [0, 1, 0]]])
    // Query vector is near-orthogonal to the only indexed doc, and shares no
    // words with either — nothing should come back.
    expect(rankDocs(docs, 'quantum tunnelling', [1, 0.1, 0], vectors, now)).toEqual([])
  })

  it('lets a literal wording match outrank a merely related page', () => {
    const vectors = new Map([['renderer', [0.9, 0.1, 0]], ['cooking', [0.88, 0.12, 0]]])
    const ranked = rankDocs(docs, 'segfault', [0.9, 0.1, 0], vectors, now)
    expect(ranked[0].id).toBe('renderer')
  })

  it('breaks near-ties by recency', () => {
    const old = doc('old', 'Same subject', 'segfault', now - 60 * 86_400_000)
    const fresh = doc('fresh', 'Same subject', 'segfault', now - 86_400_000)
    const ranked = rankDocs([old, fresh], 'segfault', null, new Map(), now)
    expect(ranked[0].id).toBe('fresh')
  })
})

describe('createSemanticIndex', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'aihub-sem-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('embeds queued documents in the background', async () => {
    const index = createSemanticIndex(dir, async () => [1, 0, 0])
    index.index(doc('a', 'Title A', 'body'))
    await wait(30)
    expect(index.stats().indexed).toBe(1)
    expect(index.vectors().get('a')).toEqual([1, 0, 0])
  })

  it('does not re-embed unchanged text', async () => {
    let calls = 0
    const index = createSemanticIndex(dir, async () => { calls++; return [1, 0, 0] })
    index.index(doc('a', 'Title A', 'body'))
    await wait(20)
    index.index(doc('a', 'Title A', 'body'))
    await wait(20)
    expect(calls).toBe(1)
  })

  it('re-embeds when the page text changes', async () => {
    let calls = 0
    const index = createSemanticIndex(dir, async () => { calls++; return [1, 0, 0] })
    index.index(doc('a', 'Title A', 'first version'))
    await wait(20)
    index.index(doc('a', 'Title A', 'second version'))
    await wait(20)
    expect(calls).toBe(2)
  })

  it('stops queueing when no model is available, and still searches', async () => {
    const index = createSemanticIndex(dir, async () => null)
    index.index(doc('a', 'Chromium renderer segfault', 'crash'))
    await wait(20)
    expect(index.stats().indexed).toBe(0)

    const out = await index.search('segfault', [doc('a', 'Chromium renderer segfault', 'crash')])
    expect(out.semantic).toBe(false)
    expect(out.results[0].id).toBe('a')
  })

  it('survives an embedder that throws', async () => {
    const index = createSemanticIndex(dir, async () => { throw new Error('ollama down') })
    index.index(doc('a', 'Title', 'body'))
    await wait(20)
    expect(index.stats().indexed).toBe(0)
    await expect(index.search('title', [doc('a', 'Title', 'body')])).resolves.toBeTruthy()
  })

  it('returns nothing for an empty query', async () => {
    const index = createSemanticIndex(dir, async () => [1, 0, 0])
    expect((await index.search('   ', [doc('a', 't', 'b')])).results).toEqual([])
  })

  it('prunes vectors for documents that no longer exist', async () => {
    const index = createSemanticIndex(dir, async () => [1, 0, 0])
    index.index(doc('a', 'A', 'x'))
    index.index(doc('b', 'B', 'y'))
    await wait(40)
    expect(index.stats().indexed).toBe(2)
    index.prune(new Set(['a']))
    expect(index.stats().indexed).toBe(1)
    expect(index.vectors().has('b')).toBe(false)
  })
})
