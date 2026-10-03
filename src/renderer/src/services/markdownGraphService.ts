/**
 * Transform markdown files into graph node data for the 3D sphere visualization.
 *
 * Reads markdown files from the main process via window.electronAPI (preload
 * bridge), parses frontmatter, and builds nodes + edges for the force-directed
 * graph.
 */

/** A saved markdown note from the main process store. */
export interface MarkdownNote {
  id: string
  filePath: string
  title: string
  url: string
  category: string
  tags: string[]
  createdAt: number
}

/** Graph node data for the visualization. */
export interface GraphNode {
  id: string
  title: string
  url: string
  category: string
  color: string
  size: number
  connections: number
  tags: string[]
  createdAt: number
}

/** Graph link (edge) data. */
export interface GraphLink {
  source: string
  target: string
  strength: number
}

/** Complete graph data. */
export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

/** Category color palette (matches BookmarkSphere). */
const CATEGORY_COLORS: Record<string, string> = {
  AI: '#a78bfa',
  Development: '#38bdf8',
  Finance: '#4ade80',
  Trading: '#fb923c',
  Education: '#fbbf24',
  Business: '#e879f9',
  Entertainment: '#f43f5e',
  Personal: '#f87171',
  News: '#34d399',
  Tools: '#60a5fa',
  Search: '#4285F4',
  Social: '#f472b6',
  Shopping: '#fb7185',
  Travel: '#2dd4bf',
  Health: '#86efac',
  Science: '#c4b5fd',
  Sports: '#fdba74',
  Gaming: '#a3e635',
  Music: '#f9a8d4',
  Art: '#fcd34d',
  Productivity: '#60a5fa',
  General: '#94a3b8',
}

/** Hash any unknown category to a stable vivid color. */
const VIVID_RING = [
  '#f43f5e','#fb923c','#fbbf24','#4ade80','#2dd4bf',
  '#38bdf8','#818cf8','#e879f9','#f472b6','#a3e635',
]
function resolveColor(category: string): string {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category]
  if (!category) return CATEGORY_COLORS.General
  let h = 0
  for (let i = 0; i < category.length; i++) h = category.charCodeAt(i) + ((h << 5) - h)
  return VIVID_RING[Math.abs(h) % VIVID_RING.length]
}

/**
 * Build graph nodes and links from markdown notes.
 *
 * Combines two relationship strategies:
 * 1. Category grouping (star clusters - like BookmarkSphere)
 * 2. Entity-based cross-links (shared tags, URL references, same domain)
 */
export async function buildMarkdownGraphData(notes: MarkdownNote[]): Promise<GraphData> {
  const counts: Record<string, number> = {}
  const links: GraphLink[] = []
  const seen = new Set<string>()

  const addLink = (a: MarkdownNote, b: MarkdownNote, strength: number) => {
    const key = [a.id, b.id].sort().join('|')
    if (seen.has(key)) return
    seen.add(key)
    links.push({ source: a.id, target: b.id, strength })
    counts[a.id] = (counts[a.id] ?? 0) + 1
    counts[b.id] = (counts[b.id] ?? 0) + 1
  }

  // ── Strategy 1: Category star clusters ──────────────────────────────────────
  // Group by category; first note in each group is the cluster anchor
  const categoryGroups = new Map<string, MarkdownNote[]>()
  for (const note of notes) {
    const cat = note.category || 'General'
    if (!categoryGroups.has(cat)) categoryGroups.set(cat, [])
    categoryGroups.get(cat)!.push(note)
  }

  const categoryAnchors: MarkdownNote[] = []
  for (const members of categoryGroups.values()) {
    if (members.length === 0) continue
    const anchor = members[0]
    categoryAnchors.push(anchor)
    for (let i = 1; i < members.length; i++) addLink(anchor, members[i], 0.55)
  }

  // Link category anchors in a ring
  if (categoryAnchors.length > 1) {
    for (let i = 0; i < categoryAnchors.length; i++) {
      addLink(categoryAnchors[i], categoryAnchors[(i + 1) % categoryAnchors.length], 0.18)
    }
  }

  // ── Strategy 2: Entity/tag cross-links ──────────────────────────────────────
  // Notes that share tags get linked
  const tagGroups = new Map<string, MarkdownNote[]>()
  for (const note of notes) {
    for (const tag of note.tags) {
      if (!tagGroups.has(tag)) tagGroups.set(tag, [])
      tagGroups.get(tag)!.push(note)
    }
  }

  // For each tag with 2+ notes, link them (but don't over-connect)
  for (const members of tagGroups.values()) {
    if (members.length < 2) continue
    // Connect first to others (star pattern within tag)
    const anchor = members[0]
    for (let i = 1; i < Math.min(members.length, 6); i++) {
      addLink(anchor, members[i], 0.35)
    }
  }

  // ── Strategy 3: Domain-based links ─────────────────────────────────────────
  // Notes from the same domain get weakly linked
  const domainGroups = new Map<string, MarkdownNote[]>()
  for (const note of notes) {
    try {
      const domain = new URL(note.url).hostname.replace('www.', '')
      if (!domainGroups.has(domain)) domainGroups.set(domain, [])
      domainGroups.get(domain)!.push(note)
    } catch {}
  }

  for (const members of domainGroups.values()) {
    if (members.length < 2) continue
    for (let i = 0; i < members.length - 1; i++) {
      for (let j = i + 1; j < Math.min(members.length, i + 3); j++) {
        addLink(members[i], members[j], 0.15)
      }
    }
  }

  // ── Strategy 4: URL references within content ──────────────────────────────
  // Could be expanded later to parse markdown content for [text](url) links
  // that point to other saved notes

  // ── Build nodes ─────────────────────────────────────────────────────────────
  const maxConn = Math.max(1, ...Object.values(counts))

  const nodes: GraphNode[] = notes.map(note => {
    const conn = counts[note.id] ?? 0
    // Size based on connections (hub nodes get bigger)
    const baseSize = 18
    const connSize = (conn / maxConn) * 34
    return {
      id: note.id,
      title: note.title,
      url: note.url,
      category: note.category,
      color: resolveColor(note.category),
      size: baseSize + connSize,
      connections: conn,
      tags: note.tags,
      createdAt: note.createdAt,
    }
  })

  return { nodes, links }
}

