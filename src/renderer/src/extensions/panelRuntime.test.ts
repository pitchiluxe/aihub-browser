import { describe, it, expect } from 'vitest'
import { PANEL_RUNTIME, withPanelRuntime } from './panelRuntime'

describe('panel runtime', () => {
  it('is syntactically valid JavaScript', () => {
    // Constructed, never called — a SyntaxError here means every extension
    // that ships with the runtime prepended would die on injection.
    expect(() => new Function(PANEL_RUNTIME)).not.toThrow()
  })

  it('defines the panel API extensions are told to use', () => {
    for (const member of ['window.AIHubPanel', 'create:', 'get:', 'destroy:', 'destroyAll:']) {
      expect(PANEL_RUNTIME).toContain(member)
    }
  })

  it('is idempotent, so re-injection on every navigation is free', () => {
    expect(PANEL_RUNTIME).toMatch(/if \(window\.AIHubPanel\) return/)
  })

  it('ships minimise as well as close', () => {
    expect(PANEL_RUNTIME).toContain("title = 'Minimise'")
    expect(PANEL_RUNTIME).toContain("bMin.title = panel.minimized ? 'Expand' : 'Minimise'")
    expect(PANEL_RUNTIME).toContain("bCls.title = 'Close'")
  })

  it('isolates itself from host page CSS', () => {
    expect(PANEL_RUNTIME).toContain('attachShadow')
    expect(PANEL_RUNTIME).toContain(':host{all:initial}')
  })

  it('only ever assigns innerHTML from its own constant icons', () => {
    const assignments = PANEL_RUNTIME.match(/innerHTML\s*=\s*([^;]+);/g) || []
    expect(assignments.length).toBeGreaterThan(0)
    for (const a of assignments) {
      expect(a).toMatch(/ICON_(MIN|MAX|CLS)/)
    }
  })

  it('prepends the runtime to extension code without altering it', () => {
    const code = "(function(){var p=AIHubPanel.create({key:'x'});})()"
    const out = withPanelRuntime(code)
    expect(out.startsWith('(function(){\nif (window.AIHubPanel) return;')).toBe(true)
    expect(out.endsWith(code)).toBe(true)
    expect(() => new Function(out)).not.toThrow()
  })
})
