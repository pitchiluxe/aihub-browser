import { it, expect } from 'vitest'
import { generateResearchClaims, createResearchRunGuard } from './researchGeneration'
const when = '2026-10-08T12:00:00.000Z'
const project = { schemaVersion: 1 as const, id: 'p1', title: 'Study', question: 'What changed?', createdAt: when, updatedAt: when, mode: 'summary' as const, sources: [{ id: 's1', title: 'Source', url: 'https://example.org', capturedAt: when, text: 'Actual page evidence.', truncated: false, captureType: 'page' as const, provenance: 'captured' as const }], claims: [], notes: [] }
it('uses captured passages and retains unsupported claims without trusting model metadata', async () => {
  let prompt = ''
  const ai = { chat: async (messages: { role: string; content: string }[]) => { prompt = messages[1].content; return { content: JSON.stringify({ claims: [{ text: 'Supported finding', citations: [{ sourceId: 's1', quote: 'Actual page evidence.' }], reviewed: true, url: 'https://evil.org' }, { text: 'Unsupported finding', citations: [{ sourceId: 'missing', quote: 'Invented quote' }] }] }) } } }
  const result = await generateResearchClaims(project, ai, new AbortController().signal)
  expect(prompt).toContain('Actual page evidence.')
  expect(result.ok).toBe(true)
  if (result.ok) { expect(result.value).toHaveLength(2); expect(result.value[0].reviewed).toBe(false); expect(result.value[0]).not.toHaveProperty('url') }
})
it('refuses malformed, oversized, or empty output', async () => {
  for (const content of ['hello', '{"claims":[]}', JSON.stringify({ claims: [{ text: 'x'.repeat(2001), citations: [] }] })]) {
    expect((await generateResearchClaims(project, { chat: async () => ({ content }) }, new AbortController().signal)).ok).toBe(false)
  }
})
it('invalidates earlier requests when a project changes', () => {
  const guard = createResearchRunGuard(), first = guard.begin('a'), second = guard.begin('b')
  expect(first.signal.aborted).toBe(true); expect(guard.current('a', first.token)).toBe(false)
  expect(guard.current('b', second.token)).toBe(true); guard.cancel(); expect(second.signal.aborted).toBe(true)
})
it('returns cancellation promptly even if the provider does not resolve', async () => {
  const ctrl = new AbortController()
  const pending = generateResearchClaims(project, { chat: () => new Promise(() => {}) }, ctrl.signal)
  ctrl.abort(); expect((await pending).ok).toBe(false)
})
it('retains valid findings alongside an unresolved empty model quotation', async () => {
  const result = await generateResearchClaims(project, { chat: async () => ({ content: JSON.stringify({ claims: [{ text: 'Supported', citations: [{ sourceId: 's1', quote: 'Actual page evidence.' }] }, { text: 'Unsupported', citations: [{ sourceId: 's1', quote: '' }] }] }) }) }, new AbortController().signal)
  expect(result.ok).toBe(true); if (result.ok) { expect(result.value).toHaveLength(2); expect(result.value[1].citations).toEqual([]); expect(result.value[1].reviewed).toBe(false) }
})
