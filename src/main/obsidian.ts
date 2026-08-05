import fs from 'fs'
import { join } from 'path'

/**
 * AIHub Browser — Obsidian vault integration.
 *
 * A vault is just a folder of markdown files, so this writes plain markdown
 * with YAML frontmatter and nothing else: no plugin, no API, no lock-in. The
 * user points at their vault, and clippings, bookmarks and AI answers land in
 * it as notes Obsidian indexes on its own — links, tags, graph and all.
 *
 * All of the fiddly parts (safe filenames, YAML that survives quotes and
 * colons, wiki-links, append vs. create) are pure functions below so their
 * edge cases are testable without a vault on disk.
 */

export type NoteKind = 'clip' | 'bookmark' | 'answer'

export interface NoteInput {
  kind: NoteKind
  title: string
  url?: string
  /** Markdown body. */
  content: string
  tags?: string[]
  /** Extra frontmatter fields (source, model, …). */
  extra?: Record<string, string | number | boolean>
  createdAt?: number
}

/** Characters Windows, macOS and Obsidian all refuse in a filename. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g

/**
 * Turn a page title into a filename that survives every OS and Obsidian's own
 * link syntax. Long titles are cut at a word boundary so the note stays
 * recognisable in a file list.
 */
export function safeFileName(title: string, maxLength = 80): string {
  const cleaned = String(title || '')
    .replace(ILLEGAL, ' ')
    // Drop dot-only fragments outright. Once separators become spaces, "../.."
    // survives as ".. ..", which is not a traversal any more but still reads as
    // one — and a leading dot would hide the note from the file manager.
    .split(/\s+/)
    .filter(part => part && !/^\.+$/.test(part))
    .join(' ')
    .replace(/^\.+/, '')
    .trim()
  if (!cleaned) return 'Untitled'
  if (cleaned.length <= maxLength) return cleaned
  const cut = cleaned.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trim()
}

/** YAML-quote a value only when it needs it, the way Obsidian writes it. */
export function yamlValue(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value)
  const needsQuotes = /^[\s>|@`%&*!?{}[\],#-]|[:#]\s|["'\n]|^$/.test(value)
  if (!needsQuotes) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
}

export function buildFrontmatter(fields: Record<string, string | number | boolean | string[]>): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (!value.length) continue
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${yamlValue(item)}`)
    } else {
      lines.push(`${key}: ${yamlValue(value)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

/** ISO date (no time) — what Obsidian's daily-note conventions expect. */
export function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export function buildNote(input: NoteInput): { fileName: string; markdown: string } {
  const createdAt = input.createdAt ?? Date.now()
  const title = String(input.title || 'Untitled').trim() || 'Untitled'
  const tags = ['aihub', input.kind, ...(input.tags || [])]
    // Obsidian tags cannot contain spaces; hyphenate rather than drop them.
    .map(t => String(t).trim().replace(/\s+/g, '-').replace(/^#/, ''))
    .filter(Boolean)

  const frontmatter = buildFrontmatter({
    title,
    source: input.url || '',
    created: new Date(createdAt).toISOString(),
    date: isoDate(createdAt),
    tags: [...new Set(tags)],
    ...(input.extra || {}),
  })

  const heading = `# ${title}`
  const link = input.url ? `\n[${input.url}](${input.url})\n` : ''
  const markdown = `${frontmatter}\n\n${heading}\n${link}\n${String(input.content || '').trim()}\n`
  return { fileName: `${safeFileName(title)}.md`, markdown }
}

/** Vault-relative folder a note kind is filed under. */
export function folderFor(kind: NoteKind): string {
  return kind === 'clip' ? 'AIHub/Clippings'
    : kind === 'bookmark' ? 'AIHub/Bookmarks'
    : 'AIHub/AI Answers'
}

/**
 * A path that does not exist yet: "Note.md", then "Note 2.md", "Note 3.md".
 * Overwriting silently is the one behaviour a notes vault must never have.
 */
export function uniquePath(dir: string, fileName: string, exists: (p: string) => boolean): string {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  let candidate = join(dir, fileName)
  let n = 2
  while (exists(candidate)) {
    candidate = join(dir, `${stem} ${n}${ext}`)
    n++
    if (n > 999) return join(dir, `${stem} ${Date.now()}${ext}`)
  }
  return candidate
}

export interface VaultWriteResult {
  ok: boolean
  path?: string
  error?: string
}

/** Does this folder look like an Obsidian vault (or at least a usable folder)? */
export function describeVault(vaultPath: string): { exists: boolean; isVault: boolean } {
  try {
    const exists = fs.existsSync(vaultPath) && fs.statSync(vaultPath).isDirectory()
    return { exists, isVault: exists && fs.existsSync(join(vaultPath, '.obsidian')) }
  } catch {
    return { exists: false, isVault: false }
  }
}

export function writeNote(vaultPath: string, input: NoteInput): VaultWriteResult {
  try {
    if (!vaultPath) return { ok: false, error: 'No vault folder selected' }
    if (!describeVault(vaultPath).exists) return { ok: false, error: 'Vault folder not found' }
    const dir = join(vaultPath, folderFor(input.kind))
    fs.mkdirSync(dir, { recursive: true })
    const { fileName, markdown } = buildNote(input)
    const target = uniquePath(dir, fileName, p => fs.existsSync(p))
    fs.writeFileSync(target, markdown, 'utf-8')
    return { ok: true, path: target }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not write to the vault' }
  }
}
