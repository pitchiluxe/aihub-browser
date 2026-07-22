import { describe, it, expect } from 'vitest'
import { API_SCOPES, apiIsGranted } from './scopes'

// The Mail page's right-click actions (star, mark read/unread, archive) and
// marking a thread read on open all call Gmail's threads.modify endpoint, which
// requires the gmail.modify scope. Requesting only gmail.readonly makes every
// one of those 403 — the label change never persists, so a refresh reverts read
// mail back to unread and drops stars. Guard the scope so that regression can't
// come back silently.
describe('gmail oauth scopes', () => {
  it('requests gmail.modify so label writes (read/star/archive) persist', () => {
    expect(API_SCOPES.gmail).toContain('https://www.googleapis.com/auth/gmail.modify')
  })

  it('does not rely on read-only alone for Gmail', () => {
    const readonlyOnly = ['https://www.googleapis.com/auth/gmail.readonly']
    expect(apiIsGranted('gmail', readonlyOnly)).toBe(false)
  })

  it('keeps send capability for composing mail', () => {
    expect(API_SCOPES.gmail).toContain('https://www.googleapis.com/auth/gmail.send')
  })
})
