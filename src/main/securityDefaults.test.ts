import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { join } from 'path'

// Static guard on window hardening. The app window renders untrusted text
// (clipped pages, AI replies, community posts) and holds the preload bridge;
// switching these off once took a full audit to notice.
describe('BrowserWindow security defaults', () => {
  const src = fs.readFileSync(join(__dirname, 'index.ts'), 'utf-8')

  it('never disables webSecurity', () => {
    expect(src).not.toMatch(/webSecurity:\s*false/)
  })
  it('never enables Node integration or disables context isolation', () => {
    expect(src).not.toMatch(/nodeIntegration:\s*true/)
    expect(src).not.toMatch(/contextIsolation:\s*false/)
  })
  it('never allows insecure content', () => {
    expect(src).not.toMatch(/allowRunningInsecureContent:\s*true/)
  })
})
