export const config = { runtime: 'edge' }

const REPO = 'pitchiluxe/aihub-browser'

// Live total download count for the landing page. Sums download_count across
// every published release for the real installer assets (.exe / .dmg /
// .AppImage) — not the auto-update metadata (latest.yml, .blockmap). Cached at
// the edge for 5 minutes so a burst of page views never hits GitHub's
// unauthenticated rate limit.
export default async function handler() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aihub-browser-landing' },
    })
    if (res.ok) {
      const releases = await res.json()
      let total = 0
      let version = ''
      for (const r of Array.isArray(releases) ? releases : []) {
        for (const a of r.assets || []) {
          if (/\.(exe|dmg|AppImage)$/i.test(a.name || '')) total += a.download_count || 0
        }
        // The newest published (non-draft, non-prerelease) release names the
        // current version. Reporting it here means the landing page can never
        // advertise a version that shipped fifteen releases ago.
        if (!version && !r.draft && !r.prerelease && r.tag_name) version = String(r.tag_name)
      }
      return new Response(JSON.stringify({ downloads: total, version }), {
        headers: {
          'content-type': 'application/json',
          'cache-control': 's-maxage=300, stale-while-revalidate=600',
          'access-control-allow-origin': '*',
        },
      })
    }
  } catch { /* fall through */ }

  return new Response(JSON.stringify({ downloads: null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 's-maxage=60' },
  })
}
