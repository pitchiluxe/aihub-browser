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
// Without a nudge, a model asked for "creative extensions" converges on the
// same handful of ideas every run. Each generation gets a different lens so
// consecutive batches explore genuinely different ground.
const CREATIVE_LENSES = [
  'Reveal something the page is doing that the user cannot normally see.',
  'Let the user interrogate the page and get answers back, not just read it.',
  'Turn a property of the page (structure, timing, colour, density) into something visual or playable.',
  'Give the user a control the site deliberately withheld from them.',
  'Change how the page behaves over time — replay it, slow it down, watch it change.',
  'Re-cut the page for a purpose its designers never had in mind.',
  'Make comparison possible: across the page, across tabs, or against a reference.',
  'Turn attention itself into the subject — what the user actually reads, misses, or returns to.',
]

export function buildGenerationPrompt(
  topic: string,
  existing: ExistingExtInfo[],
  lens: string = CREATIVE_LENSES[Math.floor(Math.random() * CREATIVE_LENSES.length)],
): string {
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

RULE 3 — NEVER BUILD YOUR OWN WINDOW. The browser provides the window chrome. For ANY extension with a UI, call:
  var panel = AIHubPanel.create({ key:'<key>', title:'Name', icon:'🎯', width:340 });
It returns a ready-made draggable glass panel with a title bar, a MINIMISE button and a close button already wired. You only fill panel.body — append your controls/content to it. Inputs, buttons, selects and iframes inside panel.body are styled for you, so plain <input>/<button>/<iframe> elements already look right; do not restyle the shell, do not add your own header, close button, position:fixed wrapper or z-index. panel.remove() tears the whole thing down.
Only a passive, non-interactive overlay (a reading ruler, a tint layer, a badge that never needs closing) may skip the panel — those append their own element directly.

CODE CONTRACT (exact):
- injectCode is an IIFE; pick a unique short key. It MUST add at least one real element to the page (via AIHubPanel or your own node) — adding nothing = rejected. Only append your own nodes; never overwrite document.body.innerHTML.
  (function(){var K='__ext_<key>';if(window[K])return;var p=AIHubPanel.create({key:'<key>',title:'...',icon:'🎯',width:340,onClose:function(){delete window[K];}});/* build controls into p.body with real listeners */window[K]={remove:function(){p.remove();delete window[K];}};})()
  Use the SAME short key for AIHubPanel.create and for the __ext_<key> global, and pass the onClose shown above — that is what lets the panel's own × button be reopened later.
- removeCode is exactly: window.__ext_<key>&&window.__ext_<key>.remove()
- For a maps/earth request, follow the RULE 2 Google Maps embed pattern inside panel.body: an <input> for the place, a Go button, and an <iframe> whose src is rebuilt from the input. That is the standard for "locator" extensions.

RULE 4 — MAKE IT SOMETHING NOBODY HAS SHIPPED BEFORE. These already exist a thousand times over and are an automatic fail: dark mode / night theme, ad or cookie-banner blockers, word counters, reading-time badges, note stickies, generic to-do lists, screenshot buttons, plain colour pickers, QR generators, password generators, tab counters, bare "summarise this page" buttons.
Instead invent a mechanic that only makes sense inside a browser. Good thinking looks like: turning something invisible on the page into something you can see or steer; letting the reader interrogate the page ("show me every number and what it's compared to"); replaying or rewinding what the page did; making the page's own structure playable, measurable or navigable in a way the site never intended; giving the user a control the site deliberately withheld.
Each extension must pass this test: a browsing friend would say "wait, how did you do that?" — not "oh, I have that one already".
Every extension in the batch must use a DIFFERENT mechanic from the others. Ship the strange, specific idea over the safe, generic one — as long as it genuinely works.

ANGLE FOR THIS BATCH (bend every idea through it): ${lens}

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
