import { describe, it, expect } from 'vitest'
import { isSecondaryWindow, initialUrlFrom, ownsSession } from './windowRole'

describe('initialUrlFrom', () => {
  it('reads the page a detached window was opened for', () => {
    expect(initialUrlFrom('?initialUrl=https%3A%2F%2Fexample.com%2Fa'))
      .toBe('https://example.com/a')
  })
  it('works with or without the leading question mark', () => {
    expect(initialUrlFrom('initialUrl=https://example.com')).toBe('https://example.com')
  })
  it('is null for the launch window', () => {
    expect(initialUrlFrom('')).toBeNull()
    expect(initialUrlFrom('?')).toBeNull()
    expect(initialUrlFrom('?something=else')).toBeNull()
  })
  it('is null for an empty or whitespace value', () => {
    expect(initialUrlFrom('?initialUrl=')).toBeNull()
    expect(initialUrlFrom('?initialUrl=%20%20')).toBeNull()
  })
  it('refuses a scheme that is not http(s)', () => {
    // The value is one this process wrote for itself, but it still arrives as
    // a string in a renderer's address bar.
    expect(initialUrlFrom('?initialUrl=file%3A%2F%2F%2FC%3A%2Fsecret.txt')).toBeNull()
    expect(initialUrlFrom('?initialUrl=javascript%3Aalert(1)')).toBeNull()
    expect(initialUrlFrom('?initialUrl=aihub%3A%2F%2Fsettings')).toBeNull()
  })
})

describe('isSecondaryWindow / ownsSession', () => {
  it('treats a detached window as secondary', () => {
    const search = '?initialUrl=https%3A%2F%2Fexample.com'
    expect(isSecondaryWindow(search)).toBe(true)
    // The bug this prevents: a detached window restoring every tab from the
    // last session on top of the single page it was opened for.
    expect(ownsSession(search)).toBe(false)
  })

  it('treats the launch window as the one that owns the session', () => {
    expect(isSecondaryWindow('')).toBe(false)
    expect(ownsSession('')).toBe(true)
  })

  it('does not treat a malformed initialUrl as secondary', () => {
    // Falling back to "secondary" here would leave a window that neither
    // restores nor saves, which loses tabs silently.
    expect(ownsSession('?initialUrl=not-a-url')).toBe(true)
  })

  it('gives restore and save the same answer', () => {
    for (const search of ['', '?initialUrl=https://a.test', '?x=1']) {
      expect(ownsSession(search)).toBe(!isSecondaryWindow(search))
    }
  })
})
