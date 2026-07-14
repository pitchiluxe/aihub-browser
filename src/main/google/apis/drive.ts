import { apiRequest } from './rest'
import { API_BASES } from '../auth/config'

// Google Drive API module (read-only). Mirrors the Gmail module's shape so new
// Google products are added by copying this pattern.
export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size?: string
  iconLink?: string
  webViewLink?: string
}

const base = API_BASES.drive

export async function listFiles(q?: string, pageToken?: string): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    pageSize: '30',
    orderBy: 'modifiedTime desc',
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,iconLink,webViewLink)',
    spaces: 'drive',
  })
  // Free-text search maps to Drive's fullText query; empty lists recent files.
  if (q) params.set('q', `name contains '${q.replace(/'/g, "\\'")}' or fullText contains '${q.replace(/'/g, "\\'")}'`)
  if (pageToken) params.set('pageToken', pageToken)
  const res = await apiRequest('GET', `${base}/files?${params.toString()}`)
  return { files: res.files || [], nextPageToken: res.nextPageToken }
}

export async function getAbout(): Promise<{ user?: any; storageQuota?: any }> {
  return apiRequest('GET', `${base}/about?fields=user,storageQuota`)
}
