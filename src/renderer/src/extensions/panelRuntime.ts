// Shared panel chrome for extensions.
//
// Every extension that shows a UI used to hand-roll its own floating card, so
// they all looked different, none could be moved or collapsed, and the host
// page's CSS regularly mangled them. This runtime ships one window: glass card,
// draggable header, minimise and close, style-isolated in a shadow root so no
// page can touch it. Extensions get `AIHubPanel.create(...)` and fill in a body.
//
// It is prepended to every injected extension script (see withPanelRuntime) and
// is idempotent, so re-injection on navigation is free.

export const PANEL_RUNTIME = `(function(){
if (window.AIHubPanel) return;

var Z = 2147483000;
var OPEN = {};        // key -> panel
var CASCADE = 0;      // so two panels never land on exactly the same pixel

var CSS = [
  ':host{all:initial}',
  '*{box-sizing:border-box;margin:0;padding:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '.card{',
    'display:flex;flex-direction:column;overflow:hidden;',
    'width:100%;border-radius:16px;',
    'background:linear-gradient(180deg,rgba(21,22,38,0.97),rgba(13,14,26,0.98));',
    'border:1px solid rgba(255,255,255,0.10);',
    'box-shadow:0 24px 60px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.06);',
    '-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);',
    'color:#e9ebf5;font-size:13px;line-height:1.5;',
    'transition:width 180ms cubic-bezier(.2,.8,.2,1),border-radius 180ms cubic-bezier(.2,.8,.2,1);',
  '}',
  '.hd{display:flex;align-items:center;gap:9px;padding:0 8px 0 12px;height:42px;flex:0 0 auto;cursor:grab;user-select:none;position:relative}',
  '.hd:active{cursor:grabbing}',
  '.hd::after{content:"";position:absolute;left:12px;right:12px;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(150,138,255,0.5),transparent)}',
  '.ico{font-size:15px;line-height:1;filter:saturate(1.15)}',
  '.ttl{flex:1;min-width:0;font-size:12.5px;font-weight:600;letter-spacing:0.015em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#f3f4fb}',
  '.btn{display:flex;align-items:center;justify-content:center;width:24px;height:24px;flex:0 0 auto;border:0;border-radius:8px;background:transparent;color:#a9aec6;cursor:pointer;transition:background 120ms,color 120ms}',
  '.btn:hover{background:rgba(255,255,255,0.10);color:#fff}',
  '.btn svg{width:12px;height:12px;display:block}',
  '.bd{padding:12px 14px 14px;overflow:auto;max-height:min(62vh,520px);flex:1 1 auto}',
  '.bd::-webkit-scrollbar{width:8px}',
  '.bd::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:8px}',
  '.bd input,.bd textarea,.bd select{width:100%;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#f3f4fb;font-size:12.5px;outline:none;transition:border-color 120ms,background 120ms}',
  '.bd input:focus,.bd textarea:focus,.bd select:focus{border-color:rgba(150,138,255,0.65);background:rgba(255,255,255,0.08)}',
  '.bd button{padding:8px 14px;border-radius:10px;border:0;cursor:pointer;font-size:12.5px;font-weight:600;color:#fff;background:linear-gradient(135deg,#7c6cff,#5b8cff);transition:filter 120ms,transform 120ms}',
  '.bd button:hover{filter:brightness(1.12)}',
  '.bd button:active{transform:translateY(1px)}',
  '.bd iframe{width:100%;border:0;border-radius:12px;display:block;background:rgba(255,255,255,0.04)}',
  '.bd a{color:#a5b4ff}',
  ':host(.min) .bd{display:none}',
  ':host(.min) .card{border-radius:999px}',
  ':host(.min) .hd::after{opacity:0}',
].join('');

var ICON_MIN  = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 6h7"/></svg>';
var ICON_MAX  = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 2.5v7M2.5 6h7"/></svg>';
var ICON_CLS  = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>';

function store(key, val){
  try {
    if (val === undefined) { var r = localStorage.getItem('aihub.panel.' + key); return r ? JSON.parse(r) : null; }
    localStorage.setItem('aihub.panel.' + key, JSON.stringify(val));
  } catch (e) {}
  return null;
}

function create(opts){
  opts = opts || {};
  var key = opts.key || ('panel' + (++CASCADE));
  if (OPEN[key]) return OPEN[key];

  var width = Math.max(220, Math.min(opts.width || 340, 640));
  var host = document.createElement('div');
  var saved = store(key) || {};
  var offset = (CASCADE++ % 6) * 26;
  var top  = typeof saved.top  === 'number' ? saved.top  : 24 + offset;
  var left = typeof saved.left === 'number' ? saved.left : Math.max(12, window.innerWidth - width - 24 - offset);

  host.style.cssText = 'position:fixed;z-index:' + Z + ';top:' + top + 'px;left:' + left + 'px;width:' + width + 'px;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  var card = document.createElement('div'); card.className = 'card';
  var hd   = document.createElement('div'); hd.className = 'hd';
  var ico  = document.createElement('span'); ico.className = 'ico'; ico.textContent = opts.icon || '✨';
  var ttl  = document.createElement('div'); ttl.className = 'ttl'; ttl.textContent = opts.title || 'Extension';
  var bMin = document.createElement('button'); bMin.className = 'btn'; bMin.innerHTML = ICON_MIN; bMin.title = 'Minimise';
  var bCls = document.createElement('button'); bCls.className = 'btn'; bCls.innerHTML = ICON_CLS; bCls.title = 'Close';
  var bd   = document.createElement('div'); bd.className = 'bd';

  hd.appendChild(ico); hd.appendChild(ttl); hd.appendChild(bMin); hd.appendChild(bCls);
  card.appendChild(hd); card.appendChild(bd);
  root.appendChild(card);
  (document.body || document.documentElement).appendChild(host);

  var panel = {
    key: key, host: host, body: bd, minimized: false,
    setTitle: function(t){ ttl.textContent = t; return panel; },
    minimize: function(on){
      panel.minimized = on === undefined ? !panel.minimized : !!on;
      host.classList.toggle('min', panel.minimized);
      host.style.width = panel.minimized ? 'auto' : width + 'px';
      bMin.innerHTML = panel.minimized ? ICON_MAX : ICON_MIN;
      bMin.title = panel.minimized ? 'Expand' : 'Minimise';
      store(key, { top: parseInt(host.style.top, 10), left: parseInt(host.style.left, 10), min: panel.minimized });
      return panel;
    },
    remove: function(){
      try { host.remove(); } catch (e) {}
      delete OPEN[key];
      if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (e) {} }
      // Extensions guard re-injection with \`if (window['__ext_'+key]) return\`.
      // Closing the panel from its own × has to clear that guard too, or the
      // extension is stuck: its window is gone and it refuses to build another.
      try { delete window['__ext_' + key]; } catch (e) {}
    },
  };

  bMin.addEventListener('click', function(e){ e.stopPropagation(); panel.minimize(); });
  bCls.addEventListener('click', function(e){ e.stopPropagation(); panel.remove(); });

  // Drag by the header, clamped so a panel can never be lost off-screen.
  var dx = 0, dy = 0, dragging = false;
  hd.addEventListener('pointerdown', function(e){
    if (e.target === bMin || e.target === bCls || bMin.contains(e.target) || bCls.contains(e.target)) return;
    dragging = true;
    dx = e.clientX - host.offsetLeft;
    dy = e.clientY - host.offsetTop;
    try { hd.setPointerCapture(e.pointerId); } catch (err) {}
  });
  hd.addEventListener('pointermove', function(e){
    if (!dragging) return;
    var w = host.offsetWidth, h = host.offsetHeight;
    var nl = Math.max(6, Math.min(e.clientX - dx, window.innerWidth  - w - 6));
    var nt = Math.max(6, Math.min(e.clientY - dy, window.innerHeight - h - 6));
    host.style.left = nl + 'px';
    host.style.top  = nt + 'px';
  });
  hd.addEventListener('pointerup', function(e){
    if (!dragging) return;
    dragging = false;
    try { hd.releasePointerCapture(e.pointerId); } catch (err) {}
    store(key, { top: host.offsetTop, left: host.offsetLeft, min: panel.minimized });
  });

  OPEN[key] = panel;
  if (saved.min) panel.minimize(true);
  return panel;
}

window.AIHubPanel = {
  create: create,
  get: function(key){ return OPEN[key] || null; },
  destroy: function(key){ if (OPEN[key]) OPEN[key].remove(); },
  destroyAll: function(){ Object.keys(OPEN).forEach(function(k){ OPEN[k].remove(); }); },
};
})();`

/** Prepends the panel runtime to an extension's injected code. Idempotent in
 *  the page, so it is safe to apply on every injection. */
export function withPanelRuntime(code: string): string {
  return `${PANEL_RUNTIME}\n;${code}`
}
