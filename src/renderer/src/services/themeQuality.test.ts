import { describe, it, expect } from 'vitest'
import {
  parseColor, relativeLuminance, contrastRatio, wcagLevel,
  auditTheme, adjustForContrast, adjustBackgroundForBase, repairTheme,
  REQUIRED_TOKENS, BASE_TEXT,
} from './themeQuality'

/** A theme shaped like the ones buildThemeFromPalette produces. */
const darkTheme = (over: Record<string, string> = {}): Record<string, string> => ({
  '--ds-bg': '#101114', '--ds-bg-2': '#17181D', '--ds-bg-3': '#1E2027',
  '--ds-accent': '#6B4EFF', '--ds-accent-soft': '#8E79FF',
  '--aihub-bg': '#101114', '--aihub-surface': '#17181D', '--aihub-card': '#1E2027', '--aihub-accent': '#6B4EFF',
  ...over,
})

describe('parseColor', () => {
  it('reads the formats the theme system uses', () => {
    expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    // The space-separated triple is what rgb(var(--token)) needs.
    expect(parseColor('16 17 20')).toEqual({ r: 16, g: 17, b: 20 })
    expect(parseColor('rgb(16, 17, 20)')).toEqual({ r: 16, g: 17, b: 20 })
  })
  it('returns null rather than throwing on nonsense', () => {
    expect(parseColor('')).toBeNull()
    expect(parseColor('chartreuse-ish')).toBeNull()
    expect(parseColor('300 0 0')).toBeNull()
    expect(parseColor(undefined as any)).toBeNull()
  })
})

describe('relativeLuminance / contrastRatio', () => {
  it('matches the WCAG reference points', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 3)
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 3)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 3)
  })
  it('is symmetric and safe on bad input', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 6)
    expect(contrastRatio('nope', '#fff')).toBe(0)
  })
})

describe('wcagLevel', () => {
  it('bands the ratio the way the spec does', () => {
    expect(wcagLevel(21)).toBe('AAA')
    expect(wcagLevel(7)).toBe('AAA')
    expect(wcagLevel(5)).toBe('AA')
    expect(wcagLevel(3.2)).toBe('AA-large')
    expect(wcagLevel(2)).toBe('fail')
  })
})

describe('BASE_TEXT', () => {
  it('carries the real globals.css text colours for both bases', () => {
    expect(contrastRatio(BASE_TEXT.dark.text, '#101114')).toBeGreaterThan(4.5)
    expect(contrastRatio(BASE_TEXT.light.text, '#F7F7FA')).toBeGreaterThan(4.5)
  })
})

describe('auditTheme', () => {
  it('passes a well-built dark theme', () => {
    const audit = auditTheme(darkTheme(), 'dark')
    expect(audit.ok).toBe(true)
    expect(audit.issues).toEqual([])
    expect(audit.textContrast).toBeGreaterThan(4.5)
    expect(['AA', 'AAA']).toContain(audit.level)
  })

  it('catches a background too pale for the dark base — the failure two swatches hide', () => {
    const audit = auditTheme(darkTheme({ '--ds-bg': '#C9CAD0' }), 'dark')
    expect(audit.ok).toBe(false)
    expect(audit.issues.some(i => i.kind === 'contrast' && i.detail.includes('body text'))).toBe(true)
    expect(audit.level).toBe('fail')
  })

  it('catches a background too dark for the light base', () => {
    const audit = auditTheme(darkTheme({ '--ds-bg': '#1A1A20' }), 'light')
    expect(audit.issues.some(i => i.kind === 'contrast')).toBe(true)
  })

  it('catches an accent that disappears into its own background', () => {
    const audit = auditTheme(darkTheme({ '--ds-accent': '#131418' }), 'dark')
    expect(audit.issues.some(i => i.token === '--ds-accent')).toBe(true)
  })

  it('catches cards that are invisible against the page', () => {
    const audit = auditTheme(darkTheme({ '--aihub-card': '#101114' }), 'dark')
    expect(audit.issues.some(i => i.token === '--aihub-card')).toBe(true)
  })

  it('reports every missing token by name', () => {
    const audit = auditTheme({ '--ds-bg': '#101114' }, 'dark')
    const missing = audit.issues.filter(i => i.kind === 'missing').map(i => i.token)
    expect(missing).toEqual(REQUIRED_TOKENS.filter(t => t !== '--ds-bg'))
  })

  it('treats an unreadable colour value as a defect, not a crash', () => {
    const audit = auditTheme(darkTheme({ '--ds-bg-2': 'blurple' }), 'dark')
    expect(audit.issues.some(i => i.kind === 'unparseable' && i.token === '--ds-bg-2')).toBe(true)
  })
})

