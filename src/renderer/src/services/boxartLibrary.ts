import { BOXART_REPOS, boxartUrl, matchBoxart } from '../../../shared/games/boxart'
import type { RomSystem } from '../../../shared/games/catalog'
import { IS_INCOGNITO } from './incognitoMode'

// Each game's match is remembered (a URL, or '' for "no box exists") so the
// listings are only downloaded while some cartridge is still unmatched.
const RESULT_KEY = 'aihub-game-room-boxart-v1'
const listings = new Map<RomSystem, Promise<string[]>>()
function readResults(): Record<string, string> { try { return JSON.parse(localStorage.getItem(RESULT_KEY) || '{}') } catch { return {} } }
function saveResult(id: string, url: string) { try { localStorage.setItem(RESULT_KEY, JSON.stringify({ ...readResults(), [id]: url })) } catch { /* Matched again next time. */ } }
async function listing(system: RomSystem): Promise<string[]> {
  const repo = BOXART_REPOS[system]
  if (!repo) return []
  let job = listings.get(system)
  if (!job) {
    job = (async () => {
      const tree = async (sha: string) => { const response = await fetch(`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/${sha}`, { headers: { Accept: 'application/vnd.github+json' } }); if (!response.ok) throw Error(`HTTP ${response.status}`); return (await response.json()).tree as { path: string; sha: string }[] }
      const folder = (await tree('master')).find(entry => entry.path === 'Named_Boxarts')
      return folder ? (await tree(folder.sha)).map(entry => entry.path) : []
    })()
    // A failed listing (offline, rate-limited) is retried on the next visit, not this session.
    job.catch(() => undefined)
    listings.set(system, job)
  }
  return job
}
export function cachedBoxart(id: string): string | undefined { return IS_INCOGNITO ? undefined : readResults()[id] }
export async function findBoxart(game: { id: string; title: string; system: RomSystem }): Promise<string> {
  const known = cachedBoxart(game.id)
  if (known !== undefined || IS_INCOGNITO) return known || ''
  const file = matchBoxart(game.title, await listing(game.system))
  const url = file ? boxartUrl(game.system, file) : ''
  saveResult(game.id, url)
  return url
}
