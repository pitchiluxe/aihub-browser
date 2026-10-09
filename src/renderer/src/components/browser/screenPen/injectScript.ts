// Scripts the Screen Pen injects into a web tab, kept apart from the React
// component that drives them so they can be run against a real DOM in tests.

import { SCREEN_PEN_RUNTIME_SOURCE, type ScreenPenConfig } from './screenPenRuntime'

// ── Sticky notes — in-page widgets, persisted per URL ─────────────────────
// Unchanged from the previous annotation tool on purpose: the storage key, the
// note shape and the host sync are what existing notes are saved under, so a
// note pinned before the Screen Pen still comes back exactly where it was.
export const NOTES_SCRIPT = `
  // Pastel pairs [top,bottom] for the note gradient; n.color indexes this.
  var NOTE_COLORS=[['#fef08a','#fde047'],['#bbf7d0','#86efac'],['#bfdbfe','#93c5fd'],['#fbcfe8','#f9a8d4'],['#fed7aa','#fdba74'],['#e9d5ff','#d8b4fe']];
  var NOTES_KEY='__aihub_notes::'+location.origin+location.pathname;
  var notes=[];
  var noteEls={};
  // Note-header icons: inline SVGs with a hardcoded dark stroke — emoji are
  // color fonts that ignore CSS color and render too faint on pastel notes.
  var ICON_STROKE='#3b2405';
  var SVG_NS='http://www.w3.org/2000/svg';
  // Built with createElementNS rather than innerHTML: sites that enforce
  // Trusted Types reject string HTML, which left the header buttons blank.
  function icon(shapes){
    var svg=document.createElementNS(SVG_NS,'svg');
    svg.setAttribute('width','14');svg.setAttribute('height','14');svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('fill','none');svg.setAttribute('stroke',ICON_STROKE);svg.setAttribute('stroke-width','2.4');
    svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
    svg.style.cssText='display:block;pointer-events:none;';
    shapes.forEach(function(s){
      var node=document.createElementNS(SVG_NS,s[0]);
      Object.keys(s[1]).forEach(function(k){node.setAttribute(k,s[1][k]);});
      svg.appendChild(node);
    });
    return svg;
  }
  var ICONS={
    save:[['path',{d:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'}],['polyline',{points:'17 21 17 13 7 13 7 21'}],['polyline',{points:'7 3 7 8 15 8'}]],
    check:[['polyline',{points:'20 6 9 17 4 12'}]],
    ai:[['path',{d:'M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z'}]],
    wait:[['circle',{cx:'12',cy:'12',r:'9'}],['polyline',{points:'12 7 12 12 15 15'}]],
    color:[['path',{d:'M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z'}]]
  };
  function setIcon(btn,name){btn.textContent='';btn.appendChild(icon(ICONS[name]));}
  // Site localStorage is only a fast local cache — the app's own store (synced
  // via the dirty flag + host poll) is the real persistence, so notes survive
  // site-data clears and are browsable from the Sticky Notes page.
  function saveNotes(){try{localStorage.setItem(NOTES_KEY,JSON.stringify(notes));}catch(e){} window.__aihub_notesDirty=true;}
  function makeNoteEl(n){
    var el=document.createElement('div');
    el.id='__aihub_note_'+n.id;
    el.style.cssText='position:fixed;left:'+n.x+'px;top:'+n.y+'px;width:220px;z-index:2147483647;background:linear-gradient(180deg,#fef08a,#fde047);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;overflow:hidden;';
    var head=document.createElement('div');
    head.style.cssText='display:flex;align-items:center;gap:5px;padding:6px 8px;background:rgba(0,0,0,0.07);cursor:grab;user-select:none;';
    // Editable title — identifies the note when minimized and in storage.
    var ttl=document.createElement('input');
    ttl.type='text';ttl.placeholder='Untitled note';ttl.value=n.title||'';
    ttl.style.cssText='flex:1;min-width:0;appearance:none;-webkit-appearance:none;border:none;background:transparent;outline:none;font-size:11px;font-weight:700;color:#422006;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:0;margin:0;cursor:text;';
    var tdeb=null;
    ttl.addEventListener('input',function(){
      n.title=ttl.value;
      if(tdeb)clearTimeout(tdeb);
      tdeb=setTimeout(saveNotes,400);
    });
    ttl.addEventListener('keydown',function(ev){ev.stopPropagation();});
    // Fully self-contained button CSS: injected into arbitrary pages, so a
    // site's own button rules (background:none, font-size:0, filters…) must
    // not be able to blank these out.
    var btnCss='appearance:none;-webkit-appearance:none;margin:0;padding:0;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;min-width:24px;border:none;border-radius:6px;background:rgba(0,0,0,0.14);cursor:pointer;font-size:14px;line-height:1;color:'+ICON_STROKE+';font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:1;visibility:visible;text-indent:0;box-shadow:none;filter:none;';
    var ai=document.createElement('button');
    ai.type='button';setIcon(ai,'ai');
    ai.title='Empty note: AI summarizes this page. With text: AI answers it about this page.';
    ai.style.cssText=btnCss;
    var sv=document.createElement('button');
    sv.type='button';setIcon(sv,'save');sv.title='Save note';
    sv.style.cssText=btnCss;
    var clr=document.createElement('button');
    clr.type='button';setIcon(clr,'color');clr.title='Note color';
    clr.style.cssText=btnCss;
    var nm=document.createElement('button');
    nm.type='button';nm.title='Minimize note';
    nm.style.cssText=btnCss+'font-weight:700;';
    var del=document.createElement('button');
    del.type='button';del.textContent='\\u00D7';del.title='Delete note';
    del.style.cssText=btnCss+'font-size:16px;font-weight:700;';
    head.appendChild(ttl);head.appendChild(sv);head.appendChild(ai);head.appendChild(clr);head.appendChild(nm);head.appendChild(del);
    // Color palette strip — hidden until the palette button is clicked.
    var pal=document.createElement('div');
    pal.style.cssText='display:none;gap:6px;padding:6px 8px;background:rgba(0,0,0,0.05);align-items:center;';
    NOTE_COLORS.forEach(function(c,i){
      var sw=document.createElement('button');
      sw.type='button';sw.title='Color '+(i+1);
      sw.style.cssText='appearance:none;-webkit-appearance:none;margin:0;padding:0;width:20px;height:20px;min-width:20px;border:2px solid rgba(0,0,0,0.25);border-radius:50%;cursor:pointer;background:linear-gradient(180deg,'+c[0]+','+c[1]+');';
      sw.onclick=function(){
        n.color=i;applyColor();saveNotes();
        pal.style.display='none';
      };
      pal.appendChild(sw);
    });
    function applyColor(){
      var c=NOTE_COLORS[(typeof n.color==='number'&&NOTE_COLORS[n.color])?n.color:0];
      el.style.background='linear-gradient(180deg,'+c[0]+','+c[1]+')';
    }
    applyColor();
    clr.onclick=function(){ pal.style.display=pal.style.display==='none'?'flex':'none'; };
    var body=document.createElement('div');
    body.contentEditable='true';
    body.textContent=n.text||'';
    body.style.cssText='min-height:70px;max-height:220px;overflow-y:auto;padding:8px 10px;font-size:12px;line-height:1.5;color:#422006;outline:none;white-space:pre-wrap;word-break:break-word;';
    el.appendChild(head);el.appendChild(pal);el.appendChild(body);
    document.body.appendChild(el);
    // n.min persists through saveNotes because the whole note object is serialized
    function applyMin(){
      body.style.display=n.min?'none':'block';
      if(n.min)pal.style.display='none';
      nm.textContent=n.min?'\\u25A1':'\\u2212';
      nm.title=n.min?'Restore note':'Minimize note';
    }
    applyMin();
    noteEls[n.id]={el:el,body:body,ai:ai,expand:function(){n.min=false;applyMin();}};
    var deb=null;
    body.addEventListener('input',function(){
      n.text=body.textContent||'';
      if(deb)clearTimeout(deb);
      deb=setTimeout(saveNotes,400);
    });
    // Typing in a note must never reach the page's own shortcuts or the pen.
    body.addEventListener('keydown',function(ev){ev.stopPropagation();});
    sv.onclick=function(){
      n.text=body.textContent||'';
      saveNotes();
      setIcon(sv,'check');
      setTimeout(function(){setIcon(sv,'save');},900);
    };
    nm.onclick=function(){ n.min=!n.min; applyMin(); saveNotes(); };
    del.onclick=function(){
      notes=notes.filter(function(x){return x.id!==n.id;});
      delete noteEls[n.id];
      el.remove();saveNotes();
    };
    ai.onclick=function(){
      if(ai.disabled)return;
      ai.disabled=true;setIcon(ai,'wait');
      window.__aihub_aiQueue=window.__aihub_aiQueue||[];
      window.__aihub_aiQueue.push({noteId:n.id,text:(n.text||'').trim()});
    };
    var ndrag=false,nx=0,ny=0;
    head.addEventListener('mousedown',function(e){
      if(e.target===ai||e.target===del||e.target===sv||e.target===nm||e.target===clr||e.target===ttl)return;
      ndrag=true;var r=el.getBoundingClientRect();nx=e.clientX-r.left;ny=e.clientY-r.top;e.preventDefault();
    });
    window.addEventListener('mousemove',function(e){
      if(!ndrag)return;
      n.x=Math.max(4,e.clientX-nx);n.y=Math.max(4,e.clientY-ny);
      el.style.left=n.x+'px';el.style.top=n.y+'px';
    });
    window.addEventListener('mouseup',function(){ if(ndrag){ndrag=false;saveNotes();} });
  }
  // New notes open beside the pen's toolbar, which now runs down the side of
  // the page, so they land next to where the button was clicked.
  function createNote(){
    var tbr=window.__aihub_pen?window.__aihub_pen.barRect():{left:16,top:80,right:66,bottom:400};
    var n={id:Date.now()+''+Math.floor(Math.random()*1000),
      x:Math.max(8,Math.min(window.innerWidth-240,tbr.right+16+Math.random()*40)),
      y:Math.max(8,Math.min(window.innerHeight-140,tbr.top+Math.random()*40)),text:''};
    notes.push(n);makeNoteEl(n);saveNotes();
  }
  function loadNotes(){
    try{
      var s=localStorage.getItem(NOTES_KEY);
      if(!s)return;
      var arr=JSON.parse(s);
      if(Array.isArray(arr)){notes=arr;notes.forEach(makeNoteEl);}
    }catch(e){}
  }
  window.__aihub_setNoteText=function(id,text){
    var rec=noteEls[id];var n=null;
    for(var i=0;i<notes.length;i++)if(notes[i].id===id)n=notes[i];
    if(!rec||!n)return;
    n.text=text;rec.body.textContent=text;
    rec.ai.disabled=false;setIcon(rec.ai,'ai');
    if(rec.expand)rec.expand();
    saveNotes();
  };
  // Full snapshot for the host — used by the poll (when dirty) and by the
  // final flush when annotation mode closes.
  window.__aihub_getNotesSnapshot=function(){return {url:location.href,title:document.title,notes:notes};};
  // Merge notes saved in the app store into the page (dedup by id — the
  // localStorage cache may already have rendered some of them).
  window.__aihub_restoreNotes=function(arr){
    try{
      if(typeof arr==='string')arr=JSON.parse(arr);
      if(!Array.isArray(arr))return;
      arr.forEach(function(n){
        if(!n||!n.id)return;
        for(var i=0;i<notes.length;i++)if(notes[i].id===n.id)return;
        notes.push(n);makeNoteEl(n);
      });
      try{localStorage.setItem(NOTES_KEY,JSON.stringify(notes));}catch(e){}
    }catch(e){}
  };
`

