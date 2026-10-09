import { describe, it, expect } from 'vitest'
import {
  validateBackendConfig, sealBackendConfig, loadBackendConfig,
  type SafeStorageLike,
} from './backendConfig'

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
}

describe('validateBackendConfig', () => {
  it('accepts a well-formed project url and key', () => {
    const out = validateBackendConfig({ url: 'https://abc.supabase.co', anonKey: 'ey.k.v', iceServers: [] })
    expect(out).toEqual({
      ok: true,
      config: { url: 'https://abc.supabase.co', anonKey: 'ey.k.v', iceServers: [], livekit: null },
    })
  })

  it('rejects a url that is not https, because the key travels on it', () => {
    const out = validateBackendConfig({ url: 'http://abc.supabase.co', anonKey: 'ey.k.v' })
    expect(out).toEqual({ ok: false, error: 'The project URL must start with https://.' })
  })

  it('rejects a missing url', () => {
    expect(validateBackendConfig({ anonKey: 'k' }))
      .toEqual({ ok: false, error: 'The project URL is required.' })
  })

  it('rejects a whitespace-only key rather than connecting without one', () => {
    const out = validateBackendConfig({ url: 'https://abc.supabase.co', anonKey: '  ' })
    expect(out).toEqual({ ok: false, error: 'The anon key is required.' })
  })

  it('trims a trailing slash so request paths do not double up', () => {
    const out = validateBackendConfig({ url: 'https://abc.supabase.co/', anonKey: 'k' })
    expect(out.ok && out.config.url).toBe('https://abc.supabase.co')
  })

  it('defaults iceServers to an empty list when absent', () => {
    const out = validateBackendConfig({ url: 'https://a.supabase.co', anonKey: 'k' })
    expect(out.ok && out.config.iceServers).toEqual([])
  })

  it('rejects an ice server entry with no urls', () => {
    const out = validateBackendConfig({ url: 'https://a.supabase.co', anonKey: 'k', iceServers: [{}] })
    expect(out).toEqual({ ok: false, error: 'Every ICE server needs a urls value.' })
  })

  it('keeps turn credentials when they are supplied', () => {
    const out = validateBackendConfig({
      url: 'https://a.supabase.co',
      anonKey: 'k',
      iceServers: [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'p' }],
    })
    expect(out.ok && out.config.iceServers[0]).toEqual({
      urls: 'turn:relay.example:3478', username: 'u', credential: 'p',
    })
  })

  it('accepts an array of urls on one server', () => {
    const out = validateBackendConfig({
      url: 'https://a.supabase.co', anonKey: 'k',
      iceServers: [{ urls: ['stun:a:3478', 'stun:b:3478'] }],
    })
    expect(out.ok && out.config.iceServers[0].urls).toEqual(['stun:a:3478', 'stun:b:3478'])
  })
})

describe('livekit', () => {
  const base = { url: 'https://a.supabase.co', anonKey: 'k' }

  it('is null when no LiveKit fields are given, so the mesh fallback stays', () => {
    const out = validateBackendConfig(base)
    expect(out.ok && out.config.livekit).toBe(null)
  })

  it('is null when every LiveKit field is blank', () => {
    const out = validateBackendConfig({ ...base, livekit: { url: '', apiKey: '', apiSecret: '' } })
    expect(out.ok && out.config.livekit).toBe(null)
  })

  it('accepts a complete project', () => {
    const out = validateBackendConfig({
      ...base,
      livekit: { url: 'wss://x.livekit.cloud', apiKey: 'API123', apiSecret: 'shh' },
    })
    expect(out.ok && out.config.livekit).toEqual({
      url: 'wss://x.livekit.cloud', apiKey: 'API123', apiSecret: 'shh',
    })
  })

  it('refuses a half-filled project rather than failing later at join time', () => {
    const out = validateBackendConfig({ ...base, livekit: { url: 'wss://x.livekit.cloud' } })
    expect(out).toEqual({ ok: false, error: 'The LiveKit API key is required.' })
  })

  it('names the missing secret specifically', () => {
    const out = validateBackendConfig({
      ...base, livekit: { url: 'wss://x.livekit.cloud', apiKey: 'API123' },
    })
    expect(out).toEqual({ ok: false, error: 'The LiveKit API secret is required.' })
  })

  it('rejects an https LiveKit url, which is the usual paste mistake', () => {
    const out = validateBackendConfig({
      ...base, livekit: { url: 'https://x.livekit.cloud', apiKey: 'k', apiSecret: 's' },
    })
    expect(out).toEqual({ ok: false, error: 'The LiveKit URL must start with wss://.' })
  })

  it('trims a trailing slash off the LiveKit url', () => {
    const out = validateBackendConfig({
      ...base, livekit: { url: 'wss://x.livekit.cloud/', apiKey: 'k', apiSecret: 's' },
    })
    expect(out.ok && out.config.livekit?.url).toBe('wss://x.livekit.cloud')
  })
})

