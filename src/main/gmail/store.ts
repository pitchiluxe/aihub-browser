import { safeStorage } from 'electron'
import os from 'os'
import fs from 'fs'
import { join } from 'path'

const FILE = join(os.homedir(), '.aihub-browser', 'gmail-tokens.enc')

export interface StoredTokens { email: string; refreshToken: string; clientId: string; clientSecret: string }

export function isEncryptionAvailable(): boolean {
  try { return safeStorage.isEncryptionAvailable() } catch { return false }
}

export function saveTokens(t: StoredTokens): void {
  if (!isEncryptionAvailable()) throw new Error('OS secure storage unavailable — refusing to store tokens in plaintext')
  const enc = safeStorage.encryptString(JSON.stringify(t))
  fs.mkdirSync(join(os.homedir(), '.aihub-browser'), { recursive: true })
  fs.writeFileSync(FILE, enc)
}

export function loadTokens(): StoredTokens | null {
  try {
    if (!fs.existsSync(FILE) || !isEncryptionAvailable()) return null
    const buf = fs.readFileSync(FILE)
    return JSON.parse(safeStorage.decryptString(buf)) as StoredTokens
  } catch { return null }
}

export function clearTokens(): void {
  try { fs.unlinkSync(FILE) } catch {}
}
