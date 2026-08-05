import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import {
  safeFileName, yamlValue, buildFrontmatter, isoDate, buildNote, folderFor,
  uniquePath, describeVault, writeNote,
} from './obsidian'

describe('safeFileName', () => {
  it('strips characters no filesystem or Obsidian link will accept', () => {
    expect(safeFileName('Report: Q3/Q4 <draft> "final"?')).toBe('Report Q3 Q4 draft final')
    expect(safeFileName('a#b^c[d]e')).toBe('a b c d e')
  })
  it('never produces an empty, hidden or traversing name', () => {
    expect(safeFileName('')).toBe('Untitled')
    expect(safeFileName('///')).toBe('Untitled')
    expect(safeFileName('../../etc/passwd')).toBe('etc passwd')
    expect(safeFileName('.hidden')).toBe('hidden')
  })
  it('cuts long titles at a word boundary', () => {
    const name = safeFileName('The quick brown fox jumps over the lazy dog and keeps running for a while', 40)
    expect(name.length).toBeLessThanOrEqual(40)
    expect(name.endsWith(' ')).toBe(false)
    expect(name.split(' ').pop()).not.toBe('')
  })
})

describe('yamlValue', () => {
  it('leaves plain values unquoted', () => {
    expect(yamlValue('Simple title')).toBe('Simple title')
    expect(yamlValue(42)).toBe('42')
    expect(yamlValue(true)).toBe('true')
  })
  it('quotes anything that would break the document', () => {
    expect(yamlValue('key: value')).toBe('"key: value"')
    expect(yamlValue('- dash start')).toBe('"- dash start"')
    expect(yamlValue('has "quotes"')).toBe('"has \\"quotes\\""')
    expect(yamlValue('')).toBe('""')
  })
  it('flattens newlines so a value cannot escape its field', () => {
    expect(yamlValue('line1\nline2')).toBe('"line1 line2"')
  })
})

describe('buildFrontmatter', () => {
  it('writes fenced YAML with lists', () => {
    const fm = buildFrontmatter({ title: 'Hello', tags: ['aihub', 'clip'] })
    expect(fm.startsWith('---\n')).toBe(true)
    expect(fm.endsWith('\n---')).toBe(true)
    expect(fm).toContain('title: Hello')
    expect(fm).toContain('  - aihub')
  })
  it('omits empty values and empty lists', () => {
    const fm = buildFrontmatter({ title: 'x', source: '', tags: [] })
    expect(fm).not.toContain('source')
    expect(fm).not.toContain('tags')
  })
})

describe('isoDate', () => {
  it('is a plain calendar date', () => {
    expect(isoDate(Date.UTC(2026, 7, 5, 13, 30))).toBe('2026-08-05')
  })
})

describe('buildNote', () => {
  const base = { kind: 'clip' as const, title: 'Electron renderer crashes', url: 'https://example.com/a', content: 'Body text' }

  it('produces frontmatter, a heading, the source link and the body', () => {
    const { fileName, markdown } = buildNote(base)
    expect(fileName).toBe('Electron renderer crashes.md')
    expect(markdown).toContain('source: https://example.com/a')
    expect(markdown).toContain('# Electron renderer crashes')
    expect(markdown).toContain('[https://example.com/a](https://example.com/a)')
    expect(markdown.trimEnd().endsWith('Body text')).toBe(true)
  })

  it('always tags the note so a vault can filter AIHub content', () => {
    expect(buildNote(base).markdown).toContain('  - aihub')
    expect(buildNote(base).markdown).toContain('  - clip')
  })

  it('hyphenates tags with spaces and de-duplicates them', () => {
    const md = buildNote({ ...base, tags: ['machine learning', 'aihub', 'clip'] }).markdown
    expect(md).toContain('  - machine-learning')
    expect(md.match(/- aihub/g)).toHaveLength(1)
  })

  it('survives a title that would break YAML', () => {
    const { markdown } = buildNote({ ...base, title: 'Q3: results "final"' })
    expect(markdown).toContain('title: "Q3: results \\"final\\""')
  })

  it('works with no url and no content', () => {
    const { markdown } = buildNote({ kind: 'answer', title: 'Just a thought', content: '' })
    expect(markdown).toContain('# Just a thought')
    expect(markdown).not.toContain('](')
  })

  it('carries extra frontmatter such as the model that answered', () => {
    const { markdown } = buildNote({ ...base, kind: 'answer', extra: { model: 'llama3.2:3b' } })
    expect(markdown).toContain('model: llama3.2:3b')
  })
})

describe('folderFor', () => {
  it('files each kind separately under one AIHub folder', () => {
    expect(folderFor('clip')).toBe('AIHub/Clippings')
    expect(folderFor('bookmark')).toBe('AIHub/Bookmarks')
    expect(folderFor('answer')).toBe('AIHub/AI Answers')
  })
})

describe('uniquePath', () => {
  it('returns the plain name when nothing is there', () => {
    expect(uniquePath('/vault', 'Note.md', () => false)).toBe(join('/vault', 'Note.md'))
  })
  it('numbers up rather than overwriting an existing note', () => {
    const taken = new Set([join('/vault', 'Note.md'), join('/vault', 'Note 2.md')])
    expect(uniquePath('/vault', 'Note.md', p => taken.has(p))).toBe(join('/vault', 'Note 3.md'))
  })
  it('keeps the extension when numbering', () => {
    const taken = new Set([join('/vault', 'Note.md')])
    expect(uniquePath('/vault', 'Note.md', p => taken.has(p)).endsWith('.md')).toBe(true)
  })
})

describe('vault writing', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'aihub-vault-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('recognises a folder and an actual Obsidian vault', () => {
    expect(describeVault(dir)).toEqual({ exists: true, isVault: false })
    fs.mkdirSync(join(dir, '.obsidian'))
    expect(describeVault(dir)).toEqual({ exists: true, isVault: true })
    expect(describeVault(join(dir, 'nope'))).toEqual({ exists: false, isVault: false })
  })

  it('writes a note into the right subfolder, creating it as needed', () => {
    const res = writeNote(dir, { kind: 'clip', title: 'A page', url: 'https://x.com', content: 'text' })
    expect(res.ok).toBe(true)
    expect(res.path).toContain(join('AIHub', 'Clippings'))
    expect(fs.readFileSync(res.path!, 'utf-8')).toContain('# A page')
  })

  it('never overwrites an existing note', () => {
    const first = writeNote(dir, { kind: 'clip', title: 'Same', content: 'one' })
    const second = writeNote(dir, { kind: 'clip', title: 'Same', content: 'two' })
    expect(second.path).not.toBe(first.path)
    expect(fs.readFileSync(first.path!, 'utf-8')).toContain('one')
    expect(fs.readFileSync(second.path!, 'utf-8')).toContain('two')
  })

  it('reports a missing vault instead of throwing', () => {
    expect(writeNote(join(dir, 'gone'), { kind: 'clip', title: 't', content: 'c' }))
      .toEqual({ ok: false, error: 'Vault folder not found' })
    expect(writeNote('', { kind: 'clip', title: 't', content: 'c' }).ok).toBe(false)
  })

  it('keeps a title with path separators inside the vault folder', () => {
    const res = writeNote(dir, { kind: 'clip', title: '../../escape', content: 'c' })
    expect(res.ok).toBe(true)
    expect(res.path!.startsWith(dir)).toBe(true)
    expect(res.path).not.toContain('..')
  })
})
