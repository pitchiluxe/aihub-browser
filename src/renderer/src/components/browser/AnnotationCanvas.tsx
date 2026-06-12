import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useBrowserStore } from '../../store/browserStore'

type Tool = 'pen' | 'highlight' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser'

const COLORS = [
  '#ef4444', '#f97316', '#facc15', '#22c55e',
  '#06b6d4', '#3b82f6', '#a855f7', '#ec4899',
  '#ffffff', '#0f172a',
]

const TOOL_DEFS: { id: Tool; label: string; icon: string }[] = [
  { id: 'pen',       label: 'Pen',         icon: '✏️' },
  { id: 'highlight', label: 'Highlighter', icon: '🖊' },
  { id: 'arrow',     label: 'Arrow',       icon: '➜' },
  { id: 'rect',      label: 'Rectangle',   icon: '⬜' },
  { id: 'ellipse',   label: 'Ellipse',     icon: '⭕' },
  { id: 'text',      label: 'Text',        icon: 'T' },
  { id: 'eraser',    label: 'Eraser',      icon: '⌫' },
]

const SIZES = [
  { value: 2,  label: 'S' },
  { value: 5,  label: 'M' },
  { value: 10, label: 'L' },
]

function buildScript(tool: Tool, color: string, width: number): string {
  const t = JSON.stringify(tool)
  const c = JSON.stringify(color)
  const w = Number(width)
  return `(function(){
  if(document.getElementById('__aihub_cv')){
    if(window.__aihub) window.__aihub.set(${t},${c},${w});
    return 'updated';
  }
  var cv=document.createElement('canvas');
  cv.id='__aihub_cv';
  cv.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:all;cursor:crosshair;touch-action:none;box-sizing:border-box;';
  cv.width=window.innerWidth; cv.height=window.innerHeight;
  (document.documentElement||document.body).appendChild(cv);
  var ctx=cv.getContext('2d');
  var strokes=[],redo=[],cur=null,drawing=false,sp=[0,0];
  var st={t:${t},c:${c},w:${w}};
  function gp(e){return[e.clientX,e.clientY];}
  function sc(){cv.style.cursor=st.t==='text'?'text':st.t==='eraser'?'cell':'crosshair';}
  function redraw(){
    ctx.clearRect(0,0,cv.width,cv.height);
    strokes.forEach(function(s){ds(s);});
  }
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
    if(e.button!==0)return;
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
  cv.addEventListener('mouseup',function(e){
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
  window.__aihub={
    set:function(t,c,w){st={t:t,c:c,w:w};sc();},
    undo:function(){if(strokes.length){redo.push(strokes.pop());redraw();}},
    redo:function(){if(redo.length){strokes.push(redo.pop());redraw();}},
    clear:function(){strokes=[];redo=[];ctx.clearRect(0,0,cv.width,cv.height);},
    save:function(){return cv.toDataURL('image/png');},
    remove:function(){cv.remove();delete window.__aihub;}
  };
  return 'injected';
})()`
}

