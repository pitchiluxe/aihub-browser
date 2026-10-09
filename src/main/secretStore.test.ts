import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { SECRET_SETTING_KEYS, stripSecrets, createSecretStore, type Cipher } from './secretStore'
import { portableSettings } from './backup'
import { syncableSettings } from './syncCrypto'

// Reversible stand-in for OS encryption that is visibly NOT plaintext on disk.
const fakeCipher = (available = true): Cipher => ({
  available: () => available,
  encrypt: s => Buffer.from(Buffer.from(s, 'utf-8').toString('base64').split('').reverse().join(''), 'utf-8'),
  decrypt: b => Buffer.from(b.toString('utf-8').split('').reverse().join(''), 'base64').toString('utf-8'),
})

describe('stripSecrets', () => {
  it('separates every API key from the rest of the settings', () => {
    const { clean, secrets } = stripSecrets({ theme: 'dark', openrouterKey: 'sk-or-1', claudeKey: 'sk-ant-2', chatGptKey: '' })
    expect(clean).toEqual({ theme: 'dark' })
    expect(secrets).toEqual({ openrouterKey: 'sk-or-1', claudeKey: 'sk-ant-2' })
  })
})

describe('createSecretStore', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'aihub-secrets-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('round-trips keys and never writes them in plaintext', () => {
    const file = join(dir, 'secrets.enc')
    const store = createSecretStore(file, fakeCipher())
    expect(store.save({ openrouterKey: 'sk-or-v1-abcdef' })).toBe(true)
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('sk-or-v1-abcdef')
    expect(store.load()).toEqual({ openrouterKey: 'sk-or-v1-abcdef' })
  })

  it('returns nothing for a missing or corrupt file instead of throwing', () => {
    const file = join(dir, 'secrets.enc')
    expect(createSecretStore(file, fakeCipher()).load()).toEqual({})
    fs.writeFileSync(file, 'garbage')
    expect(createSecretStore(file, fakeCipher()).load()).toEqual({})
  })

  it('refuses to save when OS encryption is unavailable', () => {
    const file = join(dir, 'secrets.enc')
    expect(createSecretStore(file, fakeCipher(false)).save({ claudeKey: 'x' })).toBe(false)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('deletes the file when every key is cleared', () => {
    const file = join(dir, 'secrets.enc')
    const store = createSecretStore(file, fakeCipher())
    store.save({ claudeKey: 'x' })
    store.save({})
    expect(fs.existsSync(file)).toBe(false)
  })
})

describe('secrets never leave the machine', () => {
  const settings = { theme: 'dark', openrouterKey: 'a', claudeKey: 'b', chatGptKey: 'c' }
  it.each(SECRET_SETTING_KEYS)('%s is excluded from backups and sync', key => {
    expect(portableSettings(settings)).not.toHaveProperty(key)
    expect(syncableSettings(settings)).not.toHaveProperty(key)
  })
})
