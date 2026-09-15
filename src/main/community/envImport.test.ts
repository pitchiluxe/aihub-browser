import { describe, it, expect } from 'vitest'
import { parseEnv, backendFromEnv, refusedKeysIn } from './envImport'

describe('parseEnv', () => {
  it('reads plain KEY=value lines', () => {
    expect(parseEnv('A=1\nB=two')).toEqual({ A: '1', B: 'two' })
  })

  it('ignores comments and blank lines', () => {
    expect(parseEnv('# note\n\nA=1\n   \n# A=2')).toEqual({ A: '1' })
  })

  it('strips an export prefix', () => {
    expect(parseEnv('export A=1')).toEqual({ A: '1' })
  })

  it('strips surrounding quotes of either kind', () => {
    expect(parseEnv('A="one"\nB=\'two\'')).toEqual({ A: 'one', B: 'two' })
  })

  it('handles CRLF line endings', () => {
    expect(parseEnv('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' })
  })

  it('keeps a value containing = , which every JWT eventually does', () => {
    expect(parseEnv('A=ey.J.h==')).toEqual({ A: 'ey.J.h==' })
  })

  it('trims a trailing inline comment from an unquoted value', () => {
    expect(parseEnv('A=one # a note')).toEqual({ A: 'one' })
  })

  it('does NOT truncate a value at a hash with no space before it', () => {
    // A secret may legitimately contain '#'. Cutting there would produce a
    // credential that is wrong in a way nothing reports.
    expect(parseEnv('A=se#cret')).toEqual({ A: 'se#cret' })
  })

  it('keeps a hash inside a quoted value', () => {
    expect(parseEnv('A="se # cret"')).toEqual({ A: 'se # cret' })
  })

  it('skips malformed lines rather than throwing', () => {
    expect(parseEnv('no equals here\n=novalue\n1BAD=x\nA=1')).toEqual({ A: '1' })
  })

  it('returns an empty object for empty input', () => {
    expect(parseEnv('')).toEqual({})
  })
})

describe('backendFromEnv', () => {
  const full = [
    'SUPABASE_URL=https://proj.supabase.co',
    'SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc',
    'LIVEKIT_URL=wss://proj.livekit.cloud',
    'LIVEKIT_API_KEY=APIabc',
    'LIVEKIT_API_SECRET=shhh',
  ].join('\n')

  it('pulls every field out of a complete file', () => {
    const out = backendFromEnv(full)
    expect(out.config.url).toBe('https://proj.supabase.co')
    expect(out.config.anonKey).toBe('sb_publishable_abc')
    expect(out.config.livekit).toEqual({
      url: 'wss://proj.livekit.cloud', apiKey: 'APIabc', apiSecret: 'shhh',
    })
    expect(out.missing).toEqual([])
  })

  it('reports the variable names it used, so the panel can show them', () => {
    expect(backendFromEnv(full).found).toContain('SUPABASE_PUBLISHABLE_KEY')
  })

  it('accepts the older SUPABASE_ANON_KEY spelling', () => {
    const out = backendFromEnv('SUPABASE_URL=https://p.supabase.co\nSUPABASE_ANON_KEY=old')
    expect(out.config.anonKey).toBe('old')
    expect(out.found).toContain('SUPABASE_ANON_KEY')
  })

  it('accepts NEXT_PUBLIC_ variants', () => {
    const out = backendFromEnv([
      'NEXT_PUBLIC_SUPABASE_URL=https://p.supabase.co',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=k',
      'NEXT_PUBLIC_LIVEKIT_URL=wss://p.livekit.cloud',
      'LIVEKIT_API_KEY=API',
      'LIVEKIT_API_SECRET=s',
    ].join('\n'))
    expect(out.config.url).toBe('https://p.supabase.co')
    expect(out.config.livekit?.url).toBe('wss://p.livekit.cloud')
  })

  it('prefers the non-prefixed name when a file carries both', () => {
    const out = backendFromEnv('SUPABASE_URL=https://a.co\nNEXT_PUBLIC_SUPABASE_URL=https://b.co')
    expect(out.config.url).toBe('https://a.co')
  })

  it('imports Supabase alone and names the missing LiveKit fields', () => {
    const out = backendFromEnv('SUPABASE_URL=https://p.supabase.co\nSUPABASE_ANON_KEY=k')
    expect(out.config.livekit).toBe(null)
    expect(out.missing).toEqual(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'])
  })

  it('leaves LiveKit null when the secret is missing, rather than half-configuring it', () => {
    const out = backendFromEnv([
      'SUPABASE_URL=https://p.supabase.co', 'SUPABASE_ANON_KEY=k',
      'LIVEKIT_URL=wss://p.livekit.cloud', 'LIVEKIT_API_KEY=API',
    ].join('\n'))
    expect(out.config.livekit).toBe(null)
    expect(out.missing).toEqual(['LIVEKIT_API_SECRET'])
  })

  it('ignores an empty assignment as if it were absent', () => {
    const out = backendFromEnv('SUPABASE_URL=\nSUPABASE_ANON_KEY=k')
    expect(out.config.url).toBe('')
    expect(out.missing).toContain('SUPABASE_URL')
  })

  it('never reads the service role key, even as a fallback for a missing anon key', () => {
    // This is the important one. A desktop app holding service_role can read
    // and rewrite every row regardless of policy.
    const out = backendFromEnv([
      'SUPABASE_URL=https://p.supabase.co',
      'SUPABASE_SECRET_KEY=sb_secret_DANGEROUS',
      'SUPABASE_SERVICE_ROLE_KEY=also_DANGEROUS',
    ].join('\n'))
    expect(out.config.anonKey).toBe('')
    expect(JSON.stringify(out)).not.toContain('DANGEROUS')
    expect(out.missing).toContain('SUPABASE_PUBLISHABLE_KEY')
  })
})

describe('refusedKeysIn', () => {
  it('names a service role key that was present and skipped', () => {
    expect(refusedKeysIn('SUPABASE_SECRET_KEY=x')).toEqual(['SUPABASE_SECRET_KEY'])
  })

  it('is empty when the file has none', () => {
    expect(refusedKeysIn('SUPABASE_URL=https://p.supabase.co')).toEqual([])
  })

  it('reports names only, never values', () => {
    expect(refusedKeysIn('SUPABASE_SERVICE_ROLE_KEY=secretvalue').join()).not.toContain('secretvalue')
  })
})
