export const config = { runtime: 'edge' }

export default async function handler() {
  const ZIP = 'https://github.com/pitchiluxe/aihub-browser/releases/download/v1.0.0/AIHub-Browser-1.0.0-win-x64.zip'

  return Response.redirect(ZIP, 302)
}