/**
 * Fetch all markdown notes from the main process.
 * Uses the `markdown:getAll` IPC handler.
 */
export async function fetchMarkdownNotes(): Promise<MarkdownNote[]> {
  try {
    return await window.electronAPI.markdown.getAll()
  } catch (e) {
    console.error('[markdownGraphService] Failed to fetch notes:', e)
    return []
  }
}

/**
 * Save a new markdown note via the main process.
 * Uses the `markdown:save` IPC handler.
 */
export async function saveMarkdownNote(note: {
  title: string; url: string; category: string; tags: string[]; content: string; createdAt?: number
}): Promise<MarkdownNote | null> {
  try {
    return await window.electronAPI.markdown.save(note)
  } catch (e) {
    console.error('[markdownGraphService] Failed to save note:', e)
    return null
  }
}

/**
 * Delete a markdown note by ID.
 * Uses the `markdown:delete` IPC handler.
 */
export async function deleteMarkdownNote(id: string): Promise<boolean> {
  try {
    return await window.electronAPI.markdown.delete(id)
  } catch (e) {
    console.error('[markdownGraphService] Failed to delete note:', e)
    return false
  }
}

/**
 * Get a single markdown note's full content by ID.
 * Uses the `markdown:get` IPC handler.
 */
export async function getMarkdownNote(id: string): Promise<string | null> {
  try {
    return await window.electronAPI.markdown.get(id)
  } catch (e) {
    console.error('[markdownGraphService] Failed to get note:', e)
    return null
  }
}

/**
 * Convert a web page to markdown using AI.
 * Uses the `ai:convertToMarkdown` IPC handler.
 */
export async function convertToMarkdown(url: string, pageText: string): Promise<{
  markdown: string
  entities: string[]
  concepts: string[]
  links: Array<{ text: string; url: string }>
  category: string
  tags: string[]
} | null> {
  try {
    return await window.electronAPI.ai.convertToMarkdown(url, pageText)
  } catch (e) {
    console.error('[markdownGraphService] AI conversion failed:', e)
    return null
  }
}

/**
 * The Web Clipper's single entry point: raw page text in, a saved note out.
 * Ties together the AI conversion pass and the save call so every caller
 * (the address-bar clip button, a future context-menu action, …) gets the
 * same behaviour instead of re-deriving it.
 */
export async function clipPageToMarkdown(
  url: string, pageTitle: string, pageText: string,
): Promise<MarkdownNote | null> {
  const ai = await convertToMarkdown(url, pageText)
  if (!ai?.markdown) return null
  // The model writes its own, usually better-judged title into the
  // frontmatter; the page's own <title> is only the fallback.
  const fmTitle = ai.markdown.match(/^title:\s*"?([^"\n]+)"?/m)?.[1]?.trim()
  return saveMarkdownNote({
    title: fmTitle || pageTitle || url,
    url,
    category: ai.category || 'General',
    tags: ai.tags || [],
    content: ai.markdown,
    createdAt: Date.now(),
  })
}