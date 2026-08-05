/**
 * AIHub Browser — theme quality: contrast, completeness, repair.
 *
 * Generated themes are the problem this solves. A random or model-picked
 * palette looks fine as two swatches and can still ship grey-on-grey body text
 * or an accent nobody can read a label on. Worse, a theme that simply omits a
 * variable leaves that part of the UI inheriting whatever the last theme set.
 *
 * So every theme — built-in, AI-generated or hand-made — is measured against
 * WCAG contrast ratios and a canonical token list before it is offered, and
 * can be repaired rather than rejected: keep the designer's hue, move the
 * lightness until the text is actually readable.
 */

/**
 * The variables a custom theme must define. Text colour is NOT among them:
 * in this app text comes from the base class (light-mode or dark) in
 * globals.css, and a theme only supplies surfaces and accents. Auditing a
 * theme therefore means checking those surfaces against the text colour its
 * base will pair them with — which is exactly where generated palettes fail.
 */
export const REQUIRED_TOKENS = [
  '--ds-bg', '--ds-bg-2', '--ds-bg-3',
  '--ds-accent', '--ds-accent-soft',
  '--aihub-bg', '--aihub-surface', '--aihub-card', '--aihub-accent',
] as const

export type TokenName = typeof REQUIRED_TOKENS[number]

/**
 * Text colours each base supplies, straight from globals.css. `text` is body
 * copy (--ds-text-1) and `muted` is secondary text (--ds-text-4).
 */
export const BASE_TEXT: Record<'dark' | 'light', { text: string; muted: string }> = {
  dark:  { text: '248 248 248', muted: '96 102 130' },
  light: { text: '18 18 36',    muted: '88 90 124' },
}

export interface Rgb { r: number; g: number; b: number }

/**
 * Parse the colour formats the theme system actually uses: "#rrggbb", "#rgb",
 * "r g b" and "r, g, b" (the space-separated triple Tailwind's rgb(var(--x))
 * pattern needs). Returns null for anything unparseable so callers can treat
 * a malformed token as a missing one rather than crashing a settings page.
 */
export function parseColor(value: string): Rgb | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const hex = raw.replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    }
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }

  const parts = raw.replace(/rgba?\(|\)/gi, '').split(/[\s,]+/).filter(Boolean).map(Number)
  if (parts.length >= 3 && parts.slice(0, 3).every(n => Number.isFinite(n) && n >= 0 && n <= 255)) {
    return { r: parts[0], g: parts[1], b: parts[2] }
  }
  return null
}

/** WCAG relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const rgbA = parseColor(a)
  const rgbB = parseColor(b)
  if (!rgbA || !rgbB) return 0
  const lumA = relativeLuminance(rgbA)
  const lumB = relativeLuminance(rgbB)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

export type WcagLevel = 'AAA' | 'AA' | 'AA-large' | 'fail'

export function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA-large'
  return 'fail'
}

export interface ThemeIssue {
  kind: 'missing' | 'unparseable' | 'contrast'
  token: string
  detail: string
  /** Measured ratio, for contrast issues. */
  ratio?: number
}

export interface ThemeAudit {
  ok: boolean
  issues: ThemeIssue[]
  /** Body text against the page background — the number that matters most. */
  textContrast: number
  mutedContrast: number
  accentContrast: number
  level: WcagLevel
}

/**
 * Measure a theme. Body text is held to AA (4.5:1); muted text and text on the
 * accent are held to the large-text bar (3:1), which is what they are actually
 * used for — secondary labels and button captions.
 */
export function auditTheme(vars: Record<string, string>, base: 'dark' | 'light' = 'dark'): ThemeAudit {
  const issues: ThemeIssue[] = []

  for (const token of REQUIRED_TOKENS) {
    const value = vars?.[token]
    if (value === undefined || value === null || value === '') {
      issues.push({ kind: 'missing', token, detail: 'not defined by this theme' })
    } else if (!parseColor(value)) {
      issues.push({ kind: 'unparseable', token, detail: `"${value}" is not a colour this app can read` })
    }
  }

  const bg = vars?.['--ds-bg']
  const surface = vars?.['--aihub-card'] || vars?.['--ds-bg-3']
  const accent = vars?.['--ds-accent']
  const { text, muted } = BASE_TEXT[base]

  // Body text and secondary text come from the base; what the theme controls
  // is what they sit ON. That pairing is the thing to measure.
  const textContrast = bg && parseColor(bg) ? contrastRatio(bg, text) : 0
  const mutedContrast = bg && parseColor(bg) ? contrastRatio(bg, muted) : 0
  // Accents carry links, active tabs and button fills — they must separate
  // from the background they are drawn on.
  const accentContrast = bg && accent && parseColor(accent) ? contrastRatio(bg, accent) : 0

  if (textContrast && textContrast < 4.5) {
    issues.push({ kind: 'contrast', token: '--ds-bg', ratio: textContrast, detail: `body text is hard to read on this background (${textContrast.toFixed(1)}:1)` })
  }
  if (mutedContrast && mutedContrast < 3) {
    issues.push({ kind: 'contrast', token: '--ds-bg', ratio: mutedContrast, detail: `secondary text nearly disappears into the background (${mutedContrast.toFixed(1)}:1)` })
  }
  if (accentContrast && accentContrast < 3) {
    issues.push({ kind: 'contrast', token: '--ds-accent', ratio: accentContrast, detail: `the accent barely separates from the background (${accentContrast.toFixed(1)}:1)` })
  }
  if (surface && bg && parseColor(surface) && parseColor(bg) && contrastRatio(surface, bg) < 1.05) {
    issues.push({ kind: 'contrast', token: '--aihub-card', ratio: contrastRatio(surface, bg), detail: 'cards are indistinguishable from the page behind them' })
  }

  return {
    ok: issues.length === 0,
    issues,
    textContrast,
    mutedContrast,
    accentContrast,
    level: wcagLevel(textContrast),
  }
}

