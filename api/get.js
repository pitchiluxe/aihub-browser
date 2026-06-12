export const config = { runtime: 'edge' }

export default async function handler() {
  const EXE = 'https://github.com/pitchiluxe/aihub-browser/releases/download/v1.0.0/AIHub-Browser-1.0.0-win-x64.exe'

  return Response.redirect(EXE, 302)
}
