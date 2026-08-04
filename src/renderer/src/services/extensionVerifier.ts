import { CustomExt } from '../extensions/customExts'

// Runtime verification for generated extensions.
//
// The model sometimes emits an extension that parses as valid JSON and valid
// JavaScript but does nothing on the page — a stub that only logs, or a panel
// it forgets to append. Those are exactly the "created but doesn't work"
// extensions the user hit. Static analysis can't tell a working panel from a
// dead one, so we actually RUN each extension in an isolated sandbox and keep
// only the ones that visibly change the page and then clean themselves up.
//
// The sandbox is a `sandbox="allow-scripts"` iframe loaded from a blob: URL
// (both permitted by the renderer CSP: `frame-src 'self' blob:`). It never
// touches the real app DOM.
//
// The extension's code runs as REAL inline <script> blocks inside the harness,
// NOT via eval(). That distinction is load-bearing: a blob: document inherits
// the creator's CSP in Chromium, and our CSP has `script-src 'self'
// 'unsafe-inline'` with NO 'unsafe-eval' — so eval() throws, but an inline
// <script> runs. An earlier eval-based version of this verifier rejected every
// single extension for exactly that reason.

export interface VerifyResult {
  ok: boolean
  reason?: string          // why it failed, for the discard summary
}

const VERIFY_TIMEOUT_MS = 4000

// `</script>` inside the extension's own code would prematurely close the
// harness's script block. In JavaScript source that sequence only ever occurs
// inside a string or regex literal, where `<\/script>` is exactly equivalent —
// so this substitution is safe and standard.
function scriptSafe(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1')
}

// The harness records a DOM baseline, runs injectCode as a real inline script,
// checks the page actually changed, runs removeCode, and posts the verdict
// back to the opener. The extension code runs in its own <script> block (see
// the CSP note above — this is why it is not eval'd); a throw there is caught
// by window.onerror and reported rather than hanging.
function harnessHtml(injectCode: string, removeCode: string, token: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
  window.__H = { token: ${JSON.stringify(token)}, injectErr: '', removeErr: '' };
  window.addEventListener('error', function(e){ if(!window.__H.done) window.__H.injectErr = window.__H.injectErr || (e.message || 'error'); });
  // Count only what an extension would actually add — NOT the harness's own
  // <script> blocks, which live in <body> and would otherwise inflate every
  // measurement (making a do-nothing extension look like it added nodes).
  window.__cn = function(){ return document.body.querySelectorAll('*:not(script)').length; };
  window.__cs = function(){ return document.querySelectorAll('style, link[rel="stylesheet"]').length; };
  window.__H.beforeNodes = window.__cn();
  window.__H.beforeStyles = window.__cs();
</script>
<script>
  try { ${scriptSafe(injectCode)} } catch (e) { window.__H.injectErr = String(e && e.message || e); }
</script>
<script>
  (function(){
    var H = window.__H; H.done = true;
    function send(m){ try{ parent.postMessage(Object.assign({__extverify:H.token}, m), '*'); }catch(e){} }
    if (H.injectErr) { send({ ok:false, reason:'threw on inject: ' + H.injectErr }); return; }
    var added = (window.__cn() - H.beforeNodes) + (window.__cs() - H.beforeStyles);
    if (added <= 0) { send({ ok:false, reason:'adds nothing visible to the page' }); return; }
    try { ${scriptSafe(removeCode)} } catch (e) { H.removeErr = String(e && e.message || e); }
    var restored = window.__cn() + window.__cs();
    var baseline = H.beforeNodes + H.beforeStyles;
    send({ ok:true, added:added, cleanRemoval: !H.removeErr && restored <= baseline + 1, removeErr: H.removeErr });
  })();
</script>
</body></html>`
}

// Verify one extension. Resolves ok=false (never rejects) on any failure or
// timeout, so a single bad item can never break the batch.
export function verifyExtension(ext: Pick<CustomExt, 'injectCode' | 'removeCode'>): Promise<VerifyResult> {
  return new Promise<VerifyResult>(resolve => {
    let settled = false
    const token = `v${Date.now()}_${Math.random().toString(36).slice(2)}`
    const html = harnessHtml(ext.injectCode, ext.removeCode, token)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)

    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.style.cssText = 'position:fixed;width:1024px;height:768px;left:-99999px;top:-99999px;opacity:0;pointer-events:none;border:0'

    const cleanup = () => {
      window.removeEventListener('message', onMsg)
      clearTimeout(timer)
      try { iframe.remove() } catch {}
      try { URL.revokeObjectURL(url) } catch {}
    }
    const finish = (r: VerifyResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(r)
    }

    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.__extverify !== token) return
      if (!d.ok) { finish({ ok: false, reason: d.reason || 'did nothing' }); return }
      // Working extension. A messy teardown is a warning, not a rejection —
      // the extension still functions; we surface it in the reason for logs.
      finish({ ok: true, reason: d.cleanRemoval ? undefined : `leaves residue on removal${d.removeErr ? `: ${d.removeErr}` : ''}` })
    }

    const timer = setTimeout(() => finish({ ok: false, reason: 'timed out — likely hangs or never renders' }), VERIFY_TIMEOUT_MS)

    window.addEventListener('message', onMsg)
    iframe.src = url
    document.body.appendChild(iframe)
  })
}

// Verify a batch, preserving order. Runs sequentially so twenty sandboxes
// don't spin up at once; each is quick. Returns the passing extensions plus a
// short reason for each rejection (for the "N discarded" summary).
export async function verifyExtensions(
  exts: CustomExt[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ passed: CustomExt[]; rejected: { name: string; reason: string }[] }> {
  const passed: CustomExt[] = []
  const rejected: { name: string; reason: string }[] = []
  for (let i = 0; i < exts.length; i++) {
    const ext = exts[i]
    const r = await verifyExtension(ext)
    if (r.ok) passed.push(ext)
    else rejected.push({ name: ext.name, reason: r.reason || 'did not work' })
    onProgress?.(i + 1, exts.length)
  }
  return { passed, rejected }
}
