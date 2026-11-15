// Pure, offline utilities behind the Tech Hub toolbox. Nothing here touches
// the network: pasted tokens, secrets and payloads never leave the machine.

export type ToolResult = { ok: true; output: string } | { ok: false; error: string }

const ok = (output: string): ToolResult => ({ ok: true, output })
const fail = (error: string): ToolResult => ({ ok: false, error })

export function formatJson(text: string, indent: 0 | 2 | 4 = 2): ToolResult {
  if (!text.trim()) return fail('Paste some JSON first.')
  try {
    return ok(JSON.stringify(JSON.parse(text), null, indent || undefined))
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid JSON.')
  }
}

export function base64Encode(text: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const encoded = btoa(binary)
  return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded
}

export function base64Decode(text: string): ToolResult {
  const clean = text.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!clean) return fail('Paste Base64 text first.')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return fail('This is not valid Base64.')
  try {
    const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return fail('Decoded bytes are not readable UTF-8 text.')
  }
}

export function urlDecode(text: string): ToolResult {
  try { return ok(decodeURIComponent(text.replace(/\+/g, ' '))) } catch { return fail('Malformed percent-encoding.') }
}

export type JwtParts = { header: unknown; payload: Record<string, unknown>; expiresAt?: number; issuedAt?: number; expired?: boolean }

export function decodeJwt(token: string, now = Date.now()): { ok: true; value: JwtParts } | { ok: false; error: string } {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.')
  if (parts.length !== 3) return { ok: false, error: 'A JWT has three dot-separated parts.' }
  const header = base64Decode(parts[0])
  const payload = base64Decode(parts[1])
  if (!header.ok || !payload.ok) return { ok: false, error: 'The header or payload is not valid Base64URL.' }
  try {
    const value: JwtParts = { header: JSON.parse(header.output), payload: JSON.parse(payload.output) }
    if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return { ok: false, error: 'The payload is not a JSON object.' }
    if (typeof value.payload.exp === 'number') {
      value.expiresAt = value.payload.exp * 1000
      value.expired = value.expiresAt < now
    }
    if (typeof value.payload.iat === 'number') value.issuedAt = value.payload.iat * 1000
    return { ok: true, value }
  } catch {
    return { ok: false, error: 'The header or payload is not JSON.' }
  }
}

export const HASH_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const
export type HashAlgorithm = typeof HASH_ALGORITHMS[number]

export async function hashText(text: string, algorithm: HashAlgorithm): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Accepts Unix seconds, Unix milliseconds, or any date string Date can parse. */
export function parseTimestamp(input: string): Date | null {
  const text = input.trim()
  if (!text) return null
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text)
    // 1e11 seconds is the year 5138, so anything larger is already milliseconds.
    const date = new Date(Math.abs(n) < 1e11 ? n * 1000 : n)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export type SubnetInfo = {
  cidr: string; network: string; broadcast: string; mask: string; wildcard: string
  firstHost: string; lastHost: string; usableHosts: number; totalAddresses: number; ipClass: string; privateRange: boolean
}

const toIp = (n: number) => [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.')

export function parseIpv4(text: string): number | null {
  const parts = text.trim().split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null
  return parts.reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0)
}

export function subnet(input: string): { ok: true; value: SubnetInfo } | { ok: false; error: string } {
  const match = input.trim().match(/^([\d.]+)\s*(?:\/\s*(\d{1,2})|\s+([\d.]+))$/)
  if (!match) return { ok: false, error: 'Use CIDR notation like 192.168.1.10/24 or an address and mask.' }
  const ip = parseIpv4(match[1])
  if (ip === null) return { ok: false, error: 'That IPv4 address is not valid.' }
  let prefix: number
  if (match[2] !== undefined) {
    prefix = Number(match[2])
    if (prefix > 32) return { ok: false, error: 'The prefix must be between 0 and 32.' }
  } else {
    const mask = parseIpv4(match[3])
    const inverted = mask === null ? -1 : (~mask >>> 0)
    if (mask === null || (inverted & (inverted + 1)) !== 0) return { ok: false, error: 'That subnet mask is not contiguous.' }
    prefix = 32 - Math.log2(inverted + 1)
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (ip & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const total = 2 ** (32 - prefix)
  const pointToPoint = prefix >= 31
  const firstOctet = ip >>> 24
  const secondOctet = (ip >>> 16) & 255
  return {
    ok: true,
    value: {
      cidr: `${toIp(network)}/${prefix}`,
      network: toIp(network),
      broadcast: pointToPoint ? 'n/a' : toIp(broadcast),
      mask: toIp(mask),
      wildcard: toIp(~mask >>> 0),
      firstHost: toIp(pointToPoint ? network : network + 1),
      lastHost: toIp(pointToPoint ? broadcast : broadcast - 1),
      usableHosts: prefix === 32 ? 1 : prefix === 31 ? 2 : total - 2,
      totalAddresses: total,
      ipClass: firstOctet < 128 ? 'A' : firstOctet < 192 ? 'B' : firstOctet < 224 ? 'C' : firstOctet < 240 ? 'D (multicast)' : 'E (reserved)',
      privateRange: firstOctet === 10 || (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31)
        || (firstOctet === 192 && secondOctet === 168),
    },
  }
}

export type RegexMatch = { index: number; text: string; groups: string[] }

export function testRegex(pattern: string, flags: string, input: string, limit = 200): { ok: true; matches: RegexMatch[] } | { ok: false; error: string } {
  if (!pattern) return { ok: false, error: 'Enter a pattern.' }
  let re: RegExp
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid pattern.' }
  }
  const matches: RegexMatch[] = []
  for (const match of input.matchAll(re)) {
    matches.push({ index: match.index ?? 0, text: match[0], groups: match.slice(1).map(group => group ?? '') })
    if (matches.length >= limit) break
  }
  return { ok: true, matches }
}

export const PASSWORD_SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
} as const
export type PasswordSet = keyof typeof PASSWORD_SETS

/** Unbiased: rejection-samples bytes so every character is equally likely. */
export function generatePassword(length: number, sets: PasswordSet[], random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const alphabet = [...new Set(sets.flatMap(set => [...PASSWORD_SETS[set]]))].join('')
  if (!alphabet) return ''
  const size = Math.max(4, Math.min(128, Math.floor(length)))
  const limit = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < size) {
    for (const byte of random(new Uint8Array(size * 2))) {
      if (byte < limit) out += alphabet[byte % alphabet.length]
      if (out.length === size) break
    }
  }
  return out
}

/** Bits of entropy for a uniformly random password. */
export function passwordEntropy(length: number, sets: PasswordSet[]): number {
  const size = new Set(sets.flatMap(set => [...PASSWORD_SETS[set]])).size
  return size ? Math.round(length * Math.log2(size)) : 0
}
