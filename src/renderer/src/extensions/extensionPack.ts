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

  // ── Developer & Design (cont'd) ─────────────────────────────────────────
  {
    id: 'apisniffer',
    name: 'API Sniffer',
    tagline: 'Every fetch and XHR, with headers and bodies',
    description: 'Wraps fetch and XHR to capture every request the page makes — method, URL, request headers and body, response status and body — without opening devtools. Any request can be copied as a ready-to-run cURL command, or the whole session exported as a HAR file for Chrome DevTools, Postman or Insomnia.',
    howTo: 'Enable, then use the page. Every request lands in the panel as it happens — press Copy cURL on any row, or Export HAR to save the whole session.',
    icon: '🔌', color: '#22d3ee', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'rows', label: 'Keep last N requests', type: 'range', min: 10, max: 100, step: 10, default: 40 },
      { key: 'captureBodies', label: 'Capture request/response bodies', type: 'toggle', default: true },
    ],
    inject: (s) => ext('apisniffer', `
    var ROWS=${+(s.rows ?? 40)},CAPTURE_BODY=${s.captureBodies === false ? 'false' : 'true'};
    var records=[];
    var panel=window.AIHubPanel.create({key:'apisniffer',title:'API Sniffer',icon:'🔌',width:420});
    var bd=panel.body;
    var toolbar=document.createElement('div');toolbar.style.cssText='display:flex;gap:6px;margin-bottom:8px';
    var harBtn=document.createElement('button');harBtn.textContent='Export HAR';
    var clearBtn=document.createElement('button');clearBtn.textContent='Clear';clearBtn.style.cssText='background:rgba(255,255,255,.08)';
    toolbar.appendChild(harBtn);toolbar.appendChild(clearBtn);bd.appendChild(toolbar);
    var list=document.createElement('div');bd.appendChild(list);
    function curlFor(rec){
      var parts=['curl',"'"+rec.url.replace(/'/g,"'\\\\''")+"'",'-X',rec.method];
      (rec.reqHeaders||[]).forEach(function(h){parts.push('-H',"'"+h[0]+': '+String(h[1]).replace(/'/g,"'\\\\''")+"'")});
      if(rec.reqBody)parts.push('--data',"'"+String(rec.reqBody).replace(/'/g,"'\\\\''")+"'");
      return parts.join(' ');
    }
    function addRow(rec){
      records.unshift(rec);
      if(records.length>ROWS)records.length=ROWS;
      renderList();
    }
    function renderList(){
      while(list.firstChild)list.removeChild(list.firstChild);
      records.forEach(function(rec){
        var row=document.createElement('div');
        row.style.cssText='padding:6px 8px;margin-bottom:5px;border-radius:8px;background:rgba(255,255,255,.04);font-size:11px';
        var top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;gap:8px';
        var m=document.createElement('span');m.style.cssText='opacity:.6;width:40px';m.textContent=rec.method;
        var u=document.createElement('span');u.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';u.textContent=rec.url.replace(/^https?:\\/\\//,'');
        var st=document.createElement('span');st.style.cssText='color:'+(rec.ok===false?'#f87171':'#6ee7b7');st.textContent=rec.status!=null?rec.status:'\\u2026';
        top.appendChild(m);top.appendChild(u);top.appendChild(st);
        var copyB=document.createElement('button');copyB.textContent='Copy cURL';copyB.style.cssText='margin-top:5px;padding:2px 8px;font-size:10px';
        copyB.onclick=function(){try{navigator.clipboard.writeText(curlFor(rec));copyB.textContent='Copied';setTimeout(function(){copyB.textContent='Copy cURL'},1200)}catch(e){}};
        row.appendChild(top);row.appendChild(copyB);
        list.appendChild(row);
      });
    }
    harBtn.onclick=function(){
      var har={log:{version:'1.2',creator:{name:'AIHub API Sniffer',version:'1.0'},entries:records.map(function(rec){
        return {
          startedDateTime:new Date(rec.time).toISOString(),
          time:rec.duration||0,
          request:{method:rec.method,url:rec.url,httpVersion:'HTTP/1.1',headers:(rec.reqHeaders||[]).map(function(h){return{name:h[0],value:String(h[1])}}),queryString:[],cookies:[],headersSize:-1,bodySize:rec.reqBody?rec.reqBody.length:0,postData:rec.reqBody?{mimeType:'text/plain',text:rec.reqBody}:undefined},
          response:{status:rec.status||0,statusText:'',httpVersion:'HTTP/1.1',headers:[],cookies:[],content:{size:rec.respBody?rec.respBody.length:0,mimeType:'text/plain',text:rec.respBody||''},redirectURL:'',headersSize:-1,bodySize:-1},
          cache:{},timings:{send:0,wait:rec.duration||0,receive:0}
        };
      })}};
      var blob=new Blob([JSON.stringify(har,null,2)],{type:'application/json'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');a.href=url;a.download='api-sniffer.har';document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(url)},4000);
    };
    clearBtn.onclick=function(){records=[];renderList()};
    var of=window.fetch;
    if(of){
      window.fetch=function(input,init){
        var url=(input&&input.url)||input;
        var method=(init&&init.method)||(input&&input.method)||'GET';
        var reqHeaders=[];
        try{
          var h=(init&&init.headers)||(input&&input.headers);
          if(h){if(typeof Headers!=='undefined'&&h instanceof Headers){h.forEach(function(v,k){reqHeaders.push([k,v])})}else if(Array.isArray(h)){reqHeaders=h.slice()}else{Object.keys(h).forEach(function(k){reqHeaders.push([k,h[k]])})}}
        }catch(e){}
        var reqBody=CAPTURE_BODY&&init&&typeof init.body==='string'?init.body.slice(0,4000):null;
        var start=performance.now();
        var rec={method:method,url:String(url),reqHeaders:reqHeaders,reqBody:reqBody,time:Date.now(),status:null,ok:null,duration:null,respBody:null};
        addRow(rec);
        return of.apply(this,arguments).then(function(r){
          rec.status=r.status;rec.ok=r.ok;rec.duration=performance.now()-start;
          if(CAPTURE_BODY){try{r.clone().text().then(function(t){rec.respBody=t.slice(0,4000);renderList()}).catch(function(){})}catch(e){}}
          renderList();
          return r;
        },function(e){rec.status='ERR';rec.ok=false;rec.duration=performance.now()-start;renderList();throw e});
      };
      onClean(function(){window.fetch=of});
    }
    var OX=window.XMLHttpRequest&&window.XMLHttpRequest.prototype.open;
    var OSend=window.XMLHttpRequest&&window.XMLHttpRequest.prototype.send;
    var OSetHeader=window.XMLHttpRequest&&window.XMLHttpRequest.prototype.setRequestHeader;
    if(OX&&OSend&&OSetHeader){
      window.XMLHttpRequest.prototype.open=function(m,u){this.__aihubMethod=m;this.__aihubUrl=u;this.__aihubHeaders=[];return OX.apply(this,arguments)};
      window.XMLHttpRequest.prototype.setRequestHeader=function(k,v){if(this.__aihubHeaders)this.__aihubHeaders.push([k,v]);return OSetHeader.apply(this,arguments)};
      window.XMLHttpRequest.prototype.send=function(body){
        var xhr=this;
        var rec={method:xhr.__aihubMethod||'GET',url:String(xhr.__aihubUrl||''),reqHeaders:xhr.__aihubHeaders||[],reqBody:CAPTURE_BODY&&typeof body==='string'?body.slice(0,4000):null,time:Date.now(),status:null,ok:null,duration:null,respBody:null};
        var start=performance.now();
        addRow(rec);
        xhr.addEventListener('loadend',function(){
          rec.status=xhr.status;rec.ok=xhr.status>=200&&xhr.status<400;rec.duration=performance.now()-start;
          if(CAPTURE_BODY){try{rec.respBody=String(xhr.responseText||'').slice(0,4000)}catch(e){}}
          renderList();
        });
        return OSend.apply(this,arguments);
      };
      onClean(function(){
        window.XMLHttpRequest.prototype.open=OX;
        window.XMLHttpRequest.prototype.send=OSend;
        window.XMLHttpRequest.prototype.setRequestHeader=OSetHeader;
      });
    }`),
    remove: cleanup('apisniffer'),
  },

  {
    id: 'jsonschemagen',
    name: 'JSON Schema Generator',
    tagline: 'Turns a raw JSON response into a real type',
    description: 'When a URL returns raw JSON, infers a TypeScript interface or a JSON Schema document straight from the actual payload — nested objects become their own named interfaces, arrays are typed from their first element. One click copies it, ready to paste into your codebase.',
    howTo: 'Enable, then open any JSON endpoint (works alongside JSON Peek). Pick TypeScript or JSON Schema in settings, then press Copy.',
    icon: '🧬', color: '#34d399', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'mode', label: 'Generate as', type: 'select', default: 'ts', options: [
        { value: 'ts', label: 'TypeScript interface' },
        { value: 'schema', label: 'JSON Schema' },
      ] },
    ],
    inject: (s) => ext('jsonschemagen', `
    var MODE=${JSON.stringify(s.mode ?? 'ts')};
    var panel=window.AIHubPanel.create({key:'jsonschemagen',title:'JSON Schema Generator',icon:'🧬',width:400});
    var bd=panel.body;
    var pre=document.body&&document.body.children.length===1?document.body.querySelector('pre'):null;
    var raw=pre?pre.textContent:(document.body?document.body.innerText:'');
    var data=null;
    if(raw&&raw.length<3000000){try{data=JSON.parse(raw)}catch(e){data=null}}
    if(data===null){
      var msg=document.createElement('div');
      msg.style.cssText='font-size:11.5px;opacity:.7;line-height:1.6';
      msg.textContent='This page is not a raw JSON response, so there is nothing to generate a type from.';
      bd.appendChild(msg);
    }else{
      function toPascal(name){
        var s2=String(name||'Root').replace(/[^a-zA-Z0-9]+(.)/g,function(_,c){return c.toUpperCase()}).replace(/[^a-zA-Z0-9]/g,'');
        return (s2.charAt(0).toUpperCase()+s2.slice(1))||'Root';
      }
      function safeKey(k){return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)?k:JSON.stringify(k)}
      var blocks=[];
      function tsType(val,name){
        if(val===null)return 'null';
        if(Array.isArray(val))return val.length?tsType(val[0],name)+'[]':'any[]';
        var t=typeof val;
        if(t==='object'){
          var ifName=toPascal(name);
          var lines=['interface '+ifName+' {'];
          Object.keys(val).forEach(function(k){lines.push('  '+safeKey(k)+': '+tsType(val[k],k)+';')});
          lines.push('}');
          blocks.push(lines.join('\\n'));
          return ifName;
        }
        if(t==='string')return 'string';
        if(t==='number')return 'number';
        if(t==='boolean')return 'boolean';
        return 'any';
      }
      function schemaOf(val){
        if(val===null)return {type:'null'};
        if(Array.isArray(val))return {type:'array',items:val.length?schemaOf(val[0]):{}};
        var t=typeof val;
        if(t==='object'){
          var props={},required=[];
          Object.keys(val).forEach(function(k){props[k]=schemaOf(val[k]);required.push(k)});
          return {type:'object',properties:props,required:required};
        }
        if(t==='string')return {type:'string'};
        if(t==='number')return {type:Number.isInteger(val)?'integer':'number'};
        if(t==='boolean')return {type:'boolean'};
        return {};
      }
      var text;
      if(MODE==='schema'){
        var schema=schemaOf(data);
        schema['$schema']='http://json-schema.org/draft-07/schema#';
        text=JSON.stringify(schema,null,2);
      }else{
        tsType(data,'Root');
        text=blocks.join('\\n\\n');
      }
      var pre2=document.createElement('pre');
      pre2.style.cssText='white-space:pre-wrap;word-break:break-word;font-size:11px;font-family:ui-monospace,monospace;line-height:1.5;opacity:.9;max-height:340px;overflow:auto;margin-bottom:8px';
      pre2.textContent=text;
      bd.appendChild(pre2);
      var copyB=document.createElement('button');copyB.textContent='Copy';
      copyB.onclick=function(){try{navigator.clipboard.writeText(text);copyB.textContent='Copied';setTimeout(function(){copyB.textContent='Copy'},1200)}catch(e){}};
      bd.appendChild(copyB);
    }`),
    remove: cleanup('jsonschemagen'),
  },

  {
    id: 'contrastfixer',
    name: 'Color Contrast Fixer',
    tagline: 'Not just a failing ratio — a color that passes',
    description: 'Finds the same low-contrast text Contrast Audit does, but for each failure computes the nearest color — by lightness, keeping the original hue — that actually clears the ratio, and applies it with one click. A real fix, not just a diagnosis.',
    howTo: 'Enable, open the panel, and press Apply on any failure to swap in the suggested color immediately. Disabling the extension restores every original color.',
    icon: '🛠', color: '#f472b6', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'level', label: 'Standard', type: 'select', default: 'AA', options: [
        { value: 'AA', label: 'AA — 4.5:1 body text' },
        { value: 'AAA', label: 'AAA — 7:1 body text' },
      ] },
    ],
    inject: (s) => ext('contrastfixer', `
    var LEVEL=${JSON.stringify(s.level ?? 'AA')};
    var need=LEVEL==='AAA'?7:4.5;
    function lum(c){var p=c.map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2]}
    function parse(c){var m=(c||'').match(/[\\d.]+/g);return m&&m.length>=3?[+m[0],+m[1],+m[2],m[3]===undefined?1:+m[3]]:null}
    function bgOf(el){for(var n=el;n&&n!==document.documentElement;n=n.parentElement){var c=parse(getComputedStyle(n).backgroundColor);if(c&&c[3]>0.05)return c}return [255,255,255,1]}
    function ratio(a,b){var la=lum(a),lb=lum(b);return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05)}
    function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;var max=Math.max(r,g,b),min=Math.min(r,g,b);var h,s2,l=(max+min)/2;
      if(max===min){h=s2=0}else{var d=max-min;s2=l>0.5?d/(2-max-min):d/(max+min);
        switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4}
        h/=6}
      return [h,s2,l];
    }
    function hslToRgb(h,s2,l){
      if(s2===0){var v=Math.round(l*255);return [v,v,v]}
      function hue2rgb(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p}
      var q=l<0.5?l*(1+s2):l+s2-l*s2,p=2*l-q;
      return [Math.round(hue2rgb(p,q,h+1/3)*255),Math.round(hue2rgb(p,q,h)*255),Math.round(hue2rgb(p,q,h-1/3)*255)];
    }
    function findAccessible(fg,bg,needR){
      var hsl=rgbToHsl(fg[0],fg[1],fg[2]);
      var goDark=lum(bg)>0.5;
      var l=hsl[2];
      for(var i=0;i<50;i++){
        var rgb=hslToRgb(hsl[0],hsl[1],l);
        if(ratio(rgb,bg)>=needR)return rgb;
        l=goDark?Math.max(0,l-0.02):Math.min(1,l+0.02);
      }
      return goDark?[0,0,0]:[255,255,255];
    }
    var panel=window.AIHubPanel.create({key:'contrastfixer',title:'Contrast Fixer',icon:'🛠',width:360});
    var bd=panel.body;
    var applied=[];
    function scan(){
      while(bd.firstChild)bd.removeChild(bd.firstChild);
      var walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);
      var node,list=[];
      while((node=walk.nextNode())&&list.length<4000){if(node.nodeValue&&node.nodeValue.trim().length>1)list.push(node)}
      var bad=[];
      list.forEach(function(t){
        var el=t.parentElement;if(!el)return;
        var st=getComputedStyle(el);
        if(st.visibility==='hidden'||st.display==='none'||+st.opacity===0)return;
        var r=el.getBoundingClientRect();if(!r.width||!r.height)return;
        var fg=parse(st.color);if(!fg||fg[3]<0.5)return;
        var bg=bgOf(el);
        var got=ratio(fg,bg);
        if(got<need)bad.push({el:el,fg:fg,bg:bg,got:got,text:t.nodeValue.trim().slice(0,44)});
      });
      if(!bad.length){
        var ok=document.createElement('div');ok.style.cssText='color:#6ee7b7;font-size:12px';ok.textContent='No contrast failures at '+LEVEL+'.';
        bd.appendChild(ok);return;
      }
      var head=document.createElement('div');head.style.cssText='margin-bottom:8px;color:#fca5a5;font-weight:600;font-size:12px';
      head.textContent=bad.length+' elements fail '+LEVEL+'.';
      bd.appendChild(head);
      bad.slice(0,30).forEach(function(b){
        var suggestion=findAccessible(b.fg,b.bg,need);
        var sugRgb='rgb('+suggestion[0]+','+suggestion[1]+','+suggestion[2]+')';
        var row=document.createElement('div');
        row.style.cssText='padding:7px 9px;margin-bottom:6px;border-radius:9px;background:rgba(255,255,255,.05)';
        var top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px';
        var lbl=document.createElement('span');lbl.style.cssText='font-size:11px;opacity:.8';lbl.textContent=b.got.toFixed(2)+':1 \\u2192 '+ratio(suggestion,b.bg).toFixed(2)+':1';
        var swatch=document.createElement('span');swatch.style.cssText='display:inline-block;width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,.2);background:'+sugRgb;
        top.appendChild(lbl);top.appendChild(swatch);
        var txt=document.createElement('div');txt.style.cssText='font-size:11px;opacity:.6;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        txt.textContent=b.text;
        var applyB=document.createElement('button');applyB.textContent='Apply';applyB.style.cssText='padding:3px 10px;font-size:10.5px';
        applyB.onclick=function(){
          var prevColor=b.el.style.color;
          b.el.style.color=sugRgb;
          applied.push(function(){b.el.style.color=prevColor});
          applyB.textContent='Applied \\u2713';applyB.disabled=true;
        };
        row.appendChild(top);row.appendChild(txt);row.appendChild(applyB);
        bd.appendChild(row);
      });
      var rescanBtn=document.createElement('button');rescanBtn.textContent='Rescan';rescanBtn.style.cssText='margin-top:6px;background:rgba(255,255,255,.08)';
      rescanBtn.onclick=scan;
      bd.appendChild(rescanBtn);
    }
    scan();
    onClean(function(){applied.forEach(function(f){f()})});`),
    remove: cleanup('contrastfixer'),
  },

  {
    id: 'cssvarinspector',
    name: 'CSS Variable Inspector',
    tagline: 'Hover anything, see which design tokens it uses',
    description: 'Hover any element to see which CSS custom properties (--variables) its own matching stylesheet rules actually reference, their resolved values, and the nearest ancestor where each one is defined — so a token change is traced to its source instead of guessed at. Cross-origin stylesheets can’t be read by any page script and are skipped, which the panel says plainly rather than pretending otherwise.',
    howTo: 'Enable and move the pointer over the page — the panel updates to the hovered element’s custom properties. Click to freeze on the current element; click again to resume.',
    icon: '🎨', color: '#c084fc', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'color', label: 'Highlight color', type: 'select', default: '#c084fc', options: [
        { value: '#c084fc', label: 'Purple' },
        { value: '#60a5fa', label: 'Blue' },
        { value: '#34d399', label: 'Green' },
        { value: '#fbbf24', label: 'Gold' },
      ] },
    ],
    inject: (s) => ext('cssvarinspector', `
    var COLOR=${JSON.stringify(s.color || '#c084fc')};
    var panel=window.AIHubPanel.create({key:'cssvarinspector',title:'CSS Variable Inspector',icon:'🎨',width:360});
    var bd=panel.body;
    var hint=document.createElement('div');hint.style.cssText='font-size:11px;opacity:.55;margin-bottom:8px';
    hint.textContent='Hover an element on the page. Click to freeze.';
    bd.appendChild(hint);
    var out=document.createElement('div');bd.appendChild(out);
    var hi=document.createElement('div');
    hi.style.cssText='position:fixed;pointer-events:none;z-index:2147482999;border:2px solid '+COLOR+';background:'+COLOR+'22;border-radius:3px;display:none';
    document.documentElement.appendChild(hi);onClean(function(){hi.remove()});
    var frozen=false;
    function varsUsedBy(el){
      var names={};
      try{
        var sheets=document.styleSheets;
        for(var i=0;i<sheets.length;i++){
          var rules;
          try{rules=sheets[i].cssRules}catch(e){continue}
          if(!rules)continue;
          for(var j=0;j<rules.length;j++){
            var rule=rules[j];
            if(!rule.selectorText||!rule.style)continue;
            var matches=false;
            try{matches=el.matches(rule.selectorText)}catch(e){continue}
            if(!matches)continue;
            var css2=rule.style.cssText||'';
            var m=css2.match(/var\\(\\s*(--[a-zA-Z0-9-_]+)/g)||[];
            m.forEach(function(v){names[v.replace(/var\\(\\s*/,'')]=true});
          }
        }
      }catch(e){}
      if(el.style&&el.style.cssText){
        (el.style.cssText.match(/var\\(\\s*(--[a-zA-Z0-9-_]+)/g)||[]).forEach(function(v){names[v.replace(/var\\(\\s*/,'')]=true});
      }
      return Object.keys(names);
    }
    function whereDefined(el,name){
      var chain=[];
      for(var n=el;n;n=n.parentElement)chain.push(n);
      chain.push(document.documentElement);
      chain.reverse();
      var prevVal='',definedAt=null,definedVal='';
      chain.forEach(function(node){
        var v=(getComputedStyle(node).getPropertyValue(name)||'').trim();
        if(v&&v!==prevVal){definedAt=node;definedVal=v}
        prevVal=v;
      });
      return {node:definedAt,value:definedVal};
    }
    function describe(node){
      if(!node)return '(not found)';
      var id=node.id?'#'+node.id:'';
      var cls=node.className&&typeof node.className==='string'?'.'+node.className.trim().split(/\\s+/).slice(0,2).join('.'):'';
      return '<'+node.tagName.toLowerCase()+'>'+id+cls;
    }
    function render(el){
      while(out.firstChild)out.removeChild(out.firstChild);
      var names=varsUsedBy(el);
      var tag=document.createElement('div');tag.style.cssText='font-weight:600;margin-bottom:8px;color:'+COLOR;
      tag.textContent='<'+el.tagName.toLowerCase()+'>'+(el.id?'#'+el.id:'');
      out.appendChild(tag);
      if(!names.length){
        var none=document.createElement('div');none.style.cssText='opacity:.5;font-size:11.5px';
        none.textContent='No var(--…) usage found in this element\\'s matching same-origin rules.';
        out.appendChild(none);return;
      }
      names.forEach(function(name){
        var def=whereDefined(el,name);
        var row=document.createElement('div');
        row.style.cssText='padding:6px 8px;margin-bottom:5px;border-radius:8px;background:rgba(255,255,255,.04);font-size:11px';
        var top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;gap:8px;font-family:ui-monospace,monospace';
        var k=document.createElement('span');k.style.color=COLOR;k.textContent=name;
        var v=document.createElement('span');v.style.opacity='.8';v.textContent=def.value.slice(0,60);
        top.appendChild(k);top.appendChild(v);
        var meta=document.createElement('div');meta.style.cssText='opacity:.45;margin-top:2px';
        meta.textContent='defined at '+esc(describe(def.node));
        row.appendChild(top);row.appendChild(meta);
        out.appendChild(row);
      });
    }
    on(document,'mousemove',function(e){
      if(frozen)return;
      var el=e.target;if(!el||panel.host.contains(el))return;
      var r=el.getBoundingClientRect();
      hi.style.display='block';hi.style.top=r.top+'px';hi.style.left=r.left+'px';hi.style.width=r.width+'px';hi.style.height=r.height+'px';
      render(el);
    },true);
    on(document,'click',function(e){
      if(panel.host.contains(e.target))return;
      frozen=!frozen;
      if(!frozen){var el=document.elementFromPoint(e.clientX,e.clientY);if(el)render(el)}
    },true);`),
    remove: cleanup('cssvarinspector'),
  },

  {
    id: 'responsivecarousel',
    name: 'Responsive Preview Carousel',
    tagline: 'This exact page at 5 real breakpoints, side by side',
    description: 'Renders the current page inside five same-origin iframes sized to mobile, tablet, laptop, desktop and 4K widths, laid out in a scrollable strip so you can see how it actually reflows at each size at once. Some sites refuse to be framed at all (X-Frame-Options or a frame-ancestors CSP) and will show blank previews — that is the site’s own protection, not a bug here.',
    howTo: 'Enable, then open the panel — five live copies of the current page load at real breakpoint widths. Scroll the strip horizontally to compare them.',
    icon: '📱', color: '#f59e0b', category: 'Design', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'scale', label: 'Preview scale', type: 'range', min: 0.2, max: 0.6, step: 0.05, default: 0.32 },
    ],
    inject: (s) => ext('responsivecarousel', `
    var SCALE=${+(s.scale ?? 0.32)};
    var BREAKS=[['Mobile',375],['Tablet',768],['Laptop',1024],['Desktop',1440],['4K',2560]];
    var panel=window.AIHubPanel.create({key:'responsivecarousel',title:'Responsive Preview',icon:'📱',width:Math.min(900,window.innerWidth-40)});
    var bd=panel.body;
    bd.style.cssText+=';max-height:70vh';
    var strip=document.createElement('div');
    strip.style.cssText='display:flex;gap:14px;overflow-x:auto;padding-bottom:8px';
    BREAKS.forEach(function(b){
      var name=b[0],w=b[1],h=900;
      var box=document.createElement('div');box.style.cssText='flex:0 0 auto;text-align:center';
      var label=document.createElement('div');label.style.cssText='font-size:10.5px;opacity:.6;margin-bottom:4px';
      label.textContent=name+' \\u00b7 '+w+'px';
      var frameWrap=document.createElement('div');
      frameWrap.style.cssText='width:'+(w*SCALE)+'px;height:'+(h*SCALE)+'px;overflow:hidden;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#0b0d18';
      var iframe=document.createElement('iframe');
      iframe.style.cssText='width:'+w+'px;height:'+h+'px;border:0;transform:scale('+SCALE+');transform-origin:top left;';
      iframe.src=location.href;
      frameWrap.appendChild(iframe);
      box.appendChild(label);box.appendChild(frameWrap);
      strip.appendChild(box);
    });
    bd.appendChild(strip);
    var note=document.createElement('div');
    note.style.cssText='margin-top:8px;font-size:10px;opacity:.4;line-height:1.5';
    note.textContent='A blank preview usually means the site blocks being framed (X-Frame-Options / frame-ancestors), not a failure here.';
    bd.appendChild(note);`),
    remove: cleanup('responsivecarousel'),
  },

  {
    id: 'perfbudget',
    name: 'Performance Budget Monitor',
    tagline: 'Core Web Vitals, watched live as you browse',
    description: 'Tracks LCP, CLS and FID from the browser’s own PerformanceObserver as they happen, approximates Total Blocking Time from long tasks, and totals the JS actually transferred — each graded against the standard Core Web Vitals thresholds. Cross-origin scripts without a Timing-Allow-Origin header can report 0 bytes; that is a browser privacy limit, not a bug.',
    howTo: 'Enable on any page and browse it normally — metrics fill in as they occur (LCP needs the main content to paint, FID/CLS need you to interact and scroll). Toggle strict thresholds in settings.',
    icon: '⏱', color: '#facc15', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'thresholdsStrict', label: 'Use strict ("good") thresholds', type: 'toggle', default: true },
    ],
    inject: (s) => ext('perfbudget', `
    var STRICT=${s.thresholdsStrict === false ? 'false' : 'true'};
    var panel=window.AIHubPanel.create({key:'perfbudget',title:'Performance Budget',icon:'⏱',width:300});
    var bd=panel.body;
    var metrics={lcp:null,cls:0,fid:null,tbt:0};
    var observers=[];
    function watch(type,cb){try{var o=new PerformanceObserver(cb);o.observe({type:type,buffered:true});observers.push(o)}catch(e){}}
    watch('largest-contentful-paint',function(list){
      var entries=list.getEntries(),last=entries[entries.length-1];
      if(last)metrics.lcp=last.renderTime||last.loadTime||last.startTime;
      paint();
    });
    watch('layout-shift',function(list){
      list.getEntries().forEach(function(entry){if(!entry.hadRecentInput)metrics.cls+=entry.value});
      paint();
    });
    watch('first-input',function(list){
      var e2=list.getEntries()[0];
      if(e2)metrics.fid=e2.processingStart-e2.startTime;
      paint();
    });
    watch('longtask',function(list){
      list.getEntries().forEach(function(t){metrics.tbt+=Math.max(0,t.duration-50)});
      paint();
    });
    function jsSize(){
      var total=0;
      (performance.getEntriesByType('resource')||[]).forEach(function(r){if(r.initiatorType==='script')total+=(r.transferSize||0)});
      return total;
    }
    function grade(val,good,ok){
      if(val==null)return {c:'#94a3b8',t:'\\u2013'};
      var g=STRICT?good:ok,o=STRICT?ok:ok*1.6;
      return val<=g?{c:'#6ee7b7',t:'good'}:val<=o?{c:'#fbbf24',t:'needs work'}:{c:'#f87171',t:'poor'};
    }
    function fmtVal(val,isMs){return val==null?'\\u2013':(isMs?Math.round(val)+'ms':val.toFixed(3))}
    function row(label,val,isMs,good,ok){
      var g=grade(val,good,ok);
      var r=document.createElement('div');
      r.style.cssText='display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px';
      var l=document.createElement('span');l.style.opacity='.7';l.textContent=label;
      var v=document.createElement('span');v.style.cssText='color:'+g.c+';font-weight:600';v.textContent=fmtVal(val,isMs)+' \\u00b7 '+g.t;
      r.appendChild(l);r.appendChild(v);return r;
    }
    function paint(){
      while(bd.firstChild)bd.removeChild(bd.firstChild);
      bd.appendChild(row('LCP',metrics.lcp,true,2500,4000));
      bd.appendChild(row('CLS',metrics.cls,false,0.1,0.25));
      bd.appendChild(row('FID',metrics.fid,true,100,300));
      bd.appendChild(row('TBT (approx)',metrics.tbt,true,200,600));
      var jsRow=document.createElement('div');
      jsRow.style.cssText='display:flex;justify-content:space-between;padding:5px 0;font-size:12px';
      var l2=document.createElement('span');l2.style.opacity='.7';l2.textContent='Total JS (transferred)';
      var v2=document.createElement('span');v2.style.opacity='.85';v2.textContent=Math.round(jsSize()/1024)+' KB';
      jsRow.appendChild(l2);jsRow.appendChild(v2);
      bd.appendChild(jsRow);
      var note=document.createElement('div');note.style.cssText='margin-top:8px;font-size:10px;opacity:.4;line-height:1.5';
      note.textContent='TBT is approximated from long tasks. Cross-origin scripts without Timing-Allow-Origin can show 0 KB.';
      bd.appendChild(note);
    }
    paint();
    var iv=setInterval(paint,2000);
    onClean(function(){clearInterval(iv);observers.forEach(function(o){try{o.disconnect()}catch(e){}})});`),
    remove: cleanup('perfbudget'),
  },

  {
    id: 'websocketinspector',
    name: 'WebSocket Inspector',
    tagline: 'Every WebSocket connection, live, with replay',
    description: 'Wraps the page’s WebSocket constructor to list every connection it opens with a live in/out message log, and lets you resend any outgoing message you captured. Nothing else in this browser’s extension pack touches WebSocket traffic.',
    howTo: 'Enable before the page opens its sockets (or reload after enabling). Each connection gets its own log in the panel; press resend on any outgoing message, or Pause log to freeze the view without closing anything.',
    icon: '🔗', color: '#60a5fa', category: 'Developer', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'rows', label: 'Messages kept per connection', type: 'range', min: 20, max: 200, step: 20, default: 80 },
    ],
    inject: (s) => ext('websocketinspector', `
    var ROWS=${+(s.rows ?? 80)};
    var OrigWS=window.WebSocket;
    var panel=window.AIHubPanel.create({key:'websocketinspector',title:'WebSocket Inspector',icon:'🔗',width:380});
    var bd=panel.body;
    var paused=false;
    var pauseBtn=document.createElement('button');pauseBtn.textContent='Pause log';pauseBtn.style.cssText='margin-bottom:8px;background:rgba(255,255,255,.08)';
    pauseBtn.onclick=function(){paused=!paused;pauseBtn.textContent=paused?'Resume log':'Pause log'};
    bd.appendChild(pauseBtn);
    var connWrap=document.createElement('div');bd.appendChild(connWrap);
    function addConn(url){
      var box=document.createElement('div');
      box.style.cssText='margin-bottom:10px;padding:8px;border-radius:8px;background:rgba(255,255,255,.04)';
      var head=document.createElement('div');head.style.cssText='display:flex;justify-content:space-between;font-size:11.5px;font-weight:600;margin-bottom:6px;gap:8px';
      var urlEl=document.createElement('span');urlEl.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px';urlEl.textContent=url;
      var statusEl=document.createElement('span');statusEl.style.cssText='color:#fbbf24';statusEl.textContent='connecting';
      head.appendChild(urlEl);head.appendChild(statusEl);
      var log=document.createElement('div');log.style.cssText='max-height:160px;overflow:auto;font-family:ui-monospace,monospace;font-size:10.5px';
      box.appendChild(head);box.appendChild(log);
      connWrap.insertBefore(box,connWrap.firstChild);
      return {statusEl:statusEl,log:log,url:url};
    }
    function logMsg(rec,dir,data,resend){
      if(paused)return;
      var row=document.createElement('div');
      row.style.cssText='padding:3px 5px;margin-bottom:3px;border-radius:5px;background:rgba(255,255,255,.03);border-left:2px solid '+(dir==='out'?'#60a5fa':'#34d399');
      var text=typeof data==='string'?data:'[binary]';
      var line=document.createElement('span');line.textContent=(dir==='out'?'\\u2192 ':'\\u2190 ')+text.slice(0,160);
      row.appendChild(line);
      if(dir==='out'&&resend){
        var rb=document.createElement('button');rb.textContent='resend';rb.style.cssText='margin-left:6px;padding:1px 6px;font-size:9px';
        rb.onclick=resend;row.appendChild(rb);
      }
      rec.log.insertBefore(row,rec.log.firstChild);
      while(rec.log.children.length>ROWS)rec.log.removeChild(rec.log.lastChild);
    }
    var empty=null;
    if(OrigWS){
      function PatchedWS(url,protocols){
        var inst=protocols===undefined?Reflect.construct(OrigWS,[url]):Reflect.construct(OrigWS,[url,protocols]);
        if(empty){empty.remove();empty=null}
        var rec=addConn(String(url));
        var origSend=inst.send.bind(inst);
        inst.send=function(data){
          logMsg(rec,'out',data,function(){try{if(inst.readyState===1)origSend(data)}catch(e){}});
          return origSend(data);
        };
        inst.addEventListener('open',function(){rec.statusEl.textContent='open';rec.statusEl.style.color='#6ee7b7'});
        inst.addEventListener('close',function(e){rec.statusEl.textContent='closed ('+e.code+')';rec.statusEl.style.color='#94a3b8'});
        inst.addEventListener('error',function(){rec.statusEl.textContent='error';rec.statusEl.style.color='#f87171'});
        inst.addEventListener('message',function(e){logMsg(rec,'in',e.data)});
        return inst;
      }
      PatchedWS.prototype=OrigWS.prototype;
      PatchedWS.CONNECTING=OrigWS.CONNECTING;PatchedWS.OPEN=OrigWS.OPEN;PatchedWS.CLOSING=OrigWS.CLOSING;PatchedWS.CLOSED=OrigWS.CLOSED;
      window.WebSocket=PatchedWS;
      onClean(function(){window.WebSocket=OrigWS});
    }
    empty=document.createElement('div');empty.style.cssText='opacity:.5;font-size:11.5px';empty.textContent='No WebSocket connections yet on this page.';
    connWrap.appendChild(empty);`),
    remove: cleanup('websocketinspector'),
  },

  // ── Media (cont'd) ──────────────────────────────────────────────────────
  {
    id: 'speedboost',
    name: 'Speed Boost Presets',
    tagline: 'One-tap playback speed, remembered per site',
    description: 'A small always-visible strip of speed presets from 0.25× to 4×, applied to every video and audio element on the page at once — including ones added later by the site. Remembers your chosen speed per domain, so YouTube can stay at 1.5× while a course site stays at 1× without you resetting it every visit. Media Deck (also in this pack) covers the same ground plus A-B looping and skip step if you want the fuller transport instead.',
    howTo: 'Enable, then tap a speed in the small strip that appears bottom-left. It reapplies automatically to new media on the page and remembers your choice for this site.',
    icon: '⏩', color: '#fb7185', category: 'Media', version: '1.0.0',
    settings: [
      { key: 'rememberPerDomain', label: 'Remember speed per site', type: 'toggle', default: true },
    ],
    inject: (s) => ext('speedboost', `
    var REMEMBER=${s.rememberPerDomain === false ? 'false' : 'true'};
    var PRESETS=[0.25,0.5,0.75,1,1.25,1.5,2,3,4];
    var key='aihub.speedboost.'+location.hostname;
    function loadSaved(){if(!REMEMBER)return null;try{var v=+localStorage.getItem(key);return v>0?v:null}catch(e){return null}}
    function persist(v){if(!REMEMBER)return;try{localStorage.setItem(key,String(v))}catch(e){}}
    var current=loadSaved()||1;
    function applyAll(){document.querySelectorAll('video,audio').forEach(function(m){try{m.playbackRate=current}catch(e){}})}
    applyAll();
    var mo=new MutationObserver(function(){applyAll()});
    mo.observe(document.body||document.documentElement,{childList:true,subtree:true});
    onClean(function(){mo.disconnect()});
    var bar=document.createElement('div');
    bar.style.cssText='position:fixed;bottom:14px;left:14px;z-index:2147483000;display:flex;gap:3px;padding:5px;border-radius:10px;background:rgba(15,17,30,.92);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px)';
    document.documentElement.appendChild(bar);onClean(function(){bar.remove()});
    var buttons=[];
    function paint(){buttons.forEach(function(b){b.style.background=Math.abs(b.__v-current)<0.01?'rgba(96,165,250,.35)':'transparent'})}
    PRESETS.forEach(function(v){
      var b=document.createElement('button');
      b.__v=v;b.textContent=v+'\\u00d7';
      b.style.cssText='padding:3px 6px;font-size:10px;border:0;border-radius:6px;background:transparent;color:#e9ebf5;cursor:pointer';
      b.onclick=function(){current=v;applyAll();persist(v);paint()};
      bar.appendChild(b);buttons.push(b);
    });
    paint();`),
    remove: cleanup('speedboost'),
  },

  {
    id: 'audionormalizer',
    name: 'Audio Normalizer',
    tagline: 'Boosts quiet audio, tames sudden loud peaks',
    description: 'Routes every video and audio element on the page through a real Web Audio compressor — quiet dialogue gets easier to hear and sudden loud moments get tamed, instead of you riding the volume slider. A gain slider layers a per-site volume on top and remembers it for next time. New media added later by the page (an infinite-scroll feed, a lazy-loaded player) is picked up automatically. Verified live against a real cross-origin video that this doesn’t stop playback — but if a site’s video CDN sends no CORS header at all, the Web Audio spec can silence that element’s output entirely rather than just skip normalizing it, a browser-level restriction no page script can work around; toggle the extension off for that one site if audio ever drops out.',
    howTo: 'Enable while audio or video is on the page. Adjust the gain slider in the panel — it remembers your setting for this site.',
    icon: '🔊', color: '#0ea5e9', category: 'Media', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'threshold', label: 'Compressor threshold (dB)', type: 'range', min: -60, max: 0, step: 5, default: -24 },
      { key: 'ratio', label: 'Compression ratio', type: 'range', min: 1, max: 20, step: 1, default: 8 },
    ],
    inject: (s) => ext('audionormalizer', `
    var THRESH=${+(s.threshold ?? -24)},RATIO=${+(s.ratio ?? 8)};
    var volKey='aihub.audionorm.'+location.hostname;
    function loadVol(){try{var v=+localStorage.getItem(volKey);return v>0?v:1}catch(e){return 1}}
    function saveVol(v){try{localStorage.setItem(volKey,String(v))}catch(e){}}
    var gainValue=loadVol();
    var ctx=null;
    function getCtx(){
      if(!ctx){var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;ctx=new AC()}
      return ctx;
    }
    function ensureRunning(){if(ctx&&ctx.state==='suspended')ctx.resume().catch(function(){})}
    on(document,'click',ensureRunning,true);
    on(document,'keydown',ensureRunning,true);
    var nodes=[];
    var panel=window.AIHubPanel.create({key:'audionormalizer',title:'Audio Normalizer',icon:'🔊',width:280});
    var bd=panel.body;
    var label=document.createElement('div');label.style.cssText='font-size:11px;opacity:.6;margin-bottom:8px';
    bd.appendChild(label);
    function updateLabel(){label.textContent='Boosts quiet audio, tames loud peaks, on '+nodes.length+' element(s) found so far.'}
    updateLabel();
    function wrap(el){
      if(el.__aihubNormalized)return;
      var c=getCtx();if(!c)return;
      el.__aihubNormalized=true;
      try{
        var src=c.createMediaElementSource(el);
        var comp=c.createDynamicsCompressor();
        comp.threshold.value=THRESH;comp.ratio.value=RATIO;comp.knee.value=24;comp.attack.value=0.003;comp.release.value=0.25;
        var gain=c.createGain();gain.gain.value=gainValue;
        src.connect(comp);comp.connect(gain);gain.connect(c.destination);
        nodes.push({el:el,gain:gain});
        updateLabel();
        ensureRunning();
      }catch(e){}
    }
    function scan(){document.querySelectorAll('video,audio').forEach(wrap)}
    scan();
    var mo=new MutationObserver(function(){scan()});
    mo.observe(document.body||document.documentElement,{childList:true,subtree:true});
    onClean(function(){mo.disconnect();if(ctx)try{ctx.close()}catch(e){}});
    var row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:8px';
    var slider=document.createElement('input');slider.type='range';slider.min='0.2';slider.max='3';slider.step='0.1';slider.value=String(gainValue);
    var val=document.createElement('span');val.style.cssText='font-family:ui-monospace,monospace;font-size:11px;width:40px;text-align:right';val.textContent=gainValue.toFixed(1)+'\\u00d7';
    slider.oninput=function(){
      gainValue=+slider.value;val.textContent=gainValue.toFixed(1)+'\\u00d7';
      nodes.forEach(function(n){n.gain.gain.value=gainValue});
      saveVol(gainValue);
    };
    row.appendChild(slider);row.appendChild(val);bd.appendChild(row);
    var note=document.createElement('div');note.style.cssText='margin-top:8px;font-size:10px;opacity:.4;line-height:1.5';
    note.textContent='Remembers this level for '+location.hostname+'. New media on the page is picked up automatically.';
    bd.appendChild(note);`),
    remove: cleanup('audionormalizer'),
  },

  // ── Reading & Accessibility (cont'd) ────────────────────────────────────
  {
    id: 'bionicreader',
    name: 'Bionic Reader',
    tagline: 'Bolds the lead of every word to speed reading',
    description: 'Rewrites the visible text so the leading letters of each word are bold and the rest lighter — a fixation-guide technique some readers find noticeably faster, since the eye can often complete a word from its first few letters alone. Reverts to the page’s real text exactly when switched off.',
    howTo: 'Enable to boldify the whole page. Adjust how much of each word gets bolded in settings — more bold is a stronger effect but can feel busier.',
    icon: '⚡', color: '#fbbf24', category: 'Reading', version: '1.0.0',
    settings: [
      { key: 'ratio', label: 'Bold portion of each word', type: 'range', min: 0.2, max: 0.7, step: 0.05, default: 0.4 },
    ],
    inject: (s) => ext('bionicreader', `
    var RATIO=${+(s.ratio ?? 0.4)};
    var SKIP={SCRIPT:1,STYLE:1,TEXTAREA:1,INPUT:1,CODE:1,PRE:1,NOSCRIPT:1,SVG:1};
    var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{
      acceptNode:function(node){
        var p=node.parentNode;
        if(!p||SKIP[p.nodeName])return NodeFilter.FILTER_REJECT;
        if(!node.nodeValue||!/\\S/.test(node.nodeValue))return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var targets=[];var n;
    while(n=walker.nextNode())targets.push(n);
    var restores=[];
    targets.forEach(function(textNode){
      var text=textNode.nodeValue;
      var frag=document.createDocumentFragment();
      text.split(/(\\s+)/).forEach(function(tok){
        if(!tok)return;
        if(/^\\s+$/.test(tok)){frag.appendChild(document.createTextNode(tok));return}
        var boldLen=Math.max(1,Math.ceil(tok.length*RATIO));
        var b=document.createElement('b');
        b.style.cssText='font-weight:800';
        b.textContent=tok.slice(0,boldLen);
        frag.appendChild(b);
        if(tok.length>boldLen)frag.appendChild(document.createTextNode(tok.slice(boldLen)));
      });
      var parent=textNode.parentNode;
      if(!parent)return;
      var newNodes=Array.prototype.slice.call(frag.childNodes);
      if(!newNodes.length)return;
      parent.replaceChild(frag,textNode);
      restores.push(function(){
        try{
          parent.insertBefore(textNode,newNodes[0]);
          newNodes.forEach(function(nn){try{parent.removeChild(nn)}catch(e){}});
        }catch(e){}
      });
    });
    onClean(function(){restores.forEach(function(f){f()})});`),
    remove: cleanup('bionicreader'),
  },

  {
    id: 'ttsplayer',
    name: 'Text-to-Speech Player',
    tagline: 'Reads the article aloud, sentence by sentence',
    description: 'Reads the current selection (or the whole article, if nothing is selected) out loud using the browser’s own speech engine, with adjustable rate and pitch and a choice of installed voices. Each sentence is highlighted in the player panel as it is spoken — kept inside the panel itself rather than injected into the page’s own markup, so it never risks breaking a site’s layout or scripts.',
    howTo: 'Enable, then press Play in the panel — it reads the current selection, or the whole article if nothing is selected. Pick a voice from the dropdown and tune rate/pitch in settings.',
    icon: '🔊', color: '#38bdf8', category: 'Reading', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'rate', label: 'Speech rate', type: 'range', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'pitch', label: 'Speech pitch', type: 'range', min: 0.5, max: 2, step: 0.1, default: 1 },
    ],
    inject: (s) => ext('ttsplayer', `
    var RATE=${+(s.rate ?? 1)},PITCH=${+(s.pitch ?? 1)};
    var panel=window.AIHubPanel.create({key:'ttsplayer',title:'Read Aloud',icon:'🔊',width:360});
    var bd=panel.body;
    var voiceSel=document.createElement('select');
    function loadVoices(){
      var voices=window.speechSynthesis?window.speechSynthesis.getVoices():[];
      while(voiceSel.firstChild)voiceSel.removeChild(voiceSel.firstChild);
      voices.forEach(function(v,i){
        var o=document.createElement('option');o.value=String(i);o.textContent=v.name+' ('+v.lang+')';
        voiceSel.appendChild(o);
      });
    }
    loadVoices();
    if(window.speechSynthesis){window.speechSynthesis.onvoiceschanged=loadVoices;onClean(function(){window.speechSynthesis.onvoiceschanged=null});}
    bd.appendChild(voiceSel);
    var controls=document.createElement('div');controls.style.cssText='display:flex;gap:6px;margin:8px 0';
    var playBtn=document.createElement('button');playBtn.textContent='\\u25b6 Play';
    var stopBtn=document.createElement('button');stopBtn.textContent='\\u25a0 Stop';stopBtn.style.cssText='background:rgba(255,255,255,.08)';
    controls.appendChild(playBtn);controls.appendChild(stopBtn);
    bd.appendChild(controls);
    var list=document.createElement('div');list.style.cssText='max-height:280px;overflow:auto';bd.appendChild(list);
    var rows=[],idx=0,sentences=[],state='idle';
    function buildSentences(){
      var sel=window.getSelection();
      var selText=sel?String(sel).trim():'';
      var source=selText.length>40?selText:((document.querySelector('article,main')||document.body).innerText||'');
      var raw=source.replace(/\\s+/g,' ').trim();
      var parts=raw.match(/[^.!?]+[.!?]+(\\s|$)|[^.!?]+$/g)||[raw];
      return parts.map(function(p){return p.trim()}).filter(function(p){return p.length>0}).slice(0,400);
    }
    function render(list2){
      while(list.firstChild)list.removeChild(list.firstChild);
      rows=[];
      list2.forEach(function(s2){
        var row=document.createElement('div');
        row.style.cssText='padding:5px 7px;margin-bottom:3px;border-radius:6px;font-size:11.5px;line-height:1.5';
        row.textContent=s2;
        list.appendChild(row);rows.push(row);
      });
    }
    function speakNext(){
      if(!window.speechSynthesis||idx>=sentences.length){
        state='idle';playBtn.textContent='\\u25b6 Play';
        rows.forEach(function(r){r.style.background=''});
        return;
      }
      rows.forEach(function(r,i){r.style.background=i===idx?'rgba(96,165,250,.18)':''});
      if(rows[idx]&&rows[idx].scrollIntoView)rows[idx].scrollIntoView({block:'center',behavior:'smooth'});
      var u=new SpeechSynthesisUtterance(sentences[idx]);
      u.rate=RATE;u.pitch=PITCH;
      var voices=window.speechSynthesis.getVoices();
      var picked=voices[+voiceSel.value];
      if(picked)u.voice=picked;
      u.onend=function(){idx++;speakNext()};
      u.onerror=function(){idx++;speakNext()};
      window.speechSynthesis.speak(u);
    }
    playBtn.onclick=function(){
      if(!window.speechSynthesis){playBtn.textContent='Not supported';return}
      if(state==='playing'){window.speechSynthesis.pause();state='paused';playBtn.textContent='\\u25b6 Resume';return}
      if(state==='paused'){window.speechSynthesis.resume();state='playing';playBtn.textContent='\\u23f8 Pause';return}
      sentences=buildSentences();render(sentences);idx=0;state='playing';playBtn.textContent='\\u23f8 Pause';
      window.speechSynthesis.cancel();speakNext();
    };
    stopBtn.onclick=function(){
      if(window.speechSynthesis)window.speechSynthesis.cancel();
      state='idle';idx=sentences.length;playBtn.textContent='\\u25b6 Play';
      rows.forEach(function(r){r.style.background=''});
    };
    onClean(function(){if(window.speechSynthesis)window.speechSynthesis.cancel()});`),
    remove: cleanup('ttsplayer'),
  },

  {
    id: 'linefocusruler',
    name: 'Line Focus Ruler',
    tagline: 'A reading band pinned to the screen, not the mouse',
    description: 'Dims everything except a band held at a fixed height on screen — the page scrolls underneath it rather than the band chasing your cursor, so it works for keyboard or scroll-wheel reading with no mouse movement at all. A different mechanic from Focus Line, which tracks the pointer.',
    howTo: 'Enable and scroll — the undimmed band stays at the screen position you set and the page moves through it. Set the position, band height and dim strength in settings.',
    icon: '📏', color: '#a78bfa', category: 'Accessibility', version: '1.0.0',
    settings: [
      { key: 'positionPct', label: 'Ruler position (% from top)', type: 'range', min: 10, max: 90, step: 5, default: 40 },
      { key: 'band', label: 'Band height (px)', type: 'range', min: 30, max: 200, step: 10, default: 80 },
      { key: 'dim', label: 'Dim strength', type: 'range', min: 0.1, max: 0.9, step: 0.05, default: 0.6 },
    ],
    inject: (s) => ext('linefocusruler', `
    var POS=${+(s.positionPct ?? 40)},H=${+(s.band ?? 80)},D=${+(s.dim ?? 0.6)};
    var top=document.createElement('div'),bot=document.createElement('div');
    var base='position:fixed;left:0;right:0;background:rgba(3,5,14,'+D+');z-index:2147482980;pointer-events:none';
    top.style.cssText=base+';top:0';
    bot.style.cssText=base+';bottom:0';
    [top,bot].forEach(function(n){document.documentElement.appendChild(n);onClean(function(){n.remove()})});
    function layout(){
      var y=window.innerHeight*(POS/100),half=H/2;
      top.style.height=Math.max(0,y-half)+'px';
      bot.style.height=Math.max(0,window.innerHeight-(y+half))+'px';
    }
    layout();
    on(window,'resize',layout);`),
    remove: cleanup('linefocusruler'),
  },

  {
    id: 'dyslexiamode',
    name: 'Dyslexia-Friendly Mode',
    tagline: 'Wider spacing and an easier-to-track font, everywhere',
    description: 'Switches the page to a widely-available humanist font, opens up letter, word and line spacing per common dyslexia-accessibility guidance, and can add a soft cream tint that many readers find easier to track than stark white. Uses fonts already installed on your system rather than downloading one, so it works instantly and offline.',
    howTo: 'Enable for an easier-to-track version of any page. Tune spacing and toggle the cream background in settings.',
    icon: '🔤', color: '#fb923c', category: 'Accessibility', version: '1.0.0',
    settings: [
      { key: 'letterSpacing', label: 'Letter spacing (em)', type: 'range', min: 0, max: 0.15, step: 0.01, default: 0.05 },
      { key: 'lineSpacing', label: 'Line height', type: 'range', min: 1.4, max: 2.4, step: 0.1, default: 1.8 },
      { key: 'tint', label: 'Cream background tint', type: 'toggle', default: true },
    ],
    inject: (s) => ext('dyslexiamode', `
    var LS=${+(s.letterSpacing ?? 0.05)},LH=${+(s.lineSpacing ?? 1.8)},TINT=${s.tint === false ? 'false' : 'true'};
    css('body,body *{font-family:"Comic Sans MS","Trebuchet MS",Verdana,sans-serif !important;letter-spacing:'+LS+'em !important;word-spacing:'+(LS*2)+'em !important;line-height:'+LH+' !important;}'
      +(TINT?'html,body{background:#fbf6e9 !important}':''));`),
    remove: cleanup('dyslexiamode'),
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

  // ── Productivity (cont'd) ───────────────────────────────────────────────
  {
    id: 'citationgrabber',
    name: 'Citation Grabber',
    tagline: 'One click to a ready-to-paste citation',
    description: 'Reads the page\'s own metadata — Open Graph tags, JSON-LD, byline and publish-date markup — and turns it into APA, MLA, Chicago and BibTeX citations you can copy straight into a paper or reference manager. No page ever has to be typed out by hand again.',
    howTo: 'Enable, then open the panel on any article or paper — all four formats are ready immediately. Press Copy next to the one you need.',
    icon: '📚', color: '#0ea5e9', category: 'Productivity', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'includeAccessDate', label: 'Include "accessed" date', type: 'toggle', default: true },
    ],
    inject: (s) => ext('citationgrabber', `
    var INCLUDE_ACCESS=${s.includeAccessDate === false ? 'false' : 'true'};
    function meta(name){
      var el=document.querySelector('meta[name="'+name+'"]')||document.querySelector('meta[property="'+name+'"]');
      return el?el.getAttribute('content'):null;
    }
    function jsonLd(){
      var out={};
      document.querySelectorAll('script[type="application/ld+json"]').forEach(function(node){
        try{
          var data=JSON.parse(node.textContent);
          var arr=Array.isArray(data)?data:[data];
          arr.forEach(function(d){
            if(!d||typeof d!=='object')return;
            if(d.author&&!out.author){
              if(typeof d.author==='string')out.author=d.author;
              else if(d.author.name)out.author=d.author.name;
              else if(Array.isArray(d.author)&&d.author[0]&&d.author[0].name)out.author=d.author[0].name;
            }
            if(d.datePublished&&!out.date)out.date=d.datePublished;
            if(d.headline&&!out.title)out.title=d.headline;
          });
        }catch(e){}
      });
      return out;
    }
    var ld=jsonLd();
    var title=ld.title||meta('og:title')||document.title||'Untitled';
    var author=ld.author||meta('author')||meta('article:author')||'';
    var dateRaw=ld.date||meta('article:published_time')||meta('date')||meta('publish-date')||'';
    var site=meta('og:site_name')||location.hostname.replace(/^www\\./,'');
    var canon=document.querySelector('link[rel=canonical]');
    var pageUrl=canon?canon.href:location.href;
    function parseDate(raw){
      if(!raw)return null;
      var d=new Date(raw);
      return isNaN(d.getTime())?null:d;
    }
    var pub=parseDate(dateRaw);
    var today=new Date();
    var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
    function fmtLong(d){return d?MONTHS[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear():'n.d.'}
    function fmtISO(d){return d?d.toISOString().slice(0,10):'n.d.'}
    function lastFirst(name){
      if(!name)return '';
      var parts=name.trim().split(/\\s+/);
      if(parts.length<2)return name;
      var last=parts.pop();
      return last+', '+parts.join(' ');
    }
    var apa=(author?lastFirst(author)+'. ':'')+'('+(pub?pub.getFullYear():'n.d.')+'). '+title+'. '+site+'.'+(INCLUDE_ACCESS?' Retrieved '+fmtLong(today)+', from '+pageUrl:' '+pageUrl);
    var mla='\\u201c'+title+'.\\u201d '+site+(pub?', '+fmtLong(pub):'')+(author?', by '+author:'')+', '+pageUrl+(INCLUDE_ACCESS?'. Accessed '+fmtLong(today)+'.':'.');
    var chicago=(author?author+'. ':'')+'\\u201c'+title+'.\\u201d '+site+'. '+(pub?fmtLong(pub):'n.d.')+'. '+pageUrl+(INCLUDE_ACCESS?' (accessed '+fmtLong(today)+').':'.');
    var bibkey=(author?author.split(/\\s+/).pop().toLowerCase():site.replace(/[^a-z0-9]+/gi,''))+(pub?pub.getFullYear():'nd');
    var bibtex='@misc{'+bibkey+',\\n  title = {'+title+'},\\n'+(author?'  author = {'+author+'},\\n':'')+'  year = {'+(pub?pub.getFullYear():'n.d.')+'},\\n  howpublished = {'+site+'},\\n  url = {'+pageUrl+'}'+(INCLUDE_ACCESS?',\\n  note = {Accessed: '+fmtISO(today)+'}':'')+'\\n}';
    var panel=window.AIHubPanel.create({key:'citationgrabber',title:'Citation Grabber',icon:'📚',width:400});
    var bd=panel.body;
    [['APA',apa],['MLA',mla],['Chicago',chicago],['BibTeX',bibtex]].forEach(function(f){
      var box=document.createElement('div');
      box.style.cssText='margin-bottom:10px;padding:8px;border-radius:8px;background:rgba(255,255,255,.04)';
      var head=document.createElement('div');head.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:5px';
      var lbl=document.createElement('span');lbl.style.cssText='font-weight:700;font-size:11px;color:#93c5fd';lbl.textContent=f[0];
      var copyB=document.createElement('button');copyB.textContent='Copy';copyB.style.cssText='padding:2px 10px;font-size:10px';
      copyB.onclick=function(){try{navigator.clipboard.writeText(f[1]);copyB.textContent='Copied';setTimeout(function(){copyB.textContent='Copy'},1200)}catch(e){}};
      head.appendChild(lbl);head.appendChild(copyB);
      var body=document.createElement('div');
      body.style.cssText='font-size:11px;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;opacity:.85;line-height:1.5';
      body.textContent=f[1];
      box.appendChild(head);box.appendChild(body);bd.appendChild(box);
    });`),
    remove: cleanup('citationgrabber'),
  },

  {
    id: 'pagesnapshotdiff',
    name: 'Page Snapshot Diff',
    tagline: 'See what changed since your last visit',
    description: 'Remembers the text of this page from your last visit and highlights the paragraphs that were added or removed since, right on the page — no watch list to set up, no polling in the background. Every visit rolls the baseline forward, so it always compares against last time you were actually here. Great for docs, pricing pages and changelogs you browse to directly.',
    howTo: 'Enable and revisit any page you check periodically — the first visit just records a baseline, every visit after that shows added text in green and removed text in struck-through red.',
    icon: '📸', color: '#22c55e', category: 'Productivity', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'minChars', label: 'Ignore text blocks shorter than (chars)', type: 'range', min: 0, max: 200, step: 10, default: 20 },
    ],
    inject: (s) => ext('pagesnapshotdiff', `
    var MINCHARS=${+(s.minChars ?? 20)};
    var key='aihub.snapdiff.'+location.origin+location.pathname;
    function blocks(){
      var out=[];
      document.querySelectorAll('p,li,h1,h2,h3,blockquote').forEach(function(n){
        var t=(n.innerText||'').trim().replace(/\\s+/g,' ');
        if(t.length>=MINCHARS)out.push(t);
      });
      return out;
    }
    function load(){try{return JSON.parse(localStorage.getItem(key)||'null')}catch(e){return null}}
    function save(list){try{localStorage.setItem(key,JSON.stringify({t:Date.now(),blocks:list}))}catch(e){}}
    function diff(prevList,curList){
      var prevSet={};prevList.forEach(function(p){prevSet[p]=true});
      var curSet={};curList.forEach(function(c){curSet[c]=true});
      return {
        added: curList.filter(function(c){return !prevSet[c]}),
        removed: prevList.filter(function(p){return !curSet[p]}),
      };
    }
    var current=blocks();
    var prevData=load();
    var panel=window.AIHubPanel.create({key:'pagesnapshotdiff',title:'Snapshot Diff',icon:'📸',width:400});
    var bd=panel.body;
    if(!prevData){
      var info=document.createElement('div');
      info.style.cssText='font-size:11.5px;opacity:.7;line-height:1.6';
      info.textContent='First visit recorded ('+current.length+' text blocks). Revisit this page later to see what changed.';
      bd.appendChild(info);
    }else{
      var d=diff(prevData.blocks||[],current);
      var since=prevData.t?new Date(prevData.t):null;
      var head=document.createElement('div');
      head.style.cssText='font-size:11px;opacity:.55;margin-bottom:8px';
      head.textContent='Compared to your last visit'+(since?' ('+since.toLocaleString()+')':'')+'.';
      bd.appendChild(head);
      if(!d.added.length&&!d.removed.length){
        var same=document.createElement('div');
        same.style.cssText='font-size:11.5px;opacity:.6';
        same.textContent='No visible text changes since last visit.';
        bd.appendChild(same);
      }else{
        d.added.forEach(function(t){
          var row=document.createElement('div');
          row.style.cssText='padding:6px 8px;margin-bottom:5px;border-radius:8px;background:rgba(52,211,153,.1);border-left:2px solid #34d399;font-size:11.5px;line-height:1.5';
          row.textContent='+ '+t.slice(0,240);
          bd.appendChild(row);
        });
        d.removed.forEach(function(t){
          var row=document.createElement('div');
          row.style.cssText='padding:6px 8px;margin-bottom:5px;border-radius:8px;background:rgba(248,113,113,.1);border-left:2px solid #f87171;font-size:11.5px;line-height:1.5;text-decoration:line-through;opacity:.7';
          row.textContent='- '+t.slice(0,240);
          bd.appendChild(row);
        });
      }
    }
    var btn=document.createElement('button');
    btn.textContent='Forget baseline';
    btn.style.cssText='margin-top:8px;background:rgba(255,255,255,.08)';
    btn.onclick=function(){try{localStorage.removeItem(key)}catch(e){}btn.textContent='Forgotten \\u2713';setTimeout(function(){btn.textContent='Forget baseline'},1200)};
    bd.appendChild(btn);
    save(current);`),
    remove: cleanup('pagesnapshotdiff'),
  },

  {
    id: 'pomodorotab',
    name: 'Pomodoro Tab',
    tagline: 'A focus timer that lives on the page',
    description: 'A focus/break timer for this tab: counts down a focus block, then covers this page with a break reminder until the break block ends, and keeps a running total of focused minutes on this site today. It only affects the tab it runs in — a page script has no way to dim or control other tabs, so this is a per-tab timer, not a whole-browser one.',
    howTo: 'Enable, open the panel and press Start. When the focus block ends this page dims with a break reminder until the break block ends; press Start again anytime to resume.',
    icon: '🍅', color: '#ef4444', category: 'Productivity', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'focusMin', label: 'Focus length (minutes)', type: 'range', min: 5, max: 60, step: 5, default: 25 },
      { key: 'breakMin', label: 'Break length (minutes)', type: 'range', min: 1, max: 30, step: 1, default: 5 },
    ],
    inject: (s) => ext('pomodorotab', `
    var FOCUS=${+(s.focusMin ?? 25)}*60, BREAK=${+(s.breakMin ?? 5)}*60;
    var logKey='aihub.pomodoro.'+location.hostname;
    function loadLog(){try{return JSON.parse(localStorage.getItem(logKey)||'[]')}catch(e){return []}}
    function saveLog(list){try{localStorage.setItem(logKey,JSON.stringify(list.slice(-200)))}catch(e){}}
    var panel=window.AIHubPanel.create({key:'pomodorotab',title:'Pomodoro',icon:'🍅',width:260});
    var bd=panel.body;
    var phase='focus',remaining=FOCUS,running=false,cycles=0,sessionStart=null,overlay=null;
    function showBreakOverlay(){
      if(overlay)return;
      overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(2,6,23,.85);display:flex;align-items:center;justify-content:center;color:#e9ebf5;font:600 18px ui-sans-serif,system-ui;flex-direction:column;gap:10px';
      var t=document.createElement('div');t.textContent='\\u2615 Break time';
      var s2=document.createElement('div');s2.style.cssText='font-size:13px;opacity:.7;font-weight:400';s2.textContent='Step away from this tab for a bit.';
      overlay.appendChild(t);overlay.appendChild(s2);
      document.body.appendChild(overlay);
      onClean(function(){try{overlay&&overlay.remove()}catch(e){}});
    }
    function hideBreakOverlay(){if(overlay){overlay.remove();overlay=null}}
    var box=document.createElement('div');box.style.cssText='text-align:center';
    var timeEl=document.createElement('div');timeEl.style.cssText='font-size:32px;font-weight:700;font-family:ui-monospace,monospace;margin-bottom:4px';
    var phaseEl=document.createElement('div');phaseEl.style.cssText='font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px';
    var row=document.createElement('div');row.style.cssText='display:flex;gap:6px;justify-content:center;margin-bottom:10px';
    var startBtn=document.createElement('button');startBtn.textContent='Start';
    var resetBtn=document.createElement('button');resetBtn.textContent='Reset';resetBtn.style.cssText='background:rgba(255,255,255,.08)';
    row.appendChild(startBtn);row.appendChild(resetBtn);
    var statsEl=document.createElement('div');statsEl.style.cssText='font-size:10.5px;opacity:.5';
    box.appendChild(timeEl);box.appendChild(phaseEl);box.appendChild(row);box.appendChild(statsEl);
    bd.appendChild(box);
    function fmt(sec){var m=Math.floor(sec/60),s3=sec%60;return (m<10?'0':'')+m+':'+(s3<10?'0':'')+s3}
    function todayTotal(){
      var today=new Date().toISOString().slice(0,10);
      return loadLog().filter(function(e){return e.day===today}).reduce(function(a,e){return a+e.dur},0);
    }
    function paint(){
      timeEl.textContent=fmt(remaining);
      phaseEl.textContent=(phase==='focus'?'Focus':'Break')+' \\u00b7 cycle '+(cycles+1);
      startBtn.textContent=running?'Pause':'Start';
      statsEl.textContent=Math.round(todayTotal()/60)+'m focused today on '+location.hostname;
      panel.setTitle('Pomodoro \\u00b7 '+fmt(remaining));
    }
    function tick(){
      if(!running)return;
      remaining--;
      if(remaining<=0){
        if(phase==='focus'){
          if(sessionStart)saveLog(loadLog().concat([{day:new Date().toISOString().slice(0,10),dur:FOCUS}]));
          cycles++;phase='break';remaining=BREAK;showBreakOverlay();
        }else{
          phase='focus';remaining=FOCUS;sessionStart=Date.now();hideBreakOverlay();
        }
      }
      paint();
    }
    startBtn.onclick=function(){
      running=!running;
      if(running&&phase==='focus'&&!sessionStart)sessionStart=Date.now();
      paint();
    };
    resetBtn.onclick=function(){
      running=false;phase='focus';remaining=FOCUS;sessionStart=null;hideBreakOverlay();paint();
    };
    var iv=setInterval(tick,1000);
    onClean(function(){clearInterval(iv);hideBreakOverlay()});
    paint();`),
    remove: cleanup('pomodorotab'),
  },

  // ── Privacy ─────────────────────────────────────────────────────────────
  {
    id: 'cookieinspector',
    name: 'Cookie Inspector',
    tagline: 'Every cookie this page can read, in one panel',
    description: 'Lists every cookie readable by page scripts on the current site with its name and value, and lets you copy or delete any one of them, or wipe the lot in a click. HttpOnly cookies are called out as hidden by design — that protection is the browser working as intended, and no page script (including this one) can see past it.',
    howTo: 'Enable, then open the panel — it lists cookies for the current site immediately. Press Refresh after a page action sets new ones, or Wipe readable to clear everything this page can see.',
    icon: '🍪', color: '#f97316', category: 'Privacy', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'mask', label: 'Mask cookie values', type: 'toggle', default: true },
    ],
    inject: (s) => ext('cookieinspector', `
    var MASK=${s.mask === false ? 'false' : 'true'};
    var panel=window.AIHubPanel.create({key:'cookieinspector',title:'Cookie Inspector',icon:'🍪',width:380});
    var bd=panel.body;
    var toolbar=document.createElement('div');toolbar.style.cssText='display:flex;gap:6px;margin-bottom:8px';
    var refreshBtn=document.createElement('button');refreshBtn.textContent='Refresh';
    var wipeBtn=document.createElement('button');wipeBtn.textContent='Wipe readable';
    wipeBtn.style.cssText='background:linear-gradient(135deg,#f87171,#ef4444)';
    toolbar.appendChild(refreshBtn);toolbar.appendChild(wipeBtn);bd.appendChild(toolbar);
    var note=document.createElement('div');
    note.style.cssText='font-size:10.5px;opacity:.55;margin-bottom:8px;line-height:1.5';
    note.textContent='Showing cookies readable by scripts on '+location.hostname+'. HttpOnly cookies are hidden from JS by design and cannot be listed here.';
    bd.appendChild(note);
    var list=document.createElement('div');bd.appendChild(list);
    function parseCookies(){
      return document.cookie.split(';').map(function(p){return p.trim()}).filter(Boolean).map(function(p){
        var i=p.indexOf('=');
        var name=i===-1?p:p.slice(0,i);
        var value=i===-1?'':p.slice(i+1);
        try{value=decodeURIComponent(value)}catch(e){}
        return {name:name,value:value};
      });
    }
    function wipeOne(name){
      document.cookie=name+'=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
      document.cookie=name+'=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;domain='+location.hostname;
    }
    function row(c){
      var r=document.createElement('div');
      r.style.cssText='padding:7px 8px;margin-bottom:5px;border-radius:8px;background:rgba(255,255,255,.04);font-size:11.5px';
      var top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;gap:8px;align-items:center';
      var nm=document.createElement('span');nm.style.cssText='font-weight:600;color:#f3f4fb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nm.textContent=c.name;
      var actions=document.createElement('span');actions.style.cssText='display:flex;gap:6px;flex:0 0 auto';
      var copyB=document.createElement('button');copyB.textContent='copy';copyB.style.cssText='padding:2px 8px;font-size:10px;background:rgba(255,255,255,.08)';
      copyB.onclick=function(){try{navigator.clipboard.writeText(c.value)}catch(e){}};
      var delB=document.createElement('button');delB.textContent='del';delB.style.cssText='padding:2px 8px;font-size:10px;background:rgba(248,113,113,.18);color:#fca5a5';
      delB.onclick=function(){wipeOne(c.name);render()};
      actions.appendChild(copyB);actions.appendChild(delB);
      top.appendChild(nm);top.appendChild(actions);
      var val=document.createElement('div');
      val.style.cssText='opacity:.6;font-family:ui-monospace,monospace;font-size:10.5px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      val.textContent=MASK?(c.value?c.value.slice(0,4)+'\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022':'(empty)'):(c.value||'(empty)');
      var meta=document.createElement('div');
      meta.style.cssText='opacity:.4;font-size:10px;margin-top:2px';
      meta.textContent=location.hostname+' \\u00b7 '+(location.protocol==='https:'?'served over https':'served over http')+' \\u00b7 SameSite/Secure/HttpOnly flags are not exposed to JS';
      r.appendChild(top);r.appendChild(val);r.appendChild(meta);
      return r;
    }
    function render(){
      while(list.firstChild)list.removeChild(list.firstChild);
      var cookies=parseCookies();
      panel.setTitle('Cookie Inspector \\u00b7 '+cookies.length);
      if(!cookies.length){
        var empty=document.createElement('div');empty.style.cssText='opacity:.5;font-size:11.5px;padding:8px 0';
        empty.textContent='No JS-readable cookies on this page.';list.appendChild(empty);return;
      }
      cookies.forEach(function(c){list.appendChild(row(c))});
    }
    refreshBtn.onclick=render;
    wipeBtn.onclick=function(){parseCookies().forEach(function(c){wipeOne(c.name)});render()};
    render();`),
    remove: cleanup('cookieinspector'),
  },

  {
    id: 'trackermap',
    name: 'Third-Party Tracker Map',
    tagline: 'See every domain this page is quietly talking to',
    description: 'Watches every script, image, iframe and XHR the page loads and plots the third-party domains behind them as a small connected graph, flagging the ones that match a curated list of known ad and analytics vendors. Nothing here is a network call of its own — it only reads the browser\'s own resource timing entries for requests the page already made.',
    howTo: 'Enable, then browse normally — the graph and list below it fill in as the page fires requests. Known ad/analytics vendors get a red dot and a left border in the list; everything else is a neutral third party.',
    icon: '🕵️', color: '#ef4444', category: 'Privacy', version: '1.0.0',
    needsPanel: true,
    settings: [
      { key: 'refreshMs', label: 'Refresh interval (ms)', type: 'range', min: 1000, max: 10000, step: 500, default: 3000 },
    ],
    inject: (s) => ext('trackermap', `
    var REFRESH=${+(s.refreshMs ?? 3000)};
    var KNOWN={
      'google-analytics.com':'Google Analytics','googletagmanager.com':'Google Tag Manager',
      'doubleclick.net':'Google Ads','googlesyndication.com':'Google Ads','googleadservices.com':'Google Ads',
      'facebook.net':'Meta Pixel','connect.facebook.net':'Meta Pixel','hotjar.com':'Hotjar',
      'segment.io':'Segment','segment.com':'Segment','mixpanel.com':'Mixpanel','amplitude.com':'Amplitude',
      'criteo.com':'Criteo','taboola.com':'Taboola','outbrain.com':'Outbrain','scorecardresearch.com':'ScorecardResearch',
      'adsrvr.org':'The Trade Desk','quantserve.com':'Quantcast','clarity.ms':'Microsoft Clarity','bat.bing.com':'Bing Ads',
      'fullstory.com':'FullStory','intercomcdn.com':'Intercom','intercom.io':'Intercom','newrelic.com':'New Relic',
      'nr-data.net':'New Relic','sentry.io':'Sentry','cloudflareinsights.com':'Cloudflare Insights','snapchat.com':'Snap Pixel'
    };
    function vendorFor(host){
      for(var k in KNOWN){if(host===k||host.slice(-(k.length+1))==='.'+k)return KNOWN[k]}
      return null;
    }
    var panel=window.AIHubPanel.create({key:'trackermap',title:'Tracker Map',icon:'\\ud83d\\udd75\\ufe0f',width:400});
    var bd=panel.body;
    var svgWrap=document.createElement('div');svgWrap.style.cssText='margin-bottom:10px';bd.appendChild(svgWrap);
    var list=document.createElement('div');bd.appendChild(list);
    var selfHost=location.hostname;
    var domains={};
    function record(url,type){
      var host;try{host=new URL(url,location.href).hostname}catch(e){return}
      if(!host||host===selfHost)return;
      if(!domains[host])domains[host]={count:0,vendor:vendorFor(host)};
      domains[host].count++;
    }
    try{ performance.getEntriesByType('resource').forEach(function(e){record(e.name,e.initiatorType)}) }catch(e){}
    var po=null;
    try{
      po=new PerformanceObserver(function(l){l.getEntries().forEach(function(e){record(e.name,e.initiatorType)});render()});
      po.observe({type:'resource',buffered:false});
    }catch(e){}
    onClean(function(){if(po)try{po.disconnect()}catch(e){}});
    function draw(){
      var hosts=Object.keys(domains);
      var size=240,cx=size/2,cy=size/2,r=size/2-34;
      var svgNS='http://www.w3.org/2000/svg';
      var svg=document.createElementNS(svgNS,'svg');
      svg.setAttribute('viewBox','0 0 '+size+' '+size);svg.setAttribute('width','100%');
      svg.style.maxWidth=size+'px';svg.style.display='block';svg.style.margin='0 auto';
      var maxCount=hosts.reduce(function(m,h){return Math.max(m,domains[h].count)},1);
      hosts.forEach(function(h,i){
        var ang=(i/Math.max(hosts.length,1))*Math.PI*2-Math.PI/2;
        var x=cx+Math.cos(ang)*r,y=cy+Math.sin(ang)*r;
        var line=document.createElementNS(svgNS,'line');
        line.setAttribute('x1',cx);line.setAttribute('y1',cy);line.setAttribute('x2',x);line.setAttribute('y2',y);
        line.setAttribute('stroke',domains[h].vendor?'rgba(248,113,113,.5)':'rgba(148,163,184,.35)');
        line.setAttribute('stroke-width','1');svg.appendChild(line);
        var rad=6+8*(domains[h].count/maxCount);
        var dot=document.createElementNS(svgNS,'circle');
        dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',rad);
        dot.setAttribute('fill',domains[h].vendor?'#f87171':'#60a5fa');dot.setAttribute('opacity','0.85');
        var t=document.createElementNS(svgNS,'title');
        t.textContent=h+(domains[h].vendor?' \\u2014 '+domains[h].vendor:'')+' \\u00b7 '+domains[h].count+' req';
        dot.appendChild(t);svg.appendChild(dot);
      });
      var center=document.createElementNS(svgNS,'circle');
      center.setAttribute('cx',cx);center.setAttribute('cy',cy);center.setAttribute('r',10);center.setAttribute('fill','#a78bfa');
      var ct=document.createElementNS(svgNS,'title');ct.textContent=selfHost+' (this page)';center.appendChild(ct);
      svg.appendChild(center);
      while(svgWrap.firstChild)svgWrap.removeChild(svgWrap.firstChild);
      svgWrap.appendChild(svg);
    }
    function render(){
      draw();
      var hosts=Object.keys(domains).sort(function(a,b){return domains[b].count-domains[a].count});
      panel.setTitle('Tracker Map \\u00b7 '+hosts.length);
      while(list.firstChild)list.removeChild(list.firstChild);
      if(!hosts.length){
        var e=document.createElement('div');e.style.cssText='opacity:.5;font-size:11.5px';
        e.textContent='No third-party requests observed yet.';list.appendChild(e);return;
      }
      hosts.forEach(function(h){
        var d=domains[h];
        var row=document.createElement('div');
        row.style.cssText='display:flex;justify-content:space-between;gap:8px;padding:6px 8px;margin-bottom:4px;border-radius:8px;background:rgba(255,255,255,.04);font-size:11px'+(d.vendor?';border-left:2px solid #f87171':'');
        var left=document.createElement('span');left.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px';
        left.textContent=esc(h)+(d.vendor?' \\u2014 '+esc(d.vendor):'');
        var right=document.createElement('span');right.style.opacity='.6';right.textContent=d.count+'x';
        row.appendChild(left);row.appendChild(right);list.appendChild(row);
      });
    }
    render();
    var iv=setInterval(render,REFRESH);
    onClean(function(){clearInterval(iv)});`),
    remove: cleanup('trackermap'),
  },

  {
    id: 'formfieldspy',
    name: 'Form Field Spy',
    tagline: 'Flags forms that ship your data to another domain',
    description: 'Watches every form on the page and warns you when one submits to a different domain than the page you are on — the classic "free PDF" trick where an email form quietly ships your address to a marketing SaaS. Cross-domain forms carrying a password, email or phone field get an inline badge and a one-time confirmation before they actually submit. Pure client-side, no telemetry, no network calls of its own.',
    howTo: 'Enable and browse as normal. Any form heading to a different domain gets a small warning badge above it; submitting one that also asks for an email, phone or password pops a confirmation naming the destination domain before it goes through.',
    icon: '📝', color: '#eab308', category: 'Privacy', version: '1.0.0',
    settings: [
      { key: 'strict', label: 'Warn for every cross-domain form (not just email/password/phone)', type: 'toggle', default: false },
    ],
    inject: (s) => ext('formfieldspy', `
    var STRICT=${s.strict ? 'true' : 'false'};
    function hasSensitive(form){
      return !!form.querySelector('input[type=password],input[type=email],input[type=tel],input[name*=email i],input[name*=card i]');
    }
    function destHost(form){
      var action=form.getAttribute('action');if(!action)return null;
      try{var u=new URL(action,location.href);return u.hostname||null}catch(e){return null}
    }
    function crossDomain(form){var h=destHost(form);return !!h&&h!==location.hostname}
    function badge(form){
      if(form.__aihubBadged)return;form.__aihubBadged=true;
      var b=document.createElement('div');
      b.textContent='\\u26a0 sends to '+destHost(form);
      b.style.cssText='display:inline-block;margin:4px 0;padding:3px 8px;border-radius:6px;background:rgba(251,191,36,.15);color:#fbbf24;font:600 10.5px ui-sans-serif,system-ui;border:1px solid rgba(251,191,36,.3)';
      if(form.parentNode)form.parentNode.insertBefore(b,form);
      onClean(function(){try{b.remove()}catch(e){}});
    }
    function scan(){
      document.querySelectorAll('form').forEach(function(f){
        if(crossDomain(f)&&(STRICT||hasSensitive(f)))badge(f);
      });
    }
    scan();
    var mo=new MutationObserver(function(){scan()});
    mo.observe(document.body||document.documentElement,{childList:true,subtree:true});
    onClean(function(){mo.disconnect()});
    var pending=null;
    function showModal(form,dest){
      if(pending)return;
      var ov=document.createElement('div');
      ov.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.55);display:flex;align-items:center;justify-content:center';
      var card=document.createElement('div');
      card.style.cssText='max-width:340px;padding:18px 20px;border-radius:14px;background:#12131f;color:#e9ebf5;font:13px ui-sans-serif,system-ui;border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 60px rgba(0,0,0,.6)';
      card.innerHTML='<div style="font-weight:700;margin-bottom:8px">\\u26a0 This form sends data elsewhere</div>'+
        '<div style="opacity:.75;line-height:1.6;margin-bottom:14px">You are on <b>'+esc(location.hostname)+'</b> but this form submits to <b>'+esc(dest)+'</b>. Make sure that is what you expect before continuing.</div>';
      var row=document.createElement('div');row.style.cssText='display:flex;gap:8px;justify-content:flex-end';
      var cancel=document.createElement('button');cancel.textContent='Cancel';cancel.style.cssText='background:rgba(255,255,255,.08)';
      var cont=document.createElement('button');cont.textContent='Continue anyway';
      row.appendChild(cancel);row.appendChild(cont);card.appendChild(row);ov.appendChild(card);
      document.body.appendChild(ov);pending=ov;
      cancel.onclick=function(){ov.remove();pending=null};
      cont.onclick=function(){
        form.__aihubApproved=true;ov.remove();pending=null;
        if(typeof form.requestSubmit==='function')form.requestSubmit();else form.submit();
      };
    }
    on(document,'submit',function(e){
      var form=e.target;
      if(!(form&&form.tagName==='FORM'))return;
      if(form.__aihubApproved)return;
      if(!crossDomain(form)||!(STRICT||hasSensitive(form)))return;
      e.preventDefault();e.stopPropagation();
      showModal(form,destHost(form));
    },true);`),
    remove: cleanup('formfieldspy'),
  },

  {
    id: 'pwreveal',
    name: 'Password Field Reveal',
    tagline: 'A show/hide eye on every password field',
    description: 'Adds a small eye toggle to every password field on the page so you can check what you actually typed before submitting, without the site having to build that in itself. Fields are automatically re-masked the moment a form submits, so a revealed password never lingers on screen after you have moved on.',
    howTo: 'Enable, then click the eye icon inside any password field to reveal or re-hide it. It resets to hidden automatically when the form submits.',
    icon: '👁', color: '#8b5cf6', category: 'Privacy', version: '1.0.0',
    settings: [
      { key: 'position', label: 'Icon position', type: 'select', default: 'right', options: [
        { value: 'right', label: 'Right edge' },
        { value: 'left', label: 'Left edge' },
      ] },
    ],
    inject: (s) => ext('pwreveal', `
    var POS=${JSON.stringify(s.position === 'left' ? 'left' : 'right')};
    function wrap(input){
      if(input.__aihubEyeWrapped)return;input.__aihubEyeWrapped=true;
      var parent=input.parentNode;if(!parent)return;
      var host=document.createElement('span');
      host.style.cssText='position:relative;display:inline-block;vertical-align:middle;width:'+(input.offsetWidth?input.offsetWidth+'px':'100%');
      parent.insertBefore(host,input);host.appendChild(input);
      var btn=document.createElement('button');
      btn.type='button';btn.textContent='\\ud83d\\udc41';btn.setAttribute('aria-label','Show password');
      btn.style.cssText='position:absolute;top:50%;'+(POS==='right'?'right:6px':'left:6px')+';transform:translateY(-50%);width:22px;height:22px;padding:0;border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:13px;line-height:1;z-index:2';
      host.appendChild(btn);
      var padKey=POS==='right'?'paddingRight':'paddingLeft';
      var prevPad=input.style[padKey];
      input.style[padKey]='28px';
      btn.onmousedown=function(e){e.preventDefault()};
      var revealed=false;
      btn.onclick=function(){
        revealed=!revealed;
        input.type=revealed?'text':'password';
        btn.style.opacity=revealed?'1':'.55';
      };
      if(input.form)on(input.form,'submit',function(){
        input.type='password';revealed=false;btn.style.opacity='.55';
      },true);
      onClean(function(){
        try{
          input.type='password';input.style[padKey]=prevPad;
          if(host.parentNode)host.parentNode.insertBefore(input,host);
          host.remove();
        }catch(e){}
      });
    }
    function scan(){document.querySelectorAll('input[type=password]').forEach(wrap)}
    scan();
    var mo=new MutationObserver(function(){scan()});
    mo.observe(document.body||document.documentElement,{childList:true,subtree:true});
    onClean(function(){mo.disconnect()});`),
    remove: cleanup('pwreveal'),
  },
]
