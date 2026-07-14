import crypto from 'crypto'
import { b64urlEncode } from '../../gmail/base64url'

// RFC 7636 Proof Key for Code Exchange. The verifier is a high-entropy random
// string; the challenge is its SHA-256, base64url-encoded. Only the challenge
// travels in the authorization URL; the verifier is sent once, over TLS, at the
// token exchange — so an intercepted auth code is useless without it.
export interface Pkce {
  verifier: string
  challenge: string
  method: 'S256'
}

export function generatePkce(): Pkce {
  const verifier = b64urlEncode(crypto.randomBytes(32))
  const challenge = b64urlEncode(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge, method: 'S256' }
}

// Opaque CSRF token echoed back on the redirect and verified before we trust
// the authorization code.
export function randomState(): string {
  return b64urlEncode(crypto.randomBytes(16))
}
