import fs from 'fs'
import { join, resolve, relative, isAbsolute } from 'path'

/** App data directory (same as data.json, history.json, etc.) */
const APP_DIR = join(process.env.HOME || process.env.USERPROFILE || '', '.aihub-browser')
const MARKDOWN_DIR = join(APP_DIR, 'data', 'markdown')

/** Minimum time between auto-saves of the same page (24 hours) */
export const MIN_AUTO_SAVE_MS = 24 * 60 * 60 * 1000

/** ILLEGAL filename characters for Windows/macOS/Linux */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g

/** Make a filename-safe version of a title. */
function safeFileName(title: string): string {
  const cleaned = String(title || '')
    .replace(ILLEGAL, ' ')
    .split(/\s+/)
    .filter(part => part && !/^\.+$/.test(part))
    .join(' ')
    .replace(/^\.+/, '')
    .trim()
  if (!cleaned) return 'untitled'
  // Cap length and avoid truncating in the middle of a word
  if (cleaned.length <= 60) return cleaned
  const cut = cleaned.slice(0, 60)
  const lastSpace = cut.lastIndexOf(' ')
  return lastSpace > 30 ? cut.slice(0, lastSpace) : cleaned.slice(0, 55) + '…'
}

/** Ensure the markdown directory exists. */
function ensureDir(): void {
  if (!fs.existsSync(MARKDOWN_DIR)) fs.mkdirSync(MARKDOWN_DIR, { recursive: true })
}

/** YAML frontmatter builder (reuses obsidian.ts patterns) */
function buildFrontmatter(fields: Record<string, string | number | boolean | string[]>): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (!value.length) continue
      lines.push(`${key}:`)
      for (const item of value) {
        const needsQuotes = /^[\s>|@`%&*!?{}[\],#-]|[:#]\s|["'\n]|^$/.test(String(item))
        if (!needsQuotes) lines.push(`  - ${item}`)
        else lines.push(`  - "${String(item).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
      }
    } else {
      const needsQuotes = /^[\s>|@`%&*!?{}[\],#-]|[:#]\s|["'\n]|^$/.test(String(value))
      if (!needsQuotes) lines.push(`${key}: ${value}`)
      else lines.push(`${key}: "${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

/** Build a markdown note from input fields. */
export interface MarkdownNote {
  title: string
  url: string
  category: string
  tags: string[]
  content: string
  createdAt: number
}

/** Generate a unique filename for a markdown note. */
function uniqueFileName(note: MarkdownNote): string {
  const stem = safeFileName(note.title) || `clip-${note.createdAt}`
  const ext = '.md'
  let candidate = join(MARKDOWN_DIR, `${stem}${ext}`)
  let n = 1
  while (fs.existsSync(candidate)) {
    candidate = join(MARKDOWN_DIR, `${stem} ${n}${ext}`)
    n++
    if (n > 999) return join(MARKDOWN_DIR, `${stem}-${Date.now()}${ext}`)
  }
  return candidate
}

/** Save a markdown note. Returns the file path on success. */
export async function saveMarkdown(note: MarkdownNote): Promise<string> {
  ensureDir()

  // Build frontmatter
  const frontmatter = buildFrontmatter({
    title: note.title,
    url: note.url,
    category: note.category,
    tags: note.tags,
    created: new Date(note.createdAt).toISOString(),
    date: new Date(note.createdAt).toISOString().slice(0, 10),
  })

  // Build markdown body: heading + link + content
  const heading = `# ${note.title}`
  const link = note.url ? `\n[${note.url}](${note.url})\n` : ''
  const content = String(note.content || '').trim()
  const firstHeading = content.match(/^#\s+([^\r\n]+)\r?\n*/)
  const uniqueContent = firstHeading?.[1].trim().toLowerCase() === note.title.trim().toLowerCase()
    ? content.slice(firstHeading[0].length).trim()
    : content
  const body = `${frontmatter}\n\n${heading}${link}\n${uniqueContent}\n`

  const filePath = uniqueFileName(note)
  try {
    fs.writeFileSync(filePath, body, 'utf-8')
    return filePath
  } catch (e: any) {
    throw new Error(`Could not save markdown: ${e.message}`)
  }
}

// ── Reading notes back ─────────────────────────────────────────────────────
// The graph shows two sources: pages clipped by the browser (MARKDOWN_DIR,
// always present) and — when the user has pointed Settings at one — their
// Obsidian vault. The vault is what makes the graph useful on a second
// computer: the clip folder is per-machine and starts empty, the vault is
// the knowledge the user already has (and often syncs between machines).

/** Where a listed note lives. Vault notes are read-only to the browser. */
export type NoteOrigin = 'clip' | 'vault'

export interface ListedNote {
  /** Clip: file stem (stable, matches older builds). Vault: `vault:<relative/path.md>`. */
  id: string
  filePath: string
  title: string
  url: string
  category: string
  tags: string[]
  /** Lower-cased [[wikilink]] targets (basename, no alias/heading). */
  links: string[]
  createdAt: number
  origin: NoteOrigin
}

const VAULT_PREFIX = 'vault:'
/** Bounds on a vault walk — a huge vault must not stall the main process. */
const VAULT_MAX_FILES = 2000
const VAULT_MAX_DEPTH = 8
const VAULT_MAX_FILE_BYTES = 2 * 1024 * 1024
/**
 * Tags the browser stamps on every note it writes (see obsidian.ts buildNote).
 * Linking on them would join every note to every other into one big star.
 */
const GENERIC_TAGS = new Set(['aihub', 'clip', 'bookmark', 'conversation', 'answer', 'highlight'])

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function unquote(value: string): string {
  const v = value.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  return v
}

/** Minimal YAML reader for the flat frontmatter notes actually use: scalars, inline [a, b] and block `- item` lists. */
function parseFrontmatter(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  let listKey = ''
  for (const line of text.split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/) || (listKey ? line.match(/^-\s+(.*)$/) : null)
    if (item && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]))
      continue
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) { listKey = ''; continue }
    const key = kv[1].toLowerCase()
    const raw = kv[2].trim()
    if (!raw) { out[key] = []; listKey = key; continue }
    listKey = ''
    out[key] = raw.startsWith('[') && raw.endsWith(']')
      ? raw.slice(1, -1).split(',').map(unquote).filter(Boolean)
      : unquote(raw)
  }
  return out
}

