import { useEffect, useRef } from 'react'
import { useBrowserStore } from '../../store/browserStore'
import { buildPageExtractionScript } from '../../services/pageExtractor'

// Canvas AND toolbar are both injected directly into the guest page's own
// DOM — not rendered as host React overlays. BrowserView (the tab's native
// content view) always paints above our host HTML, so a host-rendered
// toolbar can only be made visible by permanently cropping the page to
// leave it a gutter. Injecting it into the page itself sidesteps that
// entirely: it's real content in the same document as the canvas, floats
// freely anywhere over the full, uncropped page, exactly like a normal
// in-page widget.
const INJECT_SCRIPT = `(function(){
  if(document.getElementById('__aihub_cv')){ return 'updated'; }

  var cv=document.createElement('canvas');
  cv.id='__aihub_cv';
  cv.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;pointer-events:all;cursor:crosshair;touch-action:none;box-sizing:border-box;';
  cv.width=window.innerWidth; cv.height=window.innerHeight;
  (document.documentElement||document.body).appendChild(cv);
  var ctx=cv.getContext('2d');
  var strokes=[],redo=[],cur=null,drawing=false,sp=[0,0];
  var st={t:'pen',c:'#ef4444',w:5};
  var pointerMode=false;

  function gp(e){return[e.clientX,e.clientY];}
  function sc(){cv.style.cursor=pointerMode?'default':(st.t==='text'?'text':st.t==='eraser'?'cell':'crosshair');}
  function redraw(){ ctx.clearRect(0,0,cv.width,cv.height); strokes.forEach(function(s){ds(s);}); }
  function ds(s){
    if(!s||!s.pts||!s.pts.length)return;
    ctx.save();
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.lineWidth=s.w; ctx.strokeStyle=s.c; ctx.fillStyle=s.c;
    ctx.globalCompositeOperation=s.t==='eraser'?'destination-out':'source-over';
    ctx.globalAlpha=s.t==='highlight'?0.38:1;
    if(s.t==='eraser'){ctx.lineWidth=s.w*7;ctx.strokeStyle='rgba(0,0,0,1)';}
    if(s.t==='highlight')ctx.lineWidth=s.w*6;
    var p=s.pts;
    if(s.t==='pen'||s.t==='highlight'||s.t==='eraser'){
      ctx.beginPath();ctx.moveTo(p[0][0],p[0][1]);
      for(var i=1;i<p.length-1;i++){var mx=(p[i][0]+p[i+1][0])/2,my=(p[i][1]+p[i+1][1])/2;ctx.quadraticCurveTo(p[i][0],p[i][1],mx,my);}
      if(p.length>1)ctx.lineTo(p[p.length-1][0],p[p.length-1][1]);
      ctx.stroke();
    }else if(s.t==='arrow'){
      var x1=p[0][0],y1=p[0][1],x2=p[p.length-1][0],y2=p[p.length-1][1];
      var a=Math.atan2(y2-y1,x2-x1),hl=Math.max(14,s.w*3.5);
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2,y2);ctx.lineTo(x2-hl*Math.cos(a-Math.PI/6),y2-hl*Math.sin(a-Math.PI/6));
      ctx.moveTo(x2,y2);ctx.lineTo(x2-hl*Math.cos(a+Math.PI/6),y2-hl*Math.sin(a+Math.PI/6));
      ctx.stroke();
    }else if(s.t==='rect'){
      ctx.beginPath();ctx.rect(p[0][0],p[0][1],p[p.length-1][0]-p[0][0],p[p.length-1][1]-p[0][1]);ctx.stroke();
    }else if(s.t==='ellipse'){
      var cx=(p[0][0]+p[p.length-1][0])/2,cy=(p[0][1]+p[p.length-1][1])/2,rx=Math.abs(p[p.length-1][0]-p[0][0])/2,ry=Math.abs(p[p.length-1][1]-p[0][1])/2;
      if(rx>0&&ry>0){ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.stroke();}
    }
    ctx.restore();
  }
  cv.addEventListener('mousedown',function(e){
    if(e.button!==0||pointerMode)return;
    e.preventDefault();e.stopPropagation();
    drawing=true;sp=gp(e);cur={t:st.t,c:st.c,w:st.w,pts:[gp(e)]};
  },true);
  cv.addEventListener('mousemove',function(e){
    if(!drawing||!cur)return;
    e.preventDefault();
    var p=gp(e);
    if(st.t==='pen'||st.t==='highlight'||st.t==='eraser')cur.pts.push(p);
    else cur.pts=[sp,p];
    redraw();ds(cur);
  },true);
  cv.addEventListener('mouseup',function(){
    if(!drawing||!cur)return;
    drawing=false;strokes.push(cur);redo=[];cur=null;redraw();
  },true);
  cv.addEventListener('mouseleave',function(){drawing=false;});
  cv.addEventListener('contextmenu',function(e){e.preventDefault();});
  window.addEventListener('resize',function(){
    var d;try{d=ctx.getImageData(0,0,cv.width,cv.height);}catch(e){}
    cv.width=window.innerWidth;cv.height=window.innerHeight;
    if(d)try{ctx.putImageData(d,0,0);}catch(e){}
  });

  // ── Toolbar — same in-page element, freely draggable, no host gutter needed ──
  var TOOLS=[['pen','\\u270F\\uFE0F','Pen'],['highlight','\\uD83D\\uDD8A','Highlighter'],['arrow','\\u279C','Arrow'],['rect','\\u2B1C','Rectangle'],['ellipse','\\u2B55','Ellipse'],['text','T','Text'],['eraser','\\u232B','Eraser']];
  var COLORS=['#ef4444','#f97316','#facc15','#22c55e','#06b6d4','#3b82f6','#a855f7','#ec4899','#ffffff','#0f172a'];
  var SIZES=[[2,'S'],[5,'M'],[10,'L']];

  var tb=document.createElement('div');
  tb.id='__aihub_tb';
  tb.style.cssText='position:fixed;left:20px;top:120px;z-index:2147483647;background:rgba(10,15,30,0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(59,130,246,0.3);border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,0.7);padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px;user-select:none;min-width:240px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  document.body.appendChild(tb);

  function row(){var d=document.createElement('div');d.style.cssText='display:flex;align-items:center;gap:5px;flex-wrap:wrap;';return d;}
  function divider(){var d=document.createElement('div');d.style.cssText='width:100%;height:1px;background:rgba(255,255,255,0.06);margin:2px 0;';return d;}

  var header=document.createElement('div');
  header.style.cssText='display:flex;align-items:center;gap:8px;cursor:grab;margin-bottom:2px;';
  var dot=document.createElement('div');
  dot.style.cssText='width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);box-shadow:0 0 6px rgba(59,130,246,0.6);flex-shrink:0;';
  var label=document.createElement('span');
  label.textContent='ANNOTATION';
  label.style.cssText='font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.12em;';
  var spacer=document.createElement('div'); spacer.style.flex='1';
  var pointerBtn=document.createElement('button');
  pointerBtn.type='button';
  pointerBtn.style.cssText='height:28px;padding:0 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#64748b;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;';
  function renderPointerBtn(){
    pointerBtn.textContent=pointerMode?'\\uD83D\\uDDB1 Pointer':'\\u270F\\uFE0F Draw';
    pointerBtn.style.background=pointerMode?'rgba(59,130,246,0.18)':'rgba(255,255,255,0.05)';
    pointerBtn.style.color=pointerMode?'#60a5fa':'#64748b';
    pointerBtn.style.borderColor=pointerMode?'rgba(59,130,246,0.35)':'rgba(255,255,255,0.1)';
  }
  renderPointerBtn();
  pointerBtn.onclick=function(){
    pointerMode=!pointerMode;
    cv.style.pointerEvents=pointerMode?'none':'all';
    sc();
    renderPointerBtn();
    toolsRow.style.opacity=pointerMode?'0.35':'1';
    toolsRow.style.pointerEvents=pointerMode?'none':'auto';
    colorsRow.style.opacity=pointerMode?'0.35':'1';
    colorsRow.style.pointerEvents=pointerMode?'none':'auto';
    sizesRow.style.opacity=pointerMode?'0.35':'1';
    sizesRow.style.pointerEvents=pointerMode?'none':'auto';
  };
  var minBtn=document.createElement('button');
  minBtn.type='button';minBtn.title='Minimize toolbar';
  minBtn.textContent='\\u2212';
  minBtn.style.cssText='width:28px;height:28px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#64748b;font-size:13px;font-weight:700;cursor:pointer;line-height:1;flex-shrink:0;';
  header.appendChild(dot);header.appendChild(label);header.appendChild(spacer);header.appendChild(pointerBtn);header.appendChild(minBtn);
  tb.appendChild(header);

  // All rows live in one container so minimize is a single display toggle;
  // the header (drag handle + pointer + restore) stays visible.
  var content=document.createElement('div');
  content.style.cssText='display:flex;flex-direction:column;gap:10px;';
  tb.appendChild(content);
  var minimized=false;
  minBtn.onclick=function(){
    minimized=!minimized;
    content.style.display=minimized?'none':'flex';
    tb.style.minWidth=minimized?'0':'240px';
    minBtn.textContent=minimized?'\\u25A1':'\\u2212';
    minBtn.title=minimized?'Restore toolbar':'Minimize toolbar';
    header.style.marginBottom=minimized?'0':'2px';
  };

  var toolsRow=row();
  var toolBtns={};
  TOOLS.forEach(function(t){
    var b=document.createElement('button');
    b.type='button'; b.title=t[2]; b.textContent=t[1];
    b.style.cssText='width:32px;height:32px;border-radius:8px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700;transition:all 0.12s;';
    b.onclick=function(){ st.t=t[0]; sc(); renderTools(); };
    toolBtns[t[0]]=b;
    toolsRow.appendChild(b);
  });
  function renderTools(){
    TOOLS.forEach(function(t){
      var active=st.t===t[0]; var b=toolBtns[t[0]];
      b.style.border=active?'1.5px solid #3b82f6':'1px solid rgba(255,255,255,0.08)';
      b.style.background=active?'rgba(59,130,246,0.22)':'rgba(255,255,255,0.05)';
      b.style.color=active?'#93c5fd':'#94a3b8';
    });
  }
  renderTools();
  content.appendChild(toolsRow);
  content.appendChild(divider());

  var colorsRow=row();
  var colorEls={};
  COLORS.forEach(function(c){
    var sw=document.createElement('div');
    sw.title=c;
    sw.style.cssText='width:22px;height:22px;border-radius:6px;cursor:pointer;flex-shrink:0;background:'+c+';';
    sw.onclick=function(){ st.c=c; renderColors(); };
    colorEls[c]=sw;
    colorsRow.appendChild(sw);
  });
  function renderColors(){
    COLORS.forEach(function(c){
      var active=st.c===c; var sw=colorEls[c];
      sw.style.border=active?'2px solid #fff':'2px solid transparent';
      sw.style.outline=active?'1.5px solid #3b82f6':'none';
      sw.style.outlineOffset='2px';
    });
  }
  renderColors();
  content.appendChild(colorsRow);
  content.appendChild(divider());

  var sizesRow=row();
  var sizeLbl=document.createElement('span');
  sizeLbl.textContent='Size'; sizeLbl.style.cssText='font-size:10px;color:#475569;margin-right:2px;';
  sizesRow.appendChild(sizeLbl);
  var sizeBtns={};
  SIZES.forEach(function(s){
    var b=document.createElement('button');
    b.type='button'; b.textContent=s[1];
    b.style.cssText='width:28px;height:28px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;';
    b.onclick=function(){ st.w=s[0]; renderSizes(); };
    sizeBtns[s[0]]=b;
    sizesRow.appendChild(b);
  });
  function renderSizes(){
    SIZES.forEach(function(s){
      var active=st.w===s[0]; var b=sizeBtns[s[0]];
      b.style.border=active?'1.5px solid #3b82f6':'1px solid rgba(255,255,255,0.1)';
      b.style.background=active?'rgba(59,130,246,0.2)':'rgba(255,255,255,0.04)';
      b.style.color=active?'#93c5fd':'#64748b';
    });
  }
  renderSizes();
  content.appendChild(sizesRow);
  content.appendChild(divider());

  var actionsRow=row();
  function actionBtn(text,onClick,color){
    var b=document.createElement('button');
    b.type='button'; b.textContent=text;
    b.style.cssText='height:28px;padding:0 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:'+(color||'#64748b')+';font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';
    b.onclick=onClick;
    return b;
  }
  actionsRow.appendChild(actionBtn('\\u21A9 Undo',function(){ if(strokes.length){redo.push(strokes.pop());redraw();} }));
  actionsRow.appendChild(actionBtn('\\u21AA Redo',function(){ if(redo.length){strokes.push(redo.pop());redraw();} }));
  actionsRow.appendChild(actionBtn('\\uD83D\\uDDD1 Clear',function(){ strokes=[];redo=[];ctx.clearRect(0,0,cv.width,cv.height); }));
  actionsRow.appendChild(actionBtn('\\uD83D\\uDCBE Save',function(){
    var a=document.createElement('a');
    a.download='annotation-'+Date.now()+'.png';
    a.href=cv.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  },'#22c55e'));
  actionsRow.appendChild(actionBtn('\\uD83D\\uDDD2 New Note',function(){ createNote(); },'#eab308'));
  content.appendChild(actionsRow);

  var hint=document.createElement('div');
  hint.textContent='Drag \\u00B7 P H A R E X = tools \\u00B7 Ctrl+Z/Y undo/redo';
  hint.style.cssText='font-size:9px;color:#334155;text-align:center;margin-top:2px;';
  content.appendChild(hint);

  // Drag
  var dragging=false,offX=0,offY=0;
  header.addEventListener('mousedown',function(e){
    if(e.target!==header&&e.target!==dot&&e.target!==label&&e.target!==spacer)return;
    dragging=true;
    var r=tb.getBoundingClientRect();
    offX=e.clientX-r.left; offY=e.clientY-r.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove',function(e){
    if(!dragging)return;
    tb.style.left=Math.max(4,e.clientX-offX)+'px';
    tb.style.top=Math.max(4,e.clientY-offY)+'px';
  });
  window.addEventListener('mouseup',function(){ dragging=false; });

  // Keyboard shortcuts, scoped to the page itself so they work regardless
  // of host focus.
  window.addEventListener('keydown',function(e){
    var el=e.target;
    if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable))return;
    if(e.ctrlKey&&e.key==='z'){e.preventDefault();if(strokes.length){redo.push(strokes.pop());redraw();}return;}
    if(e.ctrlKey&&e.key==='y'){e.preventDefault();if(redo.length){strokes.push(redo.pop());redraw();}return;}
    var map={p:'pen',h:'highlight',a:'arrow',r:'rect',e:'ellipse',t:'text',x:'eraser'};
    if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&map[e.key]){ st.t=map[e.key]; sc(); renderTools(); }
  },true);

  // ── Sticky notes — in-page widgets, persisted per URL in site localStorage ──
  // Pastel pairs [top,bottom] for the note gradient; n.color indexes this.
  var NOTE_COLORS=[['#fef08a','#fde047'],['#bbf7d0','#86efac'],['#bfdbfe','#93c5fd'],['#fbcfe8','#f9a8d4'],['#fed7aa','#fdba74'],['#e9d5ff','#d8b4fe']];
  var NOTES_KEY='__aihub_notes::'+location.origin+location.pathname;
  var notes=[];
  var noteEls={};
  function saveNotes(){try{localStorage.setItem(NOTES_KEY,JSON.stringify(notes));}catch(e){}}
  function makeNoteEl(n){
    var el=document.createElement('div');
    el.id='__aihub_note_'+n.id;
    el.style.cssText='position:fixed;left:'+n.x+'px;top:'+n.y+'px;width:220px;z-index:2147483647;background:linear-gradient(180deg,#fef08a,#fde047);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;overflow:hidden;';
    var head=document.createElement('div');
    head.style.cssText='display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(0,0,0,0.07);cursor:grab;user-select:none;';
    var t=document.createElement('span');
    t.textContent='\\uD83D\\uDDD2';t.style.cssText='font-size:12px;';
    var sp=document.createElement('div');sp.style.flex='1';
    // Fully self-contained button CSS: injected into arbitrary pages, so a
    // site's own button rules (background:none, font-size:0, filters…) must
    // not be able to blank these out. Emoji font stack keeps glyphs visible.
    var btnCss='appearance:none;-webkit-appearance:none;margin:0;padding:0;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;min-width:24px;border:none;border-radius:6px;background:rgba(0,0,0,0.14);cursor:pointer;font-size:13px;line-height:1;color:#422006;font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif;opacity:1;visibility:visible;text-indent:0;box-shadow:none;filter:none;';
    var ai=document.createElement('button');
    ai.type='button';ai.textContent='\\u2728';
    ai.title='Empty note: AI summarizes this page. With text: AI answers it about this page.';
    ai.style.cssText=btnCss;
    var sv=document.createElement('button');
    sv.type='button';sv.textContent='\\uD83D\\uDCBE';sv.title='Save note';
    sv.style.cssText=btnCss;
    var clr=document.createElement('button');
    clr.type='button';clr.textContent='\\uD83C\\uDFA8';clr.title='Note color';
    clr.style.cssText=btnCss;
    var nm=document.createElement('button');
    nm.type='button';nm.title='Minimize note';
    nm.style.cssText=btnCss+'font-weight:700;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    var del=document.createElement('button');
    del.type='button';del.textContent='\\u00D7';del.title='Delete note';
    del.style.cssText=btnCss+'font-size:15px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    head.appendChild(t);head.appendChild(sp);head.appendChild(sv);head.appendChild(ai);head.appendChild(clr);head.appendChild(nm);head.appendChild(del);
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
    sv.onclick=function(){
      n.text=body.textContent||'';
      saveNotes();
      sv.textContent='\\u2713';
      setTimeout(function(){sv.textContent='\\uD83D\\uDCBE';},900);
    };
    nm.onclick=function(){ n.min=!n.min; applyMin(); saveNotes(); };
    del.onclick=function(){
      notes=notes.filter(function(x){return x.id!==n.id;});
      delete noteEls[n.id];
      el.remove();saveNotes();
    };
    ai.onclick=function(){
      if(ai.disabled)return;
      ai.disabled=true;ai.textContent='\\u23F3';
      window.__aihub_aiQueue=window.__aihub_aiQueue||[];
      window.__aihub_aiQueue.push({noteId:n.id,text:(n.text||'').trim()});
    };
    var ndrag=false,nx=0,ny=0;
    head.addEventListener('mousedown',function(e){
      if(e.target===ai||e.target===del||e.target===sv||e.target===nm||e.target===clr)return;
      ndrag=true;var r=el.getBoundingClientRect();nx=e.clientX-r.left;ny=e.clientY-r.top;e.preventDefault();
    });
    window.addEventListener('mousemove',function(e){
      if(!ndrag)return;
      n.x=Math.max(4,e.clientX-nx);n.y=Math.max(4,e.clientY-ny);
      el.style.left=n.x+'px';el.style.top=n.y+'px';
    });
    window.addEventListener('mouseup',function(){ if(ndrag){ndrag=false;saveNotes();} });
  }
  function createNote(){
    var tbr=tb.getBoundingClientRect();
    var n={id:Date.now()+''+Math.floor(Math.random()*1000),
      x:Math.min(window.innerWidth-240,tbr.right+16+Math.random()*40),
      y:Math.max(8,tbr.top+Math.random()*40),text:''};
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
    rec.ai.disabled=false;rec.ai.textContent='\\u2728';
    if(rec.expand)rec.expand();
    saveNotes();
  };
  loadNotes();

  window.__aihub={
    remove:function(){
      cv.remove(); tb.remove();
      Object.keys(noteEls).forEach(function(k){try{noteEls[k].el.remove();}catch(e){}});
      delete window.__aihub_setNoteText;
      delete window.__aihub_aiQueue;
      delete window.__aihub;
    }
  };
  return 'injected';
})()`

