import { describe, expect, it } from 'vitest'
import { CERTS, CORE_SKILLS, RESOURCES, TUTOR_TOPICS } from './catalog'
import { careerPrompt, TRACKS } from './careerContent'
import {
  base64Decode, base64Encode, decodeJwt, formatJson, generatePassword, hashText, parseTimestamp, passwordEntropy, subnet, testRegex, urlDecode,
} from './devTools'
import { cleanQuestion, parseQuiz, readScore } from './quiz'

describe('dev toolbox', () => {
  it('formats and rejects JSON', () => {
    expect(formatJson('{"a":[1,2]}', 2)).toEqual({ ok: true, output: '{\n  "a": [\n    1,\n    2\n  ]\n}' })
    expect(formatJson('{"a": 1}', 0)).toEqual({ ok: true, output: '{"a":1}' })
    expect(formatJson('{a:1}').ok).toBe(false)
  })

  it('round-trips UTF-8 Base64, including URL-safe input', () => {
    const text = 'zero trust ✓ — café'
    expect(base64Decode(base64Encode(text))).toEqual({ ok: true, output: text })
    expect(base64Decode(base64Encode('??>>', true))).toEqual({ ok: true, output: '??>>' })
    expect(base64Encode('??>>', true)).not.toMatch(/[+/=]/)
    expect(base64Decode('not base64!').ok).toBe(false)
  })

  it('decodes URLs and reports malformed escapes', () => {
    expect(urlDecode('a%20b+c')).toEqual({ ok: true, output: 'a b c' })
    expect(urlDecode('%E0%A4%A').ok).toBe(false)
  })

  it('decodes JWT claims and expiry without verifying', () => {
    const header = base64Encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), true)
    const payload = base64Encode(JSON.stringify({ sub: '42', exp: 1_000, iat: 900 }), true)
    const result = decodeJwt(`Bearer ${header}.${payload}.sig`, 2_000_000)
    expect(result.ok && result.value.payload.sub).toBe('42')
    expect(result.ok && result.value.expired).toBe(true)
    expect(result.ok && result.value.issuedAt).toBe(900_000)
    expect(decodeJwt('a.b').ok).toBe(false)
  })

  it('hashes with SHA-256', async () => {
    expect(await hashText('abc', 'SHA-256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('parses seconds, milliseconds and ISO dates', () => {
    expect(parseTimestamp('1700000000')?.toISOString()).toBe('2023-11-14T22:13:20.000Z')
    expect(parseTimestamp('1700000000000')?.toISOString()).toBe('2023-11-14T22:13:20.000Z')
    expect(parseTimestamp('2026-01-02T03:04:05Z')?.getTime()).toBe(Date.UTC(2026, 0, 2, 3, 4, 5))
    expect(parseTimestamp('nonsense')).toBeNull()
  })

  it('calculates subnets from CIDR and dotted masks', () => {
    const result = subnet('192.168.10.37/26')
    expect(result.ok && result.value).toMatchObject({
      cidr: '192.168.10.0/26', broadcast: '192.168.10.63', mask: '255.255.255.192', wildcard: '0.0.0.63',
      firstHost: '192.168.10.1', lastHost: '192.168.10.62', usableHosts: 62, privateRange: true, ipClass: 'C',
    })
    const masked = subnet('10.1.2.3 255.255.0.0')
    expect(masked.ok && masked.value.cidr).toBe('10.1.0.0/16')
    const p2p = subnet('8.8.8.8/31')
    expect(p2p.ok && p2p.value).toMatchObject({ usableHosts: 2, broadcast: 'n/a', privateRange: false })
    const all = subnet('0.0.0.0/0')
    expect(all.ok && all.value.totalAddresses).toBe(2 ** 32)
    expect(subnet('10.0.0.1/33').ok).toBe(false)
    expect(subnet('10.0.0.1 255.0.255.0').ok).toBe(false)
    expect(subnet('300.0.0.1/8').ok).toBe(false)
  })

  it('tests regexes with groups and reports syntax errors', () => {
    const result = testRegex('(\\d+)-(\\w+)', '', 'a 12-ab 7-c')
    expect(result.ok && result.matches).toEqual([{ index: 2, text: '12-ab', groups: ['12', 'ab'] }, { index: 8, text: '7-c', groups: ['7', 'c'] }])
    expect(testRegex('(', '', 'x').ok).toBe(false)
  })

  it('generates passwords from the chosen sets only, without modulo bias', () => {
    const digits = generatePassword(32, ['digits'])
    expect(digits).toMatch(/^\d{32}$/)
    // A source of only 255s must be rejected for a 10-char alphabet (limit 250), then accept 0s.
    let calls = 0
    const random = (bytes: Uint8Array) => { bytes.fill(calls++ === 0 ? 255 : 0); return bytes }
    expect(generatePassword(8, ['digits'], random)).toBe('00000000')
    expect(generatePassword(10, [])).toBe('')
    expect(passwordEntropy(10, ['digits'])).toBe(33)
  })
})

