export const config = { runtime: 'edge' }

const REPO = 'pitchiluxe/aihub-browser'
const FALLBACK = `https://github.com/${REPO}/releases/latest`

// Always redirects to the .exe asset on the latest published GitHub release,
// so this endpoint never needs editing again when a new version ships.
export default async function handler() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aihub-browser-landing' },
    })
    if (res.ok) {
      const release = await res.json()
      const asset = release.assets?.find(a => a.name.endsWith('.exe'))
      if (asset?.browser_download_url) {
        return Response.redirect(asset.browser_download_url, 302)
      }
    }
  } catch {}

  return Response.redirect(FALLBACK, 302)
}
