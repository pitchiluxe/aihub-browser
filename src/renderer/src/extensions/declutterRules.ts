export interface DeclutterRule {
  id: string
  origin: string
  selectors: string[]
  enabled: boolean
  updatedAt: number
}

const STORAGE_KEY = 'aihub-site-declutter-v1'
const MAX_SELECTORS = 30
const MAX_SELECTOR_LENGTH = 300
const STYLE_ID = 'aihub-browser-site-declutter'

function browserStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

/** Canonical HTTP(S) origin, with credentials, paths, and query removed. */
export function normalizeOrigin(input: string): string | null {
  try {
    const url = new URL(String(input || '').trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    return url.origin
  } catch {
    return null
  }
}

/** Validate and normalize one CSS selector per entry. */
export function normalizeSelectors(input: string[]): { ok: true; selectors: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Enter at least one CSS selector.' }
  const selectors: string[] = []
  for (const entry of input) {
    if (typeof entry !== 'string') return { ok: false, error: 'Selectors must be text.' }
    const selector = entry.trim()
    if (!selector) continue
    if (selector.length > MAX_SELECTOR_LENGTH) return { ok: false, error: `Each selector must be ${MAX_SELECTOR_LENGTH} characters or fewer.` }
    if (/[{};]/.test(selector)) return { ok: false, error: 'Selectors cannot contain CSS declarations or blocks.' }
    if (/[()]/.test(selector)) {
      let depth = 0
      for (const char of selector) {
        if (char === '(') depth++
        if (char === ')' && --depth < 0) return { ok: false, error: `Invalid CSS selector: ${selector}` }
      }
      if (depth !== 0) return { ok: false, error: `Invalid CSS selector: ${selector}` }
    }
    try {
      if (typeof document === 'undefined') return { ok: false, error: 'Selector validation is unavailable.' }
      document.querySelectorAll(selector)
    } catch {
      return { ok: false, error: `Invalid CSS selector: ${selector}` }
    }
    if (!selectors.includes(selector)) selectors.push(selector)
    if (selectors.length > MAX_SELECTORS) return { ok: false, error: `Use no more than ${MAX_SELECTORS} selectors per site.` }
  }
  if (!selectors.length) return { ok: false, error: 'Enter at least one CSS selector.' }
  return { ok: true, selectors }
}

function normalizeRule(value: unknown): DeclutterRule | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DeclutterRule>
  const origin = typeof candidate.origin === 'string' ? normalizeOrigin(candidate.origin) : null
  const selectors = normalizeSelectors(Array.isArray(candidate.selectors) ? candidate.selectors : [])
  if (!origin || !selectors.ok) return null
  if (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.length > 100) return null
  if (typeof candidate.enabled !== 'boolean' || typeof candidate.updatedAt !== 'number' || !Number.isFinite(candidate.updatedAt)) return null
  return { id: candidate.id, origin, selectors: selectors.selectors, enabled: candidate.enabled, updatedAt: candidate.updatedAt }
}

/** Load only validated rules; malformed or inaccessible storage is treated as empty. */
export function loadDeclutterRules(storage?: Pick<Storage, 'getItem'>): DeclutterRule[] {
  const source = storage || browserStorage()
  if (!source) return []
  try {
    const raw = source.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeRule).filter((rule): rule is DeclutterRule => rule !== null)
  } catch {
    return []
  }
}

/** Persist validated rules locally. Returns false if validation or storage fails. */
export function saveDeclutterRules(rules: DeclutterRule[], storage?: Pick<Storage, 'setItem'>): boolean {
  const destination = storage || browserStorage()
  if (!destination || !Array.isArray(rules)) return false
  try {
    const normalized = rules.map(normalizeRule)
    if (normalized.some(rule => rule === null)) return false
    destination.setItem(STORAGE_KEY, JSON.stringify(normalized))
    return true
  } catch {
    return false
  }
}

/** Return selectors only when a rule's exact HTTP(S) origin matches. */
export function selectorsForOrigin(origin: string, rules: readonly DeclutterRule[]): string[] {
  const target = normalizeOrigin(origin)
  if (!target) return []
  const selectors: string[] = []
  for (const value of rules) {
    const rule = normalizeRule(value)
    if (!rule?.enabled || rule.origin !== target) continue
    for (const selector of rule.selectors) if (!selectors.includes(selector)) selectors.push(selector)
  }
  return selectors
}

/** Build page-world code that replaces only AIHub's own cleanup stylesheet. */
export function buildDeclutterStyleScript(selectors: readonly string[]): string {
  const validated = normalizeSelectors(Array.from(selectors))
  const encoded = JSON.stringify(validated.ok ? validated.selectors : [])
  return `(() => {
    document.querySelectorAll('style[data-aihub-declutter]').forEach(previous => previous.remove());
    const selectors = ${encoded};
    if (!selectors.length) return;
    const safe = selectors.filter(selector => {
      if (/[{};]/.test(selector)) return false;
      try { document.querySelector(selector); return true; } catch { return false; }
    });
    if (!safe.length) return;
    const style = document.createElement('style');
    style.id = '${STYLE_ID}';
    style.setAttribute('data-aihub-declutter', 'true');
    style.textContent = safe.map(selector => selector + ' { display: none !important; }').join('\\n');
    (document.head || document.documentElement).appendChild(style);
  })()`
}
