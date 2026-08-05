import { describe, it, expect } from 'vitest'
import {
  buildBackup, validateBackup, summarize, portableSettings,
  mergeBibleMarks, mergeBookmarks, mergeRecords, mergeById,
  bookmarkKey, backupFileName, BACKUP_APP, BACKUP_VERSION,
  type BibleMarksData,
} from './backup'

const marks = (over: Partial<BibleMarksData> = {}): BibleMarksData => ({
  highlights: { 'John 3:16': 'yellow' },
  saved: [{ ref: 'John 3:16', ts: 1000 }],
  notes: { 'John 3:16': 'the whole gospel in one verse' },
  lastRead: { book: 'John', chapter: 3 },
  ...over,
})

const meta = { device: 'desktop-01', appVersion: '1.35.0' }

describe('buildBackup', () => {
  it('stamps the envelope so another machine knows what it is', () => {
    const backup = buildBackup({ bible: marks() }, meta)
    expect(backup.app).toBe(BACKUP_APP)
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.device).toBe('desktop-01')
    expect(backup.appVersion).toBe('1.35.0')
    expect(backup.createdAt).toBeGreaterThan(0)
  })

  it('carries the sections it was given', () => {
    const backup = buildBackup({ bible: marks(), bookmarks: [{ url: 'https://a.com' }] }, meta)
    expect(backup.sections.bible?.saved).toHaveLength(1)
    expect(backup.sections.bookmarks).toHaveLength(1)
  })

  it('never writes credentials or machine-specific paths into the file', () => {
    const backup = buildBackup({
      settings: {
        theme: 'dark', restoreSession: true,
        openrouterKey: 'sk-secret', ollamaUrl: 'http://127.0.0.1:11434',
        obsidianVault: 'C:/Users/erick/Vault', containers: [{ id: 'work' }],
      },
    }, meta)
    expect(backup.sections.settings).toEqual({ theme: 'dark', restoreSession: true })
    expect(JSON.stringify(backup)).not.toContain('sk-secret')
  })
})

describe('portableSettings', () => {
  it('drops keys, tokens and local paths but keeps preferences', () => {
    expect(portableSettings({ theme: 'ocean', openrouterKey: 'x', lastSyncAt: 5 })).toEqual({ theme: 'ocean' })
  })
  it('handles nothing at all', () => {
    expect(portableSettings(undefined)).toEqual({})
  })
})

describe('validateBackup', () => {
  const good = buildBackup({ bible: marks() }, meta)

  it('accepts a real backup, as an object or as file text', () => {
    expect(validateBackup(good).ok).toBe(true)
    expect(validateBackup(JSON.stringify(good)).ok).toBe(true)
  })

  it('reports what is in it, so the user can confirm before importing', () => {
    const result = validateBackup(good)
    expect(result.summary?.verses).toBe(1)
    expect(result.summary?.highlights).toBe(1)
    expect(result.summary?.bibleNotes).toBe(1)
  })

  it('refuses a file from another application', () => {
    const out = validateBackup({ app: 'some-other-app', version: 1, sections: {} })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not made by AIHub/i)
  })

  it('refuses unreadable or empty files rather than importing nothing over everything', () => {
    expect(validateBackup('{ not json').ok).toBe(false)
    expect(validateBackup('').ok).toBe(false)
    expect(validateBackup(null).ok).toBe(false)
    expect(validateBackup({ app: BACKUP_APP, version: 1 }).ok).toBe(false)
  })

  it('refuses a backup from a NEWER version instead of guessing at its shape', () => {
    const out = validateBackup({ ...good, version: BACKUP_VERSION + 1 })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/newer/i)
  })
})

