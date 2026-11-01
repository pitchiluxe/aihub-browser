// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { extractStructuredClip } from './structuredClip'

afterEach(() => { document.body.innerHTML = '' })
describe('structured page clipping', () => {
  it('preserves headings, code, images, links and tables while dropping boilerplate', () => {
    document.body.innerHTML = '<main><nav>Menu</nav><h1>Guide</h1><p>Use <strong>care</strong> <a href="https://example.com/docs">docs</a></p><img src="https://example.com/image.png" alt="Diagram"><pre>npm run test</pre><table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table><script>telemetry()</script></main>'
    const clip = extractStructuredClip()
    expect(clip.markdown).toContain('# Guide')
    expect(clip.markdown).toContain('**care**')
    expect(clip.markdown).toContain('[docs](https://example.com/docs)')
    expect(clip.markdown).toContain('![Diagram](https://example.com/image.png)')
    expect(clip.markdown).toContain('```\nnpm run test\n```')
    expect(clip.markdown).toContain('| Name | Value |\n| --- | --- |\n| A | 1 |')
    expect(clip.text).not.toMatch(/Menu|telemetry/)
  })
  it('omits executable URLs and protects fenced source text', () => {
    document.body.innerHTML = '<article><a href="javascript:alert(1)">click</a><img src="file:///secret"><pre>```\ncode</pre></article>'
    const clip = extractStructuredClip()
    expect(clip.markdown).not.toMatch(/javascript:|file:/)
    expect(clip.markdown).toContain('````\n```\ncode\n````')
  })
})
