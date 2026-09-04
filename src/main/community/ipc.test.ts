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
    // The room opens with a welcome from the guide, so count what Grace wrote
    // rather than what the channel holds.
    const mine = messages.filter((m: any) => m.authorHandle === 'Grace')
    expect(mine).toHaveLength(1)
    expect(mine[0].body).toBe('Peace to you')
    expect(messages.some((m: any) => m.isWelcome)).toBe(true)
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
    expect((await invoke('community:messages', 'bible-study'))
      .filter((m: any) => !m.isWelcome)).toHaveLength(1)
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

  describe('unique handles', () => {
    it('reports a free name as available', async () => {
      const out = await invoke('community:handleAvailable', 'Grace')
      expect(out).toMatchObject({ ok: true, available: true })
    })

    it('reports a taken name and offers alternatives', async () => {
      await invoke('community:join', 'Grace')
      // A second device asking about the same name. This one has its own
      // identity, so the "except me" allowance does not apply.
      const state = JSON.parse(fs.readFileSync(join(userDataDir, 'community-data.json'), 'utf8'))
      const otherId = 'someone-else'
      state.members[otherId] = {
        id: otherId, handle: 'Mercy', handleKey: 'mercy',
        avatarSeed: otherId, createdAt: Date.now(),
      }
      fs.writeFileSync(join(userDataDir, 'community-data.json'), JSON.stringify(state), 'utf8')

      handlers.clear()
      vi.resetModules()
      const { registerCommunityIpc } = await import('./index')
      registerCommunityIpc()

      const out = await invoke('community:handleAvailable', 'Mercy')
      expect(out.available).toBe(false)
      expect(out.suggestions).toContain('Mercy2')
    })

    it('lets a member keep their own name across a re-join', async () => {
      await invoke('community:join', 'Grace')
      // Same device, same name: this must not collide with itself.
      const again = await invoke('community:join', 'Grace')
      expect(again.ok).toBe(true)
      expect((await invoke('community:handleAvailable', 'grace')).available).toBe(true)
    })

    it('stores the folded key alongside the display name', async () => {
      const out = await invoke('community:join', 'Grace Mwangi')
      expect(out.status.member.handle).toBe('Grace Mwangi')
      expect(out.status.member.handleKey).toBe('grace mwangi')
    })
  })

  describe('moderation', () => {
    const dataPath = () => join(userDataDir, 'community-data.json')
    /**
     * The store writes on a debounce, so reading the file straight after an
     * IPC call sees the state from before it. Flush first -- and resolve
     * jsonStore from the live module graph, because vi.resetModules() hands
     * the reloaded ./index a fresh registry that a stale import cannot reach.
     */
    const readData = async () => {
      const { flushAllJsonStores } = await import('../jsonStore')
      flushAllJsonStores()
      return JSON.parse(fs.readFileSync(dataPath(), 'utf8'))
    }
    const writeData = (d: unknown) => fs.writeFileSync(dataPath(), JSON.stringify(d), 'utf8')

    /** Reload the module so it re-reads state we edited underneath it. */
    async function reload() {
      handlers.clear()
      vi.resetModules()
      const { registerCommunityIpc } = await import('./index')
      registerCommunityIpc()
    }

    /** Join, then grant this install's member the moderator flag. */
    async function joinAsModerator() {
      const out = await invoke('community:join', 'Grace')
      const id = out.status.member.id
      const data = await readData()
      data.members[id].isAdmin = true
      writeData(data)
      await reload()
      return id
    }

    /** A second member with one message, reported to the hide threshold. */
    async function plantReportedMessage(authorId = 'other') {
      const data = await readData()
      data.members[authorId] = {
        id: authorId, handle: 'Loud', handleKey: 'loud',
        avatarSeed: authorId, createdAt: Date.now() - 10_000,
      }
      data.messages.push({
        id: 'msg-1', channel: 'sports', authorId, authorHandle: 'Loud',
        authorSeed: authorId, kind: 'text', body: 'contested', createdAt: Date.now(),
      })
      data.reports = [
        { id: 'r1', messageId: 'msg-1', reporterId: 'x', reason: 'a', createdAt: Date.now() },
        { id: 'r2', messageId: 'msg-1', reporterId: 'y', reason: 'b', createdAt: Date.now() },
      ]
      writeData(data)
      await reload()
    }

    // Local-only, this install is the whole community, so the person who
    // joins owns it. Otherwise the Reports queue can never be opened by
    // anyone and the Report button leads nowhere.
    it('makes the first member of an install its moderator', async () => {
      await invoke('community:join', 'Grace')
      expect(await invoke('community:moderatorStatus')).toMatchObject({ isModerator: true })
    })

    it('does not hand moderation to everyone who joins afterwards', async () => {
      await invoke('community:join', 'Grace')
      const data = await readData()
      // A second member arriving into state that already has an owner.
      data.members['later'] = {
        id: 'later', handle: 'Later', handleKey: 'later',
        avatarSeed: 'later', createdAt: Date.now(),
      }
      writeData(data)
      await reload()
      expect((await readData()).members['later'].isAdmin).toBeUndefined()
    })

    it('recognises a moderator', async () => {
      await joinAsModerator()
      expect(await invoke('community:moderatorStatus')).toMatchObject({ isModerator: true })
    })

    // The guide's switch is drawn when moderatorStatus says yes, and its own
    // handler used to ask a different question — the raw isAdmin flag. The two
    // disagreed on any install where that flag was never set, which made the
    // switch a control that could be seen, focused and clicked while every
    // press was refused. Whatever decides to draw it must be what decides to
    // obey it.
    // Asserted on what the handler returns rather than by asking guide:status
    // afterwards: that call probes Ollama over the network, which makes the
    // test depend on whether a model server happens to be running.
    it('lets whoever may moderate configure the guide', async () => {
      await invoke('community:join', 'Grace')
      expect((await invoke('community:moderatorStatus')).isModerator).toBe(true)

      const out = await invoke('community:guide:set', { model: 'llama3.2:3b' })
      expect(out.ok).toBe(true)
      expect(out.model).toBe('llama3.2:3b')
    })

    it('refuses the guide to somebody who may not moderate', async () => {
      const joined = await invoke('community:join', 'Grace')
      const me = joined.status.member.id
      // Hand the room to somebody else so this caller is an ordinary member.
      const data = await readData()
      data.members['other'] = {
        id: 'other', handle: 'Other', handleKey: 'other',
        avatarSeed: 'other', createdAt: Date.now() - 1000,
      }
      data.ownership = { memberId: 'other', email: 'o@e.test', verifiedAt: Date.now() }
      delete data.members[me].isAdmin
      writeData(data)
      await reload()

      expect((await invoke('community:moderatorStatus')).isModerator).toBe(false)
      const out = await invoke('community:guide:set', { model: 'llama3.2:3b' })
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/owner/i)
    })

    // The renderer decides which buttons to draw. It does not decide who may
    // press them, so the gate has to hold when the call arrives anyway.
    it('refuses the queue and every action to a non-moderator', async () => {
      const out = await invoke('community:join', 'Grace')
      const me = out.status.member.id
      await plantReportedMessage()

      // The first joiner owns a local install, so take the flag away to get a
      // genuine ordinary member. Without this the test would assert nothing:
      // the caller would be a moderator and the calls would rightly succeed.
      const stripped = await readData()
      delete stripped.members[me].isAdmin
      writeData(stripped)
      await reload()
      expect((await invoke('community:moderatorStatus')).isModerator).toBe(false)

      expect((await invoke('community:reports')).ok).toBe(false)
      expect((await invoke('community:resolveReport', { messageId: 'msg-1', action: 'remove' })).ok)
        .toBe(false)
      expect((await invoke('community:setBanned', { memberId: 'other', banned: true })).ok)
        .toBe(false)

      const data = await readData()
      expect(data.messages[0].deletedAt).toBeUndefined()
      expect(data.members['other'].bannedAt).toBeUndefined()
    })

    it('gives a moderator the queue, worst first', async () => {
      await joinAsModerator()
      await plantReportedMessage()
      const out = await invoke('community:reports')
      expect(out.ok).toBe(true)
      expect(out.queue).toHaveLength(1)
      expect(out.queue[0].count).toBe(2)
      expect(out.queue[0].message.id).toBe('msg-1')
    })

    it('keeps a message and clears it from the queue', async () => {
      await joinAsModerator()
      await plantReportedMessage()
      expect((await invoke('community:resolveReport', { messageId: 'msg-1', action: 'keep' })).ok)
        .toBe(true)
      expect((await invoke('community:reports')).queue).toHaveLength(0)
      expect(planted(await readData()).deletedAt).toBeUndefined()
    })

    /** The reported message, by id. Never by index: every channel opens with
     *  a welcome from the guide, so index 0 is not the message under test. */
    const planted = (data: any) => data.messages.find((m: any) => m.id === 'msg-1')

    it('removes a message and bans on request', async () => {
      await joinAsModerator()
      await plantReportedMessage()
      expect((await invoke('community:resolveReport',
        { messageId: 'msg-1', action: 'ban', reason: 'harassment' })).ok).toBe(true)

      const data = await readData()
      expect(planted(data).deletedAt).toBeTruthy()
      expect(data.members['other'].bannedAt).toBeTruthy()
      expect(data.members['other'].banReason).toBe('harassment')
    })

    it('unbans', async () => {
      const me = await joinAsModerator()
      await plantReportedMessage()
      await invoke('community:setBanned', { memberId: 'other', banned: true, reason: 'spam' })
      expect((await readData()).members['other'].bannedAt).toBeTruthy()
      await invoke('community:setBanned', { memberId: 'other', banned: false })
      expect((await readData()).members['other'].bannedAt).toBeUndefined()
      expect(me).toBeTruthy()
    })

    it('will not let a moderator ban themselves', async () => {
      const me = await joinAsModerator()
      const out = await invoke('community:setBanned', { memberId: me, banned: true })
      expect(out.ok).toBe(false)
      expect((await readData()).members[me].bannedAt).toBeUndefined()
    })
  })

  describe('delete my data', () => {
    it('erases the member, their posts, and the device identity', async () => {
      const out = await invoke('community:join', 'Grace')
      const id = out.status.member.id
      await invoke('community:post', { channel: 'sports', kind: 'text', body: 'hello' })

      const deleted = await invoke('community:deleteMyData')
      expect(deleted.ok).toBe(true)
      expect(deleted.removed.messages).toBe(1)

      const { flushAllJsonStores } = await import('../jsonStore')
      flushAllJsonStores()
      const data = JSON.parse(fs.readFileSync(join(userDataDir, 'community-data.json'), 'utf8'))
      expect(data.members[id]).toBeUndefined()
      expect(data.messages.filter((m: any) => m.authorId === id)).toHaveLength(0)
      // The guide's welcomes belong to the community, not to the member who
      // left — erasing them would empty every room for everyone else.
      expect(data.messages.every((m: any) => m.isWelcome)).toBe(true)

      // Back to onboarding: the key is gone, so there is no identity to resume.
      expect((await invoke('community:status')).state).toBe('unregistered')
    })

    it('refuses when there is nothing to delete', async () => {
      expect((await invoke('community:deleteMyData')).ok).toBe(false)
    })
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
    const own = async () => (await invoke('community:messages', 'sports'))
      .filter((m: any) => !m.isWelcome)
    expect(await own()).toHaveLength(1)

    const out = await invoke('community:block', posted.message.authorId, true)
    expect(out.ok).toBe(true)
    expect(await own()).toHaveLength(1)
  })
})