describe('mergeBibleMarks — the data nobody can recreate', () => {
  it('keeps verses from both machines', () => {
    const local = marks({ saved: [{ ref: 'Psalm 23:1', ts: 2000 }], highlights: {}, notes: {} })
    const incoming = marks()
    const merged = mergeBibleMarks(local, incoming)
    expect(merged.saved.map(v => v.ref).sort()).toEqual(['John 3:16', 'Psalm 23:1'])
  })

  it('never loses a highlight or note that exists on only one side', () => {
    const local = marks({ highlights: { 'Psalm 23:1': 'green' }, notes: { 'Psalm 23:1': 'shepherd' } })
    const merged = mergeBibleMarks(local, marks())
    expect(Object.keys(merged.highlights).sort()).toEqual(['John 3:16', 'Psalm 23:1'])
    expect(Object.keys(merged.notes).sort()).toEqual(['John 3:16', 'Psalm 23:1'])
  })

  it('lets this machine win a genuine clash', () => {
    const local = marks({ highlights: { 'John 3:16': 'blue' }, notes: { 'John 3:16': 'mine' } })
    const merged = mergeBibleMarks(local, marks())
    expect(merged.highlights['John 3:16']).toBe('blue')
    expect(merged.notes['John 3:16']).toBe('mine')
  })

  it('keeps the earliest save date for a verse saved on both machines', () => {
    const local = marks({ saved: [{ ref: 'John 3:16', ts: 9000 }] })
    const merged = mergeBibleMarks(local, marks())
    expect(merged.saved).toHaveLength(1)
    expect(merged.saved[0].ts).toBe(1000)
  })

  it('imports cleanly onto a machine with no Bible data yet', () => {
    const merged = mergeBibleMarks(null, marks())
    expect(merged.saved).toHaveLength(1)
    expect(merged.lastRead).toEqual({ book: 'John', chapter: 3 })
  })

  it('leaves local data untouched when the backup has no Bible section', () => {
    expect(mergeBibleMarks(marks(), null)).toEqual(marks())
  })

  it('drops malformed verse entries instead of importing junk', () => {
    const merged = mergeBibleMarks(null, marks({ saved: [{ ref: '', ts: 1 } as any, { ts: 2 } as any, { ref: 'Acts 1:8', ts: 3 }] }))
    expect(merged.saved.map(v => v.ref)).toEqual(['Acts 1:8'])
  })
})

describe('mergeBookmarks — and therefore the sphere', () => {
  const local = [{ id: '1', url: 'https://github.com', category: 'Development', color: '#fff' }]

  it('brings across bookmarks the new machine does not have', () => {
    const merged = mergeBookmarks(local, [{ id: '2', url: 'https://tradingview.com', category: 'Finance' }])
    expect(merged).toHaveLength(2)
  })

  it('does not duplicate the same page saved on both machines', () => {
    const merged = mergeBookmarks(local, [{ id: '9', url: 'https://www.github.com/', category: 'Other' }])
    expect(merged).toHaveLength(1)
  })

  it('keeps the local category and colour, so the sphere does not rearrange itself', () => {
    const merged = mergeBookmarks(local, [{ id: '9', url: 'https://github.com', category: 'Other', color: '#000' }])
    expect(merged[0].category).toBe('Development')
    expect(merged[0].color).toBe('#fff')
  })

  it('carries category and colour for imported bookmarks, which is what the sphere draws', () => {
    const merged = mergeBookmarks([], [{ id: '2', url: 'https://a.com', category: 'AI', color: '#6B4EFF' }])
    expect(merged[0]).toMatchObject({ category: 'AI', color: '#6B4EFF' })
  })

  it('ignores entries with no url', () => {
    expect(mergeBookmarks([], [{ id: 'x' } as any])).toEqual([])
  })
})

describe('bookmarkKey', () => {
  it('treats the same page written differently as one bookmark', () => {
    expect(bookmarkKey({ url: 'https://www.example.com/page/' })).toBe(bookmarkKey({ url: 'https://example.com/page' }))
  })
  it('keeps different pages apart', () => {
    expect(bookmarkKey({ url: 'https://example.com/a' })).not.toBe(bookmarkKey({ url: 'https://example.com/b' }))
  })
})

describe('mergeRecords / mergeById', () => {
  it('unions keyed records with local winning', () => {
    expect(mergeRecords({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 1, b: 3 })
    expect(mergeRecords(undefined, { b: 3 })).toEqual({ b: 3 })
  })

  it('unions lists by id', () => {
    const merged = mergeById([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }, { id: 'b', v: 3 }], 'id')
    expect(merged).toHaveLength(2)
    expect(merged.find(x => x.id === 'a')!.v).toBe(1)
  })

})

describe('backupFileName', () => {
  it('is dated and carries the app extension', () => {
    expect(backupFileName(new Date(Date.UTC(2026, 7, 5)))).toBe('AIHub-Browser-2026-08-05.aihub')
  })
})

describe('summarize', () => {
  it('counts everything the import preview shows', () => {
    const backup = buildBackup({
      bible: marks(),
      bookmarks: [{ url: 'https://a.com' }, { url: 'https://b.com' }],
      stickyNotes: { 'https://a.com': {} },
      siteMemory: { 'https://b.com': {} },
      watches: [{ id: 'w1' }],
      extensions: { customExts: [{ id: 'e1' }] },
      local: { 'aihub-custom-themes': JSON.stringify([{ id: 't1' }, { id: 't2' }]) },
    }, meta)
    expect(summarize(backup)).toEqual({
      verses: 1, highlights: 1, bibleNotes: 1, bookmarks: 2,
      notePages: 1, rememberedSites: 1, watches: 1, extensions: 1, themes: 2,
    })
  })

  it('is all zeroes for an empty backup rather than throwing', () => {
    expect(summarize(buildBackup({}, meta)).verses).toBe(0)
  })
})
