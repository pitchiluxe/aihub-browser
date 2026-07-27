// ── Theme registry ───────────────────────────────────────────────────────────
// Each theme is a CSS ruleset in globals.css keyed by body[data-theme="<id>"].
// `base` decides the light-mode class (text/surface inversion); the data-theme
// attribute recolors accents and background tints on top of that base.

export interface ThemeDef {
  id: string
  name: string
  base: 'dark' | 'light'
  desc: string
  /** Swatch colors for the settings picker: [background, accent] */
  swatch: [string, string]
}

export const THEMES: ThemeDef[] = [
  // ── Dark bases ──
  { id: 'dark',     name: 'Midnight', base: 'dark',  desc: 'Deep navy · violet',    swatch: ['#17182B', '#6B4EFF'] },
  { id: 'ocean',    name: 'Ocean',    base: 'dark',  desc: 'Abyss blue · cyan',     swatch: ['#0C1626', '#38BDF8'] },
  { id: 'forest',   name: 'Forest',   base: 'dark',  desc: 'Pine dark · emerald',   swatch: ['#0D1B16', '#34D399'] },
  { id: 'sunset',   name: 'Sunset',   base: 'dark',  desc: 'Ember dark · amber',    swatch: ['#1C1210', '#FB923C'] },
  { id: 'crimson',  name: 'Crimson',  base: 'dark',  desc: 'Noir · scarlet',        swatch: ['#1A0F14', '#F43F5E'] },
  { id: 'cyber',    name: 'Cyber',    base: 'dark',  desc: 'Carbon · neon lime',    swatch: ['#0A0D0A', '#A3E635'] },
  { id: 'royal',    name: 'Royal',    base: 'dark',  desc: 'Indigo · gold',         swatch: ['#14122A', '#FBBF24'] },
  { id: 'rose',     name: 'Rose',     base: 'dark',  desc: 'Plum dark · pink',      swatch: ['#190F18', '#F472B6'] },
  { id: 'graphite', name: 'Graphite', base: 'dark',  desc: 'Carbon mono · silver',  swatch: ['#101114', '#A1A1AA'] },
  { id: 'nordic',   name: 'Nordic',   base: 'dark',  desc: 'Arctic slate · ice',    swatch: ['#1E222B', '#88C0D0'] },
  { id: 'espresso', name: 'Espresso', base: 'dark',  desc: 'Roast brown · caramel', swatch: ['#18120E', '#D4A15F'] },
  { id: 'aurora',   name: 'Aurora',   base: 'dark',  desc: 'Polar night · teal',    swatch: ['#0C1418', '#2DD4BF'] },
  // ── Light bases ──
  { id: 'light',    name: 'Clear',    base: 'light', desc: 'Clean white · violet',  swatch: ['#F5F5FA', '#6B4EFF'] },
  { id: 'lavender', name: 'Lavender', base: 'light', desc: 'Soft lilac · purple',   swatch: ['#F3F0FC', '#7C5CFF'] },
  { id: 'mint',     name: 'Mint',     base: 'light', desc: 'Fresh green · teal',    swatch: ['#EFF8F4', '#059669'] },
  { id: 'sand',     name: 'Sand',     base: 'light', desc: 'Warm cream · amber',    swatch: ['#FAF6EE', '#D97706'] },
  { id: 'sky',      name: 'Sky',      base: 'light', desc: 'Airy blue · azure',     swatch: ['#EEF5FC', '#0284C7'] },
  { id: 'blossom',  name: 'Blossom',  base: 'light', desc: 'Petal pink · rose',     swatch: ['#FCF1F6', '#DB2777'] },
  { id: 'paper',    name: 'Paper',    base: 'light', desc: 'Neutral white · slate', swatch: ['#F8F8F7', '#475569'] },
]

// ── Custom (AI/random-generated) themes ──────────────────────────────────────
// Built-ins are CSS rulesets; custom themes carry their variables with them
// and are applied as inline custom properties on <body>.

export interface CustomTheme extends ThemeDef {
  custom: true
  /** Hue used to generate the palette — kept to avoid near-duplicate colors */
  hue: number
  vars: Record<string, string>
}

const LS_THEMES = 'aihub-custom-themes'

export function loadCustomThemes(): CustomTheme[] {
  try { return JSON.parse(localStorage.getItem(LS_THEMES) || '[]') } catch { return [] }
}