function asList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  // Obsidian also accepts `tags: a, b` and `tags: a b`.
  return value ? value.split(/[,\s]+/) : []
}

function asText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] || '') : (value || '')
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')
}

/** Parse one note's metadata. Pure: no filesystem access. */
export function parseNoteMeta(content: string, fileName: string, fallbackTime: number):
  Pick<ListedNote, 'title' | 'url' | 'category' | 'tags' | 'links' | 'createdAt'> {
  const fmMatch = content.match(FRONTMATTER)
  const fm = fmMatch ? parseFrontmatter(fmMatch[1]) : {}
  const body = fmMatch ? content.slice(fmMatch[0].length) : content

  const stem = fileName.replace(/\.md$/i, '')
  const title = asText(fm.title).trim() || body.match(/^#\s+(.+)$/m)?.[1].trim() || stem
  const url = (asText(fm.url) || asText(fm.source)).trim()
  const category = asText(fm.category).trim() || 'General'
  const tags = Array.from(new Set(asList(fm.tags).map(normalizeTag)))
    .filter(t => t && t.length <= 40 && !GENERIC_TAGS.has(t))

  const stamp = Date.parse(asText(fm.created) || asText(fm.date))
  const createdAt = Number.isFinite(stamp) ? stamp : fallbackTime

  const links: string[] = []
  for (const m of body.matchAll(/\[\[([^\]|#^]+)/g)) {
    const target = m[1].trim().split('/').pop()!.replace(/\.md$/i, '').trim().toLowerCase()
    if (target && !links.includes(target)) links.push(target)
  }
  return { title, url, category, tags, links, createdAt }
}

async function readNote(filePath: string, fileName: string, id: string, origin: NoteOrigin): Promise<ListedNote | null> {
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile() || stat.size > VAULT_MAX_FILE_BYTES) return null
    const content = await fs.promises.readFile(filePath, 'utf-8')
    return { id, filePath, origin, ...parseNoteMeta(content, fileName, stat.mtimeMs) }
  } catch {
    return null // unreadable / vanished mid-scan — skip, never fail the list
  }
}

/** Every `.md` file in a vault, as forward-slash relative paths. Skips `.obsidian`, `.trash`, `.git`, … */
async function walkVault(vaultPath: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > VAULT_MAX_DEPTH || found.length >= VAULT_MAX_FILES) return
    let entries: fs.Dirent[]
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length >= VAULT_MAX_FILES) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), childRel, depth + 1)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) found.push(childRel)
    }
  }
  await walk(vaultPath, '', 0)
  return found
}

