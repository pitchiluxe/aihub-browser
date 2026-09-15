import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'

/**
 * The authorization boundary, tested where an attacker would actually stand.
 *
 * The renderer's permission checks decide what to draw. They are not security —
 * anyone can open DevTools and call `window.api.community.createChannel(...)`
 * directly, which arrives here as a plain IPC invoke with no UI in front of it.
 * So the tests below call the handlers exactly that way and assert the main
 * process refuses, rather than asserting a button was hidden.
 */

const handlers = new Map<string, (...args: any[]) => any>()
const sent: { channel: string; payload: unknown }[] = []
let userDataDir = ''

/** Whatever the next connect()/status() should report. */
let googleEmail: string | null = null
let googleConfigured = true

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (p: string) => Buffer.from('KEYCHAIN:' + p, 'utf8'),
    decryptString: (c: Buffer) => c.toString('utf8').replace(/^KEYCHAIN:/, ''),
  },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
    }],
  },
}))

vi.mock('../google/auth', () => ({
  status: () => ({ connected: !!googleEmail, email: googleEmail, scopes: [], apis: [] }),
  connect: async () => googleConfigured
    ? (googleEmail ? { ok: true, email: googleEmail, scopes: [], apis: [] }
                   : { ok: false, error: 'Sign-in was cancelled.' })
    : { ok: false, error: 'No Google OAuth client configured. Add your Desktop client ID in Settings → Google.' },
}))

const invoke = (channel: string, ...args: any[]) => handlers.get(channel)!({} as any, ...args)

beforeEach(async () => {
  handlers.clear()
  sent.length = 0
  googleEmail = null
  googleConfigured = true
  userDataDir = fs.mkdtempSync(join(os.tmpdir(), 'aihub-community-admin-'))
  vi.resetModules()
  const { registerCommunityIpc } = await import('./index')
  registerCommunityIpc()
})

/** Join, so there is an identity behind the calls that follow. */
async function joinAs(handle = 'Erick') {
  const result = await invoke('community:join', handle)
  expect(result.ok).toBe(true)
  return result
}

async function becomeOwner() {
  await joinAs()
  googleEmail = 'erickomari243@gmail.com'
  const claimed = await invoke('community:claimOwnership')
  expect(claimed.ok).toBe(true)
}

describe('ownership over IPC', () => {
  it('claims ownership from a verified Google address', async () => {
    await becomeOwner()

    const status = await invoke('community:ownership')
    expect(status.isOwner).toBe(true)
    expect(status.email).toBe('erickomari243@gmail.com')
  })

  it('refuses a Google account that is not the owner', async () => {
    await joinAs()
    googleEmail = 'someone@else.com'

    const result = await invoke('community:claimOwnership')

    expect(result.ok).toBe(false)
    expect((await invoke('community:ownership')).isOwner).toBe(false)
  })

  it('says so plainly when Google sign-in is not configured', async () => {
    await joinAs()
    googleConfigured = false

    const result = await invoke('community:claimOwnership')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/client|configur/i)
  })

  it('never accepts an address handed in by the caller', async () => {
    await joinAs()

    // The whole point of verifying through Google: passing the owner's address
    // as an argument must achieve nothing, because the handler does not read it.
    const result = await invoke('community:claimOwnership', 'erickomari243@gmail.com')

    expect(result.ok).toBe(false)
    expect((await invoke('community:ownership')).isOwner).toBe(false)
  })
})

describe('channel management is refused to everyone but the owner', () => {
  it('refuses createChannel from a member who never claimed ownership', async () => {
    await joinAs()

    const result = await invoke('community:createChannel', { name: 'Mine' })

    expect(result.ok).toBe(false)
    const channels = await invoke('community:channels')
    expect(channels.some((c: any) => c.slug === 'mine')).toBe(false)
  })

  it('refuses updateChannel', async () => {
    await joinAs()
    const result = await invoke('community:updateChannel', 'general', { name: 'Hijacked' })

    expect(result.ok).toBe(false)
    const channels = await invoke('community:channels')
    expect(channels.find((c: any) => c.slug === 'general').name).toBe('general')
  })

  it('refuses deleteChannel', async () => {
    await joinAs()
    const result = await invoke('community:deleteChannel', 'bible-study')

    expect(result.ok).toBe(false)
    const channels = await invoke('community:channels')
    expect(channels.some((c: any) => c.slug === 'bible-study')).toBe(true)
  })

  it('refuses purgeChannel, so no amount of direct calling destroys messages', async () => {
    await joinAs()
    await invoke('community:post', { channel: 'general', kind: 'text', body: 'keep me' })

    await invoke('community:deleteChannel', 'general')
    const result = await invoke('community:purgeChannel', 'general', 'general')

    expect(result.ok).toBe(false)
    const messages = await invoke('community:messages', 'general')
    expect(messages.some((m: any) => m.body === 'keep me')).toBe(true)
  })

  it('refuses reorderChannels, createCategory and deleteCategory', async () => {
    await joinAs()

    expect((await invoke('community:reorderChannels',
      [{ slug: 'general', categoryId: 'community', position: 9 }])).ok).toBe(false)
    expect((await invoke('community:createCategory', 'Mine')).ok).toBe(false)
    expect((await invoke('community:deleteCategory', 'community')).ok).toBe(false)
  })

  it('refuses role management', async () => {
    await joinAs()

    expect((await invoke('community:createRole', { name: 'Boss', permissions: ['manage_channels'] })).ok).toBe(false)
    expect((await invoke('community:assignRole', 'anyone', 'owner')).ok).toBe(false)
  })

  it('refuses an unauthenticated caller outright', async () => {
    // No join at all — no identity, no permissions, nothing to appeal to.
    const result = await invoke('community:createChannel', { name: 'Mine' })
    expect(result.ok).toBe(false)
  })
})

