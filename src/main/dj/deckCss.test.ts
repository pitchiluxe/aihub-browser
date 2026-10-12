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
  it('still hides every overlay layer and covers the window with the video', () => {
    expect(DECK_CLEAN_CSS).toContain('#movie_player>:not(.html5-video-container)')
    expect(DECK_CLEAN_CSS).toMatch(/video\{position:fixed!important/)
  })
})
