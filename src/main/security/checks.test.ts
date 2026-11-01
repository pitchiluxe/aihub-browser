import { describe, expect, it } from 'vitest'
import { inspectHtml, inspectPage, localOllamaUrl, parseAgentReport } from './checks'

describe('security evidence checks', () => {
  it('identifies insecure password submission and cross-origin forms', () => {
    const findings = inspectPage({ url: 'https://example.com', passwordForms: ['http://evil.test/collect'] })
    expect(findings.map(f => f.code)).toEqual(expect.arrayContaining(['insecure-password', 'external-password']))
  })
  it('does not flag a same-origin secure password form', () => {
    expect(inspectPage({ url: 'https://example.com/login', passwordForms: ['https://example.com/session'] })).toEqual([])
  })
  it('flags misleading credentials and internationalized domain indicators', () => {
    expect(inspectPage({ url: 'https://bank.com@xn--bnk-5cd.test' }).map(f => f.code)).toEqual(expect.arrayContaining(['url-credentials', 'punycode']))
  })
  it('inspects HTML without running it and detects encoded code and remote scripts', () => {
    const findings = inspectHtml('<script src="https://evil.test/a.js"></script><script>eval(atob("test"))</script><form action="http://evil.test"><input type="password"></form>')
    expect(findings.map(f => f.code)).toEqual(expect.arrayContaining(['remote-script', 'encoded-script', 'html-password']))
    expect(inspectHtml('<h1>Hello</h1>')).toEqual([])
  })
  it('never accepts a non-loopback Ollama endpoint or a cloud model', () => {
    for (const url of ['https://ollama.com', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost', 'file:///x']) expect(() => localOllamaUrl(url, 'qwen3:8b')).toThrow()
    expect(() => localOllamaUrl('http://localhost:11434', 'gpt:cloud')).toThrow()
    expect(localOllamaUrl('http://127.0.0.1:11434', 'qwen3:8b')).toBe('http://127.0.0.1:11434/api/chat')
  })
  it('rejects malformed agent output instead of presenting it as evidence', () => {
    expect(() => parseAgentReport('{"summary":"safe","actions":"delete"}')).toThrow()
    expect(parseAgentReport('{"summary":"Review this","recommendations":["Run a scan"]}')).toEqual({ summary: 'Review this', recommendations: ['Run a scan'] })
  })
})
