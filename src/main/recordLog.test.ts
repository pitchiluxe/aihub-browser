import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { createRecordLog } from './recordLog'

interface Rec { id: string; text: string }

let dir: string
let file: string
const lines = () => fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
const ids = (log: { all(): readonly Rec[] }) => log.all().map(r => r.id)

beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'aihub-recordlog-'))
  file = join(dir, 'log.ndjson')
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('createRecordLog', () => {
  it('starts empty when no file exists', () => {
    expect(createRecordLog<Rec>(file).all()).toEqual([])
  })

  it('lists records newest first and survives a reload', () => {
    const log = createRecordLog<Rec>(file)
    log.put({ id: 'a', text: '1' })
    log.put({ id: 'b', text: '2' })
    expect(ids(log)).toEqual(['b', 'a'])
    expect(ids(createRecordLog<Rec>(file))).toEqual(['b', 'a'])
  })

  it('appends one line per change instead of rewriting the file', () => {
    const log = createRecordLog<Rec>(file)
    log.put({ id: 'a', text: '1' })
    log.put({ id: 'b', text: '2' })
    expect(lines()).toHaveLength(2)
    expect(JSON.parse(lines()[1])).toEqual({ id: 'b', text: '2' })
  })

  it('replacing a record by id moves it to newest, on disk too', () => {
    const log = createRecordLog<Rec>(file)
    log.put({ id: 'a', text: 'old' })
    log.put({ id: 'b', text: '2' })
    log.put({ id: 'a', text: 'new' })
    expect(log.all()).toEqual([{ id: 'a', text: 'new' }, { id: 'b', text: '2' }])
    expect(createRecordLog<Rec>(file).all()).toEqual([{ id: 'a', text: 'new' }, { id: 'b', text: '2' }])
  })

  it('removes with a tombstone that replay honours', () => {
    const log = createRecordLog<Rec>(file)
    log.put({ id: 'a', text: '1' })
    log.put({ id: 'b', text: '2' })
    log.remove('a')
    expect(ids(log)).toEqual(['b'])
    expect(ids(createRecordLog<Rec>(file))).toEqual(['b'])
  })

  it('ignores removing an unknown id without writing', () => {
    const log = createRecordLog<Rec>(file)
    log.put({ id: 'a', text: '1' })
    log.remove('nope')
    expect(lines()).toHaveLength(1)
  })

  it('evicts the oldest records past the cap', () => {
    const log = createRecordLog<Rec>(file, { cap: 2 })
    for (const id of ['a', 'b', 'c']) log.put({ id, text: id })
    expect(ids(log)).toEqual(['c', 'b'])
    expect(ids(createRecordLog<Rec>(file, { cap: 2 }))).toEqual(['c', 'b'])
  })

  it('does not resurrect an evicted record when a later removal frees a slot', () => {
    const log = createRecordLog<Rec>(file, { cap: 2 })
    for (const id of ['a', 'b', 'c']) log.put({ id, text: id }) // evicts a
    log.remove('c')
    expect(ids(log)).toEqual(['b'])
    expect(ids(createRecordLog<Rec>(file, { cap: 2 }))).toEqual(['b'])
  })

  it('skips a torn final line left by a crash mid-append', () => {
    fs.writeFileSync(file, '{"id":"a","text":"1"}\n{"id":"b","te')
    expect(ids(createRecordLog<Rec>(file))).toEqual(['a'])
  })

  it('clear empties memory and disk', () => {
    const log = createRecordLog<Rec>(file)
    log.put({ id: 'a', text: '1' })
    log.clear()
    expect(log.all()).toEqual([])
    expect(fs.readFileSync(file, 'utf-8')).toBe('')
    expect(createRecordLog<Rec>(file).all()).toEqual([])
  })

  it('compacts obsolete lines away once they pile up, keeping every live record', async () => {
    const log = createRecordLog<Rec>(file, { sliceSize: 7 })
    // 300 rewrites of 5 ids: far more lines than live records.
    for (let i = 0; i < 300; i++) log.put({ id: `r${i % 5}`, text: String(i) })
    await log.idle()
    // Compaction starts at line 208 (5 live × 1.5 + 200) and writes 5; the 92
    // puts made while it ran are re-appended after the swap: 97, not 300.
    expect(lines()).toHaveLength(97)
    const reloaded = createRecordLog<Rec>(file)
    expect(reloaded.all()).toEqual(log.all())
    expect(reloaded.all()[0]).toEqual({ id: 'r4', text: '299' })
  })

  it('keeps writes that land while a compaction is running', async () => {
    const log = createRecordLog<Rec>(file, { sliceSize: 1 })
    for (let i = 0; i < 260; i++) log.put({ id: `r${i % 3}`, text: String(i) })
    // A compaction is now in flight (it yields between slices); write during it.
    log.put({ id: 'late', text: 'x' })
    log.remove('r0')
    await log.idle()
    const reloaded = createRecordLog<Rec>(file)
    expect(reloaded.all()).toEqual(log.all())
    expect(ids(reloaded)).toContain('late')
    expect(ids(reloaded)).not.toContain('r0')
  })

  it('a clear during compaction is not undone by the compaction finishing', async () => {
    const log = createRecordLog<Rec>(file, { sliceSize: 1 })
    for (let i = 0; i < 260; i++) log.put({ id: `r${i % 3}`, text: String(i) })
    log.clear()
    log.put({ id: 'after', text: 'x' })
    await log.idle()
    expect(ids(createRecordLog<Rec>(file))).toEqual(['after'])
  })

  describe('legacy migration', () => {
    const legacyFile = () => join(dir, 'legacy.json')
    const legacy = () => ({ file: legacyFile(), read: (raw: string) => JSON.parse(raw) as Rec[] })

    it('imports a newest-first legacy array, writes the log and removes the old file', async () => {
      fs.writeFileSync(legacyFile(), JSON.stringify([{ id: 'new', text: '2' }, { id: 'old', text: '1' }]))
      const log = createRecordLog<Rec>(file, { legacy: legacy() })
      expect(ids(log)).toEqual(['new', 'old'])
      await log.idle()
      expect(fs.existsSync(legacyFile())).toBe(false)
      expect(ids(createRecordLog<Rec>(file, { legacy: legacy() }))).toEqual(['new', 'old'])
    })

    it('does not lose the legacy archive if the app quits before the first compaction', () => {
      fs.writeFileSync(legacyFile(), JSON.stringify([{ id: 'a', text: '1' }]))
      // Simulate: one append landed, compaction never did (legacy file still there).
      fs.writeFileSync(file, '{"id":"b","text":"2"}\n')
      const log = createRecordLog<Rec>(file, { legacy: legacy() })
      expect(ids(log)).toEqual(['b', 'a'])
    })

    it('applies the cap to imported records', () => {
      fs.writeFileSync(legacyFile(), JSON.stringify([{ id: 'c', text: '' }, { id: 'b', text: '' }, { id: 'a', text: '' }]))
      expect(ids(createRecordLog<Rec>(file, { cap: 2, legacy: legacy() }))).toEqual(['c', 'b'])
    })
  })
})
