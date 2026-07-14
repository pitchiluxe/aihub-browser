import { safeStorage } from 'electron'
import os from 'os'
import fs from 'fs'
import { join } from 'path'

// Persisted OAuth session. Contains ONLY a refresh token (never a password,
// never an access token), the client the token belongs to, the account email,
// and the scopes Google actually granted. Written encrypted at rest via
// Electron safeStorage, which is backed by the OS keychain (DPAPI on Windows,
// Keychain on macOS, libsecret/kwallet on Linux).
export interface GoogleSession {
  clientId: string
  clientSecret: string
  refreshToken: string
  email: string
  grantedScopes: string[]
}

const DIR = join(os.homedir(), '.aihub-browser')
const FILE = join(DIR, 'google-session.enc')
// Legacy Gmail-only token file from the previous single-API implementation.
const LEGACY_FILE = join(DIR, 'gmail-tokens.enc')

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function saveSession(s: GoogleSession): void {
  if (!isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable — refusing to store tokens in plaintext')
  }
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(FILE, safeStorage.encryptString(JSON.stringify(s)))
}

export function loadSession(): GoogleSession | null {
  try {
    if (!isEncryptionAvailable()) return null
    if (fs.existsSync(FILE)) {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(FILE))) as GoogleSession
    }
    // One-time migration from the old Gmail-only store so already-connected
    // users don't have to re-authenticate after this refactor.
    if (fs.existsSync(LEGACY_FILE)) {
      const old = JSON.parse(safeStorage.decryptString(fs.readFileSync(LEGACY_FILE)))
      if (old?.refreshToken) {
        const migrated: GoogleSession = {
          clientId: old.clientId || '',
          clientSecret: old.clientSecret || '',
          refreshToken: old.refreshToken,
          email: old.email || '',
          grantedScopes: [
            'openid', 'email', 'profile',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
          ],
        }
        saveSession(migrated)
        try { fs.unlinkSync(LEGACY_FILE) } catch { /* best effort */ }
        return migrated
      }
    }
    return null
  } catch {
    return null
  }
}

export function clearSession(): void {
  try { fs.unlinkSync(FILE) } catch { /* already gone */ }
}

// Update stored client credentials without discarding an existing refresh token
// when the client hasn't changed (used by the Settings "credentials" field).
export function setStoredCredentials(clientId: string, clientSecret: string): void {
  const existing = loadSession()
  const sameClient = existing?.clientId === clientId
  saveSession({
    clientId,
    clientSecret,
    refreshToken: sameClient ? existing?.refreshToken || '' : '',
    email: sameClient ? existing?.email || '' : '',
    grantedScopes: sameClient ? existing?.grantedScopes || [] : [],
  })
}
