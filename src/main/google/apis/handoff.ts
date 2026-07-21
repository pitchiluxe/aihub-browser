import { apiRequest } from './rest'
import { API_BASES } from '../auth/config'

// Cross-device handoff via the user's own Google Drive.
//
// The session is written to a single JSON file inside Drive's special
// `appDataFolder` — a hidden, per-application space that is invisible in the
// user's Drive UI and unreadable by any other app. No third-party relay, no
// server we run, nothing leaves the user's own account. Any device signed into
// the same Google account and running AIHub can read it straight back.

const base = API_BASES.drive
const upload = 'https://www.googleapis.com/upload/drive/v3/files'
const FILE_NAME = 'aihub-handoff.json'

export interface HandoffTab { url: string; title: string }
export interface HandoffPayload {
  tabs: HandoffTab[]
  device: string      // human label of the sending machine
  sentAt: number      // epoch ms
}

// The one handoff file's id (if it exists yet). appDataFolder is searched with
// spaces=appDataFolder — the file never appears in the user's normal Drive.
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

// Publish the current session. Creates the file the first time, overwrites it
// after. The metadata create and the media upload are two calls because the
// shared REST helper speaks application/json, not multipart.
export async function pushHandoff(payload: HandoffPayload): Promise<{ ok: true }> {
  let id = await findFileId()
  if (!id) {
    const created = await apiRequest('POST', `${base}/files`, {
      name: FILE_NAME,
      parents: ['appDataFolder'],
    })
    id = created.id
  }
  await apiRequest('PATCH', `${upload}/${id}?uploadType=media`, payload)
  return { ok: true }
}

// Read the most recently published session, or null if none exists.
export async function pullHandoff(): Promise<HandoffPayload | null> {
  const id = await findFileId()
  if (!id) return null
  const data = await apiRequest('GET', `${base}/files/${id}?alt=media`)
  if (!data || !Array.isArray(data.tabs)) return null
  return data as HandoffPayload
}

// Discard the published session (e.g. after the other device has picked it up).
export async function clearHandoff(): Promise<{ ok: true }> {
  const id = await findFileId()
  if (id) await apiRequest('DELETE', `${base}/files/${id}`)
  return { ok: true }
}
