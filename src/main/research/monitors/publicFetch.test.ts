import { describe, expect, it, vi } from 'vitest'
import { assertPublicAddress, createPublicFetcher } from './publicFetch'
import { extractPublicText } from './publicText'

describe('public research observations', () => {
  it('rejects private, loopback and mapped private addresses', () => {
    for (const address of ['127.0.0.1', '10.2.3.4', '169.254.1.2', '::1', 'fc00::1', '::ffff:127.0.0.1']) {
      expect(() => assertPublicAddress(address), address).toThrow()
    }
    expect(() => assertPublicAddress('93.184.216.34')).not.toThrow()
  })

  it('pins the DNS answer and validates every redirect before making a request', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 302, headers: { location: 'https://private.example/' }, body: Buffer.alloc(0) })
    const fetcher = createPublicFetcher({ resolve: async host => [{ address: host === 'public.example' ? '93.184.216.34' : '127.0.0.1', family: 4 }], request })
    await expect(fetcher('https://public.example/', new AbortController().signal)).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1].address).toBe('93.184.216.34')
  })

  it('extracts visible prose without hidden ancestors, form values or editable drafts', () => {
    expect(extractPublicText('<main><p>Visible evidence.</p><div hidden><p>Secret</p></div><form><input value="secret"></form><div contenteditable>draft</div><script>bad()</script></main>').text)
      .toBe('Visible evidence.')
  })

  it('returns on the request deadline even when DNS has not completed', async () => {
    vi.useFakeTimers()
    const fetcher = createPublicFetcher({ resolve: () => new Promise(() => {}), request: vi.fn() })
    const pending = fetcher('https://public.example/', new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    vi.useRealTimers()
  })
})