describe('channel management works for the owner', () => {
  it('creates, renames, archives and restores a channel', async () => {
    await becomeOwner()

    expect((await invoke('community:createChannel', { name: 'Study Group' })).ok).toBe(true)
    let channels = await invoke('community:channels')
    expect(channels.some((c: any) => c.slug === 'study-group')).toBe(true)

    expect((await invoke('community:updateChannel', 'study-group', { name: 'Study' })).ok).toBe(true)
    channels = await invoke('community:channels')
    expect(channels.find((c: any) => c.slug === 'study-group').name).toBe('Study')

    expect((await invoke('community:deleteChannel', 'study-group')).ok).toBe(true)
    channels = await invoke('community:channels')
    expect(channels.some((c: any) => c.slug === 'study-group')).toBe(false)

    expect((await invoke('community:restoreChannel', 'study-group')).ok).toBe(true)
    channels = await invoke('community:channels')
    expect(channels.some((c: any) => c.slug === 'study-group')).toBe(true)
  })

  it('keeps the seven shipped channels and their messages through all of it', async () => {
    await becomeOwner()
    await invoke('community:post', { channel: 'bible-study', kind: 'text', body: 'an old message' })

    await invoke('community:createChannel', { name: 'Something New' })
    await invoke('community:deleteChannel', 'something-new')

    const channels = await invoke('community:channels')
    for (const slug of ['bible-study', 'developers', 'cybersecurity', 'traders',
                        'sports', 'entertainment', 'jobs']) {
      expect(channels.some((c: any) => c.slug === slug), slug).toBe(true)
    }
    const messages = await invoke('community:messages', 'bible-study')
    expect(messages.some((m: any) => m.body === 'an old message')).toBe(true)
  })

  it('writes every administrative action to an audit log the owner can read', async () => {
    await becomeOwner()
    await invoke('community:createChannel', { name: 'Audited' })

    const log = await invoke('community:auditLog')

    expect(log.ok).toBe(true)
    expect(log.entries.some((e: any) => e.action === 'channel.created' && e.targetId === 'audited')).toBe(true)
    expect(log.entries.some((e: any) => e.action === 'ownership.claimed')).toBe(true)
  })

  it('refuses the audit log to a member who is not a moderator', async () => {
    await joinAs()
    const log = await invoke('community:auditLog')
    expect(log.ok).toBe(false)
  })
})

describe('the community survives a restart', () => {
  it('keeps ownership, new channels and messages across a reload', async () => {
    await becomeOwner()
    await invoke('community:createChannel', { name: 'Persisted' })
    await invoke('community:post', { channel: 'persisted', kind: 'text', body: 'still here' })

    // Quit, then start again against the same profile directory.
    //
    // The flush matters and is not a shortcut: message writes are debounced by
    // 1.5s on purpose, and what makes that safe is app.on('before-quit')
    // calling flushAllJsonStores. Skipping it here would test a power cut, not
    // a restart — and would quietly hide whether the real quit path works.
    const { flushAllJsonStores } = await import('../jsonStore')
    flushAllJsonStores()

    handlers.clear()
    vi.resetModules()
    const { registerCommunityIpc } = await import('./index')
    registerCommunityIpc()

    expect((await invoke('community:ownership')).isOwner).toBe(true)
    const channels = await invoke('community:channels')
    expect(channels.some((c: any) => c.slug === 'persisted')).toBe(true)
    const messages = await invoke('community:messages', 'persisted')
    expect(messages.some((m: any) => m.body === 'still here')).toBe(true)
  })
})