// Drains pending note-AI requests enqueued by ✨ buttons inside the page.
const DRAIN_SCRIPT = `(function(){var q=window.__aihub_aiQueue||[];window.__aihub_aiQueue=[];return JSON.stringify(q);})()`

export default function AnnotationCanvas() {
  const { activeTabId, tabWcIds } = useBrowserStore()
  const wcId = activeTabId ? tabWcIds[activeTabId] : null
  const wcIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!wcId) return
    wcIdRef.current = wcId
    window.electronAPI.webview.execScript(wcId, INJECT_SCRIPT).catch(() => {})

    // Guest pages can't reach electronAPI, so the ✨ buttons only enqueue.
    // Poll the queue, run ai:chat host-side, write answers back into notes.
    const poll = setInterval(async () => {
      const id = wcIdRef.current
      if (id === null) return
      try {
        const res = await window.electronAPI.webview.execScript(id, DRAIN_SCRIPT)
        if (!res?.ok) return
        const queue = JSON.parse(String(res.result || '[]'))
        if (!Array.isArray(queue) || queue.length === 0) return
        const pageRes = await window.electronAPI.webview.execScript(id, buildPageExtractionScript())
        const pageText = pageRes?.ok ? String(pageRes.result || '').trim() : ''
        for (const req of queue) {
          if (!req || typeof req.noteId !== 'string') continue
          const prompt = req.text
            ? `Answer briefly based on this page.\nQUESTION/INSTRUCTION: ${req.text}\n\nPAGE CONTENT:\n${pageText}`
            : `Summarize this page in 3-5 short bullet points.\n\nPAGE CONTENT:\n${pageText}`
          let answer = ''
          try {
            const result = await window.electronAPI.ai.chat([{ role: 'user', content: prompt }])
            answer = result?.content || 'No response from AI.'
          } catch (e: any) {
            answer = `AI error: ${e?.message || e}`
          }
          const target = wcIdRef.current
          if (target === null) break
          await window.electronAPI.webview.execScript(
            target,
            `window.__aihub_setNoteText&&window.__aihub_setNoteText(${JSON.stringify(req.noteId)},${JSON.stringify(answer)})`
          ).catch(() => {})
        }
      } catch {}
    }, 1000)

    return () => {
      clearInterval(poll)
      if (wcIdRef.current !== null) {
        window.electronAPI.webview.execScript(wcIdRef.current, `window.__aihub&&window.__aihub.remove()`).catch(() => {})
      }
      wcIdRef.current = null
    }
  }, [wcId])

  return null
}
