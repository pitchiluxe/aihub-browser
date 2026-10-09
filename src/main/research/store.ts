import { join } from 'path'
import { createManagedJsonStore } from '../jsonStore'
import { validateProject } from '../../shared/research/validation'
import { RESEARCH_LIMITS as L, type ResearchProject, type ResearchResult } from '../../shared/research/types'
export interface ResearchOwner { id: number; incognito: boolean }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function createResearchRepository(appDir: string) {
  const normal = createManagedJsonStore<{ schemaVersion: 1; projects: ResearchProject[] }>(join(appDir, 'research-projects.json'), () => ({ schemaVersion: 1, projects: [] }))
  const privateProjects = new Map<number, ResearchProject[]>()
  function read(owner: ResearchOwner): ResearchProject[] {
    if (owner.incognito) return privateProjects.get(owner.id) || []
    const stored = normal.get()
    if (stored.schemaVersion !== 1 || !Array.isArray(stored.projects) || stored.projects.length > L.projects) throw Error('Research storage is invalid. Restore a backup before editing.')
    return stored.projects.map(p => { const result = validateProject(p); if (!result.ok) throw Error(result.error); return result.value })
  }
  function write(owner: ResearchOwner, projects: ResearchProject[]) {
    if (owner.incognito) privateProjects.set(owner.id, clone(projects))
    else normal.set({ schemaVersion: 1, projects: clone(projects) })
  }
  return {
    list(owner: ResearchOwner): ResearchProject[] { return clone(read(owner)) },
    getNormal(id: string): ResearchProject | undefined { const project = read({ id: -1, incognito: false }).find(p => p.id === id); return project ? clone(project) : undefined },
    save(owner: ResearchOwner, raw: unknown, expectedUpdatedAt: string | null = null): ResearchResult<ResearchProject> {
      const checked = validateProject(raw)
      if (!checked.ok) return checked
      try {
        const p = checked.value, projects = read(owner), previous = projects.find(x => x.id === p.id)
        if ((previous && previous.updatedAt !== expectedUpdatedAt) || (!previous && expectedUpdatedAt !== null)) throw Error('This project changed or was deleted in another window. Reload projects before editing it. Your unsaved draft is retained here.')
        if (!previous && projects.length >= L.projects) throw Error('You have twenty projects. Export or delete one before adding another.')
        const existingSources = projects.flatMap(p => p.sources)
        for (const s of p.sources) {
          const old = existingSources.find(x => x.id === s.id)
          if (old && JSON.stringify(old) !== JSON.stringify(s)) throw Error('Saved evidence cannot be changed. Capture a new source version.')
        }
        const saved = { ...p, updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString() }
        write(owner, [clone(saved), ...projects.filter(x => x.id !== p.id)])
        return { ok: true, value: clone(saved) }
      } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Could not save the project.' } }
    },
    remove(owner: ResearchOwner, id: string): ResearchResult<null> {
      try { write(owner, read(owner).filter(p => p.id !== id)); return { ok: true, value: null } }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Could not delete the project.' } }
    },
    release(windowId: number) { privateProjects.delete(windowId) },
  }
}
