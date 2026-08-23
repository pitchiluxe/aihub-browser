import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'

/**
 * End-to-end test of the Community IPC surface.
 *
 * The store tests cover the rules and the identity tests cover the crypto;
 * this covers the wiring between them — the part where a real handler reads a
 * real file, signs with a real key, and hands the renderer a real answer.
 *
 * Electron is mocked rather than launched: `app.getPath` points at a temp
 * directory, `safeStorage` stands in for the OS keychain, and `ipcMain.handle`
 * records the handlers so the test can call them exactly as the renderer does.
 * That leaves the module under test unmodified, which is the point — a test
 * that needs production code to know it is being tested proves less.
 */

const handlers = new Map<string, (...args: any[]) => any>()
const sent: { channel: string; payload: unknown }[] = []
let userDataDir = ''

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

/** Call a handler the way the renderer would, skipping the IpcMainInvokeEvent. */
const invoke = (channel: string, ...args: any[]) => handlers.get(channel)!({} as any, ...args)

beforeEach(async () => {
  handlers.clear()
  sent.length = 0
  userDataDir = fs.mkdtempSync(join(os.tmpdir(), 'aihub-community-'))
  // Fresh module per test: the stores are module-level singletons, so a reset
  // is what gives each test its own empty profile.
  vi.resetModules()
  const { registerCommunityIpc } = await import('./index')
  registerCommunityIpc()
})

