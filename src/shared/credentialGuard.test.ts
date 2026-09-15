import { describe, it, expect } from 'vitest'
import {
  registrableDomain, isPunycode, foldLookalikes, editDistance,
  isLookalike, assessLogin, buildPasswordFieldScript,
} from './credentialGuard'

describe('registrableDomain', () => {
  it('reduces a URL to its registrable domain', () => {
    expect(registrableDomain('https://www.paypal.com/signin')).toBe('paypal.com')
    expect(registrableDomain('https://login.mail.google.com/')).toBe('google.com')
  })
  it('keeps the extra label for two-level suffixes', () => {
    expect(registrableDomain('https://shop.marksandspencer.co.uk/x')).toBe('marksandspencer.co.uk')
    expect(registrableDomain('https://www.abc.com.au')).toBe('abc.com.au')
  })
  it('accepts a bare hostname', () => {
    expect(registrableDomain('paypal.com')).toBe('paypal.com')
  })
  it('is empty for junk', () => {
    expect(registrableDomain('')).toBe('')
    expect(registrableDomain('   ')).toBe('')
  })
})

describe('isPunycode', () => {
  it('spots an encoded label anywhere in the name', () => {
    expect(isPunycode('xn--pypal-4ve.com')).toBe(true)
    expect(isPunycode('login.xn--80ak6aa92e.com')).toBe(true)
  })
  it('leaves ordinary domains alone', () => {
    expect(isPunycode('paypal.com')).toBe(false)
  })
})

describe('foldLookalikes', () => {
  it('folds the substitutions a reader slides over', () => {
    expect(foldLookalikes('paypa1')).toBe(foldLookalikes('paypal'))
    expect(foldLookalikes('g00gle')).toBe(foldLookalikes('google'))
    expect(foldLookalikes('rnicrosoft')).toBe(foldLookalikes('microsoft'))
  })
})

describe('editDistance', () => {
  it('measures small edits', () => {
    expect(editDistance('paypal', 'paypall')).toBe(1)
    expect(editDistance('paypal', 'paypal')).toBe(0)
    expect(editDistance('apple', 'maple')).toBe(2)
  })
  it('gives up past the cap rather than doing the work', () => {
    expect(editDistance('abc', 'zzzzzzzzzzzz', 2)).toBeGreaterThan(2)
  })
})

describe('isLookalike', () => {
  it('catches a character substitution', () => {
    expect(isLookalike('https://paypa1.com', 'paypal.com')).toBe(true)
    expect(isLookalike('https://g00gle.com', 'google.com')).toBe(true)
  })
  it('catches a typo one edit away', () => {
    expect(isLookalike('https://gihtub.com', 'github.com')).toBe(true)
  })
  it('catches the brand parked on somebody else’s domain', () => {
    expect(isLookalike('https://paypal.secure-login.example.net', 'paypal.com')).toBe(true)
    expect(isLookalike('https://paypal-account.example.net', 'paypal.com')).toBe(true)
  })
  it('does not flag the site itself', () => {
    expect(isLookalike('https://www.paypal.com/signin', 'paypal.com')).toBe(false)
  })
  it('does not flag unrelated sites', () => {
    expect(isLookalike('https://wikipedia.org', 'paypal.com')).toBe(false)
    expect(isLookalike('https://news.ycombinator.com', 'github.com')).toBe(false)
  })
  it('refuses to compare against short names, which collide by accident', () => {
    expect(isLookalike('https://bit.ly', 'bit.io')).toBe(false)
  })
})

describe('assessLogin', () => {
  const known = ['paypal.com', 'github.com', 'mybank.co.uk']

  it('says nothing on a site the user actually uses', () => {
    expect(assessLogin('https://www.paypal.com/signin', known).level).toBe('none')
    expect(assessLogin('https://shop.mybank.co.uk/login', known).level).toBe('none')
  })
  it('warns loudly about a lookalike and names what it resembles', () => {
    const v = assessLogin('https://paypa1.com/login', known)
    expect(v.level).toBe('warn')
    expect(v.resembles).toBe('paypal.com')
    expect(v.message).toContain('paypal.com')
  })
  it('warns about an encoded address', () => {
    expect(assessLogin('https://xn--pypal-4ve.com', known).level).toBe('warn')
  })
  it('gives a mild notice on an unfamiliar but unremarkable site', () => {
    const v = assessLogin('https://some-new-forum.example', known)
    expect(v.level).toBe('notice')
    expect(v.resembles).toBeUndefined()
  })
  it('stays silent when it knows nothing about the user yet', () => {
    // A fresh profile must not warn about every site the user visits.
    expect(assessLogin('https://anything.example', []).level).toBe('none')
  })
  it('is silent on junk input rather than guessing', () => {
    expect(assessLogin('', known).level).toBe('none')
  })
})

describe('buildPasswordFieldScript', () => {
  it('is a self-contained expression that cannot throw', () => {
    const src = buildPasswordFieldScript()
    expect(src.startsWith('(function(){')).toBe(true)
    expect(src).toContain("catch(e){ return 'no'; }")
  })
  it('requires the field to be visible, not merely present', () => {
    const src = buildPasswordFieldScript()
    expect(src).toContain('getBoundingClientRect')
    expect(src).toContain('visibility')
  })
})