export function saveCustomThemes(themes: CustomTheme[]): void {
  try { localStorage.setItem(LS_THEMES, JSON.stringify(themes)) } catch {}
  // Disk mirror — same durability story as custom extensions
  try { (window as any).electronAPI?.extStore?.save?.({ customThemes: themes }) } catch {}
}

export function deleteCustomTheme(id: string): CustomTheme[] {
  const rest = loadCustomThemes().filter(t => t.id !== id)
  saveCustomThemes(rest)
  return rest
}

export function getAllThemes(): (ThemeDef | CustomTheme)[] {
  return [...THEMES, ...loadCustomThemes()]
}

export function getTheme(id: string): ThemeDef | CustomTheme {
  return getAllThemes().find(t => t.id === id) ?? THEMES[0]
}

export function themeIsLight(id: string): boolean {
  return getTheme(id).base === 'light'
}

// Every variable a custom theme may set — cleared when switching back to a
// built-in so its CSS ruleset shines through unshadowed.
const CUSTOM_VAR_KEYS = [
  '--ds-bg', '--ds-bg-2', '--ds-bg-3',
  '--ds-accent', '--ds-accent-2', '--ds-accent-3', '--ds-accent-soft', '--ds-accent-pale',
  '--ds-accent-hex', '--ds-accent-2-hex', '--ds-accent-soft-hex', '--ds-accent-ink',
  '--ds-page-bg', '--ds-page-header', '--ds-app-bg',
  '--aihub-bg', '--aihub-surface', '--aihub-card', '--aihub-accent',
]

/** Apply a theme to the DOM: base class + accent/background variant. */
export function applyThemeToDom(id: string): void {
  const theme = getTheme(id)
  const body = document.body
  body.classList.toggle('light-mode', theme.base === 'light')
  for (const k of CUSTOM_VAR_KEYS) body.style.removeProperty(k)
  if ('custom' in theme) {
    body.dataset.theme = 'custom'
    for (const [k, v] of Object.entries(theme.vars)) body.style.setProperty(k, v)
  } else {
    body.dataset.theme = theme.id
  }
}

// ── Palette builder ──────────────────────────────────────────────────────────
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}
const trip = (h: number, s: number, l: number) => hslToRgb(h, s, l).join(' ')
const hex  = (h: number, s: number, l: number) =>
  '#' + hslToRgb(h, s, l).map(c => c.toString(16).padStart(2, '0')).join('')

// A full palette spec. The single-hue builder below is a special case of this
// where every hue is the same — which is exactly why those themes looked flat
// and monochrome. Real, modern themes set the background and the accent to
// DIFFERENT hues (a deep indigo room lit by a warm amber lamp), and carry a
// second accent a step around the wheel for gradients and hover states.
export interface PaletteSpec {
  bgHue: number
  bgSat: number          // background saturation — low = neutral/graphite, high = moody colour
  accentHue: number
  accentHue2: number     // secondary accent (gradients, the -2 vars)
  accentSat: number
}

