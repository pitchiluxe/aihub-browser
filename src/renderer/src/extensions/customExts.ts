// Custom (user-created or AI-generated) extensions. Shared between the
// Extensions page (create/generate/delete/toggle) and App.tsx (re-injection
// on every page load). Storage shape and key predate this module — do not
// change either.
export interface CustomExt {
  id: string
  name: string
  tagline: string
  icon: string
  category: string
  injectCode: string
  removeCode: string
}

export function loadCustomExts(): CustomExt[] {
  try { return JSON.parse(localStorage.getItem('aihub-custom-exts') || '[]') } catch { return [] }
}

export function saveCustomExts(exts: CustomExt[]) {
  try { localStorage.setItem('aihub-custom-exts', JSON.stringify(exts)) } catch {}
}
