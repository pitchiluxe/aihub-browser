// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { SCAN_PAGE_SCRIPT, fillFieldScript, clickElementScript } from './agentTools'

// These scripts are strings injected into a real page via tabview:execJs, so
// nothing else in the suite type-checks or exercises them — a typo or a
// too-loose matcher ships silently. Running them against a DOM is the only
// way to see what the user would see.
//
// The form is deliberately the shape a model gets wrong: fields addressed by
// name rather than by the id scan_page hands out, a <select> whose option
// text differs from its value, and a submit button addressed by its text.
//
// On eval/new Function/innerHTML below: every string fed to them is a
// constant from this file or from agentTools.ts. Nothing here is attacker-
// reachable — evaluating the shipped script verbatim is the entire point,
// since substituting a paraphrase would test something the app never runs.
// (The app itself never evals; it hands these strings to Electron's execJs,
// which runs them in the target tab.)
const FORM = `
  <form>
    <p><label for="cn">Customer name</label><input id="cn" name="customer_name" type="text"></p>
    <p><label for="tel">Telephone</label><input id="tel" name="telephone" type="tel"></p>
    <p><label>Email <input name="email" type="email" placeholder="you@example.com"></label></p>
    <p><label for="sz">Pizza size</label>
       <select id="sz" name="pizza_size">
         <option value="">Choose…</option>
         <option value="s">Small</option>
         <option value="m">Medium</option>
         <option value="l">Large</option>
       </select></p>
    <p><label for="di">Delivery instructions</label>
       <textarea id="di" name="delivery_instructions"></textarea></p>
    <input type="hidden" name="csrf" value="secret">
    <button type="button" id="go">Place order</button>
  </form>`

const run = (script: string): any => eval(script)
const field = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)!

let events: string[] = []

beforeEach(() => {
  document.body.innerHTML = FORM
  events = []
  // jsdom has no layout and no scrolling, so the two things the scripts lean
  // on have to be supplied: a non-zero rect (the visibility filter) and a
  // no-op scrollIntoView (absent entirely, and it would throw).
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const hidden = (this as HTMLInputElement).type === 'hidden'
    return { width: hidden ? 0 : 120, height: hidden ? 0 : 20, top: 0, left: 0, bottom: 20, right: 120, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
  Element.prototype.scrollIntoView = () => {}
  // jsdom implements no rendering, so it has no innerText at all — the
  // property the scripts read labels and button text from. Chromium has it;
  // map it onto textContent so the label-matching paths are actually exercised
  // rather than silently skipped by the scripts' filter(Boolean).
  if (!('innerText' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) { return this.textContent },
      set(this: HTMLElement, v: string) { this.textContent = v },
    })
  }
  for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
    el.addEventListener('input',  () => events.push(`input:${(el as HTMLInputElement).name}`))
    el.addEventListener('change', () => events.push(`change:${(el as HTMLInputElement).name}`))
  }
  document.getElementById('go')!.addEventListener('click', () => events.push('clicked'))
})

describe('scan_page', () => {
  it('numbers every visible control and reads its label', () => {
    const res = run(SCAN_PAGE_SCRIPT)
    expect(res.elements.map((e: any) => e.label)).toEqual([
      // "Email" not the placeholder: a real <label> wins over placeholder text.
      'Customer name', 'Telephone', 'Email', 'Pizza size', 'Delivery instructions', 'Place order',
    ])
    expect(res.elements.map((e: any) => e.id)).toEqual([1, 2, 3, 4, 5, 6])
    // The hidden CSRF field is not something the model may address.
    expect(res.elements.some((e: any) => e.label === 'csrf')).toBe(false)
  })

  it('returns a select’s options so the model can pick one', () => {
    const sel = run(SCAN_PAGE_SCRIPT).elements.find((e: any) => e.kind === 'select')
    expect(sel.options).toEqual(['Choose…', 'Small', 'Medium', 'Large'])
  })
})

describe('fill_field', () => {
  it('fills by the numeric id scan_page handed out', () => {
    run(SCAN_PAGE_SCRIPT)
    expect(run(fillFieldScript('1', 'Test User'))).toEqual({ ok: true, nowContains: 'Test User' })
    expect(field('customer_name').value).toBe('Test User')
  })

  it('fills by the field’s own name when the model never scanned', () => {
    for (const [ref, val] of [
      ['customer_name', 'Test User'],
      ['telephone', '555-0142'],
      ['email', 'test@example.com'],
      ['delivery_instructions', 'Leave at front desk'],
    ]) {
      expect(run(fillFieldScript(ref, val)), ref).toMatchObject({ ok: true })
    }
    expect(field('customer_name').value).toBe('Test User')
    expect(field('telephone').value).toBe('555-0142')
    expect(field('email').value).toBe('test@example.com')
    expect(field('delivery_instructions').value).toBe('Leave at front desk')
  })

  it('fills by the visible label too', () => {
    expect(run(fillFieldScript('Delivery instructions', 'Ring twice'))).toMatchObject({ ok: true })
    expect(field('delivery_instructions').value).toBe('Ring twice')
  })

  it('matches a dropdown on option text, not value', () => {
    expect(run(fillFieldScript('pizza_size', 'large'))).toMatchObject({ ok: true })
    expect(field('pizza_size').value).toBe('l')
  })

  it('fires input and change so React and Vue forms see the value', () => {
    run(fillFieldScript('telephone', '555-0142'))
    expect(events).toEqual(['input:telephone', 'change:telephone'])
  })

  // The bug this file exists for. A select holding "l" was matched by the
  // loose fallback for ANY reference containing an l — "nonexistent_field"
  // hits it via "fie(l)d" — so a mistyped field name silently wrote the
  // user's data into an unrelated control instead of reporting the miss.
  it('reports a miss instead of writing into some other field', () => {
    run(fillFieldScript('pizza_size', 'large'))
    const before = field('pizza_size').value
    const res = run(fillFieldScript('nonexistent_field', 'x'))
    expect(res.error).toMatch(/no field matches/)
    expect(field('pizza_size').value).toBe(before)
  })

  it('never treats a field’s current contents as its name', () => {
    run(fillFieldScript('customer_name', 'Test User'))
    // "Test User" is now a value on the page, but no field is CALLED that.
    expect(run(fillFieldScript('Test User', 'oops')).error).toMatch(/no field matches/)
    expect(field('customer_name').value).toBe('Test User')
  })

  it('refuses a reference too short to identify anything', () => {
    expect(run(fillFieldScript('e', 'oops')).error).toMatch(/no field matches/)
    expect(field('email').value).toBe('')
  })
})

describe('click_element', () => {
  it('clicks by the button’s visible text', () => {
    expect(run(clickElementScript('Place order'))).toEqual({ ok: true, clicked: 'Place order' })
    expect(events).toEqual(['clicked'])
  })

  it('clicks by the scan id', () => {
    run(SCAN_PAGE_SCRIPT)
    expect(run(clickElementScript('6'))).toMatchObject({ ok: true })
    expect(events).toEqual(['clicked'])
  })

  it('reports a miss rather than clicking something else', () => {
    expect(run(clickElementScript('Cancel order')).error).toMatch(/nothing matches/)
    expect(events).toEqual([])
  })
})

describe('injected scripts are valid JavaScript', () => {
  it('parses, including references carrying quotes', () => {
    for (const s of [SCAN_PAGE_SCRIPT, fillFieldScript(`O'Brien "x"`, `it's a "test"`), clickElementScript(`Don't`)]) {
      expect(() => new Function(`return ${s}`)).not.toThrow()
    }
  })
})
