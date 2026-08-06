import type { ExtensionDef } from './extensionDefs'

/**
 * AIHub Browser — the built-in extension pack.
 *
 * Twenty tools that ship with the browser rather than being generated. Each
 * one exists because it answers a question a person actually asks while
 * looking at a page — "is this readable?", "what font is that?", "why is this
 * request slow?", "how long have I been on this site?" — and answers it in
 * place, without devtools, a second monitor or a paid service.
 *
 * House rules for everything here:
 *   - Every panel uses AIHubPanel, so they are all draggable, minimisable,
 *     closable, and sealed in a shadow root the host page cannot restyle.
 *   - Injection is idempotent: a page navigation re-injects, and the guard
 *     makes that free.
 *   - `remove` genuinely undoes everything — listeners, styles, observers and
 *     patched globals — because an extension that leaks after being switched
 *     off is worse than one that never worked.
 *   - No network calls. Everything is computed from the page in front of you.
 */

/** Wraps body code in the standard guard + cleanup registry. */
const ext = (id: string, body: string) => `(function(){
  var K='__ext_${id}';
  if (window[K]) return;
  var CLEAN=[];
  window[K]={clean:CLEAN};
  function onClean(fn){CLEAN.push(fn)}
  function on(t,ev,fn,opt){t.addEventListener(ev,fn,opt);onClean(function(){try{t.removeEventListener(ev,fn,opt)}catch(e){}})}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function css(text){var st=document.createElement('style');st.id='${id}-style';st.textContent=text;document.documentElement.appendChild(st);onClean(function(){try{st.remove()}catch(e){}});return st}
  try{
${body}
  }catch(e){console.warn('[aihub:${id}]',e)}
})()`

/** The matching teardown: run every registered cleanup, then forget the guard. */
const cleanup = (id: string) => `(function(){
  var K='__ext_${id}';
  var s=window[K];
  if(s&&s.clean)s.clean.forEach(function(f){try{f()}catch(e){}});
  try{if(window.AIHubPanel)window.AIHubPanel.destroy('${id}')}catch(e){}
  var st=document.getElementById('${id}-style');if(st)st.remove();
  try{delete window[K]}catch(e){window[K]=undefined}
})()`

