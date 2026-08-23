import { describe, it, expect } from 'vitest'
import { validateHandle, handleKey, containsInvisible, joinBlocker } from './communityHandle'
import { avatarSvg, avatarDataUri } from './communityAvatar'
import { CHANNELS, channelBySlug } from './community'

describe('validateHandle', () => {
  it('accepts an ordinary name and returns it normalized', () => {
    expect(validateHandle('  Grace   Mwangi ')).toEqual({ ok: true, value: 'Grace Mwangi' })
  })

  it('accepts non-Latin names', () => {
    expect(validateHandle('Мария').ok).toBe(true)
    expect(validateHandle('恩典恩典').ok).toBe(true)
  })

  // Several people named Grace is the expected case in this community, not an
  // edge case, so nothing here may depend on uniqueness.
  it('does not reject a name for being common', () => {
    expect(validateHandle('Grace').ok).toBe(true)
    expect(validateHandle('Grace').value).toBe('Grace')
  })

  it('rejects names that are too short or too long', () => {
    expect(validateHandle('ab').ok).toBe(false)
    expect(validateHandle('x'.repeat(25)).ok).toBe(false)
    expect(validateHandle('x'.repeat(24)).ok).toBe(true)
  })

  it('measures length in code points, not UTF-16 units', () => {
    // Four astral-plane characters: String.length says 8, a person says 4.
    expect(validateHandle('👍👍👍👍').ok).toBe(true)
  })

  it('rejects the impersonation characters', () => {
    // Built from code points rather than pasted: pasted invisibles make the
    // test unreadable and survive exactly one careless reformat.
    const ZWSP = String.fromCharCode(0x200B)   // zero-width space
    const RLO  = String.fromCharCode(0x202E)   // right-to-left override
    const NUL  = String.fromCharCode(0x0007)   // a C0 control
    const BOM  = String.fromCharCode(0xFEFF)   // byte-order mark used as a space

    expect(validateHandle('Gra' + ZWSP + 'ce').ok).toBe(false)
    expect(validateHandle('Grace' + RLO).ok).toBe(false)
    expect(validateHandle('Gra' + NUL + 'ce').ok).toBe(false)

    // U+FEFF is the odd one out: JS counts it as whitespace, so the `\s+`
    // collapse turns it into an ordinary space before the guard ever sees it.
    // "Gra ce" is a visibly different name, not a disguised one, so accepting
    // it is correct — the property that matters is enforced below.
    expect(validateHandle('Gra' + BOM + 'ce')).toEqual({ ok: true, value: 'Gra ce' })
  })

  // The actual security property, stated once instead of inferred from a list
  // of rejections: whatever route a hostile name takes — rejected outright or
  // normalized into something harmless — no invisible character is ever stored.
  it('never stores an invisible character, by any route', () => {
    const invisibles = [
      0x0007, 0x001F, 0x007F, 0x009F, 0x200B, 0x200D, 0x200F,
      0x202A, 0x202E, 0x2066, 0x2069, 0xFEFF,
    ]
    for (const cp of invisibles) {
      const ch = String.fromCharCode(cp)
      for (const candidate of [ch + 'Grace', 'Gra' + ch + 'ce', 'Grace' + ch]) {
        const out = validateHandle(candidate)
        if (out.ok) {
          expect(containsInvisible(out.value), `stored an invisible U+${cp.toString(16)}`)
            .toBe(false)
        }
      }
    }
  })

  it('rejects reserved words anywhere in the name, not just alone', () => {
    expect(validateHandle('admin').ok).toBe(false)
    expect(validateHandle('AIHub Support').ok).toBe(false)
    expect(validateHandle('the moderator').ok).toBe(false)
    // A name that merely contains a reserved word as part of a real word is
    // still rejected; that is the accepted cost of substring matching.
    expect(validateHandle('Administrator').ok).toBe(false)
  })

  it('rejects an empty or whitespace-only name with a usable message', () => {
    const out = validateHandle('   ')
    expect(out.ok).toBe(false)
    expect(out.error).toBeTruthy()
  })
})

