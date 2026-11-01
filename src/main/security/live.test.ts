import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createDefender } from './defender'
import { createSecurityService } from './service'

// Explicit opt-in: normal CI never scans a developer's computer or loads a model.
describe.skipIf(process.env.AIHUB_SECURITY_LIVE !== '1')('live local protection', () => {
  it('reads real Defender status and scans a harmless temporary HTML file', async () => {
    const defender = createDefender()
    const status = await defender.status()
    expect(status.available, status.message).toBe(true)
    expect(status.active).toBe(true)
    const dir = await mkdtemp(join(tmpdir(), 'aihub-security-'))
    try {
      const file = join(dir, 'hello #1.html')
      await writeFile(file, '<!doctype html><title>AIHub harmless scan test</title><p>Hello</p>')
      expect(await defender.scan('file', file)).toEqual({ detected: false })
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 120_000)
  it('receives a validated report from a real local Ollama model', async () => {
    const service = createSecurityService({ store: { get: () => [], set() {} }, aiConfig: () => ({ base: process.env.AIHUB_SECURITY_TEST_BASE || 'http://127.0.0.1:11434', model: process.env.AIHUB_SECURITY_TEST_MODEL || 'qwen2.5-coder:1.5b' }) })
    const report = await service.analyze({ id: 1, incognito: true }, 'Briefly explain the supplied Defender status. Do not claim a scan was performed.')
    expect(report.summary.length).toBeGreaterThan(0)
    expect(Array.isArray(report.recommendations)).toBe(true)
  }, 110_000)
})
