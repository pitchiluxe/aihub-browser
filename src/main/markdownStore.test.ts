import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { parseNoteMeta, listMarkdown, getMarkdown, deleteMarkdown, resolveNotePath } from './markdownStore'

describe('parseNoteMeta', () => {
  it('reads the YAML list tags saveMarkdown itself writes', () => {
    const meta = parseNoteMeta([
      '---', 'title: "Hello: World"', 'url: https://a.com/x', 'category: AI',
      'tags:', '  - llm', '  - "agents"', 'created: 2026-10-01T10:00:00.000Z', '---', '', '# Hello',
    ].join('\n'), 'Hello World.md', 0)
    expect(meta.title).toBe('Hello: World')
    expect(meta.url).toBe('https://a.com/x')
    expect(meta.category).toBe('AI')
    expect(meta.tags).toEqual(['llm', 'agents'])
    expect(meta.createdAt).toBe(Date.parse('2026-10-01T10:00:00.000Z'))
  })

  it('handles CRLF files, inline tag arrays and Obsidian "source" urls', () => {
    const meta = parseNoteMeta(
      '---\r\ntitle: Clip\r\nsource: https://b.com\r\ntags: [aihub, clip, "#Research", web dev]\r\n---\r\nbody',
      'Clip.md', 0,
    )
    expect(meta.url).toBe('https://b.com')
    // aihub/clip are on every note the browser writes — linking on them would
    // collapse the whole graph into one star, so they are dropped.
    expect(meta.tags).toEqual(['research', 'web-dev'])
  })

  it('falls back to H1, then filename, then file time for notes without frontmatter', () => {
    expect(parseNoteMeta('# From Heading\ntext', 'x.md', 5).title).toBe('From Heading')
    const plain = parseNoteMeta('just text', 'My Note.md', 1234)
    expect(plain.title).toBe('My Note')
    expect(plain.category).toBe('General')
    expect(plain.createdAt).toBe(1234)
  })

  it('collects [[wikilinks]] so vault notes connect like they do in Obsidian', () => {
    const meta = parseNoteMeta('See [[Other Note]] and [[folder/Third|alias]] and [[Other Note#h]].', 'a.md', 0)
    expect(meta.links).toEqual(['other note', 'third'])
  })
})

describe('"Save Page to Obsidian" page script', () => {
  it('is valid JavaScript once the template literal is cooked', () => {
    // A raw newline inside a regex literal here once made every clip throw
    // in the page and save "(no readable text on this page)".
    const src = fs.readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    const start = src.indexOf('body = await wc.executeJavaScript(`')
    expect(start).toBeGreaterThan(-1)
    const open = src.indexOf('`', start) + 1
    const literal = src.slice(open, src.indexOf('`)', open))
    const cooked = new Function('return `' + literal + '`')() as string
    expect(() => new Function(`return ${cooked}`)).not.toThrow()
  })
})

describe('listMarkdown with an Obsidian vault', () => {
  let root: string
  let clips: string
  let vault: string

  beforeEach(() => {
    root = fs.mkdtempSync(join(os.tmpdir(), 'aihub-md-'))
    clips = join(root, 'clips')
    vault = join(root, 'vault')
    fs.mkdirSync(clips)
    fs.mkdirSync(join(vault, '.obsidian'), { recursive: true })
    fs.mkdirSync(join(vault, 'Projects', 'Deep'), { recursive: true })
    fs.writeFileSync(join(clips, 'Saved.md'), '---\ntitle: Saved\nurl: https://same.com/\n---\n')
    fs.writeFileSync(join(vault, 'Root Note.md'), '# Root Note\nLinks to [[Deep Note]]')
    fs.writeFileSync(join(vault, 'Projects', 'Deep', 'Deep Note.md'), '---\ntags: [x]\n---\n')
    // Same page clipped into both stores: shown once.
    fs.writeFileSync(join(vault, 'Projects', 'Saved copy.md'), '---\nsource: https://same.com\n---\n')
    fs.writeFileSync(join(vault, '.obsidian', 'workspace.md'), 'internal')
    fs.writeFileSync(join(vault, 'image.png'), 'x')
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('shows clips on a fresh install with no vault', async () => {
    const notes = await listMarkdown(undefined, clips)
    expect(notes.map(n => n.id)).toEqual(['Saved'])
    expect(notes[0].origin).toBe('clip')
  })

  it('includes vault notes recursively, skips dot-folders, de-duplicates clipped urls', async () => {
    const notes = await listMarkdown(vault, clips)
    const ids = notes.map(n => n.id).sort()
    expect(ids).toEqual(['Saved', 'vault:Projects/Deep/Deep Note.md', 'vault:Root Note.md'])
    expect(notes.find(n => n.id === 'vault:Root Note.md')!.links).toEqual(['deep note'])
  })

  it('returns no vault notes (instead of throwing) when the vault folder is gone', async () => {
    const notes = await listMarkdown(join(root, 'missing'), clips)
    expect(notes.map(n => n.id)).toEqual(['Saved'])
  })

  it('reads vault notes but never deletes them', async () => {
    expect(getMarkdown('vault:Root Note.md', vault, clips)).toContain('# Root Note')
    expect(deleteMarkdown('vault:Root Note.md', clips)).toBe(false)
    expect(fs.existsSync(join(vault, 'Root Note.md'))).toBe(true)
    expect(deleteMarkdown('Saved', clips)).toBe(true)
  })

  it('refuses ids that escape their folder', () => {
    expect(resolveNotePath('../secret', vault, clips)).toBeNull()
    expect(resolveNotePath('a/b', vault, clips)).toBeNull()
    expect(resolveNotePath('vault:../outside.md', vault, clips)).toBeNull()
    expect(resolveNotePath('vault:Projects/../../outside.md', vault, clips)).toBeNull()
    expect(resolveNotePath('vault:Root Note.md', undefined, clips)).toBeNull()
    expect(resolveNotePath('vault:image.png', vault, clips)).toBeNull()
  })
})
