import { describe, it, expect } from 'vitest'
import { buildGenerationPrompt, parseGeneratedExtensions } from './extensionGenerator'

const EXISTING = [{ name: 'Dime', tagline: 'Dims the background while video plays', category: 'Media' }]

describe('generation prompt', () => {
  const prompt = buildGenerationPrompt('', EXISTING, 'TEST LENS')

  it('tells the model to build on the shared panel, not its own window', () => {
    expect(prompt).toContain('AIHubPanel.create')
    expect(prompt).toContain('MINIMISE')
    expect(prompt).toMatch(/do not add your own header, close button, position:fixed wrapper/)
  })

  it('bans the extensions that already exist a thousand times', () => {
    for (const cliche of ['dark mode', 'word counters', 'qr generators', 'password generators']) {
      expect(prompt.toLowerCase()).toContain(cliche)
    }
  })

  it('carries the per-batch creative angle', () => {
    expect(prompt).toContain('ANGLE FOR THIS BATCH')
    expect(prompt).toContain('TEST LENS')
  })

  it('varies the angle across runs', () => {
    const seen = new Set(
      Array.from({ length: 40 }, () => {
        const p = buildGenerationPrompt('', [])
        return p.slice(p.indexOf('ANGLE FOR THIS BATCH'), p.indexOf('OUTPUT —'))
      }),
    )
    expect(seen.size).toBeGreaterThan(1)
  })

  it('still lists what is already installed so nothing is duplicated', () => {
    expect(prompt).toContain('Dime')
  })
})

describe('parseGeneratedExtensions', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    name: 'Echo Trace',
    tagline: 'Replays what the page changed while you were reading',
    icon: '🌀',
    category: 'Developer',
    howTo: 'Toggle on, then watch the panel.',
    injectCode: "(function(){var K='__ext_echo';if(window[K])return;var p=AIHubPanel.create({key:'echo',title:'Echo Trace'});window[K]={remove:function(){p.remove();delete window[K];}};})()",
    removeCode: 'window.__ext_echo&&window.__ext_echo.remove()',
    ...over,
  })

  it('accepts a well-formed panel-based extension', () => {
    const { extensions, discarded } = parseGeneratedExtensions(JSON.stringify([item()]), [])
    expect(discarded).toBe(0)
    expect(extensions).toHaveLength(1)
    expect(extensions[0].name).toBe('Echo Trace')
    expect(extensions[0].injectCode).toContain('AIHubPanel.create')
  })

  it('drops items that duplicate an installed extension by function', () => {
    const { extensions } = parseGeneratedExtensions(
      JSON.stringify([item({ name: 'Dimmer', tagline: 'Dims the background while video plays' })]),
      EXISTING,
    )
    expect(extensions).toHaveLength(0)
  })

  it('salvages a batch truncated mid-array', () => {
    const full = JSON.stringify([item(), item({ name: 'Second', removeCode: 'window.x&&window.x.remove()' })])
    const truncated = full.slice(0, full.lastIndexOf('}') + 1)
    const { extensions } = parseGeneratedExtensions(truncated, [])
    expect(extensions.length).toBeGreaterThanOrEqual(1)
  })

  it('returns nothing usable when the model replies with prose', () => {
    expect(parseGeneratedExtensions('Sorry, I cannot do that.', []).extensions).toHaveLength(0)
  })
})
