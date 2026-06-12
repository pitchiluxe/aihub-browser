export const config = { runtime: 'edge' }

export default async function handler() {
  const ZIP = 'https://github.com/pitchiluxe/aihub-browser/releases/download/v1.0.0/AIHub-Browser-1.0.0-win-x64.zip'

  const upstream = await fetch(ZIP, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  })

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="AIHub-Browser-1.0.0-win-x64.zip"',
      'Content-Length': upstream.headers.get('content-length') || '',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    }
  })
}
