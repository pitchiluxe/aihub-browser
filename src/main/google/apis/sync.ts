import { apiRequest } from './rest'
import { API_BASES } from '../auth/config'
import type { EncryptedBlob } from '../../syncCrypto'

/**
 * Encrypted settings/bookmark sync through the user's own Google Drive.
 *
 * Same hidden `appDataFolder` the handoff feature uses — invisible in the
 * user's Drive UI, unreadable by other apps — but with one extra guarantee:
 * what gets uploaded here is already ciphertext (see syncCrypto). Google
 * stores a blob it cannot read, and a passphrase the user knows is required to
 * turn it back into bookmarks. Losing that passphrase means losing the backup;
 * that is the deal end-to-end encryption makes, and it is the right one for a
 * file holding every site a person visits.
 */

const base = API_BASES.drive
const upload = 'https://www.googleapis.com/upload/drive/v3/files'
const FILE_NAME = 'aihub-sync.json'

export interface SyncEnvelope {
  blob: EncryptedBlob
  /** Plaintext metadata — safe to leave readable, useful for conflict checks. */
  updatedAt: number
  device: string
}

async function findFileId(): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name)',
    q: `name = '${FILE_NAME}'`,
    pageSize: '1',
  })
  const res = await apiRequest('GET', `${base}/files?${params.toString()}`)
  return res.files?.[0]?.id ?? null
}

export async function pushSync(envelope: SyncEnvelope): Promise<{ ok: true }> {
  let id = await findFileId()
  if (!id) {
    const created = await apiRequest('POST', `${base}/files`, {
      name: FILE_NAME,
      parents: ['appDataFolder'],
    })
    id = created.id
  }
  await apiRequest('PATCH', `${upload}/${id}?uploadType=media`, envelope)
  return { ok: true }
}

export async function pullSync(): Promise<SyncEnvelope | null> {
  const id = await findFileId()
  if (!id) return null
  const data = await apiRequest('GET', `${base}/files/${id}?alt=media`)
  if (!data?.blob?.data) return null
  return data as SyncEnvelope
}

export async function clearSync(): Promise<{ ok: true }> {
  const id = await findFileId()
  if (id) await apiRequest('DELETE', `${base}/files/${id}`)
  return { ok: true }
}
