// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { captureResearchSource, RESEARCH_CAPTURE_SCRIPT } from './capture'
it('uses actual page metadata and excludes form contents', async () => {
  document.body.innerHTML = '<main><p>Actual page evidence.</p><input value="secret"><textarea>private draft</textarea><div contenteditable>private editor</div></main>'
  const result = await captureResearchSource({ isDestroyed: () => false, getURL: () => 'https://example.org/a', getTitle: () => 'Actual title', executeJavaScript: async script => window.eval(script) })
  expect(result.ok).toBe(true)
  if (result.ok) { expect(result.value.text).toBe('Actual page evidence.'); expect(result.value.title).toBe('Actual title'); expect(result.value.url).toBe('https://example.org/a') }
})
it('rejects navigation during capture and unavailable pages', async () => {
  let url = 'https://example.org/a'
  const result = await captureResearchSource({ isDestroyed: () => false, getURL: () => url, getTitle: () => 'A', executeJavaScript: async () => { url = 'https://example.org/b'; return { text: 'Evidence', captureType: 'page', truncated: false } } })
  expect(result.ok).toBe(false)
  expect((await captureResearchSource({ isDestroyed: () => true, getURL: () => 'about:blank', getTitle: () => '', executeJavaScript: async () => null })).ok).toBe(false)
})
it('bounds the saved text and labels truncation', async () => {
  document.body.innerHTML = `<main>${'x'.repeat(13000)}</main>`
  const raw = await window.eval(RESEARCH_CAPTURE_SCRIPT)
  expect(raw.text.length).toBe(12000); expect(raw.truncated).toBe(true)
})
