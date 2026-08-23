import { describe, it, expect } from 'vitest'
import {
  generateKeyPair, canonicalJson, signPayload, verifyPayload,
  signEnvelope, checkEnvelope, MAX_CLOCK_SKEW_SECONDS,
  sealPrivateKey, openPrivateKey, type SecretBox,
} from './identity'

describe('canonicalJson', () => {
  // The failure this prevents is invisible locally: client and server build
  // the same object in different orders, every signature fails to verify, and
  // it reads as a wrong key rather than a wrong string.
  it('does not depend on the order keys were inserted in', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  it('sorts nested objects too', () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}')
  })

  it('keeps array order, which is meaningful', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('drops undefined values rather than emitting them', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('handles the primitives', () => {
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson('x')).toBe('"x"')
    expect(canonicalJson(7)).toBe('7')
    expect(canonicalJson(true)).toBe('true')
  })
})

describe('sign and verify', () => {
  const keys = generateKeyPair()

  it('round-trips a payload', () => {
    const sig = signPayload(keys.privateKey, { hello: 'world' })
    expect(verifyPayload(keys.publicKey, { hello: 'world' }, sig)).toBe(true)
  })

  it('verifies regardless of key order, because the payload is canonicalized', () => {
    const sig = signPayload(keys.privateKey, { a: 1, b: 2 })
    expect(verifyPayload(keys.publicKey, { b: 2, a: 1 }, sig)).toBe(true)
  })

  it('fails when the payload was tampered with', () => {
    const sig = signPayload(keys.privateKey, { amount: 1 })
    expect(verifyPayload(keys.publicKey, { amount: 2 }, sig)).toBe(false)
  })

  it('fails against a different key', () => {
    const other = generateKeyPair()
    const sig = signPayload(keys.privateKey, { hello: 'world' })
    expect(verifyPayload(other.publicKey, { hello: 'world' }, sig)).toBe(false)
  })

  // This runs on attacker-supplied input, so garbage must be a false, not a
  // thrown exception that takes the handler down with it.
  it('returns false rather than throwing on malformed input', () => {
    expect(verifyPayload('not a key', {}, 'not a signature')).toBe(false)
    expect(verifyPayload(keys.publicKey, {}, '!!!!')).toBe(false)
  })
})

describe('signed envelopes', () => {
  const keys = generateKeyPair()

  it('accepts a fresh envelope', () => {
    const env = signEnvelope(keys.privateKey, { channel: 'bible-study', body: 'hi' })
    expect(checkEnvelope(keys.publicKey, env)).toEqual({ ok: true })
  })

  it('rejects a replay with a swapped timestamp or nonce', () => {
    const env = signEnvelope(keys.privateKey, { body: 'hi' })
    expect(checkEnvelope(keys.publicKey, { ...env, nonce: 'different' }).ok).toBe(false)
    expect(checkEnvelope(keys.publicKey, { ...env, timestamp: env.timestamp + 1 }).ok).toBe(false)
  })

  it('rejects an envelope older than the skew window and says by how much', () => {
    const past = Date.now() - (MAX_CLOCK_SKEW_SECONDS + 60) * 1000
    const env = signEnvelope(keys.privateKey, { body: 'hi' }, past)
    const out = checkEnvelope(keys.publicKey, env)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      // The user has to be told their clock is wrong; without the amount the
      // message cannot say so convincingly.
      expect(out.reason).toBe('clock_skew')
      expect(out.skewSeconds).toBeGreaterThan(MAX_CLOCK_SKEW_SECONDS)
    }
  })

  it('accepts a small skew, because clocks are never exact', () => {
    const env = signEnvelope(keys.privateKey, { body: 'hi' }, Date.now() - 30_000)
    expect(checkEnvelope(keys.publicKey, env).ok).toBe(true)
  })

  it('gives every envelope a distinct nonce', () => {
    const nonces = new Set(
      Array.from({ length: 50 }, () => signEnvelope(keys.privateKey, { body: 'x' }).nonce))
    expect(nonces.size).toBe(50)
  })
})

describe('key storage', () => {
  const working: SecretBox = {
    isEncryptionAvailable: () => true,
    // Stand-in for the OS keychain: reversible, and clearly not the PEM.
    encryptString: (p) => Buffer.from('KEYCHAIN:' + p, 'utf8'),
    decryptString: (c) => c.toString('utf8').replace(/^KEYCHAIN:/, ''),
  }
  const unavailable: SecretBox = {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error('no keychain') },
    decryptString: () => { throw new Error('no keychain') },
  }

  it('encrypts the key and round-trips it', () => {
    const { privateKey } = generateKeyPair()
    const sealed = sealPrivateKey(working, privateKey)
    expect(sealed.insecure).toBe(false)
    expect(sealed.value).not.toContain('PRIVATE KEY')
    expect(openPrivateKey(working, sealed.value)).toBe(privateKey)
  })

  // Refusing to run would be worse than the honest fallback, but the flag has
  // to reach the UI or the user is trusting protection they do not have.
  it('falls back to plaintext and flags it when the OS has no keychain', () => {
    const { privateKey } = generateKeyPair()
    const sealed = sealPrivateKey(unavailable, privateKey)
    expect(sealed.insecure).toBe(true)
    expect(sealed.value).toBe(privateKey)
  })

  // A machine that gains or loses a keychain between runs must still be able
  // to read what the previous run wrote.
  it('reads a plaintext key back even once encryption becomes available', () => {
    const { privateKey } = generateKeyPair()
    const plain = sealPrivateKey(unavailable, privateKey).value
    expect(openPrivateKey(working, plain)).toBe(privateKey)
  })
})