describe('quiz parsing', () => {
  it('extracts questions from fenced, chatty output and accepts letter answers', () => {
    const text = 'Sure!\n```json\n[{"q":"What does DNS do?","choices":["A) Names to IPs","B) Encrypts","C) Routes","D) Stores"],"answer":"A","why":"Resolution."},{"question":"bad","options":["x"],"answer":0}]\n```'
    expect(parseQuiz(text)).toEqual([{ question: 'What does DNS do?', options: ['Names to IPs', 'Encrypts', 'Routes', 'Stores'], answer: 0, explanation: 'Resolution.' }])
  })

  it('salvages questions from malformed model JSON (stray "]]" and "}]}")', () => {
    const broken = '[{"question":"What is the purpose of the SYN packet?","options":["Establishing a connection","Requesting data","Relaying packets","Terminating a connection"],"answer":0,"explanation":"SYN starts the handshake."},'
      + '{"question":"What happens to data packets?","options":["Discarded if not acknowledged","Replayed","Sent regardless","Lost in transit"]],"answer":0,"explanation":"They are retransmitted until \\"acknowledged\\"."}]}'
    const quiz = parseQuiz(broken)
    expect(quiz).toHaveLength(2)
    expect(quiz[0]).toMatchObject({ question: 'What is the purpose of the SYN packet?', answer: 0 })
    expect(quiz[1].options).toEqual(['Discarded if not acknowledged', 'Replayed', 'Sent regardless', 'Lost in transit'])
    expect(quiz[1].explanation).toBe('They are retransmitted until "acknowledged".')
  })

  it('returns nothing for non-JSON', () => {
    expect(parseQuiz('no quiz here')).toEqual([])
    expect(parseQuiz('[not json]')).toEqual([])
  })
})

describe('interview scoring', () => {
  it('reads common score formats', () => {
    expect(readScore('Score: 7/10\n...')).toBe(7)
    expect(readScore('**Score:** 9 / 10')).toBe(9)
    expect(readScore('I would give this a score of 6 out of 10')).toBe(6)
    expect(readScore('No rating')).toBeUndefined()
  })
})

describe('catalog integrity', () => {
  it('covers every track with skills, tutor topics, certs and resources', () => {
    for (const track of TRACKS) {
      expect(CORE_SKILLS[track.name].length).toBeGreaterThanOrEqual(8)
      expect(TUTOR_TOPICS[track.name].length).toBeGreaterThan(0)
      expect(CERTS.some(cert => cert.tracks.includes(track.name))).toBe(true)
      expect(RESOURCES.some(item => item.tracks === 'all' || item.tracks.includes(track.name))).toBe(true)
    }
  })

  it('uses unique ids and https links only', () => {
    expect(new Set(CERTS.map(cert => cert.id)).size).toBe(CERTS.length)
    for (const url of [...CERTS, ...RESOURCES].map(item => item.url)) expect(new URL(url).protocol).toBe('https:')
  })

  it('passes extra context into skill and cert prompts', () => {
    expect(careerPrompt('skills', 'SOC Analyst', 'Starting out', '', 'Skills still missing: SIEM')).toContain('Skills still missing: SIEM')
    expect(careerPrompt('news', 'SOC Analyst', 'Starting out', '', '1. Headline')).toContain('Headlines:\n1. Headline')
  })
})

describe('interview question cleanup', () => {
  it('strips labels, bold and wrapping quotes', () => {
    expect(cleanQuestion('**Question:** "Walk me through it."')).toBe('Walk me through it.')
    expect(cleanQuestion('“How do you triage alerts?”')).toBe('How do you triage alerts?')
    expect(cleanQuestion('Question 1: Explain "least privilege".')).toBe('Explain "least privilege".')
  })
})
