export interface ExtensionSetting {
  key: string
  label: string
  type: 'range' | 'select' | 'toggle'
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
  default: any
}

export interface ExtensionDef {
  id: string
  name: string
  tagline: string
  description: string
  icon: string
  color: string
  category: 'Media' | 'Privacy' | 'Productivity' | 'Accessibility' | 'Developer' | 'Reading'
  version: string
  settings: ExtensionSetting[]
  inject: (s: Record<string, any>) => string
  remove: string
}

export const EXTENSION_DEFS: ExtensionDef[] = [
  {
    id: 'dime',
    name: 'Dime',
    tagline: 'Dims the background while video plays',
    description: 'Creates a dark overlay around playing videos to bring cinematic focus to the content. Opacity is fully adjustable. Works on YouTube, Vimeo, and any HTML5 video.',
    icon: '🎬',
    color: '#f59e0b',
    category: 'Media',
    version: '1.0.0',
    settings: [
      { key: 'opacity', label: 'Dim Opacity', type: 'range', min: 0.1, max: 0.95, step: 0.05, default: 0.7 },
    ],
    inject: (s) => `(function(){
  var K='__ext_dime';
  if(window[K]){window[K].update(${+(s.opacity ?? 0.7)});return;}
  var op=${+(s.opacity ?? 0.7)},ov=null;
  function show(){
    if(ov)return;
    ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,'+op+');z-index:2147483640;pointer-events:none;transition:opacity 0.4s;opacity:0;';
    if(document.body)document.body.appendChild(ov);
    setTimeout(function(){if(ov)ov.style.opacity='1';},10);
  }
  function hide(){
    if(!ov)return;
    var o=ov;ov=null;
    o.style.opacity='0';
    setTimeout(function(){try{o.remove();}catch(e){}},420);
  }
  function check(){
    var pl=false;
    document.querySelectorAll('video').forEach(function(v){if(!v.paused&&!v.ended&&v.readyState>2)pl=true;});
    pl?show():hide();
  }
  document.addEventListener('play',check,true);
  document.addEventListener('pause',check,true);
  document.addEventListener('ended',check,true);
  check();
  window[K]={
    update:function(v){op=v;if(ov)ov.style.background='rgba(0,0,0,'+v+')';},
    remove:function(){
      hide();
      document.removeEventListener('play',check,true);
      document.removeEventListener('pause',check,true);
      document.removeEventListener('ended',check,true);
      delete window[K];
    }
  };
})()`,
    remove: `window.__ext_dime&&window.__ext_dime.remove()`,
  },

  {
    id: 'silent',
    name: 'Silent Mode',
    tagline: 'Blocks autoplay audio and video everywhere',
    description: 'Mutes all media on page load and intercepts new media elements so nothing autoplays. Toggle off to restore normal behavior.',
    icon: '🔇',
    color: '#ef4444',
    category: 'Media',
    version: '1.0.0',
    settings: [],
    inject: () => `(function(){
  var K='__ext_silent';
  if(window[K])return;
  var orig=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){this.muted=true;return orig.apply(this,arguments);};
  document.querySelectorAll('video,audio').forEach(function(m){m.muted=true;});
  var obs=new MutationObserver(function(ms){
    ms.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(typeof n.muted!=='undefined')n.muted=true;
        if(n.querySelectorAll)n.querySelectorAll('video,audio').forEach(function(e){e.muted=true;});
      });
    });
  });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  window[K]={remove:function(){HTMLMediaElement.prototype.play=orig;obs.disconnect();delete window[K];}};
})()`,
    remove: `window.__ext_silent&&window.__ext_silent.remove()`,
  },

  {
    id: 'reader',
    name: 'Focus Reader',
    tagline: 'Strips clutter for distraction-free reading',
    description: 'Detects the main article and presents it in a clean, full-screen reading environment with adjustable font size.',
    icon: '📖',
    color: '#10b981',
    category: 'Reading',
    version: '1.0.0',
    settings: [
      { key: 'fontSize', label: 'Font Size (px)', type: 'range', min: 14, max: 26, step: 1, default: 18 },
    ],
    inject: (s) => `(function(){
  var K='__ext_reader';
  if(window[K])return;
  var fs=${+(s.fontSize ?? 18)};
  var selectors=['article','main','[role="main"]','.article-body','.post-content','.entry-content','.content-body','#article-body','#main-content','#content'];
  var c=null;
  for(var i=0;i<selectors.length;i++){c=document.querySelector(selectors[i]);if(c&&c.innerText&&c.innerText.trim().length>200)break;c=null;}
  if(!c){
    var d2=document.createElement('div');
    d2.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1e293b;color:#94a3b8;padding:24px 32px;border-radius:14px;z-index:2147483647;font-family:sans-serif;font-size:14px;border:1px solid rgba(96,165,250,0.2);';
    d2.textContent='Focus Reader: No article content detected on this page.';
    var cl=document.createElement('button');
    cl.textContent='Close';
    cl.style.cssText='margin-top:12px;display:block;padding:6px 14px;background:rgba(59,130,246,0.2);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);border-radius:6px;cursor:pointer;font-size:12px;';
    cl.onclick=function(){d2.remove();delete window[K];};
    d2.appendChild(cl);
    document.body.appendChild(d2);
    window[K]={remove:function(){d2.remove();delete window[K];}};
    return;
  }
  var text=c.innerText;
  var overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:#0f172a;z-index:2147483645;overflow-y:auto;padding:56px 24px 80px;box-sizing:border-box;';
  var inner=document.createElement('div');
  inner.style.cssText='max-width:680px;margin:0 auto;color:#e2e8f0;font-family:Georgia,serif;font-size:'+fs+'px;line-height:1.85;';
  var h=document.createElement('h1');
  h.style.cssText='font-size:'+(fs+8)+'px;margin:0 0 28px;color:#f1f5f9;line-height:1.25;font-family:system-ui,sans-serif;font-weight:700;';
  h.textContent=document.title;
  inner.appendChild(h);
  var body=document.createElement('div');
  body.style.whiteSpace='pre-wrap';
  body.textContent=text;
  inner.appendChild(body);
  overlay.appendChild(inner);
  var btn=document.createElement('button');
  btn.textContent='Exit Reader';
  btn.style.cssText='position:fixed;top:14px;right:14px;z-index:2147483646;padding:7px 16px;background:rgba(15,23,42,0.92);color:#60a5fa;border:1px solid rgba(96,165,250,0.25);border-radius:8px;cursor:pointer;font-size:12px;font-family:sans-serif;backdrop-filter:blur(8px);';
  btn.onclick=function(){overlay.remove();btn.remove();delete window[K];};
  document.body.appendChild(overlay);
  document.body.appendChild(btn);
  window[K]={remove:function(){overlay.remove();btn.remove();delete window[K];}};
})()`,
    remove: `window.__ext_reader&&window.__ext_reader.remove()`,
  },

  {
    id: 'linkcleaner',
    name: 'Link Cleaner',
    tagline: 'Strips UTM & tracking params from all links',
    description: 'Silently removes UTM, fbclid, gclid, and other tracking tokens from every link on the page. Your clicks stay private.',
    icon: '🧹',
    color: '#6366f1',
    category: 'Privacy',
    version: '1.0.0',
    settings: [],
    inject: () => `(function(){
  var K='__ext_linkcleaner';
  if(window[K])return;
  var PARAMS=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','fbclid','gclid','ref','referrer','mc_cid','mc_eid','_ga','_gl','igshid','si','feature','icid','ncid','cmpid','yclid','msclkid','twclid'];
  function clean(a){
    if(!a||!a.href)return;
    try{
      var u=new URL(a.href);
      var changed=false;
      PARAMS.forEach(function(p){if(u.searchParams.has(p)){u.searchParams.delete(p);changed=true;}});
      if(changed)a.href=u.toString();
    }catch(e){}
  }
  function cleanAll(){document.querySelectorAll('a[href]').forEach(clean);}
  cleanAll();
  var obs=new MutationObserver(function(){setTimeout(cleanAll,80);});
  obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
  document.addEventListener('mouseover',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a)clean(a);},true);
  window[K]={remove:function(){obs.disconnect();delete window[K];}};
})()`,
    remove: `window.__ext_linkcleaner&&window.__ext_linkcleaner.remove()`,
  },

  {
    id: 'darkforce',
    name: 'Dark Force',
    tagline: 'Forces dark mode on any website',
    description: 'Applies a CSS invert+hue-rotate filter to make any bright website dark. Images and videos are re-inverted so they look natural.',
    icon: '🌑',
    color: '#334155',
    category: 'Accessibility',
    version: '1.0.0',
    settings: [],
    inject: () => `(function(){
  var K='__ext_darkforce';
  if(window[K])return;
  var st=document.createElement('style');
  st.id=K;
  st.textContent='html{filter:invert(1) hue-rotate(180deg) !important;background:#000 !important;}img,video,canvas,picture,svg,iframe{filter:invert(1) hue-rotate(180deg) !important;}';
  document.head.appendChild(st);
  window[K]={remove:function(){st.remove();delete window[K];}};
})()`,
    remove: `window.__ext_darkforce&&window.__ext_darkforce.remove()`,
  },

  {
    id: 'imginfo',
    name: 'Image Inspector',
    tagline: 'Hover images to see dimensions & file name',
    description: 'Shows a tooltip with natural dimensions, displayed size, and file name whenever you hover over any image. Great for designers and developers.',
    icon: '🔍',
    color: '#0ea5e9',
    category: 'Developer',
    version: '1.0.0',
    settings: [],
    inject: () => `(function(){
  var K='__ext_imginfo';
  if(window[K])return;
  var tip=document.createElement('div');
  tip.style.cssText='display:none;position:fixed;z-index:2147483647;background:rgba(2,6,23,0.96);color:#e2e8f0;font-size:11px;font-family:ui-monospace,monospace;padding:10px 14px;border-radius:10px;pointer-events:none;max-width:360px;line-height:1.7;border:1px solid rgba(96,165,250,0.18);backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,0.5);';
  document.body.appendChild(tip);
  function show(e){
    var img=e.target;
    if(!img||img.tagName!=='IMG')return;
    var nat=img.naturalWidth+'x'+img.naturalHeight;
    var disp=img.offsetWidth+'x'+img.offsetHeight;
    var name=(img.src||'').split('/').pop().split('?')[0].slice(0,48)||'(unknown)';
    while(tip.firstChild)tip.removeChild(tip.firstChild);
    [['Natural size',nat],['Displayed',disp],['File',name]].forEach(function(row){
      var d=document.createElement('div');d.style.display='flex';d.style.gap='10px';d.style.justifyContent='space-between';
      var k=document.createElement('span');k.style.color='#475569';k.textContent=row[0];
      var v=document.createElement('span');v.style.color='#93c5fd';v.textContent=row[1];
      d.appendChild(k);d.appendChild(v);tip.appendChild(d);
    });
    tip.style.display='block';
    move(e);
  }
  function hide(e){if(e.target&&e.target.tagName==='IMG')tip.style.display='none';}
  function move(e){
    if(tip.style.display==='none')return;
    tip.style.left=Math.min(e.clientX+14,window.innerWidth-380)+'px';
    tip.style.top=Math.min(e.clientY+14,window.innerHeight-100)+'px';
  }
  document.addEventListener('mouseover',show,true);
  document.addEventListener('mouseout',hide,true);
  document.addEventListener('mousemove',move,true);
  window[K]={remove:function(){tip.remove();document.removeEventListener('mouseover',show,true);document.removeEventListener('mouseout',hide,true);document.removeEventListener('mousemove',move,true);delete window[K];}};
})()`,
    remove: `window.__ext_imginfo&&window.__ext_imginfo.remove()`,
  },

  {
    id: 'wordcount',
    name: 'Word Counter',
    tagline: 'Shows live word count and reading time',
    description: 'A floating badge shows how many words are on the current page and your estimated reading time. Adjustable reading speed.',
    icon: '📊',
    color: '#8b5cf6',
    category: 'Productivity',
    version: '1.0.0',
    settings: [
      { key: 'wpm', label: 'Reading Speed (WPM)', type: 'range', min: 100, max: 600, step: 25, default: 200 },
    ],
    inject: (s) => `(function(){
  var K='__ext_wordcount';
  if(window[K])return;
  var wpm=${+(s.wpm ?? 200)};
  var badge=document.createElement('div');
  badge.style.cssText='position:fixed;bottom:18px;right:18px;z-index:2147483647;background:rgba(8,12,30,0.92);color:#94a3b8;font-size:11px;font-family:ui-monospace,monospace;padding:5px 14px;border-radius:20px;pointer-events:none;border:1px solid rgba(255,255,255,0.06);backdrop-filter:blur(14px);letter-spacing:0.02em;';
  function update(){
    var text=(document.body&&document.body.innerText)||'';
    var words=text.trim().split(/\\s+/).filter(function(w){return w.length>0;}).length;
    var mins=Math.ceil(words/wpm);
    badge.textContent=words.toLocaleString()+' words · '+mins+' min read';
  }
  update();
  if(document.body)document.body.appendChild(badge);
  var t;
  var obs=new MutationObserver(function(){clearTimeout(t);t=setTimeout(update,600);});
  obs.observe(document.body||document.documentElement,{childList:true,subtree:true,characterData:true});
  window[K]={remove:function(){badge.remove();obs.disconnect();clearTimeout(t);delete window[K];}};
})()`,
    remove: `window.__ext_wordcount&&window.__ext_wordcount.remove()`,
  },

  {
    id: 'cursorfx',
    name: 'Cursor Trail',
    tagline: 'Adds a glowing physics-based cursor trail',
    description: 'Renders a smooth spring-physics dot trail following your cursor. Fully customizable color and trail length.',
    icon: '✨',
    color: '#ec4899',
    category: 'Productivity',
    version: '1.0.0',
    settings: [
      {
        key: 'color', label: 'Trail Color', type: 'select', default: '#60a5fa',
        options: [
          { value: '#60a5fa', label: 'Blue' },
          { value: '#a78bfa', label: 'Purple' },
          { value: '#34d399', label: 'Green' },
          { value: '#f472b6', label: 'Pink' },
          { value: '#fbbf24', label: 'Gold' },
          { value: '#ffffff', label: 'White' },
        ],
      },
      { key: 'length', label: 'Trail Length', type: 'range', min: 4, max: 20, step: 1, default: 12 },
    ],
    inject: (s) => `(function(){
  var K='__ext_cursorfx';
  if(window[K])return;
  var color=${JSON.stringify(s.color || '#60a5fa')};
  var n=${+(s.length || 12)};
  var dots=[];
  for(var i=0;i<n;i++){
    var d=document.createElement('div');
    d.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border-radius:50%;will-change:left,top;';
    if(document.body)document.body.appendChild(d);
    dots.push({el:d,x:window.innerWidth/2,y:window.innerHeight/2});
  }
  var mx=window.innerWidth/2,my=window.innerHeight/2;
  function onMove(e){mx=e.clientX;my=e.clientY;}
  document.addEventListener('mousemove',onMove,true);
  var raf;
  function animate(){
    dots[0].x+=(mx-dots[0].x)*0.5;
    dots[0].y+=(my-dots[0].y)*0.5;
    for(var i=1;i<n;i++){
      dots[i].x+=(dots[i-1].x-dots[i].x)*0.35;
      dots[i].y+=(dots[i-1].y-dots[i].y)*0.35;
    }
    for(var j=0;j<n;j++){
      var sz=Math.max(1.5,9-j*0.55);
      var op=Math.pow(1-j/n,1.5);
      var dot=dots[j];
      dot.el.style.width=sz+'px';dot.el.style.height=sz+'px';
      dot.el.style.left=(dot.x-sz/2)+'px';dot.el.style.top=(dot.y-sz/2)+'px';
      dot.el.style.background=color;dot.el.style.opacity=String(op);
    }
    raf=requestAnimationFrame(animate);
  }
  animate();
  window[K]={remove:function(){cancelAnimationFrame(raf);document.removeEventListener('mousemove',onMove,true);dots.forEach(function(d){d.el.remove();});delete window[K];}};
})()`,
    remove: `window.__ext_cursorfx&&window.__ext_cursorfx.remove()`,
  },

  {
    id: 'colorfilter',
    name: 'Color Filter',
    tagline: 'Colorblind accessibility simulation filters',
    description: 'Applies SVG color matrix filters to simulate and compensate for color vision deficiencies. Choose from deuteranopia, protanopia, tritanopia, or grayscale.',
    icon: '🎨',
    color: '#f97316',
    category: 'Accessibility',
    version: '1.0.0',
    settings: [
      {
        key: 'mode', label: 'Filter Mode', type: 'select', default: 'deuteranopia',
        options: [
          { value: 'deuteranopia', label: 'Deuteranopia (Red-Green)' },
          { value: 'protanopia',   label: 'Protanopia (Red Weak)' },
          { value: 'tritanopia',   label: 'Tritanopia (Blue-Yellow)' },
          { value: 'grayscale',    label: 'Grayscale' },
        ],
      },
    ],
    inject: (s) => {
      const matrices: Record<string, string> = {
        deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
        protanopia:   '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
        tritanopia:   '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
        grayscale:    '0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0',
      }
      const m = matrices[s.mode as string] || matrices.deuteranopia
      return `(function(){
  var K='__ext_colorfilter';
  if(window[K])window[K].remove();
  var ns='http://www.w3.org/2000/svg';
  var svg=document.createElementNS(ns,'svg');
  svg.style.cssText='position:absolute;width:0;height:0;overflow:hidden;';
  var defs=document.createElementNS(ns,'defs');
  var filt=document.createElementNS(ns,'filter');
  filt.setAttribute('id','__aihub_cf');
  var cm=document.createElementNS(ns,'feColorMatrix');
  cm.setAttribute('type','matrix');
  cm.setAttribute('values','${m}');
  filt.appendChild(cm);defs.appendChild(filt);svg.appendChild(defs);
  if(document.body)document.body.appendChild(svg);
  var st=document.createElement('style');
  st.id=K+'_st';
  st.textContent='html{filter:url(#__aihub_cf)!important;}img,video,canvas{filter:url(#__aihub_cf)!important;}';
  document.head.appendChild(st);
  window[K]={remove:function(){try{svg.remove();}catch(e){}try{st.remove();}catch(e){}delete window[K];}};
})()`
    },
    remove: `window.__ext_colorfilter&&window.__ext_colorfilter.remove()`,
  },

  {
    id: 'ruler',
    name: 'Pixel Ruler',
    tagline: 'Crosshair overlay with pixel coordinates',
    description: 'Displays a dashed crosshair following your cursor with real-time pixel coordinates. Essential for designers checking layouts.',
    icon: '📐',
    color: '#14b8a6',
    category: 'Developer',
    version: '1.0.0',
    settings: [
      {
        key: 'color', label: 'Crosshair Color', type: 'select', default: '#60a5fa',
        options: [
          { value: '#60a5fa', label: 'Blue' },
          { value: '#34d399', label: 'Green' },
          { value: '#f472b6', label: 'Pink' },
          { value: '#fbbf24', label: 'Yellow' },
          { value: '#ffffff', label: 'White' },
        ],
      },
    ],
    inject: (s) => `(function(){
  var K='__ext_ruler';
  if(window[K])return;
  var color=${JSON.stringify(s.color || '#60a5fa')};
  var cv=document.createElement('canvas');
  cv.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  cv.width=window.innerWidth;cv.height=window.innerHeight;
  var ctx=cv.getContext('2d');
  var mx=0,my=0;
  function draw(){
    if(!ctx)return;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.save();
    ctx.strokeStyle=color;ctx.lineWidth=1;ctx.globalAlpha=0.55;ctx.setLineDash([5,5]);
    ctx.beginPath();ctx.moveTo(mx,0);ctx.lineTo(mx,cv.height);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,my);ctx.lineTo(cv.width,my);ctx.stroke();
    ctx.setLineDash([]);ctx.globalAlpha=1;
    var txt=mx+', '+my+' px';
    ctx.font='bold 11px ui-monospace,monospace';
    var tw=ctx.measureText(txt).width;
    var px=Math.min(mx+10,cv.width-tw-16),py=Math.max(my-10,16);
    ctx.fillStyle='rgba(2,6,23,0.9)';
    ctx.fillRect(px-5,py-13,tw+10,18);
    ctx.fillStyle=color;
    ctx.fillText(txt,px,py);
    ctx.restore();
  }
  function onMove(e){mx=e.clientX;my=e.clientY;draw();}
  window.addEventListener('mousemove',onMove);
  window.addEventListener('resize',function(){cv.width=window.innerWidth;cv.height=window.innerHeight;draw();});
  if(document.body)document.body.appendChild(cv);
  draw();
  window[K]={remove:function(){cv.remove();window.removeEventListener('mousemove',onMove);delete window[K];}};
})()`,
    remove: `window.__ext_ruler&&window.__ext_ruler.remove()`,
  },

  {
    id: 'noanimation',
    name: 'No Animations',
    tagline: 'Freezes all CSS animations and transitions',
    description: 'Instantly stops every CSS animation, transition, and scroll behavior. Reduces motion sickness, improves performance on slow machines.',
    icon: '⏸',
    color: '#64748b',
    category: 'Accessibility',
    version: '1.0.0',
    settings: [],
    inject: () => `(function(){
  var K='__ext_noanimation';
  if(window[K])return;
  var st=document.createElement('style');
  st.id=K;
  st.textContent='*,*::before,*::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important;transition-delay:0ms!important;scroll-behavior:auto!important;}';
  document.head.appendChild(st);
  window[K]={remove:function(){st.remove();delete window[K];}};
})()`,
    remove: `window.__ext_noanimation&&window.__ext_noanimation.remove()`,
  },

  {
    id: 'sepia',
    name: 'Sepia Mode',
    tagline: 'Warm sepia tone for comfortable reading',
    description: 'Applies a soft sepia filter to the page to reduce blue light and create a paper-like reading experience. Images and videos are excluded.',
    icon: '☕',
    color: '#92400e',
    category: 'Reading',
    version: '1.0.0',
    settings: [
      { key: 'intensity', label: 'Sepia Intensity', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.5 },
    ],
    inject: (s) => `(function(){
  var K='__ext_sepia';
  if(window[K])return;
  var st=document.createElement('style');
  st.id=K;
  st.textContent='html{filter:sepia(${+(s.intensity ?? 0.5)}) brightness(0.95)!important;}img,video{filter:none!important;}';
  document.head.appendChild(st);
  window[K]={remove:function(){st.remove();delete window[K];}};
})()`,
    remove: `window.__ext_sepia&&window.__ext_sepia.remove()`,
  },
]
