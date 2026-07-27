import { CustomExt } from '../extensions/customExts'

const VALID_CATEGORIES = ['Media', 'Privacy', 'Productivity', 'Accessibility', 'Developer', 'Reading']

/** What generation needs to know about an already-installed extension to
 *  avoid recreating it under a different name. */
export interface ExistingExtInfo {
  name: string
  tagline: string
  category?: string
}

// Tokenized similarity between two extensions' name+tagline. Catches
// functional duplicates that slip past the exact-name check ("Dark Reader"
// vs "Night Mode Pro — dark theme for every site").
const STOPWORDS = new Set(['a', 'an', 'the', 'for', 'of', 'and', 'or', 'to', 'in', 'on', 'with', 'your', 'every', 'all', 'any', 'page', 'pages', 'site', 'sites', 'web', 'browser', 'extension'])
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
  )
}
function isFunctionalDupe(name: string, tagline: string, existing: ExistingExtInfo[]): boolean {
  const cand = tokens(`${name} ${tagline}`)
  if (cand.size === 0) return false
  for (const ext of existing) {
    const ref = tokens(`${ext.name} ${ext.tagline}`)
    if (ref.size === 0) continue
    let overlap = 0
    for (const t of cand) if (ref.has(t)) overlap++
    // Overlap relative to the SMALLER set — a short name fully contained in
    // an existing description is a dupe even if the union is large.
    if (overlap / Math.min(cand.size, ref.size) >= 0.6) return true
  }
  return false
}

// Builds the single-shot generation prompt for ai:chat. The model must reply
// with ONLY a JSON array of extension objects following the codebase's
// window.__ext_<key> IIFE contract (same pattern as extensionDefs.ts).
export function buildGenerationPrompt(topic: string, existing: ExistingExtInfo[]): string {
  const theme = topic.trim()
    ? `EVERY SINGLE extension MUST genuinely and accurately deliver on: "${topic.trim()}". If the request names a service (maps, Earth, weather, translate, video, dictionary, calculator…), build the REAL, WORKING thing — see embeds below. NOT a fake panel or placeholder title bar. User will TEST each one immediately.`
    : 'Invent a broadly useful, varied mix (productivity, reading, privacy, media, accessibility, developer tools).'
  return `You are a senior browser-extension engineer for AIHub Browser. EVERY extension MUST work perfectly and do EXACTLY what the user asked.
Write extensions that ACTUALLY WORK — never stubs, placeholders, "coming soon", or empty boxes. Each is sandboxed, tested, and removed if dead.

Generate 4 to 6 small, 100% FUNCTIONING, spec-accurate extensions. ${theme}
Each is vanilla JS run inside the current web page when enabled. Keep each focused and compact. User will immediately test your work.

CRITICAL: Verify your code:
1. Does this ACTUALLY do what the user asked? (Not close-enough, actually)
2. Will it show visible change to the page when enabled?
3. Will it clean up with zero residue when disabled?
If unsure, build a simpler version that definitely works instead of ambitious code that fails.

RULE 1 — NEVER FAKE A CAPABILITY. If you can't truly deliver it, build the closest thing that really works. A "Google Earth locator" showing an empty box = fail. One that embeds a live, pannable satellite map of a place the user types = success.

RULE 2 — SHOW REAL CONTENT WITH AN IFRAME. These embed and work inside a page (create with document.createElement('iframe'), set .src, style width/height 100%, border 0):
- Google Maps satellite/3D:  https://maps.google.com/maps?q=<PLACE or LAT,LNG>&t=k&z=15&output=embed   (t=k=satellite; drag to pan, scroll to zoom — real Google data)
- OpenStreetMap:  https://www.openstreetmap.org/export/embed.html?bbox=...
- YouTube:  https://www.youtube.com/embed/<id>
- Wikipedia:  https://<lang>.wikipedia.org/wiki/<Title>
Do NOT use fetch/XHR, external libraries, or eval.

RULE 3 — POLISHED FLOATING PANEL for anything with a UI: position:fixed; z-index 2147483000+; rounded 14px; dark glass card background rgba(17,18,30,0.97); border rgba(255,255,255,0.12); box-shadow; a header with the title + a × button that calls remove(); light ~13px system-ui text. If it takes input (a place, word, video), give it an <input>+button wired with addEventListener so it truly responds.

CODE CONTRACT (exact):
- injectCode is an IIFE; pick a unique short key. It MUST append at least one real element to document.body (or inject a <style>) — adding nothing = rejected. Only append your own nodes; never overwrite document.body.innerHTML.
  (function(){var K='__ext_<key>';if(window[K])return;var p=document.createElement('div');/* build panel/iframe/controls with real styles + listeners */document.body.appendChild(p);window[K]={remove:function(){p.remove();delete window[K];}};})()
- removeCode is exactly: window.__ext_<key>&&window.__ext_<key>.remove()
- For a maps/earth request, follow the RULE 2 Google Maps embed pattern: an <input> for the place, a Go button, and an <iframe> whose src is rebuilt from the input. That is the standard for "locator" extensions.

OUTPUT — ONLY a JSON array (no prose, no fences) of 4 to 6 objects:
[{"name":"...","tagline":"under 80 chars","icon":"one emoji","category":"Media|Privacy|Productivity|Accessibility|Developer|Reading","howTo":"1-2 sentences: what appears and how to use it","injectCode":"...","removeCode":"..."}]

icon: ONE bold saturated emoji visible on dark UI (good: 🔥 🛡️ 📌 🎯 ⚡ 🔍 📖 🎨 🔒 🌍 🗺️ ⏱️; avoid pale/thin 🤍 💭 🕊️).

Already installed — do NOT duplicate a NAME or its FUNCTION:
${existing.map(e => `- ${e.name}${e.category ? ` [${e.category}]` : ''}: ${e.tagline}`).join('\n') || '(none)'}

JSON: injectCode/removeCode are single-line strings — prefer single quotes inside the JS, escape any double quote as \\", use \\n only if needed.`
}