export default function AnnotationCanvas({ webview }: { webview: any | null }) {
  const { toggleAnnotationMode } = useBrowserStore()

  const [tool, setTool]           = useState<Tool>('pen')
  const [color, setColor]         = useState('#ef4444')
  const [lineWidth, setLineWidth] = useState(5)
  const [status, setStatus]       = useState<'pending' | 'ok' | 'error' | 'no-webview'>('pending')
  const [statusMsg, setStatusMsg] = useState('')
  const wcIdRef = useRef<number | null>(null)

  // ── Helper: run script via IPC (main process → webContents) ──────────
  const execScript = useCallback(async (script: string) => {
    const wcId = wcIdRef.current
    if (wcId === null) return null
    try {
      const res = await window.electronAPI.webview.execScript(wcId, script)
      if (!res?.ok) {
        console.warn('[Annotation] execScript failed:', res?.error)
      }
      return res
    } catch (e) {
      console.error('[Annotation] execScript threw:', e)
      return null
    }
  }, [])

  // ── Inject canvas on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!webview) {
      setStatus('no-webview')
      return
    }

    // Get webContentsId
    let wcId: number | null = null
    try {
      wcId = webview.getWebContentsId?.() ?? null
    } catch {}

    if (wcId === null) {
      setStatus('error')
      setStatusMsg('Could not get webContentsId')
      return
    }

    wcIdRef.current = wcId
    setStatus('pending')

    const script = buildScript(tool, color, lineWidth)
    window.electronAPI.webview.execScript(wcId, script)
      .then((res: any) => {
        if (res?.ok) {
          setStatus('ok')
          setStatusMsg(String(res.result))
        } else {
          setStatus('error')
          setStatusMsg(res?.error || 'unknown error')
        }
      })
      .catch((e: any) => {
        setStatus('error')
        setStatusMsg(String(e))
      })

    // Listen for escape signal from webview (if nodeIntegration available)
    const onIpcMsg = (e: any) => {
      if (e.channel === 'annotation:escape') toggleAnnotationMode()
    }
    webview.addEventListener('ipc-message', onIpcMsg)

    return () => {
      webview.removeEventListener('ipc-message', onIpcMsg)
      if (wcIdRef.current !== null) {
        window.electronAPI.webview.execScript(wcIdRef.current, `window.__aihub&&window.__aihub.remove()`).catch(() => {})
      }
      wcIdRef.current = null
    }
  }, [webview]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync tool state ───────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ok') return
    execScript(`window.__aihub&&window.__aihub.set(${JSON.stringify(tool)},${JSON.stringify(color)},${lineWidth})`)
  }, [tool, color, lineWidth, status, execScript])

  const undo = useCallback(() => execScript(`window.__aihub&&window.__aihub.undo()`), [execScript])
  const redo = useCallback(() => execScript(`window.__aihub&&window.__aihub.redo()`), [execScript])
  const clear = useCallback(() => execScript(`window.__aihub&&window.__aihub.clear()`), [execScript])

  const saveImage = useCallback(async () => {
    const res = await execScript(`window.__aihub&&window.__aihub.save()`)
    const dataUrl = res?.result
    if (dataUrl?.startsWith?.('data:')) {
      const a = document.createElement('a')
      a.download = `annotation-${Date.now()}.png`
      a.href = dataUrl
      a.click()
    }
  }, [execScript])

  // ── Host keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo() }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo() }
      if (e.key === 'Escape') toggleAnnotationMode()
      const s: Record<string, Tool> = { p:'pen', h:'highlight', a:'arrow', r:'rect', e:'ellipse', t:'text', x:'eraser' }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && s[e.key]) setTool(s[e.key] as Tool)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo, redo, toggleAnnotationMode])

  // ── Toolbar drag ──────────────────────────────────────────────────────
  const [tbPos, setTbPos] = useState({ x: 20, y: 120 })
  const tbDragging  = useRef(false)
  const tbDragOff   = useRef({ x: 0, y: 0 })

  const onTbMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button,input')) return
    tbDragging.current = true
    tbDragOff.current = { x: e.clientX - tbPos.x, y: e.clientY - tbPos.y }
    e.preventDefault()
  }
  useEffect(() => {
    const mv = (e: MouseEvent) => { if (tbDragging.current) setTbPos({ x: e.clientX - tbDragOff.current.x, y: e.clientY - tbDragOff.current.y }) }
    const up = () => { tbDragging.current = false }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [])

  // ── Styles ────────────────────────────────────────────────────────────
  const tb: React.CSSProperties = {
    position: 'fixed', left: tbPos.x, top: tbPos.y, zIndex: 99999,
    background: 'rgba(10,15,30,0.97)',
    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid rgba(59,130,246,0.3)',
    borderRadius: 16,
    boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
    padding: '10px 12px 12px',
    display: 'flex', flexDirection: 'column', gap: 10,
    userSelect: 'none', minWidth: 240,
  }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }
  const toolBtn = (active: boolean): React.CSSProperties => ({
    width: 32, height: 32, borderRadius: 8,
    border: active ? '1.5px solid #3b82f6' : '1px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(59,130,246,0.22)' : 'rgba(255,255,255,0.05)',
    color: active ? '#93c5fd' : '#94a3b8',
    fontSize: 14, cursor: 'pointer', transition: 'all 0.12s',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
  })
  const colorSwatch = (c: string): React.CSSProperties => ({
    width: 22, height: 22, borderRadius: 6, background: c,
    border: color === c ? '2px solid #fff' : '2px solid transparent',
    cursor: 'pointer', outline: color === c ? '1.5px solid #3b82f6' : 'none', outlineOffset: 2, flexShrink: 0,
  })
  const sizeBtn = (v: number): React.CSSProperties => ({
    width: 28, height: 28, borderRadius: 7,
    border: lineWidth === v ? '1.5px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
    background: lineWidth === v ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.04)',
    color: lineWidth === v ? '#93c5fd' : '#64748b',
    fontSize: 11, fontWeight: 700, cursor: 'pointer',
  })
  const actionBtn: React.CSSProperties = {
    height: 28, padding: '0 10px', borderRadius: 7,
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
    color: '#64748b', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
  }
  const divider: React.CSSProperties = { width: '100%', height: 1, background: 'rgba(255,255,255,0.06)', margin: '2px 0' }

  const statusColor = status === 'ok' ? '#22c55e' : status === 'error' ? '#ef4444' : status === 'pending' ? '#facc15' : '#475569'
  const statusText  = status === 'ok' ? '● Active' : status === 'error' ? '● Failed' : status === 'pending' ? '● Connecting…' : '● No page'

  return (
    <div style={tb} onMouseDown={onTbMouseDown}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'grab', marginBottom: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', boxShadow: '0 0 6px rgba(59,130,246,0.6)' }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Annotation
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: statusColor, marginLeft: 4 }}>{statusText}</span>
        <div style={{ flex: 1 }} />
        <button onClick={toggleAnnotationMode} style={{ ...actionBtn, color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)' }}>✕</button>
      </div>

      {status === 'error' && (
        <div style={{ fontSize: 9, color: '#ef4444', wordBreak: 'break-all', maxHeight: 36, overflow: 'hidden' }}>
          {statusMsg}
        </div>
      )}

      {status === 'no-webview' && (
        <div style={{ fontSize: 10, color: '#475569', padding: '4px 0', textAlign: 'center' }}>
          Navigate to a web page to annotate
        </div>
      )}

      {/* Tools */}
      <div style={row}>
        {TOOL_DEFS.map(t => (
          <button key={t.id} style={toolBtn(tool === t.id)} title={t.label} onClick={() => setTool(t.id)}>
            {t.icon}
          </button>
        ))}
      </div>

      <div style={divider} />

      {/* Colors */}
      <div style={row}>
        {COLORS.map(c => (
          <div key={c} style={colorSwatch(c)} title={c} onClick={() => setColor(c)} />
        ))}
      </div>

      <div style={divider} />

      {/* Sizes */}
      <div style={row}>
        <span style={{ fontSize: 10, color: '#475569', marginRight: 2 }}>Size</span>
        {SIZES.map(s => (
          <button key={s.value} style={sizeBtn(s.value)} onClick={() => setLineWidth(s.value)}>{s.label}</button>
        ))}
      </div>

      <div style={divider} />

      {/* Actions */}
      <div style={row}>
        <button style={actionBtn} onClick={undo}>↩ Undo</button>
        <button style={actionBtn} onClick={redo}>↪ Redo</button>
        <button style={actionBtn} onClick={clear}>🗑 Clear</button>
        <button style={{ ...actionBtn, color: '#22c55e', borderColor: 'rgba(34,197,94,0.2)' }} onClick={saveImage}>💾 Save</button>
      </div>

      <div style={{ fontSize: 9, color: '#334155', textAlign: 'center', marginTop: 2 }}>
        Drag · Esc exit · P H A R E X = tools
      </div>
    </div>
  )
}