describe('community IPC', () => {
  it('registers every channel the preload bridge exposes', () => {
    for (const channel of [
      'community:status', 'community:channels', 'community:join', 'community:messages',
      'community:post', 'community:react', 'community:block', 'community:report',
      'community:resetIdentity', 'community:exportKey', 'community:importKey',
    ]) {
      expect(handlers.has(channel), `missing handler: ${channel}`).toBe(true)
    }
  })

  it('starts unregistered and offers the channel list anyway', async () => {
    const status = await invoke('community:status')
    expect(status.state).toBe('unregistered')
    // Honesty about the backend is part of the contract, not a UI detail.
    expect(status.network).toBe('local')

    const channels = await invoke('community:channels')
    expect(channels.map((c: any) => c.slug)).toContain('bible-study')
  })

  it('joins, persists the identity, and reports ready', async () => {
    const out = await invoke('community:join', 'Grace')
    expect(out.ok).toBe(true)
    expect(out.status.state).toBe('ready')
    expect(out.status.member.handle).toBe('Grace')

    const status = await invoke('community:status')
    expect(status.state).toBe('ready')
    expect(status.member.id).toBe(out.status.member.id)
  })

  it('rejects a bad handle before creating anything', async () => {
    const out = await invoke('community:join', 'ad')
    expect(out.ok).toBe(false)
    expect((await invoke('community:status')).state).toBe('unregistered')
  })

  // The private key is the one thing that must never cross the boundary.
  it('never returns key material from status or messages', async () => {
    await invoke('community:join', 'Grace')
    await invoke('community:post', { channel: 'bible-study', kind: 'text', body: 'hello' })

    const blob = JSON.stringify([
      await invoke('community:status'),
      await invoke('community:messages', 'bible-study'),
      await invoke('community:channels'),
    ])
    expect(blob).not.toContain('PRIVATE KEY')
    expect(blob).not.toContain('KEYCHAIN:')
  })

  it('encrypts the key on disk rather than writing the PEM', async () => {
    await invoke('community:join', 'Grace')
    const raw = fs.readFileSync(join(userDataDir, 'community-identity.json'), 'utf8')
    expect(raw).not.toContain('BEGIN PRIVATE KEY')
    expect(raw).toContain('enc:v1:')
    expect(JSON.parse(raw).insecureStorage).toBe(false)
  })

  it('posts a message and reads it back', async () => {
    await invoke('community:join', 'Grace')
    const posted = await invoke('community:post', {
      channel: 'bible-study', kind: 'text', body: 'Peace to you',
    })
    expect(posted.ok).toBe(true)

    const messages = await invoke('community:messages', 'bible-study')
    expect(messages).toHaveLength(1)
    expect(messages[0].body).toBe('Peace to you')
    expect(messages[0].authorHandle).toBe('Grace')
  })

  it('pushes the new message to open windows instead of making them poll', async () => {
    await invoke('community:join', 'Grace')
    sent.length = 0
    await invoke('community:post', { channel: 'sports', kind: 'text', body: 'what a match' })

    const push = sent.find(s => s.channel === 'community:message')
    expect(push).toBeTruthy()
    expect((push!.payload as any).channel).toBe('sports')
  })

  it('refuses to post before joining', async () => {
    const out = await invoke('community:post', { channel: 'sports', kind: 'text', body: 'hi' })
    expect(out.ok).toBe(false)
  })

  // The composer only shows buttons a channel accepts, but the composer is
  // renderer code and this handler must not trust it.
  it('enforces channel rules even when the renderer asks for something else', async () => {
    await invoke('community:join', 'Grace')
    const out = await invoke('community:post', {
      channel: 'sports', kind: 'prayer', body: 'pray for my team',
    })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/does not accept/)
  })

  it('hides an anonymous prayer request author from other readers', async () => {
    await invoke('community:join', 'Grace')
    const out = await invoke('community:post', {
      channel: 'bible-study', kind: 'prayer', body: 'please pray', anonymous: true,
    })
    expect(out.ok).toBe(true)
    // The author still sees their own name on their own post.
    expect(out.message.authorHandle).toBe('Grace')
    // What went out to every other window does not carry it.
    const push = sent.find(s => s.channel === 'community:message')
    expect((push!.payload as any).message.authorHandle).toBe('Anonymous')
  })

  it('survives a clean restart with the same identity and history', async () => {
    const first = await invoke('community:join', 'Grace')
    await invoke('community:post', { channel: 'bible-study', kind: 'text', body: 'before restart' })

    // What Electron does on the way out. It only reaches stores created with
    // createManagedJsonStore, which is exactly why community uses those.
    const { flushAllJsonStores } = await import('../jsonStore')
    flushAllJsonStores()

    // Same userData directory, fresh module registry: a relaunch.
    handlers.clear()
    vi.resetModules()
    const { registerCommunityIpc } = await import('./index')
    registerCommunityIpc()

    const status = await invoke('community:status')
    expect(status.state).toBe('ready')
    expect(status.member.id).toBe(first.status.member.id)
    expect(await invoke('community:messages', 'bible-study')).toHaveLength(1)
  })

  it('exports and re-imports an identity, keeping the same member', async () => {
    const joined = await invoke('community:join', 'Grace')
    const exported = await invoke('community:exportKey')
    expect(exported.ok).toBe(true)

    await invoke('community:resetIdentity')
    expect((await invoke('community:status')).state).toBe('unregistered')

    const imported = await invoke('community:importKey', exported.value)
    expect(imported.ok).toBe(true)
    expect(imported.status.member.id).toBe(joined.status.member.id)
  })

  // The identity is flushed the moment it changes rather than on the debounce,
  // so a crash cannot cost someone their signing key — which is their account,
  // with no recovery path if it is lost.
  it('keeps the identity across a CRASH, with no chance to flush', async () => {
    const first = await invoke('community:join', 'Grace')

    handlers.clear()
    vi.resetModules()
    const { registerCommunityIpc } = await import('./index')
    registerCommunityIpc()

    const status = await invoke('community:status')
    expect(status.state).toBe('ready')
    expect(status.member.id).toBe(first.status.member.id)
  })

  it('rejects a corrupt identity key without throwing', async () => {
    const out = await invoke('community:importKey', 'not-a-key')
    expect(out.ok).toBe(false)
    expect(out.error).toBeTruthy()
  })

  it('records a report and refuses one from someone who has not joined', async () => {
    const before = await invoke('community:report', 'anything', 'abuse')
    expect(before.ok).toBe(false)

    await invoke('community:join', 'Grace')
    const posted = await invoke('community:post', {
      channel: 'sports', kind: 'text', body: 'something',
    })
    expect((await invoke('community:report', posted.message.id, 'spam')).ok).toBe(true)
  })

  // Blocking yourself would silently empty your own room, so the guard in the
  // store refuses it. Only one identity exists on a local-only backend, so
  // that guard is the only blocking behaviour reachable from here; blocking
  // someone else is covered in store.test.ts, which can hold two members.
  it('refuses to let a member block themselves out of their own room', async () => {
    await invoke('community:join', 'Grace')
    const posted = await invoke('community:post', {
      channel: 'sports', kind: 'text', body: 'mine',
    })
    expect(await invoke('community:messages', 'sports')).toHaveLength(1)

    const out = await invoke('community:block', posted.message.authorId, true)
    expect(out.ok).toBe(true)
    expect(await invoke('community:messages', 'sports')).toHaveLength(1)
  })
})