export const EXTENSION_PACK: ExtensionDef[] = [
  // ── Developer ───────────────────────────────────────────────────────────
  {
    id: 'contrastaudit',
    name: 'Contrast Audit',
    tagline: 'Finds text nobody can read',
    description: 'Walks every visible text node, measures its colour against the background actually behind it, and lists the failures with their real WCAG ratio. Click a result to scroll to it and flash the element.',
    howTo: 'Enable, then press the Scan button in the panel. Failures are listed worst-first — click one to jump to it on the page.',
    icon: '◐', color: '#38bdf8', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'level', label: 'Standard', type: 'select', default: 'AA', options: [
        { value: 'AA', label: 'AA — 4.5:1 body text' },
        { value: 'AAA', label: 'AAA — 7:1 body text' },
      ] },
      { key: 'minSize', label: 'Ignore text under (px)', type: 'range', min: 0, max: 24, step: 1, default: 0 },
    ],
    inject: (s) => ext('contrastaudit', `
    var LEVEL=${JSON.stringify(s.level ?? 'AA')}, MIN=${+(s.minSize ?? 0)};
    var need=LEVEL==='AAA'?7:4.5;
    function lum(c){var p=c.map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2]}
    function parse(c){var m=(c||'').match(/[\\d.]+/g);return m&&m.length>=3?[+m[0],+m[1],+m[2],m[3]===undefined?1:+m[3]]:null}
    function bgOf(el){for(var n=el;n&&n!==document.documentElement;n=n.parentElement){var c=parse(getComputedStyle(n).backgroundColor);if(c&&c[3]>0.05)return c}return [255,255,255,1]}
    function ratio(a,b){var la=lum(a),lb=lum(b);return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05)}
    var panel=window.AIHubPanel.create({key:'contrastaudit',title:'Contrast Audit',icon:'◐',width:340});
    var bd=panel.body;
    function scan(){
      bd.innerHTML='<div style="opacity:.7">Scanning…</div>';
      var bad=[],seen=0;
      var walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);
      var node,list=[];
      while((node=walk.nextNode())&&list.length<4000){if(node.nodeValue&&node.nodeValue.trim().length>1)list.push(node)}
      list.forEach(function(t){
        var el=t.parentElement;if(!el)return;
        var st=getComputedStyle(el);
        if(st.visibility==='hidden'||st.display==='none'||+st.opacity===0)return;
        var size=parseFloat(st.fontSize)||0;if(size<MIN)return;
        var r=el.getBoundingClientRect();if(!r.width||!r.height)return;
        var fg=parse(st.color);if(!fg||fg[3]<0.5)return;
        seen++;
        var large=size>=24||(size>=18.66&&(+st.fontWeight>=700));
        var threshold=large?(LEVEL==='AAA'?4.5:3):need;
        var got=ratio(fg,bgOf(el));
        if(got<threshold)bad.push({el:el,got:got,need:threshold,text:t.nodeValue.trim().slice(0,52),size:Math.round(size)});
      });
      bad.sort(function(a,b){return a.got-b.got});
      if(!bad.length){bd.innerHTML='<div style="color:#6ee7b7">Every one of '+seen+' text runs passes '+LEVEL+'.</div>';return}
      bd.innerHTML='<div style="margin-bottom:8px;color:#fca5a5;font-weight:600">'+bad.length+' of '+seen+' fail '+LEVEL+'</div>';
      bad.slice(0,40).forEach(function(b){
        var row=document.createElement('div');
        row.style.cssText='padding:7px 9px;margin-bottom:6px;border-radius:9px;background:rgba(255,255,255,.05);cursor:pointer';
        row.innerHTML='<div style="font-weight:600;color:#fca5a5">'+b.got.toFixed(2)+':1 <span style="opacity:.55;font-weight:400">needs '+b.need+' · '+b.size+'px</span></div><div style="opacity:.75;font-size:11.5px;margin-top:2px">'+esc(b.text)+'</div>';
        row.onclick=function(){b.el.scrollIntoView({behavior:'smooth',block:'center'});var o=b.el.style.outline;b.el.style.outline='3px solid #f87171';setTimeout(function(){b.el.style.outline=o},1400)};
        bd.appendChild(row);
      });
    }
    var btn=document.createElement('button');btn.textContent='Scan this page';btn.style.marginBottom='10px';
    btn.onclick=scan;bd.appendChild(btn);
    var out=document.createElement('div');bd.appendChild(out);
    scan();`),
    remove: cleanup('contrastaudit'),
  },

  {
    id: 'cssspecimen',
    name: 'CSS Specimen',
    tagline: 'Click any element, copy its real styles',
    description: 'Point at anything on the page and get the computed typography, colour, spacing and radius that actually apply — as CSS or Tailwind classes, ready to paste.',
    howTo: 'Enable, then click any element on the page. Press Escape or the panel × to stop picking.',
    icon: '❖', color: '#a78bfa', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'format', label: 'Copy as', type: 'select', default: 'css', options: [
        { value: 'css', label: 'CSS declarations' },
        { value: 'tailwind', label: 'Tailwind-ish classes' },
      ] },
    ],
    inject: (s) => ext('cssspecimen', `
    var FMT=${JSON.stringify(s.format ?? 'css')};
    var panel=window.AIHubPanel.create({key:'cssspecimen',title:'CSS Specimen',icon:'❖',width:330});
    var bd=panel.body;bd.innerHTML='<div style="opacity:.7">Click any element on the page…</div>';
    var hi=document.createElement('div');
    hi.style.cssText='position:fixed;pointer-events:none;z-index:2147482999;border:2px solid #a78bfa;background:rgba(167,139,250,.14);border-radius:3px;display:none';
    document.documentElement.appendChild(hi);onClean(function(){hi.remove()});
    function px(v){return Math.round(parseFloat(v)||0)}
    function show(el){
      var st=getComputedStyle(el),r=el.getBoundingClientRect();
      var d={ 'font-family':st.fontFamily.split(',')[0].replace(/"/g,''),'font-size':px(st.fontSize)+'px','font-weight':st.fontWeight,'line-height':px(st.lineHeight)+'px','letter-spacing':st.letterSpacing,'color':st.color,'background':st.backgroundColor,'padding':st.padding,'margin':st.margin,'border-radius':st.borderRadius };
      var tw=['text-['+px(st.fontSize)+'px]','font-['+st.fontWeight+']','leading-['+px(st.lineHeight)+'px]','rounded-['+px(st.borderRadius)+'px]','p-['+st.padding.split(' ')[0]+']'];
      var text=FMT==='tailwind'?tw.join(' '):Object.keys(d).map(function(k){return k+': '+d[k]+';'}).join('\\n');
      bd.innerHTML='';
      var tag=document.createElement('div');
      tag.style.cssText='font-weight:600;margin-bottom:8px;color:#c4b5fd';
      tag.textContent='<'+el.tagName.toLowerCase()+'> · '+Math.round(r.width)+'×'+Math.round(r.height);
      bd.appendChild(tag);
      Object.keys(d).forEach(function(k){
        var row=document.createElement('div');
        row.style.cssText='display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px';
        row.innerHTML='<span style="opacity:.6">'+k+'</span><span style="font-family:ui-monospace,monospace">'+esc(d[k])+'</span>';
        bd.appendChild(row);
      });
      var b=document.createElement('button');b.textContent='Copy '+(FMT==='tailwind'?'classes':'CSS');b.style.marginTop='10px';
      b.onclick=function(){try{navigator.clipboard.writeText(text);b.textContent='Copied'; setTimeout(function(){b.textContent='Copy '+(FMT==='tailwind'?'classes':'CSS')},1200)}catch(e){}};
      bd.appendChild(b);
    }
    on(document,'mousemove',function(e){
      var el=e.target;if(!el||el===hi||panel.host.contains(el))return;
      var r=el.getBoundingClientRect();
      hi.style.display='block';hi.style.top=r.top+'px';hi.style.left=r.left+'px';hi.style.width=r.width+'px';hi.style.height=r.height+'px';
    },true);
    on(document,'click',function(e){
      if(panel.host.contains(e.target))return;
      e.preventDefault();e.stopPropagation();show(e.target);
    },true);
    on(document,'keydown',function(e){if(e.key==='Escape')hi.style.display='none'},true);`),
    remove: cleanup('cssspecimen'),
  },

  {
    id: 'gridoverlay',
    name: 'Layout Grid',
    tagline: 'Column and baseline grid over any page',
    description: 'Drops a configurable column grid and baseline rhythm over the page so you can see whether a layout actually lines up, instead of squinting at it.',
    howTo: 'Enable to see the grid. Adjust columns, gutter and baseline in the settings — changes apply instantly.',
    icon: '▦', color: '#f472b6', category: 'Design', version: '1.0.0',
    settings: [
      { key: 'columns', label: 'Columns', type: 'range', min: 2, max: 24, step: 1, default: 12 },
      { key: 'gutter', label: 'Gutter (px)', type: 'range', min: 0, max: 60, step: 2, default: 24 },
      { key: 'maxWidth', label: 'Container width (px)', type: 'range', min: 640, max: 1920, step: 40, default: 1200 },
      { key: 'baseline', label: 'Baseline (px, 0 = off)', type: 'range', min: 0, max: 40, step: 2, default: 8 },
    ],
    inject: (s) => ext('gridoverlay', `
    var COLS=${+(s.columns ?? 12)},GUT=${+(s.gutter ?? 24)},MAXW=${+(s.maxWidth ?? 1200)},BASE=${+(s.baseline ?? 8)};
    var wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147482990';
    var cols=document.createElement('div');
    cols.style.cssText='position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);width:min('+MAXW+'px,100%);display:grid;grid-template-columns:repeat('+COLS+',1fr);gap:'+GUT+'px;padding:0 '+GUT+'px';
    for(var i=0;i<COLS;i++){var c=document.createElement('div');c.style.cssText='background:rgba(244,114,182,.12);border-left:1px solid rgba(244,114,182,.35);border-right:1px solid rgba(244,114,182,.35)';cols.appendChild(c)}
    wrap.appendChild(cols);
    if(BASE>0){var b=document.createElement('div');b.style.cssText='position:absolute;inset:0;background:repeating-linear-gradient(to bottom,rgba(56,189,248,.22) 0 1px,transparent 1px '+BASE+'px)';wrap.appendChild(b)}
    document.documentElement.appendChild(wrap);onClean(function(){wrap.remove()});`),
    remove: cleanup('gridoverlay'),
  },

  {
    id: 'requestradar',
    name: 'Request Radar',
    tagline: 'Live network activity without devtools',
    description: 'Wraps fetch and XHR to show every request the page makes as it happens — method, path, status and how long it took — with the slow ones highlighted.',
    howTo: 'Enable, then use the page. Requests appear newest-first. Turn on "slow only" to see just the ones over your threshold.',
    icon: '◎', color: '#34d399', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'slowMs', label: 'Slow threshold (ms)', type: 'range', min: 100, max: 3000, step: 100, default: 800 },
      { key: 'slowOnly', label: 'Show slow requests only', type: 'toggle', default: false },
      { key: 'rows', label: 'Keep last N', type: 'range', min: 10, max: 200, step: 10, default: 60 },
    ],
    inject: (s) => ext('requestradar', `
    var SLOW=${+(s.slowMs ?? 800)},ONLY=${s.slowOnly ? 'true' : 'false'},ROWS=${+(s.rows ?? 60)};
    var panel=window.AIHubPanel.create({key:'requestradar',title:'Request Radar',icon:'◎',width:380});
    var bd=panel.body;var list=document.createElement('div');bd.appendChild(list);
    var count=0;
    function add(method,url,ms,status,failed){
      if(ONLY&&ms<SLOW&&!failed)return;
      count++;panel.setTitle('Request Radar · '+count);
      var slow=ms>=SLOW;
      var short=esc(String(url).replace(/^https?:\\/\\//,'').slice(0,46));
      var row=document.createElement('div');
      row.style.cssText='display:flex;gap:8px;align-items:center;padding:5px 7px;margin-bottom:4px;border-radius:8px;background:rgba(255,255,255,.04);font-size:11.5px'+(slow||failed?';border-left:2px solid '+(failed?'#f87171':'#fbbf24'):'');
      row.innerHTML='<span style="opacity:.55;width:38px">'+method+'</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+short+'</span><span style="color:'+(failed?'#f87171':slow?'#fbbf24':'#6ee7b7')+'">'+Math.round(ms)+'ms</span><span style="opacity:.5;width:28px;text-align:right">'+status+'</span>';
      list.insertBefore(row,list.firstChild);
      while(list.children.length>ROWS)list.removeChild(list.lastChild);
    }
    var of=window.fetch;
    if(of){
      window.fetch=function(){
        var t=performance.now(),u=(arguments[0]&&arguments[0].url)||arguments[0],m=(arguments[1]&&arguments[1].method)||'GET';
        return of.apply(this,arguments).then(function(r){add(m,u,performance.now()-t,r.status,!r.ok);return r},
          function(e){add(m,u,performance.now()-t,'ERR',true);throw e});
      };
      onClean(function(){window.fetch=of});
    }
    var OX=window.XMLHttpRequest&&window.XMLHttpRequest.prototype.open;
    if(OX){
      window.XMLHttpRequest.prototype.open=function(m,u){
        this.addEventListener('loadstart',function(){this.__t=performance.now()});
        this.addEventListener('loadend',function(){add(m,u,performance.now()-(this.__t||performance.now()),this.status,this.status>=400||this.status===0)});
        return OX.apply(this,arguments);
      };
      onClean(function(){window.XMLHttpRequest.prototype.open=OX});
    }`),
    remove: cleanup('requestradar'),
  },

  {
    id: 'consolesink',
    name: 'Console Sink',
    tagline: 'Page errors, visible without devtools',
    description: 'Catches console errors, warnings, unhandled promise rejections and script errors into a panel you can read while you browse — the ones that normally vanish unnoticed.',
    howTo: 'Enable and browse. Anything the page logs at your chosen level appears here, newest first.',
    icon: '⚠', color: '#fbbf24', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'level', label: 'Capture', type: 'select', default: 'warn', options: [
        { value: 'error', label: 'Errors only' },
        { value: 'warn', label: 'Errors + warnings' },
        { value: 'all', label: 'Everything (incl. log)' },
      ] },
    ],
    inject: (s) => ext('consolesink', `
    var LEVEL=${JSON.stringify(s.level ?? 'warn')};
    var want={error:['error'],warn:['error','warn'],all:['error','warn','log','info']}[LEVEL]||['error'];
    var panel=window.AIHubPanel.create({key:'consolesink',title:'Console Sink',icon:'⚠',width:400});
    var bd=panel.body;var list=document.createElement('div');bd.appendChild(list);
    var n=0;
    var COLOR={error:'#f87171',warn:'#fbbf24',log:'#93c5fd',info:'#93c5fd'};
    function add(kind,args){
      n++;panel.setTitle('Console Sink · '+n);
      var msg=Array.prototype.map.call(args,function(a){
        try{return typeof a==='string'?a:JSON.stringify(a)}catch(e){return String(a)}
      }).join(' ').slice(0,400);
      var row=document.createElement('div');
      row.style.cssText='padding:6px 8px;margin-bottom:5px;border-radius:8px;background:rgba(255,255,255,.04);border-left:2px solid '+(COLOR[kind]||'#888')+';font-size:11.5px;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word';
      row.textContent=msg;
      list.insertBefore(row,list.firstChild);
      while(list.children.length>120)list.removeChild(list.lastChild);
    }
    want.forEach(function(k){
      var orig=console[k];if(!orig)return;
      console[k]=function(){try{add(k,arguments)}catch(e){}return orig.apply(console,arguments)};
      onClean(function(){console[k]=orig});
    });
    on(window,'error',function(e){add('error',[e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno])});
    on(window,'unhandledrejection',function(e){add('error',['Unhandled rejection: '+(e.reason&&e.reason.message||e.reason)])});`),
    remove: cleanup('consolesink'),
  },

  {
    id: 'breakpoints',
    name: 'Breakpoint Ruler',
    tagline: 'Live viewport size and which breakpoint you are in',
    description: 'A small readout of the viewport size that names the active breakpoint for your framework, so responsive work stops being guesswork about where the next jump is.',
    howTo: 'Enable and resize the window. The badge shows width × height and the current breakpoint.',
    icon: '↔', color: '#60a5fa', category: 'Developer', version: '1.0.0',
    settings: [
      { key: 'preset', label: 'Breakpoints', type: 'select', default: 'tailwind', options: [
        { value: 'tailwind', label: 'Tailwind (sm/md/lg/xl/2xl)' },
        { value: 'bootstrap', label: 'Bootstrap (sm/md/lg/xl/xxl)' },
      ] },
      { key: 'corner', label: 'Position', type: 'select', default: 'bl', options: [
        { value: 'bl', label: 'Bottom left' },
        { value: 'br', label: 'Bottom right' },
        { value: 'tr', label: 'Top right' },
      ] },
    ],
    inject: (s) => ext('breakpoints', `
    var PRESET=${JSON.stringify(s.preset ?? 'tailwind')},CORNER=${JSON.stringify(s.corner ?? 'bl')};
    var BP=PRESET==='bootstrap'
      ? [[0,'xs'],[576,'sm'],[768,'md'],[992,'lg'],[1200,'xl'],[1400,'xxl']]
      : [[0,'—'],[640,'sm'],[768,'md'],[1024,'lg'],[1280,'xl'],[1536,'2xl']];
    var pos=CORNER==='br'?'bottom:14px;right:14px':CORNER==='tr'?'top:14px;right:14px':'bottom:14px;left:14px';
    var el=document.createElement('div');
    el.style.cssText='position:fixed;'+pos+';z-index:2147483000;padding:6px 11px;border-radius:999px;background:rgba(15,17,30,.92);color:#e9ebf5;font:600 12px/1 ui-sans-serif,system-ui;border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none;backdrop-filter:blur(10px)';
    document.documentElement.appendChild(el);onClean(function(){el.remove()});
    function label(){
      var w=window.innerWidth,name='—';
      for(var i=0;i<BP.length;i++){if(w>=BP[i][0])name=BP[i][1]}
      el.innerHTML=w+' × '+window.innerHeight+' <span style="opacity:.55">·</span> <span style="color:#93c5fd">'+name+'</span>';
    }
    label();on(window,'resize',label);`),
    remove: cleanup('breakpoints'),
  },

  {
    id: 'domdepth',
    name: 'DOM Depth Map',
    tagline: 'See the div soup',
    description: 'Tints every element by how deeply it is nested, so over-wrapped markup shows up as a hot spot. The deepest chain on the page is reported with its path.',
    howTo: 'Enable to tint the page. The badge names the deepest element; disable to restore normal colours.',
    icon: '☰', color: '#fb923c', category: 'Developer', version: '1.0.0',
    settings: [
      { key: 'intensity', label: 'Tint strength', type: 'range', min: 0.04, max: 0.4, step: 0.02, default: 0.14 },
    ],
    inject: (s) => ext('domdepth', `
    var A=${+(s.intensity ?? 0.14)};
    var deepest=0,deepEl=null;
    var all=document.body?document.body.querySelectorAll('*'):[];
    Array.prototype.forEach.call(all,function(el){
      var d=0;for(var n=el;n;n=n.parentElement)d++;
      if(d>deepest){deepest=d;deepEl=el}
      var hue=Math.max(0,200-d*9);
      el.style.setProperty('background-image','linear-gradient(hsla('+hue+',90%,55%,'+A+'),hsla('+hue+',90%,55%,'+A+'))','important');
    });
    onClean(function(){Array.prototype.forEach.call(all,function(el){el.style.removeProperty('background-image')})});
    var badge=document.createElement('div');
    badge.style.cssText='position:fixed;bottom:14px;right:14px;z-index:2147483000;padding:7px 12px;border-radius:10px;background:rgba(15,17,30,.94);color:#e9ebf5;font:600 12px ui-sans-serif,system-ui;border:1px solid rgba(255,255,255,.14)';
    var path=[];for(var n=deepEl;n&&path.length<4;n=n.parentElement)path.unshift(n.tagName.toLowerCase());
    badge.textContent='Deepest nesting: '+deepest+' levels · '+path.join(' › ');
    document.documentElement.appendChild(badge);onClean(function(){badge.remove()});`),
    remove: cleanup('domdepth'),
  },

  // ── Design ──────────────────────────────────────────────────────────────
  {
    id: 'palettegrab',
    name: 'Palette Grab',
    tagline: 'The page\u2019s real colours, ready to copy',
    description: 'Collects the colours actually painted on the page — text, backgrounds, borders — ranks them by how much they are used, and hands you the hex values.',
    howTo: 'Enable and press Sample. Click any swatch to copy its hex.',
    icon: '◍', color: '#f59e0b', category: 'Design', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'count', label: 'Swatches', type: 'range', min: 4, max: 24, step: 1, default: 10 },
    ],
    inject: (s) => ext('palettegrab', `
    var N=${+(s.count ?? 10)};
    var panel=window.AIHubPanel.create({key:'palettegrab',title:'Palette Grab',icon:'◍',width:320});
    var bd=panel.body;
    function hex(c){var m=(c||'').match(/[\\d.]+/g);if(!m||m.length<3)return null;if(m[3]!==undefined&&+m[3]<0.15)return null;
      return '#'+[0,1,2].map(function(i){return ('0'+(+m[i]).toString(16)).slice(-2)}).join('')}
    function sample(){
      var tally={};
      Array.prototype.forEach.call(document.querySelectorAll('*'),function(el){
        var st=getComputedStyle(el),r=el.getBoundingClientRect();
        if(!r.width||!r.height)return;
        var area=Math.min(r.width*r.height,600000);
        [[st.backgroundColor,area],[st.color,area*0.25],[st.borderTopColor,area*0.05]].forEach(function(p){
          var h=hex(p[0]);if(!h)return;tally[h]=(tally[h]||0)+p[1];
        });
      });
      var top=Object.keys(tally).sort(function(a,b){return tally[b]-tally[a]}).slice(0,N);
      bd.innerHTML='';
      var grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px';
      top.forEach(function(h){
        var sw=document.createElement('div');
        sw.style.cssText='border-radius:10px;overflow:hidden;cursor:pointer;border:1px solid rgba(255,255,255,.12)';
        sw.innerHTML='<div style="height:46px;background:'+h+'"></div><div style="padding:5px 6px;font:600 11px ui-monospace,monospace;text-align:center">'+h+'</div>';
        sw.onclick=function(){try{navigator.clipboard.writeText(h);var d=sw.lastChild;var t=d.textContent;d.textContent='copied';setTimeout(function(){d.textContent=t},900)}catch(e){}};
        grid.appendChild(sw);
      });
      bd.appendChild(grid);
    }
    var b=document.createElement('button');b.textContent='Sample page';b.style.marginBottom='10px';b.onclick=sample;bd.appendChild(b);
    sample();`),
    remove: cleanup('palettegrab'),
  },

  {
    id: 'fontinspect',
    name: 'Font Census',
    tagline: 'Every typeface the page really loads',
    description: 'Counts the font families, weights and sizes in actual use, so you can see at a glance whether a design is using four families and eleven sizes when it meant to use two and five.',
    howTo: 'Enable and press Count. Each family lists the weights and sizes it appears in.',
    icon: 'Aa', color: '#c084fc', category: 'Design', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'minUses', label: 'Ignore under N uses', type: 'range', min: 1, max: 20, step: 1, default: 2 },
    ],
    inject: (s) => ext('fontinspect', `
    var MIN=${+(s.minUses ?? 2)};
    var panel=window.AIHubPanel.create({key:'fontinspect',title:'Font Census',icon:'Aa',width:340});
    var bd=panel.body;
    function count(){
      var fam={};
      Array.prototype.forEach.call(document.querySelectorAll('*'),function(el){
        if(!el.textContent||!el.textContent.trim())return;
        var st=getComputedStyle(el);
        if(st.display==='none'||st.visibility==='hidden')return;
        var f=st.fontFamily.split(',')[0].replace(/["']/g,'').trim();
        if(!f)return;
        fam[f]=fam[f]||{n:0,w:{},s:{}};
        fam[f].n++;fam[f].w[st.fontWeight]=1;fam[f].s[Math.round(parseFloat(st.fontSize))]=1;
      });
      var names=Object.keys(fam).filter(function(f){return fam[f].n>=MIN}).sort(function(a,b){return fam[b].n-fam[a].n});
      bd.innerHTML='<div style="margin-bottom:8px;opacity:.7">'+names.length+' families in use</div>';
      names.forEach(function(f){
        var d=fam[f];
        var box=document.createElement('div');
        box.style.cssText='padding:8px 10px;margin-bottom:7px;border-radius:10px;background:rgba(255,255,255,.05)';
        // The family name is page-controlled and lands in a CSS value as well
        // as in text, so it goes through DOM properties: the CSSOM rejects an
        // invalid font-family instead of letting it break out of the style.
        var title=document.createElement('div');
        title.style.cssText='font-weight:600;font-size:14px';
        title.style.fontFamily='"'+String(f).replace(/["\\\\]/g,'')+'", sans-serif';
        title.textContent=f;
        var meta=document.createElement('div');
        meta.style.cssText='opacity:.6;font-size:11.5px;margin-top:3px';
        meta.textContent=d.n+' elements · weights '+Object.keys(d.w).sort().join(', ');
        var sizes=document.createElement('div');
        sizes.style.cssText='opacity:.6;font-size:11.5px';
        sizes.textContent='sizes '+Object.keys(d.s).sort(function(a,b){return a-b}).join(', ')+'px';
        box.appendChild(title);box.appendChild(meta);box.appendChild(sizes);
        bd.appendChild(box);
      });
    }
    var b=document.createElement('button');b.textContent='Count fonts';b.style.marginBottom='10px';b.onclick=count;bd.appendChild(b);
    count();`),
    remove: cleanup('fontinspect'),
  },

  {
    id: 'spacingpeek',
    name: 'Spacing Peek',
    tagline: 'Margin and padding, drawn on hover',
    description: 'Hover anything and see its box model drawn to scale with the numbers — padding in one colour, margin in another. The fastest way to answer "why is there a gap there".',
    howTo: 'Enable and move the pointer over the page. Hold Shift to freeze the current measurement.',
    icon: '⊹', color: '#2dd4bf', category: 'Design', version: '1.0.0',
    settings: [
      { key: 'showNumbers', label: 'Show pixel values', type: 'toggle', default: true },
    ],
    inject: (s) => ext('spacingpeek', `
    var NUM=${s.showNumbers === false ? 'false' : 'true'};
    var pad=document.createElement('div'),mar=document.createElement('div'),tip=document.createElement('div');
    pad.style.cssText='position:fixed;pointer-events:none;z-index:2147482996;background:rgba(45,212,191,.22);border:1px solid rgba(45,212,191,.7);display:none';
    mar.style.cssText='position:fixed;pointer-events:none;z-index:2147482995;background:rgba(251,146,60,.16);border:1px dashed rgba(251,146,60,.6);display:none';
    tip.style.cssText='position:fixed;pointer-events:none;z-index:2147482997;padding:4px 8px;border-radius:7px;background:rgba(15,17,30,.95);color:#e9ebf5;font:600 11px ui-monospace,monospace;display:none;border:1px solid rgba(255,255,255,.14)';
    [pad,mar,tip].forEach(function(n){document.documentElement.appendChild(n);onClean(function(){n.remove()})});
    var frozen=false;
    function px(v){return Math.round(parseFloat(v)||0)}
    on(document,'mousemove',function(e){
      if(frozen)return;
      var el=e.target;if(!el||!el.getBoundingClientRect)return;
      var st=getComputedStyle(el),r=el.getBoundingClientRect();
      var mt=px(st.marginTop),mr=px(st.marginRight),mb=px(st.marginBottom),ml=px(st.marginLeft);
      var pt=px(st.paddingTop),pr=px(st.paddingRight),pb=px(st.paddingBottom),pl=px(st.paddingLeft);
      mar.style.display='block';mar.style.top=(r.top-mt)+'px';mar.style.left=(r.left-ml)+'px';
      mar.style.width=(r.width+ml+mr)+'px';mar.style.height=(r.height+mt+mb)+'px';
      pad.style.display='block';pad.style.top=r.top+'px';pad.style.left=r.left+'px';
      pad.style.width=r.width+'px';pad.style.height=r.height+'px';
      pad.style.borderWidth=pt+'px '+pr+'px '+pb+'px '+pl+'px';
      pad.style.borderStyle='solid';pad.style.borderColor='rgba(45,212,191,.45)';
      if(NUM){
        tip.style.display='block';
        tip.style.top=Math.max(4,r.top-28)+'px';tip.style.left=r.left+'px';
        tip.textContent=Math.round(r.width)+'×'+Math.round(r.height)+'  p '+pt+' '+pr+' '+pb+' '+pl+'  m '+mt+' '+mr+' '+mb+' '+ml;
      }
    },true);
    on(document,'keydown',function(e){if(e.key==='Shift')frozen=true},true);
    on(document,'keyup',function(e){if(e.key==='Shift')frozen=false},true);`),
    remove: cleanup('spacingpeek'),
  },

  {
    id: 'imageaudit',
    name: 'Image Audit',
    tagline: 'Oversized, unlabelled and eager images',
    description: 'Checks every image for the three things that actually matter: a missing alt attribute, a file far larger than the box it is displayed in, and eager loading below the fold.',
    howTo: 'Enable and press Audit. Click a row to scroll to that image and outline it.',
    icon: '▣', color: '#4ade80', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'oversizeFactor', label: 'Flag when larger than display by', type: 'range', min: 1.2, max: 4, step: 0.2, default: 2 },
    ],
    inject: (s) => ext('imageaudit', `
    var F=${+(s.oversizeFactor ?? 2)};
    var panel=window.AIHubPanel.create({key:'imageaudit',title:'Image Audit',icon:'▣',width:360});
    var bd=panel.body;
    function audit(){
      var imgs=Array.prototype.slice.call(document.images);
      var issues=[];
      imgs.forEach(function(im){
        var r=im.getBoundingClientRect();
        var probs=[];
        if(!im.alt||!im.alt.trim())probs.push('no alt text');
        if(im.naturalWidth&&r.width&&im.naturalWidth>r.width*F)
          probs.push('served '+im.naturalWidth+'px for '+Math.round(r.width)+'px');
        if(im.loading!=='lazy'&&r.top>window.innerHeight)probs.push('eager below the fold');
        if(probs.length)issues.push({el:im,probs:probs});
      });
      bd.innerHTML='<div style="margin-bottom:8px;'+(issues.length?'color:#fbbf24':'color:#6ee7b7')+';font-weight:600">'
        +(issues.length? issues.length+' of '+imgs.length+' images need attention':'All '+imgs.length+' images look fine')+'</div>';
      issues.slice(0,40).forEach(function(it){
        var row=document.createElement('div');
        row.style.cssText='display:flex;gap:8px;padding:6px 8px;margin-bottom:5px;border-radius:9px;background:rgba(255,255,255,.05);cursor:pointer;align-items:center';
        var src=(it.el.currentSrc||it.el.src||'').split('/').pop().slice(0,26);
        row.innerHTML='<img src="'+esc(it.el.currentSrc||it.el.src)+'" style="width:34px;height:34px;object-fit:cover;border-radius:6px;flex:0 0 auto">'
          +'<div style="min-width:0"><div style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(src)+'</div>'
          +'<div style="opacity:.65;font-size:11px">'+it.probs.join(' · ')+'</div></div>';
        row.onclick=function(){it.el.scrollIntoView({behavior:'smooth',block:'center'});var o=it.el.style.outline;it.el.style.outline='3px solid #4ade80';setTimeout(function(){it.el.style.outline=o},1400)};
        bd.appendChild(row);
      });
    }
    var b=document.createElement('button');b.textContent='Audit images';b.style.marginBottom='10px';b.onclick=audit;bd.appendChild(b);
    audit();`),
    remove: cleanup('imageaudit'),
  },

  // ── Reading ─────────────────────────────────────────────────────────────
  {
    id: 'focusline',
    name: 'Focus Line',
    tagline: 'A reading ruler that follows you',
    description: 'Dims the page except for a band around your cursor, the way a ruler under a line of text keeps your place. Genuinely helpful for long articles and for anyone who loses their line.',
    howTo: 'Enable and move the pointer down the page. Adjust band height and dimming in settings.',
    icon: '▬', color: '#818cf8', category: 'Accessibility', version: '1.0.0',
    settings: [
      { key: 'band', label: 'Band height (px)', type: 'range', min: 40, max: 260, step: 10, default: 110 },
      { key: 'dim', label: 'Dim strength', type: 'range', min: 0.1, max: 0.85, step: 0.05, default: 0.55 },
    ],
    inject: (s) => ext('focusline', `
    var H=${+(s.band ?? 110)},D=${+(s.dim ?? 0.55)};
    var top=document.createElement('div'),bot=document.createElement('div');
    var base='position:fixed;left:0;right:0;background:rgba(3,5,14,'+D+');z-index:2147482980;pointer-events:none;transition:height 60ms linear,top 60ms linear';
    top.style.cssText=base+';top:0;height:0';
    bot.style.cssText=base+';bottom:0;height:0';
    [top,bot].forEach(function(n){document.documentElement.appendChild(n);onClean(function(){n.remove()})});
    on(window,'mousemove',function(e){
      var y=e.clientY,half=H/2;
      top.style.height=Math.max(0,y-half)+'px';
      bot.style.height=Math.max(0,window.innerHeight-(y+half))+'px';
    });`),
    remove: cleanup('focusline'),
  },

  {
    id: 'readprogress',
    name: 'Reading Progress',
    tagline: 'How far in, how long left',
    description: 'A progress bar for the article plus an honest estimate of the reading time remaining, calculated from the real word count at your own reading speed.',
    howTo: 'Enable on any article. Set your words-per-minute in settings — 200 to 250 is typical.',
    icon: '▰', color: '#22d3ee', category: 'Reading', version: '1.0.0',
    settings: [
      { key: 'wpm', label: 'Your reading speed (wpm)', type: 'range', min: 120, max: 500, step: 10, default: 230 },
      { key: 'showTime', label: 'Show time remaining', type: 'toggle', default: true },
    ],
    inject: (s) => ext('readprogress', `
    var WPM=${+(s.wpm ?? 230)},SHOW=${s.showTime === false ? 'false' : 'true'};
    var bar=document.createElement('div');
    bar.style.cssText='position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#22d3ee,#818cf8);z-index:2147483000;transition:width 90ms linear';
    document.documentElement.appendChild(bar);onClean(function(){bar.remove()});
    var pill=null;
    if(SHOW){
      pill=document.createElement('div');
      pill.style.cssText='position:fixed;top:10px;right:14px;z-index:2147483000;padding:5px 10px;border-radius:999px;background:rgba(15,17,30,.92);color:#e9ebf5;font:600 11.5px ui-sans-serif,system-ui;border:1px solid rgba(255,255,255,.14);pointer-events:none';
      document.documentElement.appendChild(pill);onClean(function(){pill.remove()});
    }
    var main=document.querySelector('article,main')||document.body;
    var words=(main.innerText||'').trim().split(/\\s+/).length;
    function upd(){
      var h=document.documentElement;
      var max=Math.max(1,(h.scrollHeight-h.clientHeight));
      var p=Math.min(1,Math.max(0,h.scrollTop/max));
      bar.style.width=(p*100)+'%';
      if(pill){
        var left=Math.max(0,Math.round(words*(1-p)/WPM));
        pill.textContent=left<1?'almost done':left+' min left';
      }
    }
    upd();on(window,'scroll',upd,{passive:true});on(window,'resize',upd);`),
    remove: cleanup('readprogress'),
  },

  {
    id: 'textcomfort',
    name: 'Text Comfort',
    tagline: 'Line length and spacing that do not fight you',
    description: 'Re-typesets the article to a comfortable measure: caps line length, opens up line height and letter spacing, and can switch to a serif for long reads — without touching the site\u2019s own layout elsewhere.',
    howTo: 'Enable on any article. Tune measure, line height and size; changes apply immediately.',
    icon: '¶', color: '#f0abfc', category: 'Reading', version: '1.0.0',
    settings: [
      { key: 'measure', label: 'Max line length (ch)', type: 'range', min: 45, max: 110, step: 5, default: 70 },
      { key: 'lineHeight', label: 'Line height', type: 'range', min: 1.3, max: 2.2, step: 0.05, default: 1.7 },
      { key: 'scale', label: 'Text size boost (%)', type: 'range', min: 100, max: 160, step: 5, default: 110 },
      { key: 'serif', label: 'Use a serif face', type: 'toggle', default: false },
    ],
    inject: (s) => ext('textcomfort', `
    var M=${+(s.measure ?? 70)},LH=${+(s.lineHeight ?? 1.7)},SC=${+(s.scale ?? 110)},SERIF=${s.serif ? 'true' : 'false'};
    var sel='article p, article li, main p, main li, .post p, .entry-content p, [itemprop="articleBody"] p';
    css(sel+'{max-width:'+M+'ch !important;line-height:'+LH+' !important;font-size:'+SC+'% !important;letter-spacing:.006em !important;'
      +(SERIF?'font-family:Georgia,"Iowan Old Style","Times New Roman",serif !important;':'')+'}'
      +'article,main{text-rendering:optimizeLegibility}');`),
    remove: cleanup('textcomfort'),
  },

  {
    id: 'quickdefine',
    name: 'Quick Define',
    tagline: 'Select a word, understand it in place',
    description: 'Select any word or phrase and a small card appears with its shape: word and character count, syllable estimate, reading level of the sentence it sits in, and one-click copy without the page\u2019s hidden formatting.',
    howTo: 'Enable, then select text anywhere on the page. The card follows your selection and disappears when you click away.',
    icon: '❝', color: '#fda4af', category: 'Productivity', version: '1.0.0',
    settings: [
      { key: 'minChars', label: 'Show after selecting (chars)', type: 'range', min: 1, max: 40, step: 1, default: 3 },
    ],
    inject: (s) => ext('quickdefine', `
    var MIN=${+(s.minChars ?? 3)};
    var card=document.createElement('div');
    card.style.cssText='position:fixed;z-index:2147483000;display:none;max-width:300px;padding:10px 12px;border-radius:12px;background:rgba(15,17,30,.97);color:#e9ebf5;font:400 12px/1.5 ui-sans-serif,system-ui;border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 40px rgba(0,0,0,.5);backdrop-filter:blur(14px)';
    document.documentElement.appendChild(card);onClean(function(){card.remove()});
    function syllables(w){w=w.toLowerCase().replace(/[^a-z]/g,'');if(w.length<=3)return 1;
      var m=w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').match(/[aeiouy]{1,2}/g);return m?m.length:1}
    on(document,'mouseup',function(){
      setTimeout(function(){
        var sel=window.getSelection();var t=sel?String(sel):'';
        if(!t||t.trim().length<MIN){card.style.display='none';return}
        var words=t.trim().split(/\\s+/);
        var syl=words.reduce(function(a,w){return a+syllables(w)},0);
        // Flesch reading ease over the selection: a rough but honest gauge.
        var sentences=Math.max(1,(t.match(/[.!?]+/g)||[]).length);
        var ease=Math.round(206.835-1.015*(words.length/sentences)-84.6*(syl/Math.max(1,words.length)));
        var band=ease>=70?'plain English':ease>=50?'fairly dense':'hard going';
        var r;try{r=sel.getRangeAt(0).getBoundingClientRect()}catch(e){return}
        card.innerHTML='<div style="font-weight:700;margin-bottom:5px;color:#fda4af">'+words.length+' words · '+t.trim().length+' chars</div>'
          +'<div style="opacity:.75">~'+syl+' syllables · '+Math.max(1,Math.round(words.length/230*60))+'s to read</div>'
          +'<div style="opacity:.75;margin-bottom:7px">Readability '+ease+' — '+band+'</div>';
        var b=document.createElement('button');
        b.textContent='Copy clean';
        b.style.cssText='padding:5px 10px;border:0;border-radius:8px;cursor:pointer;font:600 11.5px ui-sans-serif;color:#fff;background:linear-gradient(135deg,#f43f5e,#a855f7)';
        b.onclick=function(){try{navigator.clipboard.writeText(t.replace(/\\s+/g,' ').trim());b.textContent='Copied'}catch(e){}};
        card.appendChild(b);
        card.style.display='block';
        card.style.top=Math.min(window.innerHeight-120,r.bottom+10)+'px';
        card.style.left=Math.min(window.innerWidth-320,Math.max(8,r.left))+'px';
      },10);
    });
    on(document,'mousedown',function(e){if(!card.contains(e.target))card.style.display='none'});`),
    remove: cleanup('quickdefine'),
  },

  // ── Productivity ────────────────────────────────────────────────────────
  {
    id: 'sitetimer',
    name: 'Site Timer',
    tagline: 'How long you have really been here today',
    description: 'Counts the time you actually spend on this site — only while the tab is visible — and keeps a per-day total. Set a daily budget and it tells you when you have spent it, once, without nagging.',
    howTo: 'Enable and browse. The badge shows today\u2019s total for this domain. Set a budget in settings to get a single gentle notice.',
    icon: '◷', color: '#fbbf24', category: 'Productivity', version: '1.0.0',
    settings: [
      { key: 'budget', label: 'Daily budget (minutes, 0 = none)', type: 'range', min: 0, max: 180, step: 5, default: 0 },
      { key: 'compact', label: 'Compact badge', type: 'toggle', default: false },
    ],
    inject: (s) => ext('sitetimer', `
    var BUDGET=${+(s.budget ?? 0)},COMPACT=${s.compact ? 'true' : 'false'};
    var key='aihub.sitetimer.'+location.hostname+'.'+new Date().toISOString().slice(0,10);
    function get(){try{return +localStorage.getItem(key)||0}catch(e){return 0}}
    function set(v){try{localStorage.setItem(key,String(v))}catch(e){}}
    var secs=get(),warned=false;
    var el=document.createElement('div');
    el.style.cssText='position:fixed;bottom:14px;right:14px;z-index:2147483000;padding:'+(COMPACT?'4px 9px':'6px 12px')+';border-radius:999px;background:rgba(15,17,30,.92);color:#e9ebf5;font:600 '+(COMPACT?'11px':'12px')+' ui-sans-serif,system-ui;border:1px solid rgba(255,255,255,.14);pointer-events:none;backdrop-filter:blur(10px)';
    document.documentElement.appendChild(el);onClean(function(){el.remove()});
    function fmt(t){var m=Math.floor(t/60),h=Math.floor(m/60);return h?h+'h '+(m%60)+'m':m+'m'}
    function paint(){
      var over=BUDGET>0&&secs>=BUDGET*60;
      el.textContent=(COMPACT?'':'⏱ ')+fmt(secs)+(BUDGET>0?' / '+BUDGET+'m':'')+' here today';
      el.style.color=over?'#fca5a5':'#e9ebf5';
      if(over&&!warned){warned=true;el.style.borderColor='rgba(248,113,113,.6)'}
    }
    paint();
    var iv=setInterval(function(){
      if(document.visibilityState!=='visible')return;
      secs++;if(secs%5===0)set(secs);paint();
    },1000);
    onClean(function(){clearInterval(iv);set(secs)});
    on(window,'beforeunload',function(){set(secs)});`),
    remove: cleanup('sitetimer'),
  },

  {
    id: 'formsaver',
    name: 'Form Rescue',
    tagline: 'Never lose a long form again',
    description: 'Quietly saves what you type into forms on this page and puts it back if the page reloads, crashes or you navigate away by accident. Password fields are never touched.',
    howTo: 'Enable and type as normal. If a form comes back empty after a reload, press Restore in the badge.',
    icon: '⤴', color: '#38bdf8', category: 'Productivity', version: '1.0.0',
    settings: [
      { key: 'keepHours', label: 'Keep drafts for (hours)', type: 'range', min: 1, max: 72, step: 1, default: 24 },
    ],
    inject: (s) => ext('formsaver', `
    var KEEP=${+(s.keepHours ?? 24)}*3600000;
    var key='aihub.formsave.'+location.origin+location.pathname;
    function fields(){return Array.prototype.slice.call(document.querySelectorAll('input,textarea,select')).filter(function(f){
      return f.type!=='password'&&f.type!=='hidden'&&f.type!=='file'&&f.type!=='submit'&&f.type!=='button'&&!f.autocomplete0})}
    function idOf(f,i){return f.name||f.id||(f.tagName+':'+i)}
    function save(){
      var data={t:Date.now(),v:{}};
      fields().forEach(function(f,i){
        var v=f.type==='checkbox'||f.type==='radio'?f.checked:f.value;
        if(v!==''&&v!==false)data.v[idOf(f,i)]=v;
      });
      if(Object.keys(data.v).length){try{localStorage.setItem(key,JSON.stringify(data))}catch(e){}}
    }
    function load(){try{var d=JSON.parse(localStorage.getItem(key)||'null');
      if(!d||Date.now()-d.t>KEEP)return null;return d}catch(e){return null}}
    var saved=load();
    var badge=document.createElement('div');
    badge.style.cssText='position:fixed;bottom:14px;left:14px;z-index:2147483000;padding:6px 11px;border-radius:999px;background:rgba(15,17,30,.94);color:#e9ebf5;font:600 11.5px ui-sans-serif,system-ui;border:1px solid rgba(255,255,255,.14);display:none;cursor:pointer;backdrop-filter:blur(10px)';
    document.documentElement.appendChild(badge);onClean(function(){badge.remove()});
    if(saved&&Object.keys(saved.v).length){
      var mins=Math.max(1,Math.round((Date.now()-saved.t)/60000));
      badge.textContent='⤴ Restore draft from '+mins+'m ago';
      badge.style.display='block';
      badge.onclick=function(){
        fields().forEach(function(f,i){
          var v=saved.v[idOf(f,i)];if(v===undefined)return;
          if(f.type==='checkbox'||f.type==='radio')f.checked=!!v;else f.value=v;
          f.dispatchEvent(new Event('input',{bubbles:true}));
          f.dispatchEvent(new Event('change',{bubbles:true}));
        });
        badge.textContent='✓ Restored';setTimeout(function(){badge.style.display='none'},1400);
      };
    }
    var t=null;
    on(document,'input',function(){clearTimeout(t);t=setTimeout(save,600)},true);
    onClean(function(){clearTimeout(t)});`),
    remove: cleanup('formsaver'),
  },

  {
    id: 'zenmode',
    name: 'Zen Mode',
    tagline: 'Strips the page down to what you came for',
    description: 'Removes the things that follow you down a page — sticky headers, floating chat bubbles, cookie bars, social rails and newsletter pop-ups — without breaking the article itself.',
    howTo: 'Enable for a calmer page. Raise the strength if a site is particularly aggressive.',
    icon: '☯', color: '#94a3b8', category: 'Reading', version: '1.0.0',
    settings: [
      { key: 'strength', label: 'How aggressive', type: 'select', default: 'balanced', options: [
        { value: 'gentle', label: 'Gentle — unstick headers only' },
        { value: 'balanced', label: 'Balanced — headers, chat, cookie bars' },
        { value: 'strict', label: 'Strict — also hide sidebars and rails' },
      ] },
    ],
    inject: (s) => ext('zenmode', `
    var S=${JSON.stringify(s.strength ?? 'balanced')};
    var rules=['*{scroll-behavior:auto !important}',
      'header,[class*="sticky"],[class*="Sticky"],[style*="position: sticky"],[style*="position:sticky"]{position:static !important}'];
    if(S!=='gentle'){
      rules.push('[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i],[class*="gdpr" i]{display:none !important}');
      rules.push('[class*="chat-widget" i],[id*="intercom" i],[class*="intercom" i],[id*="drift" i],[class*="livechat" i],[class*="crisp" i]{display:none !important}');
      rules.push('[class*="newsletter" i],[class*="subscribe-modal" i],[class*="popup" i][class*="overlay" i]{display:none !important}');
    }
    if(S==='strict'){
      rules.push('aside,[class*="sidebar" i],[class*="related" i],[class*="recommend" i],[class*="social-share" i],[class*="share-bar" i]{display:none !important}');
      rules.push('article,main{max-width:min(760px,94vw) !important;margin-inline:auto !important;float:none !important}');
    }
    css(rules.join(''));
    // Some overlays set inline styles that beat a stylesheet, so unstick the
    // worst offenders directly — the ones actually pinned over the content.
    var pinned=Array.prototype.filter.call(document.querySelectorAll('body *'),function(el){
      var st=getComputedStyle(el);
      if(st.position!=='fixed')return false;
      var r=el.getBoundingClientRect();
      return r.height>60&&r.width>window.innerWidth*0.6;
    });
    pinned.forEach(function(el){var p=el.style.position;el.style.setProperty('position','static','important');onClean(function(){el.style.position=p})});`),
    remove: cleanup('zenmode'),
  },

  {
    id: 'linkxray',
    name: 'Link X-Ray',
    tagline: 'See where every link really goes',
    description: 'Marks links by destination before you click: external, tracking-laden, a download, or a mismatch between the text and the actual URL — the pattern behind most phishing links.',
    howTo: 'Enable to badge the links on the page. Hover any link for the full destination.',
    icon: '⚯', color: '#fb7185', category: 'Privacy', version: '1.0.0',
    settings: [
      { key: 'markExternal', label: 'Badge external links', type: 'toggle', default: true },
      { key: 'flagMismatch', label: 'Warn when text and URL disagree', type: 'toggle', default: true },
    ],
    inject: (s) => ext('linkxray', `
    var EXT=${s.markExternal === false ? 'false' : 'true'},MIS=${s.flagMismatch === false ? 'false' : 'true'};
    var TRACK=/[?&](utm_|fbclid|gclid|mc_eid|igshid|ref_src)/i;
    css('.aihub-lx{position:relative}.aihub-lx::after{content:attr(data-lx);font:600 9px ui-sans-serif;vertical-align:super;margin-left:3px;padding:1px 4px;border-radius:5px;opacity:.85}'
      +'.aihub-lx[data-kind="ext"]::after{background:rgba(96,165,250,.25);color:#93c5fd}'
      +'.aihub-lx[data-kind="track"]::after{background:rgba(251,191,36,.25);color:#fbbf24}'
      +'.aihub-lx[data-kind="dl"]::after{background:rgba(52,211,153,.25);color:#6ee7b7}'
      +'.aihub-lx[data-kind="warn"]::after{background:rgba(248,113,113,.3);color:#fca5a5}');
    var touched=[];
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'),function(a){
      var href=a.getAttribute('href')||'';
      if(!/^https?:/i.test(href))return;
      var u;try{u=new URL(href,location.href)}catch(e){return}
      var kind='',label='';
      if(/\\.(zip|dmg|exe|pdf|pkg|msi|apk|tar|gz)$/i.test(u.pathname)){kind='dl';label='file'}
      else if(TRACK.test(u.search)){kind='track';label='tracked'}
      else if(EXT&&u.hostname!==location.hostname){kind='ext';label=u.hostname.replace(/^www\\./,'')}
      if(MIS){
        var txt=(a.textContent||'').trim().toLowerCase();
        var m=txt.match(/([a-z0-9-]+\\.)+[a-z]{2,}/);
        if(m&&u.hostname.indexOf(m[0])===-1&&m[0].indexOf(u.hostname.replace(/^www\\./,''))===-1){kind='warn';label='goes to '+u.hostname}
      }
      if(!kind)return;
      a.classList.add('aihub-lx');a.setAttribute('data-lx',String(label).slice(0,60));a.setAttribute('data-kind',kind);
      if(!a.title)a.title=u.href;
      touched.push(a);
    });
    onClean(function(){touched.forEach(function(a){a.classList.remove('aihub-lx');a.removeAttribute('data-lx');a.removeAttribute('data-kind')})});`),
    remove: cleanup('linkxray'),
  },

  {
    id: 'tableport',
    name: 'Table Export',
    tagline: 'Any table on the page, straight to CSV',
    description: 'Finds the real data tables on a page, shows their size, and copies or downloads any of them as clean CSV — no retyping, no paid scraper.',
    howTo: 'Enable and open the panel. Each table is listed with its dimensions; press Copy or Download.',
    icon: '▤', color: '#22c55e', category: 'Productivity', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'minRows', label: 'Ignore tables under N rows', type: 'range', min: 2, max: 20, step: 1, default: 3 },
    ],
    inject: (s) => ext('tableport', `
    var MIN=${+(s.minRows ?? 3)};
    var panel=window.AIHubPanel.create({key:'tableport',title:'Table Export',icon:'▤',width:330});
    var bd=panel.body;
    function toCsv(t){
      return Array.prototype.map.call(t.rows,function(r){
        return Array.prototype.map.call(r.cells,function(c){
          var v=(c.innerText||'').replace(/\\s+/g,' ').trim().replace(/"/g,'""');
          return /[",\\n]/.test(v)?'"'+v+'"':v;
        }).join(',');
      }).join('\\n');
    }
    function scan(){
      var tables=Array.prototype.filter.call(document.querySelectorAll('table'),function(t){return t.rows.length>=MIN});
      bd.innerHTML=tables.length?'':'<div style="opacity:.7">No data tables on this page.</div>';
      tables.forEach(function(t,i){
        var box=document.createElement('div');
        box.style.cssText='padding:9px 10px;margin-bottom:7px;border-radius:10px;background:rgba(255,255,255,.05)';
        var cap=(t.caption&&t.caption.innerText.trim())||('Table '+(i+1));
        box.innerHTML='<div style="font-weight:600;margin-bottom:5px">'+esc(cap.slice(0,40))+'</div>'
          +'<div style="opacity:.6;font-size:11.5px;margin-bottom:7px">'+t.rows.length+' rows × '+(t.rows[0]?t.rows[0].cells.length:0)+' cols</div>';
        var row=document.createElement('div');row.style.cssText='display:flex;gap:6px';
        var c=document.createElement('button');c.textContent='Copy';c.style.cssText='flex:1';
        c.onclick=function(){try{navigator.clipboard.writeText(toCsv(t));c.textContent='Copied';setTimeout(function(){c.textContent='Copy'},1100)}catch(e){}};
        var d=document.createElement('button');d.textContent='Download';d.style.cssText='flex:1';
        d.onclick=function(){
          var blob=new Blob([toCsv(t)],{type:'text/csv'});
          var a=document.createElement('a');a.href=URL.createObjectURL(blob);
          a.download=(document.title||'table').replace(/[^a-z0-9]+/gi,'-').slice(0,40)+'-'+(i+1)+'.csv';
          a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},2000);
        };
        var h=document.createElement('button');h.textContent='Highlight';h.style.cssText='flex:0 0 auto;background:rgba(255,255,255,.12)';
        h.onclick=function(){t.scrollIntoView({behavior:'smooth',block:'center'});var o=t.style.outline;t.style.outline='3px solid #22c55e';setTimeout(function(){t.style.outline=o},1400)};
        row.appendChild(c);row.appendChild(d);row.appendChild(h);box.appendChild(row);bd.appendChild(box);
      });
    }
    var b=document.createElement('button');b.textContent='Find tables';b.style.marginBottom='10px';b.onclick=scan;bd.appendChild(b);
    scan();`),
    remove: cleanup('tableport'),
  },

  {
    id: 'keyboardmap',
    name: 'Keyboard Map',
    tagline: 'Tab order and focus, made visible',
    description: 'Shows the order keyboard users actually move through the page, numbers each stop, and flags the two classic faults: focus traps and controls that are reachable but invisible when focused.',
    howTo: 'Enable and press Tab to walk the page — each stop is numbered and outlined. Problems are listed in the panel.',
    icon: '⌨', color: '#a3e635', category: 'Accessibility', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'showNumbers', label: 'Number each stop', type: 'toggle', default: true },
    ],
    inject: (s) => ext('keyboardmap', `
    var NUM=${s.showNumbers === false ? 'false' : 'true'};
    var panel=window.AIHubPanel.create({key:'keyboardmap',title:'Keyboard Map',icon:'⌨',width:330});
    var bd=panel.body;
    var SEL='a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    css(':focus{outline:3px solid #a3e635 !important;outline-offset:2px !important}');
    function scan(){
      var stops=Array.prototype.filter.call(document.querySelectorAll(SEL),function(el){
        var st=getComputedStyle(el);var r=el.getBoundingClientRect();
        return st.display!=='none'&&st.visibility!=='hidden'&&!el.disabled&&(r.width>0||r.height>0);
      });
      var problems=[];
      stops.forEach(function(el,i){
        var st=getComputedStyle(el);
        if(st.outlineStyle==='none'&&!/focus/.test(el.className))problems.push({el:el,why:'no visible focus style'});
        if(el.tabIndex>0)problems.push({el:el,why:'positive tabindex ('+el.tabIndex+') breaks natural order'});
        var t=(el.innerText||el.getAttribute('aria-label')||el.getAttribute('title')||'').trim();
        if(!t&&!el.value)problems.push({el:el,why:'reachable but has no accessible name'});
      });
      bd.innerHTML='<div style="margin-bottom:8px"><strong>'+stops.length+'</strong> keyboard stops · '
        +(problems.length?'<span style="color:#fbbf24">'+problems.length+' issues</span>':'<span style="color:#6ee7b7">no issues</span>')+'</div>';
      problems.slice(0,30).forEach(function(p){
        var row=document.createElement('div');
        row.style.cssText='padding:6px 8px;margin-bottom:5px;border-radius:8px;background:rgba(255,255,255,.05);cursor:pointer;font-size:11.5px';
        row.innerHTML='<div style="color:#fbbf24">'+esc(p.why)+'</div><div style="opacity:.6">&lt;'+esc(p.el.tagName.toLowerCase())+'&gt; '+esc((p.el.innerText||'').trim().slice(0,30))+'</div>';
        row.onclick=function(){p.el.scrollIntoView({behavior:'smooth',block:'center'});p.el.focus()};
        bd.appendChild(row);
      });
      if(NUM){
        stops.slice(0,80).forEach(function(el,i){
          var r=el.getBoundingClientRect();if(!r.width&&!r.height)return;
          var tag=document.createElement('div');
          tag.className='aihub-kbnum';
          tag.style.cssText='position:absolute;z-index:2147482990;padding:1px 5px;border-radius:6px;background:#a3e635;color:#0b1020;font:700 10px ui-sans-serif;pointer-events:none';
          tag.style.top=(window.scrollY+r.top-8)+'px';tag.style.left=(window.scrollX+r.left-6)+'px';
          tag.textContent=i+1;document.body.appendChild(tag);
        });
        onClean(function(){Array.prototype.forEach.call(document.querySelectorAll('.aihub-kbnum'),function(n){n.remove()})});
      }
    }
    var b=document.createElement('button');b.textContent='Map keyboard order';b.style.marginBottom='10px';b.onclick=function(){
      Array.prototype.forEach.call(document.querySelectorAll('.aihub-kbnum'),function(n){n.remove()});scan()};
    bd.appendChild(b);scan();`),
    remove: cleanup('keyboardmap'),
  },

  {
    id: 'mediacontrol',
    name: 'Media Deck',
    tagline: 'Speed, loop and skip for any video',
    description: 'A proper transport for whatever video or audio the page is playing: fine speed control beyond the site\u2019s own menu, A-B loop for practising a passage, and frame-accurate nudging.',
    howTo: 'Enable while media is on the page. The deck attaches to the largest player; set A and B to loop a section.',
    icon: '⏯', color: '#e879f9', category: 'Media', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'step', label: 'Skip step (seconds)', type: 'range', min: 1, max: 30, step: 1, default: 5 },
      { key: 'defaultRate', label: 'Default speed', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1 },
    ],
    inject: (s) => ext('mediacontrol', `
    var STEP=${+(s.step ?? 5)},RATE=${+(s.defaultRate ?? 1)};
    var panel=window.AIHubPanel.create({key:'mediacontrol',title:'Media Deck',icon:'⏯',width:300});
    var bd=panel.body;var A=null,B=null,loopIv=null;
    function media(){
      var all=Array.prototype.slice.call(document.querySelectorAll('video,audio'));
      all.sort(function(x,y){var a=x.getBoundingClientRect(),b=y.getBoundingClientRect();return (b.width*b.height)-(a.width*a.height)});
      return all[0]||null;
    }
    function fmt(t){t=Math.max(0,t||0);var m=Math.floor(t/60),sec=Math.floor(t%60);return m+':'+('0'+sec).slice(-2)}
    function render(){
      var m=media();
      if(!m){bd.innerHTML='<div style="opacity:.7">No video or audio on this page yet.</div>';return}
      if(RATE!==1&&m.playbackRate===1)m.playbackRate=RATE;
      bd.innerHTML='';
      var t=document.createElement('div');t.style.cssText='font:600 12px ui-monospace,monospace;margin-bottom:8px;opacity:.8';
      t.textContent=fmt(m.currentTime)+' / '+fmt(m.duration)+'  ·  '+m.playbackRate.toFixed(2)+'×';
      bd.appendChild(t);
      var row=function(){var d=document.createElement('div');d.style.cssText='display:flex;gap:6px;margin-bottom:7px';return d};
      var mk=function(label,fn,flex){var b=document.createElement('button');b.textContent=label;b.style.cssText='flex:'+(flex||1);b.onclick=fn;return b};
      var r1=row();
      r1.appendChild(mk('−'+STEP+'s',function(){m.currentTime-=STEP}));
      r1.appendChild(mk(m.paused?'Play':'Pause',function(){m.paused?m.play():m.pause();render()}));
      r1.appendChild(mk('+'+STEP+'s',function(){m.currentTime+=STEP}));
      bd.appendChild(r1);
      var r2=row();
      [0.5,0.75,1,1.25,1.5,2].forEach(function(v){
        var b=mk(v+'×',function(){m.playbackRate=v;render()});
        if(Math.abs(m.playbackRate-v)<0.01)b.style.filter='brightness(1.35)';
        r2.appendChild(b);
      });
      bd.appendChild(r2);
      var r3=row();
      r3.appendChild(mk(A===null?'Set A':'A '+fmt(A),function(){A=m.currentTime;render()}));
      r3.appendChild(mk(B===null?'Set B':'B '+fmt(B),function(){B=m.currentTime;render()}));
      r3.appendChild(mk('Clear',function(){A=B=null;if(loopIv){clearInterval(loopIv);loopIv=null}render()}));
      bd.appendChild(r3);
      if(A!==null&&B!==null&&B>A&&!loopIv){
        loopIv=setInterval(function(){var mm=media();if(mm&&(mm.currentTime>B||mm.currentTime<A-0.5))mm.currentTime=A},200);
        onClean(function(){if(loopIv)clearInterval(loopIv)});
      }
    }
    render();
    var iv=setInterval(render,1000);onClean(function(){clearInterval(iv)});`),
    remove: cleanup('mediacontrol'),
  },

  {
    id: 'pagediet',
    name: 'Page Diet',
    tagline: 'What this page actually costs',
    description: 'Weighs the page you are on: how many requests, how many megabytes, the heaviest single asset, and how much of it is images versus script — the numbers that explain a slow page.',
    howTo: 'Enable to see the breakdown for the current page. Reload to measure a fresh load.',
    icon: '⚖', color: '#facc15', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'top', label: 'Show heaviest N assets', type: 'range', min: 3, max: 20, step: 1, default: 6 },
    ],
    inject: (s) => ext('pagediet', `
    var TOP=${+(s.top ?? 6)};
    var panel=window.AIHubPanel.create({key:'pagediet',title:'Page Diet',icon:'⚖',width:340});
    var bd=panel.body;
    function kb(n){return n>=1048576?(n/1048576).toFixed(2)+' MB':Math.round(n/1024)+' KB'}
    function measure(){
      var res=performance.getEntriesByType('resource')||[];
      var byType={},total=0,items=[];
      res.forEach(function(r){
        var size=r.transferSize||r.encodedBodySize||0;
        total+=size;
        var t=r.initiatorType||'other';
        byType[t]=(byType[t]||0)+size;
        items.push({name:(r.name||'').split('/').pop().split('?')[0].slice(0,34)||'(root)',size:size,type:t,ms:Math.round(r.duration)});
      });
      items.sort(function(a,b){return b.size-a.size});
      var nav=performance.getEntriesByType('navigation')[0];
      bd.innerHTML='<div style="font-weight:700;font-size:15px;margin-bottom:2px">'+kb(total)+'</div>'
        +'<div style="opacity:.65;font-size:11.5px;margin-bottom:10px">'+res.length+' requests'
        +(nav?' · loaded in '+Math.round(nav.duration)+'ms':'')+'</div>';
      var bar=document.createElement('div');
      bar.style.cssText='display:flex;height:8px;border-radius:99px;overflow:hidden;margin-bottom:10px;background:rgba(255,255,255,.06)';
      var COL={script:'#facc15',css:'#38bdf8',link:'#38bdf8',img:'#34d399',fetch:'#f472b6',xmlhttprequest:'#f472b6',other:'#94a3b8'};
      Object.keys(byType).sort(function(a,b){return byType[b]-byType[a]}).forEach(function(t){
        var seg=document.createElement('div');
        seg.style.cssText='height:100%;width:'+((byType[t]/Math.max(1,total))*100)+'%;background:'+(COL[t]||'#94a3b8');
        seg.title=t+' '+kb(byType[t]);bar.appendChild(seg);
      });
      bd.appendChild(bar);
      Object.keys(byType).sort(function(a,b){return byType[b]-byType[a]}).slice(0,5).forEach(function(t){
        var d=document.createElement('div');
        d.style.cssText='display:flex;justify-content:space-between;font-size:11.5px;padding:2px 0;opacity:.8';
        d.innerHTML='<span>'+t+'</span><span>'+kb(byType[t])+'</span>';bd.appendChild(d);
      });
      var h=document.createElement('div');h.style.cssText='margin:10px 0 6px;font-weight:600;font-size:12px';h.textContent='Heaviest assets';bd.appendChild(h);
      items.slice(0,TOP).forEach(function(it){
        var d=document.createElement('div');
        d.style.cssText='display:flex;justify-content:space-between;gap:8px;padding:4px 7px;margin-bottom:4px;border-radius:8px;background:rgba(255,255,255,.05);font-size:11.5px';
        d.innerHTML='<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(it.name)+'</span><span style="opacity:.75;flex:0 0 auto">'+kb(it.size)+' · '+it.ms+'ms</span>';
        bd.appendChild(d);
      });
    }
    var b=document.createElement('button');b.textContent='Re-measure';b.style.marginBottom='10px';b.onclick=measure;bd.appendChild(b);
    measure();`),
    remove: cleanup('pagediet'),
  },

  {
    id: 'jsonpeek',
    name: 'JSON Peek',
    tagline: 'Raw JSON, readable in place',
    description: 'When a URL returns raw JSON, this formats it into a collapsible tree with types and counts, and lets you copy any branch — instead of staring at one unbroken line.',
    howTo: 'Enable, then open any JSON endpoint. Click keys to fold branches; use Copy on any node.',
    icon: '{}', color: '#38bdf8', category: 'Developer', version: '1.0.0',
    settings: [
      { key: 'collapseDepth', label: 'Collapse below depth', type: 'range', min: 1, max: 6, step: 1, default: 2 },
    ],
    inject: (s) => ext('jsonpeek', `
    var DEPTH=${+(s.collapseDepth ?? 2)};
    var pre=document.body&&document.body.children.length===1?document.body.querySelector('pre'):null;
    var raw=pre?pre.textContent:(document.body?document.body.innerText:'');
    if(!raw||raw.length>3000000)return;
    var data;try{data=JSON.parse(raw)}catch(e){return}
    css('body{background:#0b0d18 !important;color:#e9ebf5 !important;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace !important;padding:18px !important}'
      +'.jp-k{color:#93c5fd;cursor:pointer}.jp-s{color:#6ee7b7}.jp-n{color:#fbbf24}.jp-b{color:#f472b6}.jp-nul{color:#94a3b8}'
      +'.jp-row{padding-left:16px;border-left:1px solid rgba(255,255,255,.07)}'
      +'.jp-meta{opacity:.5;font-size:11px;margin-left:6px}'
      +'.jp-copy{margin-left:8px;font-size:10px;opacity:.45;cursor:pointer}.jp-copy:hover{opacity:1}');
    function node(key,val,depth){
      var wrap=document.createElement('div');
      var isObj=val&&typeof val==='object';
      var line=document.createElement('div');
      var label=key===null?'':'<span class="jp-k">'+esc(key)+'</span>: ';
      if(!isObj){
        var cls=typeof val==='string'?'jp-s':typeof val==='number'?'jp-n':typeof val==='boolean'?'jp-b':'jp-nul';
        var shown=typeof val==='string'?'"'+val+'"':String(val);
        line.innerHTML=label+'<span class="'+cls+'">'+String(shown).replace(/</g,'&lt;').slice(0,300)+'</span>';
        wrap.appendChild(line);return wrap;
      }
      var arr=Array.isArray(val),keys=Object.keys(val);
      line.innerHTML=label+'<span style="opacity:.8">'+(arr?'[':'{')+'</span><span class="jp-meta">'+keys.length+(arr?' items':' keys')+'</span>';
      var copy=document.createElement('span');copy.className='jp-copy';copy.textContent='copy';
      copy.onclick=function(e){e.stopPropagation();try{navigator.clipboard.writeText(JSON.stringify(val,null,2));copy.textContent='copied';setTimeout(function(){copy.textContent='copy'},900)}catch(err){}};
      line.appendChild(copy);
      var kids=document.createElement('div');kids.className='jp-row';
      keys.slice(0,500).forEach(function(k){kids.appendChild(node(arr?null:k,val[k],depth+1))});
      var close=document.createElement('div');close.innerHTML='<span style="opacity:.8">'+(arr?']':'}')+'</span>';
      if(depth>=DEPTH)kids.style.display='none';
      line.style.cursor='pointer';
      line.onclick=function(){kids.style.display=kids.style.display==='none'?'':'none'};
      wrap.appendChild(line);wrap.appendChild(kids);wrap.appendChild(close);
      return wrap;
    }
    var host=document.createElement('div');
    host.appendChild(node(null,data,0));
    var old=document.body.innerHTML;
    document.body.innerHTML='';document.body.appendChild(host);
    onClean(function(){try{document.body.innerHTML=old}catch(e){}});`),
    remove: cleanup('jsonpeek'),
  },

  {
    id: 'scrollmarks',
    name: 'Scroll Marks',
    tagline: 'Drop a pin, jump back to it',
    description: 'Marks a spot on a long page and gives you a rail to jump back to it — for documentation, contracts and anything you read in passes rather than straight through.',
    howTo: 'Enable, then press Alt+M to drop a mark at your position. Click a pin on the right rail to return; Alt+Shift+M clears them.',
    icon: '⚑', color: '#f97316', category: 'Productivity', version: '1.0.0',
    settings: [
      { key: 'remember', label: 'Remember marks for this page', type: 'toggle', default: true },
    ],
    inject: (s) => ext('scrollmarks', `
    var KEEP=${s.remember === false ? 'false' : 'true'};
    var key='aihub.marks.'+location.origin+location.pathname;
    var marks=[];
    if(KEEP){try{marks=JSON.parse(localStorage.getItem(key)||'[]')}catch(e){marks=[]}}
    var rail=document.createElement('div');
    rail.style.cssText='position:fixed;top:0;right:0;width:16px;height:100vh;z-index:2147482998;pointer-events:none';
    document.documentElement.appendChild(rail);onClean(function(){rail.remove()});
    var toast=document.createElement('div');
    toast.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483000;padding:7px 14px;border-radius:999px;background:rgba(15,17,30,.95);color:#e9ebf5;font:600 12px ui-sans-serif;border:1px solid rgba(255,255,255,.14);opacity:0;transition:opacity 180ms';
    document.documentElement.appendChild(toast);onClean(function(){toast.remove()});
    function say(t){toast.textContent=t;toast.style.opacity='1';setTimeout(function(){toast.style.opacity='0'},1200)}
    function save(){if(KEEP){try{localStorage.setItem(key,JSON.stringify(marks))}catch(e){}}}
    function paint(){
      rail.innerHTML='';
      var h=Math.max(1,document.documentElement.scrollHeight);
      marks.forEach(function(m,i){
        var pin=document.createElement('div');
        pin.style.cssText='position:absolute;right:2px;width:12px;height:12px;border-radius:4px;background:#f97316;border:1px solid rgba(0,0,0,.35);cursor:pointer;pointer-events:auto;box-shadow:0 2px 6px rgba(0,0,0,.4)';
        pin.style.top=((m.y/h)*100)+'vh';
        pin.title=(m.label||('Mark '+(i+1)))+' — click to jump, right-click to remove';
        pin.onclick=function(){window.scrollTo({top:m.y,behavior:'smooth'})};
        pin.oncontextmenu=function(e){e.preventDefault();marks.splice(i,1);save();paint();say('Mark removed')};
        rail.appendChild(pin);
      });
    }
    paint();
    on(window,'keydown',function(e){
      if(!e.altKey)return;
      if(e.key.toLowerCase()==='m'&&!e.shiftKey){
        var y=window.scrollY;
        var el=document.elementFromPoint(window.innerWidth/2,window.innerHeight/2);
        var label=(el&&(el.innerText||'').trim().slice(0,40))||'';
        marks.push({y:y,label:label});save();paint();say('Mark dropped ('+marks.length+')');
      } else if(e.key.toLowerCase()==='m'&&e.shiftKey){
        marks=[];save();paint();say('Marks cleared');
      }
    });`),
    remove: cleanup('scrollmarks'),
  },
]