export function buildThemeFromPalette(name: string, base: 'dark' | 'light', p: PaletteSpec): CustomTheme {
  const bh = ((p.bgHue % 360) + 360) % 360
  const ah = ((p.accentHue % 360) + 360) % 360
  const ah2 = ((p.accentHue2 % 360) + 360) % 360
  const bs = Math.max(0, Math.min(60, p.bgSat))
  const as = Math.max(45, Math.min(100, p.accentSat))

  const vars: Record<string, string> =
    base === 'dark'
      ? {
          '--ds-bg':   trip(bh, bs, 9),
          '--ds-bg-2': trip(bh, bs, 13),
          '--ds-bg-3': trip(bh, Math.max(0, bs - 2), 17),
          '--ds-accent':      trip(ah, as, 62),
          '--ds-accent-2':    trip(ah2, as, 58),
          '--ds-accent-3':    trip(ah, as, 68),
          '--ds-accent-soft': trip(ah, Math.min(100, as + 2), 74),
          '--ds-accent-pale': trip(ah, Math.min(100, as + 4), 84),
          '--ds-accent-hex':      hex(ah, as, 62),
          '--ds-accent-2-hex':    hex(ah2, as, 58),
          '--ds-accent-soft-hex': hex(ah, Math.min(100, as + 2), 74),
          '--ds-accent-ink':      hex(ah, Math.min(100, as + 2), 74),
          // A two-hue background gradient reads as depth, not a flat wash.
          '--ds-page-bg': `linear-gradient(160deg, ${hex(bh, bs, 7)} 0%, ${hex(ah2, Math.min(bs + 6, 40), 9)} 100%)`,
          '--ds-page-header': `linear-gradient(180deg, ${hex(bh, bs, 8)}fa 80%, transparent)`,
          '--ds-app-bg': `linear-gradient(160deg, ${hex(bh, bs, 9)} 0%, ${hex(bh, bs, 6)} 100%)`,
          '--aihub-bg':      trip(bh, bs, 9),
          '--aihub-surface': trip(bh, bs, 13),
          '--aihub-card':    trip(bh, Math.max(0, bs - 2), 17),
          '--aihub-accent':  trip(ah, as, 62),
        }
      : {
          '--ds-bg':   trip(bh, Math.min(bs, 40), 97),
          '--ds-bg-2': trip(bh, Math.min(bs, 38), 94),
          '--ds-bg-3': trip(bh, Math.min(bs, 36), 91),
          '--ds-accent':      trip(ah, Math.min(as, 80), 45),
          '--ds-accent-2':    trip(ah2, Math.min(as, 78), 42),
          '--ds-accent-3':    trip(ah, Math.min(as, 80), 52),
          '--ds-accent-soft': trip(ah, Math.min(as, 78), 50),
          '--ds-accent-pale': trip(ah, Math.min(as, 76), 70),
          '--ds-accent-hex':      hex(ah, Math.min(as, 80), 45),
          '--ds-accent-2-hex':    hex(ah2, Math.min(as, 78), 42),
          '--ds-accent-soft-hex': hex(ah, Math.min(as, 78), 50),
          '--ds-accent-ink':      hex(ah, Math.min(as, 82), 30),
          '--ds-page-bg': `linear-gradient(160deg, ${hex(bh, Math.min(bs, 42), 98)} 0%, ${hex(ah2, Math.min(bs, 30), 96)} 100%)`,
          '--ds-page-header': `linear-gradient(180deg, ${hex(bh, Math.min(bs, 42), 98)}fa 80%, transparent)`,
          '--ds-app-bg': `linear-gradient(160deg, ${hex(bh, Math.min(bs, 42), 98)} 0%, ${hex(bh, Math.min(bs, 40), 95)} 100%)`,
          '--aihub-bg':      trip(bh, Math.min(bs, 40), 97),
          '--aihub-surface': trip(bh, Math.min(bs, 38), 94),
          '--aihub-card':    '255 255 255',
          '--aihub-accent':  trip(ah, Math.min(as, 80), 45),
        }
  return {
    id: `custom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name, base, custom: true, hue: ah,
    desc: `${base === 'dark' ? 'Dark' : 'Light'} · designed`,
    swatch: base === 'dark' ? [hex(bh, bs, 9), hex(ah, as, 62)] : [hex(bh, Math.min(bs, 42), 97), hex(ah, Math.min(as, 80), 45)],
    vars,
  }
}

export function buildCustomTheme(name: string, base: 'dark' | 'light', hue: number): CustomTheme {
  hue = ((hue % 360) + 360) % 360
  const vars: Record<string, string> =
    base === 'dark'
      ? {
          '--ds-bg':   trip(hue, 32, 9),
          '--ds-bg-2': trip(hue, 30, 13),
          '--ds-bg-3': trip(hue, 28, 17),
          '--ds-accent':      trip(hue, 88, 62),
          '--ds-accent-2':    trip((hue + 350) % 360, 85, 57),
          '--ds-accent-3':    trip(hue, 88, 68),
          '--ds-accent-soft': trip(hue, 90, 74),
          '--ds-accent-pale': trip(hue, 92, 84),
          '--ds-accent-hex':      hex(hue, 88, 62),
          '--ds-accent-2-hex':    hex((hue + 350) % 360, 85, 57),
          '--ds-accent-soft-hex': hex(hue, 90, 74),
          '--ds-accent-ink':      hex(hue, 90, 74),
          '--ds-page-bg': `linear-gradient(180deg, ${hex(hue, 34, 7)} 0%, ${hex(hue, 32, 10)} 100%)`,
          '--ds-page-header': `linear-gradient(180deg, ${hex(hue, 34, 8)}fa 80%, transparent)`,
          '--ds-app-bg': `linear-gradient(180deg, ${hex(hue, 32, 9)} 0%, ${hex(hue, 34, 7)} 100%)`,
          '--aihub-bg':      trip(hue, 32, 9),
          '--aihub-surface': trip(hue, 30, 13),
          '--aihub-card':    trip(hue, 28, 17),
          '--aihub-accent':  trip(hue, 88, 62),
        }
      : {
          '--ds-bg':   trip(hue, 45, 97),
          '--ds-bg-2': trip(hue, 42, 94),
          '--ds-bg-3': trip(hue, 40, 91),
          '--ds-accent':      trip(hue, 75, 45),
          '--ds-accent-2':    trip((hue + 350) % 360, 72, 40),
          '--ds-accent-3':    trip(hue, 75, 52),
          '--ds-accent-soft': trip(hue, 72, 50),
          '--ds-accent-pale': trip(hue, 70, 70),
          '--ds-accent-hex':      hex(hue, 75, 45),
          '--ds-accent-2-hex':    hex((hue + 350) % 360, 72, 40),
          '--ds-accent-soft-hex': hex(hue, 72, 50),
          '--ds-accent-ink':      hex(hue, 78, 30),
          '--ds-page-bg': `linear-gradient(180deg, ${hex(hue, 45, 98)} 0%, ${hex(hue, 42, 95)} 100%)`,
          '--ds-page-header': `linear-gradient(180deg, ${hex(hue, 45, 98)}fa 80%, transparent)`,
          '--ds-app-bg': `linear-gradient(180deg, ${hex(hue, 45, 98)} 0%, ${hex(hue, 42, 95)} 100%)`,
          '--aihub-bg':      trip(hue, 45, 97),
          '--aihub-surface': trip(hue, 42, 94),
          '--aihub-card':    '255 255 255',
          '--aihub-accent':  trip(hue, 75, 45),
        }
  return {
    id: `custom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name, base, custom: true, hue,
    desc: `${base === 'dark' ? 'Dark' : 'Light'} · generated`,
    swatch: base === 'dark' ? [hex(hue, 32, 9), hex(hue, 88, 62)] : [hex(hue, 45, 97), hex(hue, 75, 45)],
    vars,
  }
}