describe('adjustForContrast', () => {
  it('leaves a colour alone when it already passes', () => {
    expect(adjustForContrast('#ffffff', '#000000', 4.5)).toBe('#ffffff')
  })

  it('darkens a background until light text can be read on it', () => {
    const fixed = adjustForContrast('#C9CAD0', BASE_TEXT.dark.text, 4.5)
    expect(contrastRatio(fixed, BASE_TEXT.dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  it('lightens a background until dark text can be read on it', () => {
    const fixed = adjustForContrast('#3A3B40', BASE_TEXT.light.text, 4.5)
    expect(contrastRatio(fixed, BASE_TEXT.light.text)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the hue recognisable rather than snapping to black or white', () => {
    const fixed = adjustForContrast('#7A2020', '#F7F7FA', 4.5)
    const rgb = parseColor(fixed)!
    expect(rgb.r).toBeGreaterThan(rgb.g)
    expect(rgb.r).toBeGreaterThan(rgb.b)
  })

  it('returns the input untouched when a colour cannot be parsed', () => {
    expect(adjustForContrast('nope', '#000', 4.5)).toBe('nope')
  })
})

describe('adjustBackgroundForBase', () => {
  it('satisfies body text and muted text at once, without ping-ponging', () => {
    const fixed = adjustBackgroundForBase('#C9CAD0', 'dark', [
      { color: BASE_TEXT.dark.text, min: 4.5 },
      { color: BASE_TEXT.dark.muted, min: 3 },
    ])
    expect(contrastRatio(fixed, BASE_TEXT.dark.text)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(fixed, BASE_TEXT.dark.muted)).toBeGreaterThanOrEqual(3)
  })

  it('moves toward white for a light base', () => {
    const fixed = adjustBackgroundForBase('#3A3B40', 'light', [{ color: BASE_TEXT.light.text, min: 4.5 }])
    expect(relativeLuminance(parseColor(fixed)!)).toBeGreaterThan(relativeLuminance(parseColor('#3A3B40')!))
  })

  it('leaves a passing background untouched', () => {
    expect(adjustBackgroundForBase('#101114', 'dark', [{ color: BASE_TEXT.dark.text, min: 4.5 }])).toBe('#101114')
  })
})

describe('repairTheme', () => {
  it('turns an unreadable generated theme into a usable one', () => {
    const broken = darkTheme({ '--ds-bg': '#C9CAD0', '--aihub-bg': '#C9CAD0' })
    const audit = auditTheme(repairTheme(broken, 'dark'), 'dark')
    expect(audit.issues.filter(i => i.kind === 'contrast')).toEqual([])
  })

  it('fixes the background rather than the text — the text belongs to every theme', () => {
    const repaired = repairTheme(darkTheme({ '--ds-bg': '#C9CAD0' }), 'dark')
    expect(repaired['--ds-text']).toBeUndefined()
    expect(repaired['--ds-bg']).not.toBe('#C9CAD0')
  })

  it('keeps the app shell in step with the repaired page background', () => {
    const repaired = repairTheme(darkTheme({ '--ds-bg': '#C9CAD0', '--aihub-bg': '#C9CAD0' }), 'dark')
    expect(repaired['--aihub-bg']).toBe(repaired['--ds-bg'])
  })

  it('lifts an accent that had vanished into the background', () => {
    const repaired = repairTheme(darkTheme({ '--ds-accent': '#131418' }), 'dark')
    expect(contrastRatio(repaired['--ds-accent'], repaired['--ds-bg'])).toBeGreaterThanOrEqual(3)
  })

  it('supplies a background when the theme forgot one', () => {
    expect(parseColor(repairTheme({}, 'light')['--ds-bg'])).not.toBeNull()
    expect(relativeLuminance(parseColor(repairTheme({}, 'light')['--ds-bg'])!)).toBeGreaterThan(0.5)
  })

  it('is idempotent — repairing a repaired theme changes nothing', () => {
    const once = repairTheme(darkTheme({ '--ds-bg': '#C9CAD0' }), 'dark')
    expect(repairTheme(once, 'dark')).toEqual(once)
  })

  it('leaves a good theme exactly as its designer made it', () => {
    const good = darkTheme()
    expect(repairTheme(good, 'dark')).toEqual(good)
  })
})
