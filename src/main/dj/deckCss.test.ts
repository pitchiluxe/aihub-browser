import { describe, it, expect } from 'vitest'
import { DECK_CLEAN_CSS } from './deckCss'

describe('deck clean-up CSS', () => {
  it('never display:none the error panel — the state probe reads it via offsetParent', () => {
    for (const rule of DECK_CLEAN_CSS.split('}')) {
      if (!/display:none/.test(rule)) continue
      const selectors = rule.split('{')[0]
      expect(selectors).not.toMatch(/(^|,)\s*\.ytp-error\b/)
      if (selectors.includes('#movie_player>')) expect(selectors).toContain(':not(.ytp-error)')
    }
  })
  it('never uses :has() — re-checked on every DOM change, it held the player to 4 fps (measured)', () => {
    expect(DECK_CLEAN_CSS).not.toContain(':has(')
  })
  it('covers YouTube\'s logo/share/bezel by lifting the video, never by hiding its surroundings (that throttled it to ~4 fps)', () => {
    expect(DECK_CLEAN_CSS).not.toMatch(/body \*\{visibility:hidden/)
    expect(DECK_CLEAN_CSS).toMatch(/video\{[^}]*z-index:2147483647/)
  })
  it('hides the 2026 embed control layer (title, share, "More videos", logo) and the spinner by name', () => {
    // Shrunk, not hidden: hiding that layer in any way throttled the player (measured).
    expect(DECK_CLEAN_CSS).toMatch(/#player-controls,[^{]*\{transform:scale\(\.004\)!important/)
    expect(DECK_CLEAN_CSS).not.toMatch(/#player-controls,[^{]*\{(display:none|opacity:0)/)
    expect(DECK_CLEAN_CSS).toContain('.ytPlayerControlsContainerHost')
    expect(DECK_CLEAN_CSS).toContain('.ytp-spinner')
  })
  it('still hides every overlay layer and covers the window with the video', () => {
    expect(DECK_CLEAN_CSS).toContain('#movie_player>:not(.html5-video-container)')
    expect(DECK_CLEAN_CSS).toMatch(/video\{position:fixed!important/)
  })
})