// ── Generation ───────────────────────────────────────────────────────────────
const NAME_BUCKETS: [number, string[]][] = [
  [0,   ['Ruby', 'Magma', 'Cherry', 'Garnet']],
  [30,  ['Amber', 'Honey', 'Copper', 'Dune']],
  [60,  ['Citrus', 'Olive', 'Saffron', 'Brass']],
  [90,  ['Fern', 'Moss', 'Meadow', 'Sage']],
  [150, ['Jade', 'Lagoon', 'Tide', 'Aqua']],
  [180, ['Glacier', 'Cove', 'Marine', 'Frost']],
  [210, ['Cobalt', 'Sapphire', 'Storm', 'Deep']],
  [250, ['Iris', 'Twilight', 'Comet', 'Astral']],
  [280, ['Orchid', 'Nebula', 'Mystic', 'Plasma']],
  [320, ['Fuchsia', 'Blossom', 'Coral', 'Aurora']],
]

function nameForHue(hue: number, taken: Set<string>): string {
  const bucket = NAME_BUCKETS.reduce((best, b) => (hue >= b[0] ? b : best), NAME_BUCKETS[0])[1]
  for (const n of bucket) if (!taken.has(n.toLowerCase())) return n
  let i = 2
  while (taken.has(`${bucket[0].toLowerCase()} ${i}`)) i++
  return `${bucket[0]} ${i}`
}