export function buildInjectScript(config: ScreenPenConfig): string {
  return `(function(){
  if(window.__aihub_pen){ return 'present'; }
  // A page still parsing has no body to pin notes to; the poll retries.
  if(!document.body){ return 'not-ready'; }
  var mountPen=(${SCREEN_PEN_RUNTIME_SOURCE});
  window.__aihub_penQueue=[];
  ${NOTES_SCRIPT}
  var pen=mountPen(document.documentElement, ${JSON.stringify(config)}, function(e){
    if(e&&e.kind==='note'){ createNote(); return; }
    (window.__aihub_penQueue=window.__aihub_penQueue||[]).push(e);
  });
  window.__aihub_pen=pen;
  loadNotes();

  window.__aihub={
    remove:function(){
      try{pen.destroy();}catch(e){}
      Object.keys(noteEls).forEach(function(k){try{noteEls[k].el.remove();}catch(e){}});
      delete window.__aihub_pen;
      delete window.__aihub_penQueue;
      delete window.__aihub_setNoteText;
      delete window.__aihub_aiQueue;
      delete window.__aihub_getNotesSnapshot;
      delete window.__aihub_restoreNotes;
      delete window.__aihub;
    }
  };
  return 'injected';
})()`
}

// Drains toolbar events, pending note-AI requests and the notes snapshot in one
// round trip — all are queued by in-page controls and only reachable from the
// host via execScript. `missing` means the page navigated and lost the pen.
export const DRAIN_SCRIPT = `(function(){
  if(!window.__aihub_pen){ return JSON.stringify({missing:true}); }
  var ev=window.__aihub_penQueue||[];window.__aihub_penQueue=[];
  var ai=window.__aihub_aiQueue||[];window.__aihub_aiQueue=[];
  var ns=null;
  if(window.__aihub_notesDirty&&window.__aihub_getNotesSnapshot){window.__aihub_notesDirty=false;ns=window.__aihub_getNotesSnapshot();}
  return JSON.stringify({events:ev,ai:ai,notes:ns});
})()`

// Unconditional snapshot — used on unmount so the very last edits (inside the
// 400ms save debounce) are never lost.
export const SNAPSHOT_SCRIPT = `(function(){
  return window.__aihub_getNotesSnapshot?JSON.stringify(window.__aihub_getNotesSnapshot()):null;
})()`