describe('handleKey', () => {
  // Uniqueness that only compares raw strings is uniqueness in the database
  // and confusion in the room.
  it('treats case differences as the same name', () => {
    expect(handleKey('Grace')).toBe(handleKey('grace'))
    expect(handleKey('GRACE')).toBe(handleKey('Grace'))
  })

  it('treats width and spacing differences as the same name', () => {
    expect(handleKey('Ｇｒａｃｅ')).toBe(handleKey('Grace'))
    expect(handleKey('  Grace   Mwangi ')).toBe(handleKey('Grace Mwangi'))
  })

  it('keeps genuinely different names apart', () => {
    expect(handleKey('Grace')).not.toBe(handleKey('Gracie'))
  })

  // Documented gap rather than a claim of safety: a Cyrillic lookalike gets a
  // different key, and reporting covers it until confusable folding lands.
  it('does NOT yet fold cross-script lookalikes', () => {
    const cyrillicA = String.fromCharCode(0x0430)
    expect(handleKey('Gr' + cyrillicA + 'ce')).not.toBe(handleKey('Grace'))
  })
})

describe('avatarSvg', () => {
  it('is deterministic for one seed', () => {
    expect(avatarSvg('member-1')).toBe(avatarSvg('member-1'))
  })

  it('differs between seeds', () => {
    expect(avatarSvg('member-1')).not.toBe(avatarSvg('member-2'))
  })

  it('produces a well-formed, self-contained svg', () => {
    const svg = avatarSvg('member-1', 64)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('width="64"')
    // No upload path anywhere: the avatar must never reference a remote asset.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
  })

  it('mirrors horizontally, so it reads as a badge rather than noise', () => {
    const svg = avatarSvg('symmetry-check')
    const xs = [...svg.matchAll(/<rect x="(\d)" y="(\d)"/g)]
      .map(m => `${m[1]},${m[2]}`)
    const present = new Set(xs)
    for (const key of present) {
      const [x, y] = key.split(',').map(Number)
      expect(present.has(`${4 - x},${y}`)).toBe(true)
    }
  })

  it('encodes cleanly as a data uri', () => {
    expect(avatarDataUri('member-1')).toMatch(/^data:image\/svg\+xml;utf8,%3Csvg/)
  })
})

describe('CHANNELS', () => {
  it('has unique slugs', () => {
    expect(new Set(CHANNELS.map(c => c.slug)).size).toBe(CHANNELS.length)
  })

  it('covers every room the product asked for', () => {
    const slugs = CHANNELS.map(c => c.slug)
    for (const expected of [
      'bible-study', 'developers', 'cybersecurity',
      'traders', 'sports', 'entertainment', 'jobs',
    ]) {
      expect(slugs).toContain(expected)
    }
  })

  it('gives every channel the copy the UI needs', () => {
    for (const c of CHANNELS) {
      expect(c.name).toBeTruthy()
      expect(c.description).toBeTruthy()
      expect(c.icon).toBeTruthy()
      expect(c.accent).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('only Bible Study offers verse and prayer posts', () => {
    for (const c of CHANNELS) {
      const faithExtras = c.extras.filter(e => e === 'verse' || e === 'prayer')
      expect(faithExtras.length > 0).toBe(c.slug === 'bible-study')
    }
  })

  it('resolves by slug and returns undefined for an unknown one', () => {
    expect(channelBySlug('bible-study')?.name).toBe('Bible Study')
    expect(channelBySlug('nope')).toBeUndefined()
  })
})

describe('joinBlocker', () => {
  // The regression: an empty field behind a placeholder that read like a real
  // name, so the form looked finished and the button looked broken.
  it('asks for a name when the field is empty', () => {
    expect(joinBlocker('', true)).toMatch(/Type a name/)
    expect(joinBlocker('   ', true)).toMatch(/Type a name/)
  })

  it('asks for a different name when the one typed is rejected', () => {
    expect(joinBlocker('ab', true)).toMatch(/different name/)
    expect(joinBlocker('admin', true)).toMatch(/different name/)
  })

  it('asks for the checkbox once the name is fine', () => {
    expect(joinBlocker('Grace', false)).toMatch(/Tick the box/)
  })

  it('clears once both are satisfied', () => {
    expect(joinBlocker('Grace', true)).toBeNull()
  })

  // Whenever the button is disabled there must be a sentence saying why —
  // that is the actual invariant, not any one of the messages above.
  it('always explains itself when it blocks', () => {
    for (const handle of ['', '  ', 'ab', 'admin', 'Grace']) {
      for (const accepted of [true, false]) {
        const out = joinBlocker(handle, accepted)
        if (out !== null) expect(out.length).toBeGreaterThan(0)
      }
    }
  })
})
