import fs from 'fs'
import { join } from 'path'

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

/** List all saved markdown files. Returns array of { id, filePath, title, url, category, tags, createdAt } */
export function listMarkdown(): Array<{
  id: string
  filePath: string
  title: string
  url: string
  category: string
  tags: string[]
  createdAt: number
}> {
  ensureDir()

  if (!fs.existsSync(MARKDOWN_DIR)) return []

  const files = fs.readdirSync(MARKDOWN_DIR).filter(f => f.endsWith('.md'))
  const results: Array<{
    id: string
    filePath: string
    title: string
    url: string
    category: string
    tags: string[]
    createdAt: number
  }> = []

  for (const file of files) {
    const filePath = join(MARKDOWN_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const frontmatch = content.match(/^---\n([\s\S]*?)\n---$/m)
      let title = 'Untitled'
      let url = ''
      let category = 'General'
      let tags: string[] = []
      let createdAt = Date.now()

      if (frontmatch) {
        const fmText = frontmatch[1]
        const fmParts = fmText.split('\n')
        for (const line of fmParts) {
          const ml = line.trim()
          if (ml.startsWith('title:')) {
            const val = ml.slice('title:'.length).trim()
            title = val.replace(/^"|"$/g, '').trim()
          } else if (ml.startsWith('url:')) {
            const val = ml.slice('url:'.length).trim()
            url = val.replace(/^"|"$/g, '').trim()
          } else if (ml.startsWith('category:')) {
            const val = ml.slice('category:'.length).trim()
            category = val.replace(/^"|"$/g, '').trim()
          } else if (ml.startsWith('tags:')) {
            // Parse tags: yamlValue or simple comma-separated
            const after = ml.slice('tags:'.length).trim()
            if (after.startsWith('[')) {
              // JSON array
              try {
                tags = JSON.parse(after)
              } catch {}
            } else {
              // Comma-separated
              tags = after.split(',').map(t => t.trim()).filter(t => t.length > 0)
            }
          } else if (ml.startsWith('created:')) {
            const val = ml.slice('created:'.length).trim()
            createdAt = new Date(val).getTime()
          }
        }
      }

      // Extract title from first H1 if frontmatter title is empty
      if (title === 'Untitled') {
        const h1match = content.match(/^#\s+(.+)$/m)
        if (h1match) title = h1match[1].trim()
      }

      results.push({
        id: file.replace('.md', ''),
        filePath,
        title,
        url,
        category,
        tags,
        createdAt,
      })
    } catch {
      // Skip corrupt files
    }
  }

  // Sort newest first
  results.sort((a, b) => b.createdAt - a.createdAt)
  return results
}

/** Get a specific markdown file by ID. Returns the markdown content or null. */
export function getMarkdown(id: string): string | null {
  ensureDir()

  // id corresponds to the filename without .md extension
  const filePath = join(MARKDOWN_DIR, `${id}.md`)
  try {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/** Delete a markdown file by ID. Returns true on success. */
export function deleteMarkdown(id: string): boolean {
  ensureDir()

  const filePath = join(MARKDOWN_DIR, `${id}.md`)
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return true
    }
    return false
  } catch {
    return false
  }
}

/** Prune old markdown files based on limits. Returns number of files deleted. */
export function pruneMarkdown(maxPerFile = 3, maxTotalBytes = 500 * 1024 * 1024): number {
  ensureDir()

  const files = listMarkdown()
  const byKey = new Map<string, { files: string[]; totalBytes: number }>()

  // Group by urlKey (url normalized)
  for (const file of files) {
    // Parse the url from frontmatter or derive from file path
    const content = fs.readFileSync(file.filePath, 'utf-8')
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---$/m)
    let url = ''
    if (fmMatch) {
      const fmParts = fmMatch[1].split('\n')
      for (const line of fmParts) {
        if (line.startsWith('url:')) {
          const val = line.slice('url:'.length).trim()
          url = val.replace(/^"|"$/g, '').trim()
          break
        }
      }
    }
    const key = urlKey(url)
    if (!byKey.has(key)) byKey.set(key, { files: [], totalBytes: 0 })
    byKey.get(key)!.files.push(file.filePath)
  }

  // Rule 1: No more than maxPerFile per URL
  const doomed = new Set<string>()
  for (const [_key, info] of byKey.entries()) {
    if (info.files.length > maxPerFile) {
      // Sort by createdAt descending, keep the newest maxPerFile
      const sorted = info.files.map(f => {
        const content = fs.readFileSync(f, 'utf-8')
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---$/m)
        let createdAt = 0
        if (fmMatch) {
          const fmParts = fmMatch[1].split('\n')
          for (const line of fmParts) {
            if (line.startsWith('created:')) {
              createdAt = new Date(line.slice('created:'.length).trim()).getTime()
            }
          }
        }
        return { file: f, createdAt }
      })
      sorted.sort((a, b) => b.createdAt - a.createdAt)
      for (let i = maxPerFile; i < sorted.length; i++) {
        doomed.add(sorted[i].file)
      }
    }
  }

  // Rule 2: Total size under limit
  const allSurvivors = files.filter(f => !doomed.has(f.filePath))
  let totalBytes = allSurvivors.reduce((sum, f) => {
    try { return sum + fs.statSync(f.filePath).size } catch { return sum }
  }, 0)

  for (const f of allSurvivors) {
    if (totalBytes <= maxTotalBytes) break
    doomed.add(f.filePath)
    totalBytes -= fs.statSync(f.filePath).size || 0
  }

  // Delete doomed files
  let deleted = 0
  for (const path of doomed) {
    try {
      if (fs.existsSync(path)) {
        fs.unlinkSync(path)
        deleted++
      }
    } catch {}
  }

  // Rebuild the store file (remove entries for deleted files)
  // The store is in-memory in the main process; just prune the directory

  return deleted
}

/** URL key for grouping (same pattern as vault.ts) */
function urlKey(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const withoutHash = raw.split('#')[0]
  return withoutHash.replace(/\/+$/, '').toLowerCase()
}

/** Extract tags from markdown frontmatter tags field */
export function extractTags(frontmatterText: string): string[] {
  const tagsMatch = frontmatterText.match(/^tags:\s*(.+)$/m)
  if (!tagsMatch) return []

  const after = tagsMatch[1].trim()
  if (after.startsWith('[')) {
    try {
      return JSON.parse(after).map((t: string) => String(t).trim()).filter(Boolean)
    } catch {}
  }
  return after.split(',').map(t => t.trim()).filter(t => t.length > 0 && t.length < 30)
}

/** Extract category from frontmatter */
export function extractCategory(frontmatterText: string): string {
  const catMatch = frontmatterText.match(/^category:\s*(.+)$/m)
  return catMatch ? catMatch[1].trim() : 'General'
}

/** Extract title from frontmatter */
export function extractTitle(frontmatterText: string): string {
  const titleMatch = frontmatterText.match(/^title:\s*(.+)$/m)
  if (!titleMatch) return 'Untitled'
  const val = titleMatch[1].trim()
  return val.replace(/^"|"$/g, '').trim()
}