describe('seal and load', () => {
  const config = {
    url: 'https://abc.supabase.co', anonKey: 'secret', iceServers: [],
    livekit: { url: 'wss://x.livekit.cloud', apiKey: 'API123', apiSecret: 'topsecret' },
  }

  it('keeps the LiveKit secret out of the sealed blob in plain text', () => {
    const sealed = sealBackendConfig(fakeSafeStorage, config)
    expect(sealed.value).not.toContain('topsecret')
    expect(loadBackendConfig(fakeSafeStorage, sealed.value)?.livekit?.apiSecret).toBe('topsecret')
  })

  it('round-trips a config through encryption', () => {
    const sealed = sealBackendConfig(fakeSafeStorage, config)
    expect(sealed.insecure).toBe(false)
    expect(sealed.value).not.toContain('secret')
    expect(loadBackendConfig(fakeSafeStorage, sealed.value)).toEqual(config)
  })

  it('marks the blob insecure when the OS has no keyring, and still round-trips', () => {
    const noKeyring: SafeStorageLike = { ...fakeSafeStorage, isEncryptionAvailable: () => false }
    const sealed = sealBackendConfig(noKeyring, config)
    expect(sealed.insecure).toBe(true)
    expect(loadBackendConfig(noKeyring, sealed.value)).toEqual(config)
  })

  it('returns null for a missing blob rather than throwing', () => {
    expect(loadBackendConfig(fakeSafeStorage, null)).toBe(null)
  })

  it('returns null when the OS can no longer decrypt it', () => {
    const broken: SafeStorageLike = {
      ...fakeSafeStorage,
      decryptString: () => { throw new Error('keychain reset') },
    }
    expect(loadBackendConfig(broken, 'anything')).toBe(null)
  })

  it('returns null for a blob that decrypts to something invalid', () => {
    const garbage: SafeStorageLike = { ...fakeSafeStorage, decryptString: () => '{"url":"ftp://x"}' }
    expect(loadBackendConfig(garbage, 'anything')).toBe(null)
  })
})

describe('loopback URLs', () => {
  const base = { anonKey: 'anon-key-value' }

  // `supabase start` serves http on loopback and cannot be told otherwise, so
  // an https-only rule means the schema can only ever be tried in production.
  it('accepts a local stack over plain http', () => {
    for (const url of [
      'http://127.0.0.1:54421',
      'http://localhost:54421',
      'http://[::1]:54421',
    ]) {
      const out = validateBackendConfig({ ...base, url })
      expect(out.ok, url).toBe(true)
    }
  })

  // The exemption is loopback, not "http". A LAN address is on a network.
  it('still refuses plain http anywhere else', () => {
    for (const url of [
      'http://192.168.1.10:54421',
      'http://community.example.com',
      'http://10.0.0.5',
      'http://127.0.0.1.evil.com',
    ]) {
      const out = validateBackendConfig({ ...base, url })
      expect(out.ok, url).toBe(false)
    }
  })

  it('still accepts https everywhere', () => {
    expect(validateBackendConfig({ ...base, url: 'https://abc.supabase.co' }).ok).toBe(true)
  })
})