// Hand-tuned modern palettes: background and accent on different hues, the way
// a designer actually picks colours. These are the offline fallback and the
// seed pool, so even with no AI the generator produces something beautiful
// rather than another monochrome wash. Each: [name, base, bgHue, bgSat,
// accentHue, accentHue2, accentSat].
const DESIGNER_PALETTES: [string, 'dark' | 'light', number, number, number, number, number][] = [
  ['Nebula',    'dark',  262, 34, 28,  330, 92],  // indigo room, warm coral lamp
  ['Synthwave', 'dark',  280, 40, 315, 190, 95],  // violet dusk, magenta + cyan
  ['Emberglow', 'dark',  20,  30, 32,  350, 90],  // charcoal, ember orange → rose
  ['Deep Sea',  'dark',  205, 38, 168, 260, 85],  // abyss blue, teal + indigo
  ['Verdant',   'dark',  158, 26, 96,  45,  82],  // pine, lime → gold
  ['Amethyst',  'dark',  250, 30, 285, 200, 88],  // slate indigo, amethyst + ice
  ['Sunset Blvd','dark', 235, 28, 28,  300, 92],  // twilight blue, amber + orchid
  ['Neon Noir', 'dark',  220, 22, 155, 320, 96],  // near-black blue, spring green + pink
  ['Terracotta','light', 24,  36, 12,  190, 72],  // warm cream, clay red + teal
  ['Sorbet',    'light', 330, 30, 340, 40,  74],  // blush, raspberry + peach
  ['Meadow',    'light', 120, 26, 150, 90,  66],  // pale mint, emerald + citrus
  ['Porcelain', 'light', 210, 20, 220, 280, 70],  // cool white, azure + violet
]

/** Build a designer palette by name-index, spreading through the list. */
export function generateDesignerThemes(count: number): CustomTheme[] {
  const existing = getAllThemes()
  const takenNames = new Set(existing.map(t => t.name.toLowerCase()))
  const out: CustomTheme[] = []
  const start = Math.floor(Math.random() * DESIGNER_PALETTES.length)
  for (let i = 0; out.length < count && i < DESIGNER_PALETTES.length; i++) {
    const [pname, base, bgHue, bgSat, accentHue, accentHue2, accentSat] =
      DESIGNER_PALETTES[(start + i) % DESIGNER_PALETTES.length]
    let name = pname
    if (takenNames.has(name.toLowerCase())) {
      let n = 2
      while (takenNames.has(`${pname.toLowerCase()} ${n}`)) n++
      name = `${pname} ${n}`
    }
    takenNames.add(name.toLowerCase())
    out.push(buildThemeFromPalette(name, base, { bgHue, bgSat, accentHue, accentHue2, accentSat }))
  }
  // If more requested than curated palettes, top up with hue-spaced randoms.
  if (out.length < count) out.push(...generateLocalThemes(count - out.length))
  return out
}

/** Random, hue-spaced themes that avoid colors already in the catalog. */
export function generateLocalThemes(count: number): CustomTheme[] {
  const existing = getAllThemes()
  const takenNames = new Set(existing.map(t => t.name.toLowerCase()))
  const takenHues: number[] = loadCustomThemes().map(t => t.hue)
  const out: CustomTheme[] = []
  const step = 360 / count
  const start = Math.random() * 360
  for (let i = 0; i < count; i++) {
    let hue = (start + i * step + (Math.random() - 0.5) * step * 0.5) % 360
    // nudge away from hues already taken by earlier generations (<16° apart)
    const tooClose = (h2: number) => Math.abs(((hue - h2 + 540) % 360) - 180) < 16
    for (let tries = 0; tries < 6 && takenHues.some(tooClose); tries++) {
      hue = (hue + 23) % 360
    }
    takenHues.push(hue)
    const base: 'dark' | 'light' = Math.random() < 0.7 ? 'dark' : 'light'
    const name = nameForHue(hue, takenNames)
    takenNames.add(name.toLowerCase())
    out.push(buildCustomTheme(name, base, hue))
  }
  return out
}

/** AI-assisted generation with a fully offline fallback. Returns the new
 *  themes after persisting them. */
// Detect if two themes are visually too similar. Checks hue distance on
// background and accent to ensure each theme is genuinely distinct.
function isVisuallyDistinct(t1: { bgHue: number; accentHue: number; base: 'dark' | 'light' }, t2: { bgHue: number; accentHue: number; base: 'dark' | 'light' }): boolean {
  if (t1.base !== t2.base) return true // Different base modes are always distinct
  const hueDistance = (h1: number, h2: number) => {
    const d = Math.abs(h1 - h2)
    return Math.min(d, 360 - d)
  }
  // Both background and accent must have meaningful distance
  const bgDist = hueDistance(t1.bgHue, t2.bgHue)
  const accentDist = hueDistance(t1.accentHue, t2.accentHue)
  // Require at least 30° separation on BOTH hues to ensure visual variety
  return bgDist >= 30 && accentDist >= 30
}

