/**
 * Transform markdown files into graph node data for the 3D sphere visualization.
 *
 * Reads markdown files from the main process via window.electronAPI (preload
 * bridge), parses frontmatter, and builds nodes + edges for the force-directed
 * graph.
 */

/** Browser clip (deletable) or a note from the user's Obsidian vault (read-only). */
export type NoteOrigin = 'clip' | 'vault'

/** A saved markdown note from the main process store (see main/markdownStore.ts ListedNote). */
export interface MarkdownNote {
  id: string
  filePath: string
  title: string
  url: string
  category: string
  tags: string[]
  /** Lower-cased [[wikilink]] targets. Absent on notes saved by older builds' IPC. */
  links?: string[]
  createdAt: number
  origin?: NoteOrigin
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
  origin: NoteOrigin
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
 * Build graph nodes and links from markdown notes. Pure and synchronous so
 * the view can derive it in a useMemo and tests can call it directly.
 *
 * Three relationship kinds, strongest first:
 * 1. [[wikilinks]] — an explicit link the user wrote (vault notes)
 * 2. Category star clusters, anchors joined in a ring (same shape as BookmarkSphere)
 * 3. Shared tags — the AI-detected entities/concepts of clipped pages
 */
export function buildMarkdownGraph(notes: MarkdownNote[]): GraphData {
  const counts: Record<string, number> = {}
  const links: GraphLink[] = []
  const seen = new Set<string>()
  const addLink = (a: MarkdownNote, b: MarkdownNote, strength: number) => {
    if (a.id === b.id) return
    const key = [a.id, b.id].sort().join('|')
    if (seen.has(key)) return
    seen.add(key)
    links.push({ source: a.id, target: b.id, strength })
    counts[a.id] = (counts[a.id] ?? 0) + 1
    counts[b.id] = (counts[b.id] ?? 0) + 1
  }

  // Wikilinks resolve the way Obsidian does: by file name, case-insensitive.
  const byName = new Map<string, MarkdownNote>()
  for (const n of notes) {
    const stem = (n.filePath.split(/[\\/]/).pop() || '').replace(/\.md$/i, '').toLowerCase()
    if (stem && !byName.has(stem)) byName.set(stem, n)
    const title = n.title.toLowerCase()
    if (title && !byName.has(title)) byName.set(title, n)
  }
  for (const n of notes) for (const target of n.links ?? []) {
    const hit = byName.get(target)
    if (hit) addLink(n, hit, 0.7)
  }

  const byCat = new Map<string, MarkdownNote[]>()
  for (const n of notes) {
    const cat = n.category || 'General'
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat)!.push(n)
  }
  const anchors: MarkdownNote[] = []
  for (const members of byCat.values()) {
    anchors.push(members[0])
    for (let i = 1; i < members.length; i++) addLink(members[0], members[i], 0.5)
  }
  if (anchors.length > 1) for (let i = 0; i < anchors.length; i++) addLink(anchors[i], anchors[(i + 1) % anchors.length], 0.15)

  const byTag = new Map<string, MarkdownNote[]>()
  for (const n of notes) for (const t of n.tags) {
    if (!byTag.has(t)) byTag.set(t, [])
    byTag.get(t)!.push(n)
  }
  for (const members of byTag.values()) {
    if (members.length < 2) continue
    for (let i = 1; i < Math.min(members.length, 6); i++) addLink(members[0], members[i], 0.3)
  }

  const maxConn = Math.max(1, ...Object.values(counts))
  const nodes: GraphNode[] = notes.map(n => {
    const conn = counts[n.id] ?? 0
    return {
      id: n.id, title: n.title, url: n.url, category: n.category || 'General',
      color: resolveColor(n.category), size: 18 + (conn / maxConn) * 34, connections: conn,
      tags: n.tags, createdAt: n.createdAt, origin: n.origin ?? 'clip',
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