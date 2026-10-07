export const config = { runtime: 'edge' }

const REPO = 'pitchiluxe/aihub-browser'
// Real installers only — .exe / .dmg / .AppImage, plus the .zip builds early
// releases shipped. Not latest.yml or .blockmap: those are auto-update checks,
// not people downloading the app.
const INSTALLER = /\.(exe|dmg|AppImage|zip)$/i
const MAX_PAGES = 10

// Live total download count for the landing page, summed across EVERY
// published release (GitHub pages the list 100 at a time, so a single request
// silently drops the oldest releases). Cached at the edge for 5 minutes so a
// burst of page views never hits GitHub's unauthenticated rate limit.
export default async function handler() {
  try {
    let total = 0
    let version = ''
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aihub-browser-landing' },
      })
      if (!res.ok) throw new Error(`GitHub ${res.status}`)
      const releases = await res.json()
      if (!Array.isArray(releases) || releases.length === 0) break
      for (const r of releases) {
        for (const a of r.assets || []) {
          if (INSTALLER.test(a.name || '')) total += a.download_count || 0
        }
        // The newest published (non-draft, non-prerelease) release names the
        // current version, so the page never advertises an old one.
        if (!version && !r.draft && !r.prerelease && r.tag_name) version = String(r.tag_name)
      }
      if (releases.length < 100) break
    }
    return new Response(JSON.stringify({ downloads: total, version }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 's-maxage=300, stale-while-revalidate=600',
        'access-control-allow-origin': '*',
      },
    })
  } catch { /* fall through */ }

  return new Response(JSON.stringify({ downloads: null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 's-maxage=60' },
  })
}