// Extracts and validates the model's response. Never throws. Invalid items
// are dropped and counted; a response with no parseable array yields
// {extensions: [], discarded: 0} (caller treats that as a model failure).
export function parseGeneratedExtensions(
  raw: string,
  existing: ExistingExtInfo[],
): { extensions: CustomExt[]; discarded: number } {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : raw
  const start = candidate.indexOf('[')
  if (start === -1) return { extensions: [], discarded: 0 }
  const end = candidate.lastIndexOf(']')

  // Salvage truncated output (model hit its token limit mid-array): cut back
  // to the last complete object and close the array ourselves. Complete
  // extensions before the cut are still perfectly usable.
  const salvaged = (() => {
    const lastBrace = candidate.lastIndexOf('}')
    return lastBrace > start ? candidate.slice(start, lastBrace + 1) + ']' : ''
  })()

  // Trailing commas before ] or } are the most common model JSON slip —
  // safe to strip here because valid JSON string values never end in a
  // bare comma directly before an unescaped bracket at this position.
  const stripTrailingCommas = (t: string) => t.replace(/,\s*([\]}])/g, '$1')

  let items: unknown[] | null = null
  const primary = end > start ? candidate.slice(start, end + 1) : ''
  for (const text of [primary, salvaged, stripTrailingCommas(primary), stripTrailingCommas(salvaged)]) {
    if (!text) continue
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) { items = parsed; break }
    } catch { /* try next candidate */ }
  }
  if (!items) return { extensions: [], discarded: 0 }

  const taken = new Set(existing.map(e => e.name.toLowerCase()))
  // Grows as items are accepted so one response can't contain near-dupes of
  // itself either.
  const dedupePool: ExistingExtInfo[] = [...existing]
  const extensions: CustomExt[] = []
  let discarded = 0
  const now = Date.now()

  items.forEach((entry, i) => {
    try {
      const it = entry as Record<string, unknown>
      const name = typeof it?.name === 'string' ? it.name.trim() : ''
      const tagline = typeof it?.tagline === 'string' ? it.tagline.trim() : ''
      const injectCode = typeof it?.injectCode === 'string' ? it.injectCode.trim() : ''
      const removeCode = typeof it?.removeCode === 'string' ? it.removeCode.trim() : ''
      if (!name || !tagline || !injectCode || !removeCode) { discarded++; return }
      if (taken.has(name.toLowerCase())) { discarded++; return }
      if (isFunctionalDupe(name, tagline, dedupePool)) { discarded++; return }
      // Syntax gate — constructed, never invoked in the host renderer.
      // The renderer CSP has no 'unsafe-eval', so new Function throws
      // EvalError here even for valid code. Only a SyntaxError means the
      // code is actually bad; a CSP EvalError means "can't check" — accept
      // the item (it runs via executeJavaScript in guest pages, outside
      // this CSP).
      try {
        new Function(injectCode)
        new Function(removeCode)
      } catch (e) {
        if (e instanceof SyntaxError) { discarded++; return }
      }
      const icon = typeof it?.icon === 'string' && it.icon.trim()
        ? [...it.icon.trim()].slice(0, 2).join('')
        : '✨'
      const category = VALID_CATEGORIES.includes(it?.category as string)
        ? (it.category as string)
        : 'Productivity'
      const howTo = typeof it?.howTo === 'string' ? it.howTo.trim() : ''
      taken.add(name.toLowerCase())
      dedupePool.push({ name, tagline })
      extensions.push({ id: `custom-${now}-${i}`, name, tagline, icon, category, injectCode, removeCode, ...(howTo ? { howTo } : {}) })
    } catch {
      discarded++
    }
  })

  return { extensions, discarded }
}
