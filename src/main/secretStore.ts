// API keys, encrypted at rest.
//
// Settings live in data.json, which is plain JSON — readable by any process
// running as the user, and easy to copy by accident. Provider keys are split
// out of it on every save and written here instead, encrypted with Electron
// safeStorage (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on
// Linux). In memory they stay on `settings`, so every reader of
// `settings.openrouterKey` keeps working unchanged.
//
// The cipher is injected so the file format and migration are testable
// without Electron.

import fs from 'fs'

/** Settings fields that hold credentials. Also the backup/sync blocklist. */
export const SECRET_SETTING_KEYS = ['openrouterKey', 'claudeKey', 'chatGptKey'] as const
export type SecretKey = typeof SECRET_SETTING_KEYS[number]
export type Secrets = Partial<Record<SecretKey, string>>

export interface Cipher {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/** Split credentials out of a settings object. Empty values are dropped. */
export function stripSecrets<T extends Record<string, any>>(settings: T): { clean: Omit<T, SecretKey>; secrets: Secrets } {
  const clean: Record<string, any> = { ...settings }
  const secrets: Secrets = {}
  for (const key of SECRET_SETTING_KEYS) {
    const value = clean[key]
    delete clean[key]
    if (typeof value === 'string' && value) secrets[key] = value
  }
  return { clean: clean as Omit<T, SecretKey>, secrets }
}

export function createSecretStore(file: string, cipher: Cipher) {
  return {
    available: () => { try { return cipher.available() } catch { return false } },

    load(): Secrets {
      try {
        if (!cipher.available() || !fs.existsSync(file)) return {}
        const parsed = JSON.parse(cipher.decrypt(fs.readFileSync(file)))
        return parsed && typeof parsed === 'object' ? stripSecrets(parsed).secrets : {}
      } catch {
        return {} // unreadable (e.g. profile copied from another user/machine) — keys must be re-entered
      }
    },

    /** False when encryption is unavailable — the caller decides the fallback. */
    save(secrets: Secrets): boolean {
      try {
        if (!cipher.available()) return false
        const { secrets: nonEmpty } = stripSecrets(secrets)
        if (!Object.keys(nonEmpty).length) {
          try { fs.unlinkSync(file) } catch { /* nothing stored */ }
          return true
        }
        const tmp = `${file}.${process.pid}.tmp`
        fs.writeFileSync(tmp, cipher.encrypt(JSON.stringify(nonEmpty)))
        fs.renameSync(tmp, file)
        return true
      } catch {
        return false
      }
    },
  }
}