/**
 * All notes for the graph, newest first: browser clips plus (optionally) the
 * Obsidian vault. A vault note whose url was also clipped is dropped — the
 * browser writes every clip to both places when a vault is set.
 */
export async function listMarkdown(vaultPath?: string, clipDir = MARKDOWN_DIR): Promise<ListedNote[]> {
  let clipFiles: string[] = []
  try { clipFiles = (await fs.promises.readdir(clipDir)).filter(f => /\.md$/i.test(f)) } catch { /* no clips yet */ }
  const clips = (await Promise.all(clipFiles.map(f =>
    readNote(join(clipDir, f), f, f.replace(/\.md$/i, ''), 'clip')))).filter((n): n is ListedNote => !!n)

  let vaultNotes: ListedNote[] = []
  if (vaultPath) {
    const clippedUrls = new Set(clips.map(n => urlKey(n.url)).filter(Boolean))
    const rels = await walkVault(vaultPath)
    vaultNotes = (await Promise.all(rels.map(rel =>
      readNote(join(vaultPath, ...rel.split('/')), rel.split('/').pop()!, VAULT_PREFIX + rel, 'vault'))))
      .filter((n): n is ListedNote => !!n && !(n.url && clippedUrls.has(urlKey(n.url))))
  }

  return [...clips, ...vaultNotes].sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Map a renderer-supplied id to a file path, or null. Ids cross the IPC
 * boundary, so they are treated as hostile: a clip id must be a bare file
 * stem, a vault id must stay inside the vault and name a `.md` file.
 */
export function resolveNotePath(id: string, vaultPath?: string, clipDir = MARKDOWN_DIR): string | null {
  const raw = String(id || '')
  if (raw.startsWith(VAULT_PREFIX)) {
    if (!vaultPath) return null
    const rel = raw.slice(VAULT_PREFIX.length)
    if (!/\.md$/i.test(rel) || isAbsolute(rel)) return null
    const root = resolve(vaultPath)
    const full = resolve(root, rel)
    const inside = relative(root, full)
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null
    return full
  }
  if (!raw || /[\\/:]/.test(raw) || raw.includes('..')) return null
  return join(clipDir, `${raw}.md`)
}

/** A note's full markdown, or null. */
export function getMarkdown(id: string, vaultPath?: string, clipDir = MARKDOWN_DIR): string | null {
  const filePath = resolveNotePath(id, vaultPath, clipDir)
  if (!filePath) return null
  try { return fs.readFileSync(filePath, 'utf-8') } catch { return null }
}

/**
 * Delete a clip. Vault notes are refused: the vault belongs to the user's
 * Obsidian, and a browser graph view is not the place to destroy it.
 */
export function deleteMarkdown(id: string, clipDir = MARKDOWN_DIR): boolean {
  if (String(id || '').startsWith(VAULT_PREFIX)) return false
  const filePath = resolveNotePath(id, undefined, clipDir)
  if (!filePath) return false
  try {
    if (!fs.existsSync(filePath)) return false
    fs.unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Keep the clip folder bounded: at most `maxPerUrl` clips per page (newest
 * kept), then oldest-first until under `maxTotalBytes`. Never touches the vault.
 */
export async function pruneMarkdown(maxPerUrl = 3, maxTotalBytes = 500 * 1024 * 1024): Promise<number> {
  const clips = await listMarkdown() // newest first
  const doomed = new Set<string>()
  const perUrl = new Map<string, number>()
  for (const note of clips) {
    const key = urlKey(note.url)
    if (!key) continue
    const seen = (perUrl.get(key) ?? 0) + 1
    perUrl.set(key, seen)
    if (seen > maxPerUrl) doomed.add(note.filePath)
  }

  const sizeOf = (p: string) => { try { return fs.statSync(p).size } catch { return 0 } }
  const survivors = clips.filter(n => !doomed.has(n.filePath))
  let total = survivors.reduce((sum, n) => sum + sizeOf(n.filePath), 0)
  for (let i = survivors.length - 1; i >= 0 && total > maxTotalBytes; i--) {
    total -= sizeOf(survivors[i].filePath)
    doomed.add(survivors[i].filePath)
  }

  let deleted = 0
  for (const filePath of doomed) {
    try { fs.unlinkSync(filePath); deleted++ } catch { /* already gone */ }
  }
  return deleted
}

/** URL key for grouping (same pattern as vault.ts) */
function urlKey(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const withoutHash = raw.split('#')[0]
  return withoutHash.replace(/\/+$/, '').toLowerCase()
}
