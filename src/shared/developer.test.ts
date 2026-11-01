import { describe, expect, it } from 'vitest'
import { isLoopback, localDevelopmentHeaders, sanitizeRequest, validatePorts, validateReplay } from './developer'
describe('developer boundaries', () => {
  it('accepts only literal loopback hosts and localhost subdomains', () => {
    for (const url of ['http://localhost:3000', 'https://project.localhost', 'http://127.0.0.1', 'http://[::1]:8000']) expect(isLoopback(url)).toBe(true)
    for (const url of ['https://localhost.evil.com', 'https://127.0.0.1.evil.com', 'http://192.168.1.1', 'file:///secret', 'https://user:pass@localhost']) expect(isLoopback(url)).toBe(false)
  })
  it('never saves request bodies, credentials or secret query fields', () => {
    const request = sanitizeRequest({ url: 'https://example.com/?api_key=secret&token=private&q=find#secret', headers: { Authorization: 'Bearer secret', Cookie: 'session=private', 'X-API-Key': 'key', Accept: 'application/json' }, body: 'password=secret' })
    expect(request.url).not.toMatch(/secret|private/)
    expect(request.url).toContain('q=find')
    expect(request.headers).toEqual({ Accept: 'application/json' })
    expect(request.body).toBeUndefined()
  })
  it('validates explicit replays without carrying browser transport headers', () => {
    const request = validateReplay({ url: 'https://example.com', method: 'post', headers: { Host: 'evil.com', 'Content-Length': '1', Cookie: 'manual=value', 'Content-Type': 'application/json' }, body: '{}' })
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual({ Cookie: 'manual=value', 'Content-Type': 'application/json' })
    expect(request.body).toBe('{}')
    expect(() => validateReplay({ url: 'file:///secret' })).toThrow()
    expect(() => validateReplay({ url: 'https://example.com', method: 'CONNECT' })).toThrow()
    expect(() => validateReplay({ url: 'https://example.com', headers: { Accept: 'a\r\nInjected: yes' } })).toThrow()
    expect(() => validateReplay({ url: 'https://example.com', body: 'x'.repeat(256_001) })).toThrow()
  })
  it('bounds scans and rejects invalid ports', () => {
    expect(validatePorts([3000, 3000, 8080])).toEqual([3000, 8080])
    for (const value of [[0], [-1], [65536], [1.5], ['3000'], Array(33).fill(3000), null]) expect(() => validatePorts(value)).toThrow()
  })
  it('adapts only approved loopback pairs while preserving CSP and other security headers', () => {
    const approved = new Set(['http://localhost:3000', 'http://localhost:8000', 'https://example.com'])
    const original = { 'Content-Security-Policy': ["default-src 'self'"], vary: ['Accept-Encoding'], 'Access-Control-Allow-Origin': ['*'] }
    const headers = localDevelopmentHeaders('http://localhost:8000/api', 'http://localhost:3000/page', original, approved)!
    expect(headers['Access-Control-Allow-Origin']).toEqual(['http://localhost:3000'])
    expect(headers['Content-Security-Policy']).toEqual(original['Content-Security-Policy'])
    expect(headers.Vary[0]).toContain('Accept-Encoding')
    expect(headers.vary).toBeUndefined()
    expect(localDevelopmentHeaders('https://example.com', 'http://localhost:3000', original, approved)).toBeNull()
    expect(localDevelopmentHeaders('http://localhost:8000', 'https://example.com', original, approved)).toBeNull()
    expect(localDevelopmentHeaders('http://localhost:9000', 'http://localhost:3000', original, approved)).toBeNull()
    expect(localDevelopmentHeaders('http://localhost:8000', '', original, approved)).toBeNull()
    expect(original['Access-Control-Allow-Origin']).toEqual(['*'])
  })
})
