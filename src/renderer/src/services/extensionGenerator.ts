import { CustomExt } from '../extensions/customExts'

const VALID_CATEGORIES = ['Media', 'Privacy', 'Productivity', 'Accessibility', 'Developer', 'Reading']

// Builds the single-shot generation prompt for ai:chat. The model must reply
// with ONLY a JSON array of extension objects following the codebase's
// window.__ext_<key> IIFE contract (same pattern as extensionDefs.ts).
export function buildGenerationPrompt(topic: string, existingNames: string[]): string {
  const theme = topic.trim()
    ? `All extensions must serve this theme: "${topic.trim()}".`
    : 'Invent a broadly useful, varied mix (productivity, reading, privacy, media, accessibility, developer tools).'
  return `You are an expert browser-extension author for AIHub Browser.

Generate 5 to 10 small, genuinely useful page-enhancement extensions. ${theme}

Each extension is plain JavaScript injected into every web page when the user enables it.

STRICT CONTRACT for each extension:
- injectCode: an IIFE following EXACTLY this pattern (choose a unique short key per extension):
(function(){
  var K='__ext_<uniquekey>';
  if(window[K])return;
  // do the work: create elements, add listeners, modify styles...
  window[K]={remove:function(){ /* undo EVERYTHING done above */ delete window[K];}};
})()
- removeCode: exactly this one line: window.__ext_<uniquekey>&&window.__ext_<uniquekey>.remove()
- Vanilla ES5-safe JavaScript only. No external network requests, no libraries, no fetch.
- Must not break pages. Any visual element uses z-index 2147483000 or higher.

Respond with ONLY a JSON array (no prose, no markdown fences) of 5 to 10 objects shaped:
[{"name":"...","tagline":"one line, under 80 chars","icon":"one emoji","category":"Media|Privacy|Productivity|Accessibility|Developer|Reading","injectCode":"...","removeCode":"..."}]

Names must NOT duplicate any of these existing extensions: ${existingNames.join(', ') || '(none)'}
JSON string rules: injectCode/removeCode are single-line JSON strings — use \\n escapes for newlines and escape double quotes.`
}

// Extracts and validates the model's response. Never throws. Invalid items
// are dropped and counted; a response with no parseable array yields
// {extensions: [], discarded: 0} (caller treats that as a model failure).
export function parseGeneratedExtensions(
  raw: string,
  existingNames: string[],
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

  const taken = new Set(existingNames.map(n => n.toLowerCase()))
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
      taken.add(name.toLowerCase())
      extensions.push({ id: `custom-${now}-${i}`, name, tagline, icon, category, injectCode, removeCode })
    } catch {
      discarded++
    }
  })

  return { extensions, discarded }
}
