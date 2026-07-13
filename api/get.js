export const config = { runtime: 'edge' }

const REPO = 'pitchiluxe/aihub-browser'
const FALLBACK = `https://github.com/${REPO}/releases/latest`

// Redirects to the right installer asset on the latest published GitHub
// release, so this endpoint never needs editing again when a new version
// ships.  /api/get → Windows .exe   /api/get?os=mac → macOS .dmg
export default async function handler(req) {
  const os = new URL(req.url).searchParams.get('os') === 'mac' ? 'mac' : 'win'
  const ext = os === 'mac' ? '.dmg' : '.exe'

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aihub-browser-landing' },
    })
    if (res.ok) {
      const release = await res.json()
      const asset = release.assets?.find(a => a.name.endsWith(ext))
      if (asset?.browser_download_url) {
        return Response.redirect(asset.browser_download_url, 302)
      }
    }
  } catch {}

  return Response.redirect(FALLBACK, 302)
}