function toHex({ r, g, b }: Rgb): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/**
 * Move a colour toward white or black until it clears `target` against
 * `against`, keeping its hue. Repairing beats rejecting: the palette the user
 * (or the model) chose survives, it just becomes readable.
 */
export function adjustForContrast(color: string, against: string, target: number): string {
  const start = parseColor(color)
  const backdrop = parseColor(against)
  if (!start || !backdrop) return color
  if (contrastRatio(color, against) >= target) return color

  // Push away from the backdrop: lighten on dark, darken on light.
  const towardWhite = relativeLuminance(backdrop) < 0.5
  let best = start
  for (let step = 1; step <= 20; step++) {
    const amount = step / 20
    const mixed: Rgb = towardWhite
      ? { r: start.r + (255 - start.r) * amount, g: start.g + (255 - start.g) * amount, b: start.b + (255 - start.b) * amount }
      : { r: start.r * (1 - amount), g: start.g * (1 - amount), b: start.b * (1 - amount) }
    best = mixed
    if (contrastRatio(toHex(mixed), against) >= target) break
  }
  return toHex(best)
}

/**
 * Fill in anything missing and repair unreadable text, returning a theme that
 * is safe to apply. `base` decides the sensible defaults for absent tokens.
 */
/**
 * Move a background toward the end of the scale its base belongs to (black for
 * a dark theme, white for a light one) until EVERY text colour that base will
 * put on it is readable.
 *
 * Direction is fixed by the base rather than derived per target: repairing
 * against body text and then against muted text independently pushes the
 * colour in opposite directions and undoes the first fix — a dark theme ends
 * up with a mid-grey page that fails both.
 */
export function adjustBackgroundForBase(
  background: string,
  base: 'dark' | 'light',
  targets: { color: string; min: number }[],
): string {
  const start = parseColor(background)
  if (!start) return background
  const passes = (value: string) => targets.every(t => contrastRatio(value, t.color) >= t.min)
  if (passes(background)) return background

  const toward = base === 'dark' ? 0 : 255
  let candidate = background
  for (let step = 1; step <= 24; step++) {
    const amount = step / 24
    candidate = toHex({
      r: start.r + (toward - start.r) * amount,
      g: start.g + (toward - start.g) * amount,
      b: start.b + (toward - start.b) * amount,
    })
    if (passes(candidate)) break
  }
  return candidate
}

/**
 * Fill in what is missing and repair what is unreadable, returning a theme
 * that is safe to apply.
 */
export function repairTheme(vars: Record<string, string>, base: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = { ...vars }
  const { text, muted } = BASE_TEXT[base]

  const fallbackBg = base === 'dark' ? '#101114' : '#F7F7FA'
  if (!out['--ds-bg'] || !parseColor(out['--ds-bg'])) out['--ds-bg'] = fallbackBg

  // Move the BACKGROUND, never the text: the text belongs to the base and is
  // shared by every theme, so "fixing" it here would break the others.
  out['--ds-bg'] = adjustBackgroundForBase(out['--ds-bg'], base, [
    { color: text, min: 4.5 },
    { color: muted, min: 3 },
  ])

  // Keep the app shell with the page, or a repaired page sits in an unrepaired frame.
  if (out['--aihub-bg']) out['--aihub-bg'] = out['--ds-bg']

  const accent = out['--ds-accent']
  if (accent && parseColor(accent) && contrastRatio(accent, out['--ds-bg']) < 3) {
    out['--ds-accent'] = adjustForContrast(accent, out['--ds-bg'], 3)
    if (out['--aihub-accent']) out['--aihub-accent'] = out['--ds-accent']
  }
  return out
}
