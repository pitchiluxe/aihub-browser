// readingLists.ts — F10: Community Reading Lists
// Curated link collections. Per-device for now (no Supabase wiring) — the same
// storage pattern F5/F7/F8/F9 use. When a community backend connects, lists
// can opt into replication the same way channels do.

import { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReadingListItem {
  /** URL being curated */
  url: string
  /** Human title */
  title: string
  /** Optional note from the curator about why this link is here */
  note?: string
  /** When it was added (epoch ms) */
  addedAt: number
}

export interface ReadingList {
  id: string
  /** "Best reads on AI safety", "Trading psychology", "Genesis deep-dive" */
  title: string
  /** Short pitch explaining the list */
  description: string
  /** Theme tag for grouping, e.g. "AI", "Trading", "Bible" */
  theme: string
  /** Curation status: local-only, or moderated and public */
  visibility: 'private' | 'public'
  /** Author handle — local identity, e.g. "you" or peer id */
  author: string
  /** AI-generated summary, refreshed on demand */
  aiSummary?: string
  /** ISO timestamp */
  createdAt: string
  /** ISO timestamp */
  updatedAt: string
  /** List of curated links */
  items: ReadingListItem[]
  /** Number of followers (peer-side; per-device counter) */
  followers: number
  /** Has the local user subscribed? */
  subscribed: boolean
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const LISTS_KEY  = 'aihub-reading-lists-v1'
const SEED_KEY   = 'aihub-reading-lists-seeded-v1'

function readRaw(): ReadingList[] {
  try {
    const raw = localStorage.getItem(LISTS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function writeRaw(lists: ReadingList[]) {
  try { localStorage.setItem(LISTS_KEY, JSON.stringify(lists)) } catch {}
}

function uid(): string {
  return `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function today(): string {
  return new Date().toISOString()
}

const SEED_LISTS: Omit<ReadingList, 'id' | 'createdAt' | 'updatedAt' | 'followers' | 'subscribed'>[] = [
  {
    title: 'Best reads on AI safety',
    description: 'Pieces that changed how I think about alignment, agency, and the long-term arc.',
    theme: 'AI',
    visibility: 'public',
    author: 'erick',
    aiSummary: 'A curated reading path on AI safety — alignment essays, governance proposals, and a few field reports from people building frontier systems.',
    items: [
      { url: 'https://www.anthropic.com/news/core-views-on-ai-safety', title: "Anthropic — Core views on AI safety", note: 'Start here. The clearest one-page framing I have read.', addedAt: Date.now() },
      { url: 'https://arxiv.org/abs/2206.09375', title: 'Constitutional AI — arXiv', note: 'The technique that started the RLHF-on-rules branch.', addedAt: Date.now() + 1 },
      { url: 'https://www.lesswrong.com/tag/ai-alignment', title: 'LessWrong — AI alignment tag', addedAt: Date.now() + 2 },
    ],
  },
  {
    title: 'Trading psychology — the deep cuts',
    description: 'Beyond "cut your losers". What the literature actually says about trader cognition.',
    theme: 'Trading',
    visibility: 'public',
    author: 'erick',
    aiSummary: 'A working trader\'s reading list on the psychology of decision-making under uncertainty — biases, risk protocols, and the small rituals that keep you honest.',
    items: [
      { url: 'https://en.wikipedia.org/wiki/Loss_aversion', title: 'Loss aversion (Wikipedia)', addedAt: Date.now() },
      { url: 'https://www.vantharp.com/', title: 'Van Tharp — Trading psychology', addedAt: Date.now() + 1 },
    ],
  },
  {
    title: 'Genesis — close reading',
    description: 'Articles and commentaries on the first book of the Bible, chapter by chapter.',
    theme: 'Bible',
    visibility: 'public',
    author: 'grace',
    aiSummary: 'A study list on the book of Genesis — historical readings, literary structure notes, and pastoral commentaries.',
    items: [
      { url: 'https://en.wikipedia.org/wiki/Book_of_Genesis', title: 'Book of Genesis (Wikipedia)', addedAt: Date.now() },
      { url: 'https://biblehub.com/genesis/1.htm', title: 'Genesis 1 — Bible Hub', addedAt: Date.now() + 1 },
    ],
  },
]

function seedIfNeeded() {
  if (localStorage.getItem(SEED_KEY) === '1') return
  const existing = readRaw()
  if (existing.length > 0) {
    localStorage.setItem(SEED_KEY, '1')
    return
  }
  const now = today()
  const seeded: ReadingList[] = SEED_LISTS.map(s => ({
    ...s,
    id: uid(),
    createdAt: now,
    updatedAt: now,
    followers: Math.floor(Math.random() * 20) + 1,
    subscribed: false,
  }))
  writeRaw(seeded)
  localStorage.setItem(SEED_KEY, '1')
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function loadLists(): ReadingList[] {
  seedIfNeeded()
  return readRaw()
}

export function saveLists(lists: ReadingList[]) {
  writeRaw(lists)
}

export function getList(id: string): ReadingList | null {
  return readRaw().find(l => l.id === id) || null
}

export function createList(input: {
  title: string
  description: string
  theme: string
  visibility: 'private' | 'public'
  author: string
}): ReadingList {
  const now = today()
  const list: ReadingList = {
    id: uid(),
    title: input.title.trim() || 'Untitled list',
    description: input.description.trim(),
    theme: input.theme.trim() || 'General',
    visibility: input.visibility,
    author: input.author.trim() || 'anonymous',
    items: [],
    followers: 0,
    subscribed: false,
    createdAt: now,
    updatedAt: now,
  }
  const lists = readRaw()
  lists.unshift(list)
  writeRaw(lists)
  return list
}

export function updateList(id: string, updater: (l: ReadingList) => ReadingList) {
  const lists = readRaw()
  const i = lists.findIndex(l => l.id === id)
  if (i < 0) return null
  const updated = updater(lists[i])
  updated.updatedAt = today()
  lists[i] = updated
  writeRaw(lists)
  return updated
}

export function deleteList(id: string) {
  const lists = readRaw().filter(l => l.id !== id)
  writeRaw(lists)
}

export function addItem(listId: string, item: { url: string; title: string; note?: string }) {
  return updateList(listId, l => {
    // No dupes
    if (l.items.some(i => i.url === item.url)) return l
    return {
      ...l,
      items: [...l.items, { ...item, addedAt: Date.now() }],
    }
  })
}

export function removeItem(listId: string, url: string) {
  return updateList(listId, l => ({ ...l, items: l.items.filter(i => i.url !== url) }))
}

export function toggleSubscribe(listId: string) {
  return updateList(listId, l => ({
    ...l,
    subscribed: !l.subscribed,
    followers: l.subscribed ? Math.max(0, l.followers - 1) : l.followers + 1,
  }))
}

// ─── React hook ───────────────────────────────────────────────────────────────

/** Reactive view of all reading lists. Re-reads on a tick. */
export function useReadingLists() {
  const [lists, setLists] = useState<ReadingList[]>(() => loadLists())

  const refresh = useCallback(() => {
    setLists(loadLists())
  }, [])

  useEffect(() => {
    const id = setInterval(refresh, 1500)
    return () => clearInterval(id)
  }, [refresh])

  return { lists, refresh, setLists }
}

export function uniqueThemes(lists: ReadingList[]): string[] {
  const set = new Set<string>()
  for (const l of lists) set.add(l.theme)
  return Array.from(set).sort()
}