export async function generateThemes(count = 7): Promise<CustomTheme[]> {
  const existingNames = getAllThemes().map(t => t.name).join(', ')
  let fresh: CustomTheme[] = []
  try {
    const res = await (window as any).electronAPI?.ai?.chat?.(
      [{
        role: 'user',
        content:
          `You are a senior UI designer. Design ${count} distinct, modern, BEAUTIFUL browser color themes — the kind you'd see in Arc, Linear, or Raycast. ` +
          `Existing theme names (do NOT reuse): ${existingNames}.\n` +
          `CRITICAL: Each theme's BACKGROUND hue and ACCENT hue must be DIFFERENT — a deep indigo background lit by warm amber, NOT indigo-on-indigo. Monochrome is forbidden.\n` +
          `CRITICAL: Themes must spread across the color wheel — ensure NO two themes have similar background OR accent hues. Variety only.\n` +
          `For each theme give a full palette:\n` +
          `- name: one or two evocative words\n` +
          `- base: "dark" (moody, most) or "light" (a couple, airy)\n` +
          `- bgHue: 0-359, background color\n` +
          `- bgSat: 12-45, background color intensity (low=neutral, high=saturated)\n` +
          `- accentHue: 0-359, MUST differ from bgHue by 40+ degrees\n` +
          `- accentHue2: 0-359, secondary accent for gradients (different from accentHue)\n` +
          `- accentSat: 70-100, accents vivid and confident\n` +
          `Spread across spectrum: jewels, sunset warmth, cyber cool, earthy naturals. Maximize variety.\n` +
          `Reply ONLY with JSON array, no prose:\n` +
          `[{"name":"...","base":"dark","bgHue":262,"bgSat":32,"accentHue":30,"accentHue2":330,"accentSat":92}]`,
      }],
      undefined, { preferCloud: true }
    )
    const m = String(res?.content || '').match(/\[[\s\S]*\]/)
    if (m && res?.provider !== 'error') {
      const takenNames = new Set(getAllThemes().map(t => t.name.toLowerCase()))
      const allExistingThemes = getAllThemes().map(t => ({
        bgHue: 'custom' in t ? t.hue : t.swatch[0],
        accentHue: 'hue' in t ? t.hue : (t.id.includes('ocean') ? 180 : t.id.includes('forest') ? 120 : 0),
        base: t.base,
      }))
      type Seed = { name?: string; base?: string; hue?: number; bgHue?: number; bgSat?: number; accentHue?: number; accentHue2?: number; accentSat?: number }
      const seeds = JSON.parse(m[0]) as Seed[]
      for (const s of seeds.slice(0, count)) {
        const base: 'dark' | 'light' = s.base === 'light' ? 'light' : 'dark'
        const num = (v: any, fb: number) => (typeof v === 'number' && isFinite(v) ? v : fb)
        const bgHue = num(s.bgHue, num(s.hue, Math.random() * 360))
        let accentHue = num(s.accentHue, s.hue != null ? s.hue : (bgHue + 150))
        // Enforce 40° separation rule even if model ignored it
        if (Math.abs(((accentHue - bgHue + 540) % 360) - 180) < 40) accentHue = (bgHue + 160) % 360
        const accentHue2 = num(s.accentHue2, (accentHue + 28) % 360)
        const bgSat = num(s.bgSat, 30)
        const accentSat = num(s.accentSat, 88)
        // Skip themes too similar to existing ones
        const candidate = { bgHue, accentHue, base }
        if (!allExistingThemes.every(e => isVisuallyDistinct(candidate, e))) continue
        let name = (s.name || '').trim().slice(0, 20) || nameForHue(accentHue, takenNames)
        if (takenNames.has(name.toLowerCase())) name = nameForHue(accentHue, takenNames)
        takenNames.add(name.toLowerCase())
        fresh.push(buildThemeFromPalette(name, base, { bgHue, bgSat, accentHue, accentHue2, accentSat }))
      }
    }
  } catch { /* offline or AI unavailable — fall through to curated designer palettes */ }

  if (fresh.length < count) fresh = fresh.concat(generateDesignerThemes(count - fresh.length))

  const all = [...loadCustomThemes(), ...fresh]
  saveCustomThemes(all)
  return fresh
}
