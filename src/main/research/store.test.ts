import { beforeEach, afterEach, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { createResearchRepository } from './store'
import { flushAllJsonStores } from '../jsonStore'
let dir: string
const normal = { id: 1, incognito: false }, privateWindow = { id: 2, incognito: true }
const when = '2026-10-08T12:00:00.000Z'
const project = { schemaVersion: 1 as const, id: 'p1', title: 'Study', question: '', createdAt: when, updatedAt: when, mode: 'summary' as const, sources: [], claims: [], notes: [] }
beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'research-store-')) })
afterEach(() => { flushAllJsonStores(); fs.rmSync(dir, { recursive: true, force: true }) })
it('persists normal projects while private windows neither read nor write them', () => {
  const repo = createResearchRepository(dir)
  expect(repo.save(normal, project).ok).toBe(true)
  expect(repo.list(privateWindow)).toEqual([])
  expect(repo.save(privateWindow, { ...project, id: 'private' }).ok).toBe(true)
  repo.release(2); expect(repo.list(privateWindow)).toEqual([])
  flushAllJsonStores()
  expect(JSON.parse(fs.readFileSync(join(dir, 'research-projects.json'), 'utf8')).projects).toHaveLength(1)
  expect(createResearchRepository(dir).list(normal)[0].id).toBe('p1')
})
it('refuses limits, invalid data, and changes to an existing capture', () => {
  const repo = createResearchRepository(dir)
  const source = { id: 's1', title: 'Source', url: 'https://example.org', capturedAt: when, text: 'Evidence', truncated: false, captureType: 'page' as const, provenance: 'captured' as const }
  expect(repo.save(normal, { ...project, sources: [source] }).ok).toBe(true)
  expect(repo.save(normal, { ...project, sources: [{ ...source, text: 'Altered' }] }).ok).toBe(false)
  expect(repo.save(normal, { ...project, title: '' }).ok).toBe(false)
  for (let i = 1; i < 20; i++) expect(repo.save(normal, { ...project, id: `p${i + 1}` }).ok).toBe(true)
  expect(repo.save(normal, { ...project, id: 'overflow' }).ok).toBe(false)
})
it('does not expose references to mutable stored objects', () => {
  const repo = createResearchRepository(dir); repo.save(normal, project)
  repo.list(normal)[0].title = 'Changed outside repository'
  expect(repo.list(normal)[0].title).toBe('Study')
  expect(repo.remove(normal, 'p1').ok).toBe(true); expect(repo.list(normal)).toEqual([])
})
