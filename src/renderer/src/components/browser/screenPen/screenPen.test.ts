// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SCREEN_PEN_RUNTIME_SOURCE, type ScreenPenApi, type ScreenPenConfig, type ScreenPenEvent } from './screenPenRuntime'
import { buildInjectScript, DRAIN_SCRIPT, SNAPSHOT_SCRIPT } from './injectScript'

// The pen reaches web tabs as source text (toString + executeJavaScript), so
// nothing else in the suite proves that text runs. These tests evaluate the
// exact strings the app ships, in a scope with no access to this module —
// which is what catches the runtime quietly depending on something outside
// its own body.
//
// On new Function below: every string fed to it is a constant produced by the
// modules under test. Nothing here is attacker-reachable; evaluating the
// shipped script verbatim is the entire point.

const BASE: ScreenPenConfig = {
  position: null,
  canRecord: true,
  canCamera: true,
  cameraOn: true,
  cameraCorner: 'bottom-right',
  recordingStartedAt: null,
  notes: false,
  fixed: true,
  zIndex: 2147483646,
}

type Mount = (c: HTMLElement, cfg: ScreenPenConfig, emit: (e: ScreenPenEvent) => void) => ScreenPenApi

function isolatedRuntime(): Mount {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${SCREEN_PEN_RUNTIME_SOURCE})`)() as Mount
}

function runPageScript(script: string): any {
  // eslint-disable-next-line no-new-func
  return new Function(`return ${script}`)()
}

function shadowOf(): ShadowRoot {
  const host = Array.from(document.documentElement.querySelectorAll('div')).find(d => d.shadowRoot)
  if (!host?.shadowRoot) throw new Error('pen not mounted')
  return host.shadowRoot
}

const q = (sel: string) => shadowOf().querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(shadowOf().querySelectorAll(sel)) as HTMLElement[]
const byTitle = (prefix: string) => qa('button').find(b => b.title.startsWith(prefix)) as HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  // jsdom has no 2D canvas; the pen paints through whatever getContext returns.
  HTMLCanvasElement.prototype.getContext = (() => null) as any
})

afterEach(() => {
  try { (window as any).__aihub?.remove() } catch { /* already gone */ }
  // Hosts are appended to <html>, which body.innerHTML = '' does not clear.
  for (const d of Array.from(document.documentElement.querySelectorAll('div'))) if (d.shadowRoot) d.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('screenPenRuntime (serialised)', () => {
  it('mounts from its own source text with no outside references', () => {
    const events: ScreenPenEvent[] = []
    const pen = isolatedRuntime()(document.body, BASE, e => events.push(e))
    expect(q('.bar')).toBeTruthy()
    expect(q('canvas')).toBeTruthy()
    pen.destroy()
  })

  it('lays the toolbar out vertically', () => {
    const pen = isolatedRuntime()(document.body, BASE, () => {})
    const adopted = (shadowOf() as any).adoptedStyleSheets?.[0]
    const css = adopted
      ? Array.from(adopted.cssRules as CSSRuleList).map(r => r.cssText.replace(/\s+/g, '')).join('')
      : Array.from(shadowOf().querySelectorAll('style')).map(s => s.textContent).join('')
    expect(css).toMatch(/\.bar\{[^}]*flex-direction:column/)
    pen.destroy()
  })

  it('opens in click-through, and a tool switches it to drawing', () => {
    const pen = isolatedRuntime()(document.body, BASE, () => {})
    expect(q('.root').classList.contains('draw')).toBe(false)
    expect(q('.mode').textContent).toContain('Click')

    byTitle('Arrow').click()
    expect(q('.root').classList.contains('draw')).toBe(true)
    expect(byTitle('Arrow').classList.contains('on')).toBe(true)
    expect(q('.mode').textContent).toContain('Draw')
    pen.destroy()
  })

  it('Escape hands the page back from drawing, and only from drawing', () => {
    const pen = isolatedRuntime()(document.body, BASE, () => {})
    const pageSaw = vi.fn()
    document.body.addEventListener('keydown', pageSaw)

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(pageSaw).toHaveBeenCalledTimes(1) // click-through never swallows Escape

    byTitle('Pen').click()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(q('.root').classList.contains('draw')).toBe(false)
    expect(pageSaw).toHaveBeenCalledTimes(1)
    pen.destroy()
  })

  it('emits record, camera, corner and close for the host to act on', () => {
    const events: ScreenPenEvent[] = []
    const pen = isolatedRuntime()(document.body, BASE, e => events.push(e))

    byTitle('Record').click()
    byTitle('Camera bubble on').click()
    expect(events).toContainEqual({ kind: 'record' })
    expect(events).toContainEqual({ kind: 'camera', on: false })

    byTitle('Camera bubble off').click()
    byTitle('Camera bubble:').click()
    expect(events).toContainEqual({ kind: 'corner', corner: 'bottom-left' })

    byTitle('Close').click()
    expect(events[events.length - 1]).toEqual({ kind: 'close' })
    pen.destroy()
  })

  it('refuses to change the camera mid-recording, and shows a running clock', () => {
    const events: ScreenPenEvent[] = []
    const pen = isolatedRuntime()(document.body, BASE, e => events.push(e))
    pen.setRecording(Date.now() - 65_000)

    expect(byTitle('Stop recording').textContent).toContain('1:05')
    byTitle('The camera cannot be changed').click()
    expect(events.some(e => e.kind === 'camera')).toBe(false)
    expect(q('.toast').textContent).toMatch(/Stop the recording/)

    pen.setRecording(null)
    expect(byTitle('Record')).toBeTruthy()
    pen.destroy()
  })

  it('hides its chrome for a screenshot until the host has the frame', () => {
    const events: ScreenPenEvent[] = []
    const pen = isolatedRuntime()(document.body, BASE, e => events.push(e))
    byTitle('Photograph').click()
    expect(events).toContainEqual({ kind: 'screenshot' })
    expect(q('.root').classList.contains('capturing')).toBe(true)
    pen.showChrome()
    expect(q('.root').classList.contains('capturing')).toBe(false)
    pen.destroy()
  })

  it('remembers where the toolbar was dragged', () => {
    const events: ScreenPenEvent[] = []
    const pen = isolatedRuntime()(document.body, { ...BASE, position: { x: 20, y: 30 } }, e => events.push(e))
    const grip = q('.grip')
    // jsdom lays nothing out, so every rect is at 0,0: grabbing at (25,35)
    // holds the bar by that offset, and moving to (225,135) puts it at (200,100).
    grip.dispatchEvent(new MouseEvent('pointerdown', { clientX: 25, clientY: 35, button: 0 }))
    grip.dispatchEvent(new MouseEvent('pointermove', { clientX: 225, clientY: 135 }))
    grip.dispatchEvent(new MouseEvent('pointerup', { clientX: 225, clientY: 135 }))
    expect(events).toContainEqual({ kind: 'position', x: 200, y: 100 })
    pen.destroy()
  })

  it('hides the recorder where the host cannot record, and notes where there are none', () => {
    const pen = isolatedRuntime()(document.body, { ...BASE, canRecord: false }, () => {})
    expect(byTitle('Record')).toBeUndefined()
    expect(byTitle('New sticky note')).toBeUndefined()
    pen.destroy()
  })

  it('leaves nothing behind when destroyed', () => {
    const pen = isolatedRuntime()(document.body, BASE, () => {})
    pen.destroy()
    expect(Array.from(document.querySelectorAll('div')).some(d => d.shadowRoot)).toBe(false)
  })
})

describe('injected web-page script', () => {
  const inject = () => runPageScript(buildInjectScript({ ...BASE, notes: true }))

  it('injects once, and queues toolbar events for the host', () => {
    expect(inject()).toBe('injected')
    expect(inject()).toBe('present')

    byTitle('Record').click()
    const drained = JSON.parse(runPageScript(DRAIN_SCRIPT))
    expect(drained.events).toEqual([{ kind: 'record' }])
    expect(JSON.parse(runPageScript(DRAIN_SCRIPT)).events).toEqual([])
  })

  it('keeps existing sticky notes: same storage key, restored and snapshotted', () => {
    const key = '__aihub_notes::' + location.origin + location.pathname
    const old = [{ id: 'n1', x: 100, y: 120, text: 'pinned before the Screen Pen', title: 'Old note', color: 2 }]
    localStorage.setItem(key, JSON.stringify(old))

    inject()
    const note = document.getElementById('__aihub_note_n1')
    expect(note?.textContent).toContain('pinned before the Screen Pen')

    runPageScript(`window.__aihub_restoreNotes(${JSON.stringify(JSON.stringify([
      { id: 'n1', x: 0, y: 0, text: 'dupe' },
      { id: 'n2', x: 10, y: 10, text: 'from the app store' },
    ]))})`)
    expect(document.querySelectorAll('[id^="__aihub_note_"]').length).toBe(2)

    const snap = JSON.parse(runPageScript(SNAPSHOT_SCRIPT))
    expect(snap.notes.map((n: any) => n.id)).toEqual(['n1', 'n2'])
    localStorage.removeItem(key)
  })

  it('the toolbar note button pins a new note beside the toolbar', () => {
    inject()
    byTitle('New sticky note').click()
    expect(document.querySelectorAll('[id^="__aihub_note_"]').length).toBe(1)
    const drained = JSON.parse(runPageScript(DRAIN_SCRIPT))
    expect(drained.notes.notes).toHaveLength(1)
    expect(drained.events).toEqual([]) // handled in the page, never sent to the host
  })

  it('removes pen, notes and globals on close', () => {
    inject()
    byTitle('New sticky note').click()
    runPageScript('window.__aihub.remove()')
    expect(document.querySelectorAll('[id^="__aihub_note_"]').length).toBe(0)
    expect((window as any).__aihub_pen).toBeUndefined()
    expect(JSON.parse(runPageScript(DRAIN_SCRIPT))).toEqual({ missing: true })
    localStorage.clear()
  })
})
