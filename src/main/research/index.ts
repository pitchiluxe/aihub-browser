import { ipcMain } from 'electron'
import { captureResearchSource, type CaptureWebContents } from './capture'
import { createResearchRepository } from './store'
import { validateProject } from '../../shared/research/validation'
import type { CapturedSource, ResearchResult } from '../../shared/research/types'
export interface ResearchWindow { id: number; incognito: boolean; views: Map<string, { webContents: CaptureWebContents }> }
export function registerResearchIpc(options: { appDir: string; resolveWindow(event: Electron.IpcMainInvokeEvent): ResearchWindow | undefined }) {
  const repo = createResearchRepository(options.appDir)
  const captures = new Map<number, Map<string, CapturedSource>>()
  const released = new Set<number>()
  function handler(channel: string, fn: (owner: ResearchWindow, arg: unknown, expected?: unknown) => unknown) {
    ipcMain.handle(channel, async (event, arg, expected) => {
      try { const owner = options.resolveWindow(event); if (!owner) throw Error('Research window unavailable.'); return await fn(owner, arg, expected) }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Research request failed.' } }
    })
  }
  handler('research:list', owner => ({ ok: true, value: repo.list(owner) }))
  handler('research:save', (owner, raw, expected) => {
    const validated = validateProject(raw)
    if (!validated.ok) return validated
    const stored = repo.list(owner).flatMap(p => p.sources)
    for (const source of validated.value.sources) {
      if (source.provenance !== 'captured') continue
      const known = captures.get(owner.id)?.get(source.id) || stored.find(s => s.id === source.id)
      if (!known || JSON.stringify(known) !== JSON.stringify(source)) return { ok: false, error: 'Capture this source in the current window before saving it.' }
    }
    if (expected !== undefined && expected !== null && (typeof expected !== 'string' || expected.length > 32 || !Number.isFinite(Date.parse(expected)))) return { ok: false, error: 'Invalid project revision.' }
    return repo.save(owner, validated.value, expected as string | null | undefined)
  })
  handler('research:remove', (owner, id) => { if (typeof id !== 'string' || id.length > 100) throw Error('Invalid project.'); return repo.remove(owner, id) })
  handler('research:capture', async (owner, id): Promise<ResearchResult<CapturedSource>> => {
    if (typeof id !== 'string') return { ok: false, error: 'Choose a loaded web tab.' }
    const view = owner.views.get(id)
    if (!view) return { ok: false, error: 'Choose a loaded tab in this window.' }
    const result = await captureResearchSource(view.webContents)
    if (released.has(owner.id)) return { ok: false, error: 'Research window closed during capture.' }
    if (result.ok) {
      const map = captures.get(owner.id) || new Map<string, CapturedSource>()
      if (map.size >= 200) map.delete(map.keys().next().value!)
      map.set(result.value.id, result.value); captures.set(owner.id, map)
    }
    return result
  })
  return { release(windowId: number) { released.add(windowId); repo.release(windowId); captures.delete(windowId) } }
}
