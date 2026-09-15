// Screen Pen — drawing on the page itself, with a vertical floating toolbar.
//
// Ported from the IAM Range workstation's desktop annotator. The same tool has
// to run in two very different places:
//
//   - a web tab, where the tab is a BrowserView that always paints above host
//     HTML, so the pen has to be injected into the page's own document as a
//     string and can only talk back through a queue the host drains; and
//   - the app's own pages (home, Notes, Settings…), where it is mounted into
//     a React-owned element and talks back through a plain callback.
//
// Rather than keep two copies that drift, `screenPenRuntime` is ONE function
// that is called directly on app pages and serialised with toString() for
// injection into tabs. That makes it load-bearing that the function is fully
// self-contained: no imports, no references to anything outside its own body,
// no syntax that a bundler would rewrite into a helper call. The jsdom test
// next to this file evaluates the serialised source in an empty scope, so a
// stray outside reference fails there rather than on somebody's page.
//
// The behaviour that makes or breaks a tool like this is what happens to
// clicks. A full-page canvas swallows every one of them, so the page
// underneath becomes unusable. The pen therefore has two states and the
// toolbar always says which one it is in:
//
//   Draw     the sheet takes the pointer; the page is frozen behind it
//   Click    pointer events go through to the page underneath
//
// It opens in Click. A pen that has to be switched on is a smaller surprise
// than a page that has silently stopped accepting input. The marks stay
// visible in both states — draw on a page, then keep using it with the
// annotation still over it. Esc hands the page back from Draw.

export type PenTool = 'pen' | 'highlight' | 'arrow' | 'box' | 'eraser'
export type CameraCorner = 'bottom-right' | 'bottom-left' | 'top-left' | 'top-right'
export type PenToastKind = 'info' | 'success' | 'warn' | 'error'

export interface ScreenPenConfig {
  /** Toolbar position inside the pen's surface, or null for the default. */
  position: { x: number; y: number } | null
  /** Whether the host can record at all; hides the recorder when not. */
  canRecord: boolean
  /** Whether a webcam bubble is possible; hides the camera controls when not. */
  canCamera: boolean
  cameraOn: boolean
  cameraCorner: CameraCorner
  /** Epoch ms the running recording started at, or null. */
  recordingStartedAt: number | null
  /** Show the sticky-note button. Only web pages persist notes. */
  notes: boolean
  /** Cover the viewport (injected into a page) or fill the container (app page). */
  fixed: boolean
  zIndex: number
}

export type ScreenPenEvent =
  | { kind: 'screenshot' }
  | { kind: 'record' }
  | { kind: 'camera'; on: boolean }
  | { kind: 'corner'; corner: CameraCorner }
  | { kind: 'position'; x: number; y: number }
  | { kind: 'note' }
  | { kind: 'close' }

export interface ScreenPenApi {
  setRecording(startedAt: number | null): void
  setCamera(on: boolean, corner: CameraCorner): void
  toast(message: string, kind?: PenToastKind): void
  /** Bring the toolbar back after a screenshot hid it. */
  showChrome(): void
  /** Toolbar rectangle in viewport coordinates, for placing new notes. */
  barRect(): { left: number; top: number; right: number; bottom: number }
  destroy(): void
}

export function screenPenRuntime(
  container: HTMLElement,
  config: ScreenPenConfig,
  emit: (event: ScreenPenEvent) => void,
): ScreenPenApi {
  var doc = container.ownerDocument || document
  var win = doc.defaultView || window

  var TOOLS: { id: PenTool; title: string }[] = [
    { id: 'pen', title: 'Pen' },
    { id: 'highlight', title: 'Highlighter — translucent, so text stays readable' },
    { id: 'arrow', title: 'Arrow' },
    { id: 'box', title: 'Box' },
    { id: 'eraser', title: 'Eraser' },
  ]
  // 24-unit stroke icons. Drawn rather than emoji: emoji are colour fonts that
  // render small and inconsistently from one site's font stack to the next.
  var ICONS: Record<string, string[]> = {
    pen: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', 'm15 5 4 4'],
    highlight: ['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'],
    arrow: ['M7 17 17 7', 'M8 7h9v9'],
    box: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'],
    eraser: ['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9'],
    undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-15-6.7L3 13'],
    camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z', 'M9 13a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
    video: ['m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5', 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
    videoOff: ['m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5', 'M16 16v0a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2', 'M10 6h4a2 2 0 0 1 2 2v3', 'M2 2l20 20'],
    corner: ['M21 10V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h5', 'M14 14h7v6h-7z'],
    note: ['M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z', 'M15 3v6h6'],
    close: ['M18 6 6 18', 'm6 6 12 12'],
  }
  var COLORS = ['#ff5f56', '#ffbd2e', '#4ec9b0', '#5b8def', '#ffffff']
  var CORNERS: CameraCorner[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right']
  var BAR_WIDTH = 50

  var CSS =
    ':host{all:initial}' +
    '*{box-sizing:border-box}' +
    '.root{position:absolute;inset:0;pointer-events:none;overflow:hidden;' +
      'font-family:"Segoe UI",system-ui,-apple-system,sans-serif;' +
      '--accent:#3b82f6;--on-accent:#ffffff;--text:#e6e9f5;--muted:#8b93ab;' +
      '--line:rgba(255,255,255,0.12);--hover:rgba(255,255,255,0.10)}' +
    '.cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;touch-action:none}' +
    '.root.draw .cv{pointer-events:auto;cursor:crosshair}' +
    // A frame and a label on the page while the sheet is taking clicks. The
    // toolbar says which mode it is in, but it is one small strip that can be
    // dragged anywhere; without a marker on the page itself, "my clicks do
    // nothing" and "the pen is drawing" are two facts with nothing between them.
    '.frame{position:absolute;inset:0;border:2px solid var(--accent);pointer-events:none;display:none}' +
    '.pill{position:absolute;left:50%;bottom:60px;transform:translateX(-50%);pointer-events:none;display:none;' +
      'font:600 12px/1 "Segoe UI",system-ui,sans-serif;color:var(--on-accent);background:var(--accent);' +
      'padding:7px 14px;border-radius:999px;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,0.45)}' +
    '.root.draw .frame,.root.draw .pill{display:block}' +
    '.root.capturing .bar,.root.capturing .frame,.root.capturing .pill,.root.capturing .toast{visibility:hidden}' +
    '.bar{position:absolute;width:' + BAR_WIDTH + 'px;display:flex;flex-direction:column;align-items:center;gap:3px;' +
      'padding:5px 0 7px;border-radius:14px;pointer-events:auto;user-select:none;-webkit-user-select:none;' +
      'max-height:calc(100% - 16px);overflow-y:auto;overflow-x:hidden;scrollbar-width:none;' +
      'background:linear-gradient(180deg,rgba(30,35,56,0.90),rgba(12,15,26,0.93));' +
      'border:1px solid var(--line);' +
      'box-shadow:0 14px 38px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.12);' +
      'backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%)}' +
    '.bar::-webkit-scrollbar{display:none}' +
    '.grip{width:34px;height:16px;flex:0 0 auto;border-radius:5px;cursor:grab;display:flex;align-items:center;' +
      'justify-content:center;color:var(--muted);font-size:12px;letter-spacing:1px;touch-action:none}' +
    '.grip:hover{background:var(--hover)}' +
    '.grip.dragging{cursor:grabbing}' +
    '.btn{appearance:none;-webkit-appearance:none;margin:0;width:36px;min-height:32px;flex:0 0 auto;padding:0;' +
      'border-radius:8px;border:1px solid transparent;background:transparent;color:var(--text);cursor:pointer;' +
      'font:14px/1 "Segoe UI",system-ui,"Segoe UI Emoji",sans-serif;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:2px;transition:background 120ms}' +
    '.btn:hover{background:var(--hover)}' +
    '.btn svg{display:block;flex:0 0 auto}' +
    '.btn .ico{display:flex}' +
    '.btn.on{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}' +
    '.btn.word{font-size:10px;font-weight:600;letter-spacing:0.01em}' +
    '.btn.dim{opacity:0.5}' +
    '.btn.live{background:#ef4444;border-color:#ef4444;color:#fff;padding:4px 0}' +
    '.btn .clock{font-size:9.5px;font-weight:600;font-variant-numeric:tabular-nums}' +
    '.sw{appearance:none;-webkit-appearance:none;margin:2px 0;padding:0;width:20px;height:20px;flex:0 0 auto;' +
      'border-radius:50%;border:2px solid transparent;cursor:pointer}' +
    '.sw.on{border-color:var(--text);box-shadow:0 0 0 1.5px var(--accent)}' +
    '.sep{width:24px;height:1px;flex:0 0 auto;background:var(--line);margin:4px 0}' +
    '.mode{appearance:none;-webkit-appearance:none;margin:0;width:40px;flex:0 0 auto;padding:5px 0;' +
      'border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer;' +
      'display:flex;flex-direction:column;align-items:center;gap:2px;' +
      'font:600 9px/1.1 "Segoe UI",system-ui,sans-serif;letter-spacing:0.02em}' +
    '.mode .dot{font-size:11px}' +
    '.mode.drawing{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}' +
    '.toast{position:absolute;left:50%;bottom:20px;transform:translate(-50%,6px);' +
      'max-width:min(560px,calc(100% - 32px));padding:8px 14px;border-radius:10px;pointer-events:none;' +
      'font:500 12px/1.45 "Segoe UI",system-ui,sans-serif;color:var(--text);background:rgba(12,15,26,0.95);' +
      'border:1px solid var(--line);box-shadow:0 10px 30px rgba(0,0,0,0.45);opacity:0;' +
      'transition:opacity 180ms,transform 180ms}' +
    '.toast.show{opacity:1;transform:translate(-50%,0)}' +
    '.toast.success{border-color:rgba(34,197,94,0.55)}' +
    '.toast.warn{border-color:rgba(245,158,11,0.6)}' +
    '.toast.error{border-color:rgba(239,68,68,0.65)}'

  // ── Surface ────────────────────────────────────────────────────────────
  // Style-isolated in a shadow root, because on a web page the site's own CSS
  // would otherwise reach the buttons. Every node is built with createElement:
  // sites that enforce Trusted Types reject string HTML outright.

  var hostEl = doc.createElement('div')
  hostEl.style.cssText =
    'all:initial;position:' + (config.fixed ? 'fixed' : 'absolute') +
    ';inset:0;pointer-events:none;z-index:' + config.zIndex + ';display:block;'
  container.appendChild(hostEl)
  var shadow = hostEl.attachShadow({ mode: 'open' })

  // A constructed sheet where available: it is CSSOM rather than an inline
  // <style>, so a page's style-src policy cannot strip the toolbar bare.
  var adopted = false
  try {
    var SheetCtor = (win as any).CSSStyleSheet
    var sheet = new SheetCtor()
    sheet.replaceSync(CSS)
    ;(shadow as any).adoptedStyleSheets = [sheet]
    adopted = true
  } catch (e) {
    adopted = false
  }
  if (!adopted) {
    var styleEl = doc.createElement('style')
    styleEl.textContent = CSS
    shadow.appendChild(styleEl)
  }

  var root = doc.createElement('div')
  root.className = 'root'
  shadow.appendChild(root)

  var canvas = doc.createElement('canvas')
  canvas.className = 'cv'
  var frame = doc.createElement('div')
  frame.className = 'frame'
  var pill = doc.createElement('div')
  pill.className = 'pill'
  pill.textContent = 'Drawing — clicks go to the pen. Press Esc to use the page.'
  var toastEl = doc.createElement('div')
  toastEl.className = 'toast'
  var bar = doc.createElement('div')
  bar.className = 'bar'
  root.appendChild(canvas)
  root.appendChild(frame)
  root.appendChild(pill)
  root.appendChild(bar)
  root.appendChild(toastEl)

  // ── State ──────────────────────────────────────────────────────────────

  type Point = { x: number; y: number }
  type Stroke = { tool: PenTool; color: string; points: Point[] }

  var tool: PenTool = 'pen'
  var color = COLORS[0]
  var drawMode = false
  var strokes: Stroke[] = []
  var current: Stroke | null = null
  var cameraOn = !!config.cameraOn
  var cameraCorner: CameraCorner = config.cameraCorner || 'bottom-right'
  var recordingStartedAt: number | null = config.recordingStartedAt
  var recordTick: any = null
  var toastTimer: any = null
  var destroyed = false

  function surfaceSize(): { w: number; h: number } {
    var r = root.getBoundingClientRect()
    return { w: r.width || win.innerWidth, h: r.height || win.innerHeight }
  }

  function formatElapsed(seconds: number): string {
    var s = Math.max(0, seconds)
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    var first = s.points[0]
    var last = s.points[s.points.length - 1]
    if (!first || !last) return
    ctx.save()
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (s.tool === 'highlight') {
      // Wide and translucent, so whatever is underneath stays readable.
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 16
    } else if (s.tool === 'eraser') {
      // Cuts a hole in the annotation layer rather than painting over it, so
      // the page shows through exactly as it did before the mark.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = 24
    } else {
      ctx.lineWidth = 3
    }

    if (s.tool === 'box') {
      ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y)
    } else if (s.tool === 'arrow') {
      var angle = Math.atan2(last.y - first.y, last.x - first.x)
      var head = 15
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(last.x - head * Math.cos(angle - Math.PI / 7), last.y - head * Math.sin(angle - Math.PI / 7))
      ctx.lineTo(last.x - head * Math.cos(angle + Math.PI / 7), last.y - head * Math.sin(angle + Math.PI / 7))
      ctx.closePath()
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (var i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
      ctx.stroke()
    }
    ctx.restore()
  }

  function paint(): void {
    var ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    for (var i = 0; i < strokes.length; i++) drawStroke(ctx, strokes[i])
    if (current) drawStroke(ctx, current)
  }

  function sizeCanvas(): void {
    // Backing store in device pixels, so lines are not soft on a scaled
    // display; the CSS size stays in layout pixels. Strokes are vectors, so a
    // resize repaints them rather than stretching a bitmap.
    var ratio = win.devicePixelRatio || 1
    var size = surfaceSize()
    canvas.width = Math.max(1, Math.round(size.w * ratio))
    canvas.height = Math.max(1, Math.round(size.h * ratio))
    var ctx = canvas.getContext('2d')
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    paint()
  }

  function pointAt(e: PointerEvent): Point {
    var r = root.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  canvas.addEventListener('pointerdown', function (e: PointerEvent) {
    if (!drawMode || e.button !== 0) return
    e.preventDefault()
    try { canvas.setPointerCapture(e.pointerId) } catch (err) { /* capture is a nicety */ }
    current = { tool: tool, color: color, points: [pointAt(e)] }
  })
  canvas.addEventListener('pointermove', function (e: PointerEvent) {
    if (!current) return
    current.points.push(pointAt(e))
    paint()
  })
  function finishStroke(): void {
    if (!current) return
    if (current.points.length > 1) strokes.push(current)
    current = null
    paint()
  }
  canvas.addEventListener('pointerup', finishStroke)
  canvas.addEventListener('pointercancel', finishStroke)
  canvas.addEventListener('contextmenu', function (e: Event) { if (drawMode) e.preventDefault() })

  // ── Toast ──────────────────────────────────────────────────────────────

  function toast(message: string, kind?: PenToastKind): void {
    toastEl.textContent = message
    toastEl.className = 'toast show ' + (kind || 'info')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { toastEl.className = 'toast' }, 3600)
  }

  // ── Toolbar ────────────────────────────────────────────────────────────

  function el(tag: string, cls: string, text?: string, title?: string): HTMLElement {
    var node = doc.createElement(tag)
    node.className = cls
    if (text !== undefined) node.textContent = text
    if (title) node.title = title
    if (tag === 'button') (node as HTMLButtonElement).type = 'button'
    return node
  }

  function separator(): HTMLElement { return el('div', 'sep') }

  function svgIcon(name: string, filled?: boolean): Element {
    var ns = 'http://www.w3.org/2000/svg'
    var svg = doc.createElementNS(ns, 'svg')
    svg.setAttribute('width', '17')
    svg.setAttribute('height', '17')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    if (filled) {
      var shape = doc.createElementNS(ns, name === 'stop' ? 'rect' : 'circle')
      if (name === 'stop') {
        shape.setAttribute('x', '6'); shape.setAttribute('y', '6')
        shape.setAttribute('width', '12'); shape.setAttribute('height', '12'); shape.setAttribute('rx', '2')
      } else {
        shape.setAttribute('cx', '12'); shape.setAttribute('cy', '12'); shape.setAttribute('r', '6.5')
      }
      shape.setAttribute('fill', 'currentColor')
      shape.setAttribute('stroke', 'none')
      svg.appendChild(shape)
      return svg
    }
    var paths = ICONS[name] || []
    for (var i = 0; i < paths.length; i++) {
      var p = doc.createElementNS(ns, 'path')
      p.setAttribute('d', paths[i])
      svg.appendChild(p)
    }
    return svg
  }

  function iconButton(name: string, title: string): HTMLElement {
    var b = el('button', 'btn', undefined, title)
    b.appendChild(svgIcon(name))
    return b
  }

  function setIcon(node: HTMLElement, name: string, filled?: boolean): void {
    while (node.firstChild) node.removeChild(node.firstChild)
    node.appendChild(svgIcon(name, filled))
  }

  // Built once and updated in place: re-rendering the bar on every change
  // would re-bind listeners each time and lose a drag in progress.
  var grip = el('div', 'grip', '⠇⠇', 'Drag to move')
  bar.appendChild(grip)

  var toolButtons: Record<string, HTMLElement> = {}
  for (var t = 0; t < TOOLS.length; t++) {
    ;(function (def) {
      var b = iconButton(def.id, def.title)
      b.addEventListener('click', function () {
        tool = def.id
        if (!drawMode) setMode(true)
        else refresh()
      })
      toolButtons[def.id] = b
      bar.appendChild(b)
    })(TOOLS[t])
  }

  bar.appendChild(separator())

  var swatches: Record<string, HTMLElement> = {}
  for (var c = 0; c < COLORS.length; c++) {
    ;(function (hex) {
      var sw = el('button', 'sw', undefined, hex)
      sw.style.background = hex
      sw.addEventListener('click', function () {
        color = hex
        refresh()
      })
      swatches[hex] = sw
      bar.appendChild(sw)
    })(COLORS[c])
  }

  bar.appendChild(separator())

  var undoBtn = iconButton('undo', 'Undo the last mark')
  undoBtn.addEventListener('click', function () {
    strokes.pop()
    paint()
  })
  var clearBtn = el('button', 'btn word', 'Clear', 'Remove every mark')
  clearBtn.addEventListener('click', function () {
    strokes = []
    paint()
  })
  bar.appendChild(undoBtn)
  bar.appendChild(clearBtn)

  bar.appendChild(separator())

  var shotBtn = iconButton('camera', 'Photograph the page, annotations included')
  shotBtn.addEventListener('click', function () {
    // The toolbar is hidden for the frame the host takes: a picture of the
    // annotation with the annotator's own toolbar across it is not the
    // picture anybody wanted. The host calls showChrome() once it has it.
    root.classList.add('capturing')
    win.requestAnimationFrame(function () {
      win.requestAnimationFrame(function () { emit({ kind: 'screenshot' }) })
    })
  })
  bar.appendChild(shotBtn)

  var recBtn = el('button', 'btn')
  var recIcon = el('span', 'ico')
  var recClock = el('span', 'clock')
  recBtn.appendChild(recIcon)
  recBtn.appendChild(recClock)
  recBtn.addEventListener('click', function () { emit({ kind: 'record' }) })

  var camBtn = el('button', 'btn')
  camBtn.addEventListener('click', function () {
    // Disabled mid-recording: turning the bubble on halfway through would mean
    // asking for the device while the compositor is already running, and the
    // recording would change shape in the middle.
    if (recordingStartedAt !== null) {
      toast('Stop the recording before changing the camera.', 'warn')
      return
    }
    cameraOn = !cameraOn
    emit({ kind: 'camera', on: cameraOn })
    refresh()
  })

  var cornerBtn = iconButton('corner', '')
  cornerBtn.addEventListener('click', function () {
    var next = CORNERS[(CORNERS.indexOf(cameraCorner) + 1) % CORNERS.length]
    cameraCorner = next
    emit({ kind: 'corner', corner: next })
    refresh()
    toast('Camera bubble: ' + next.replace('-', ' ') + '.', 'info')
  })

  if (config.canRecord) {
    bar.appendChild(recBtn)
    if (config.canCamera) {
      bar.appendChild(camBtn)
      bar.appendChild(cornerBtn)
    }
  }

  if (config.notes) {
    bar.appendChild(separator())
    var noteBtn = iconButton('note', 'New sticky note — pinned to this page')
    noteBtn.addEventListener('click', function () { emit({ kind: 'note' }) })
    bar.appendChild(noteBtn)
  }

  bar.appendChild(separator())

  // The mode toggle, which is the control that keeps the page usable.
  var modeBtn = el('button', 'mode')
  var modeDot = el('span', 'dot')
  var modeWord = el('span', '')
  modeBtn.appendChild(modeDot)
  modeBtn.appendChild(modeWord)
  modeBtn.addEventListener('click', function () { setMode(!drawMode) })
  bar.appendChild(modeBtn)

  var closeBtn = iconButton('close', 'Close the annotator')
  closeBtn.addEventListener('click', function () { emit({ kind: 'close' }) })
  bar.appendChild(closeBtn)

  function refresh(): void {
    root.className = 'root' + (drawMode ? ' draw' : '') + (root.classList.contains('capturing') ? ' capturing' : '')

    for (var i = 0; i < TOOLS.length; i++) {
      var id = TOOLS[i].id
      toolButtons[id].className = 'btn' + (tool === id && drawMode ? ' on' : '')
    }
    for (var j = 0; j < COLORS.length; j++) {
      swatches[COLORS[j]].className = 'sw' + (COLORS[j] === color ? ' on' : '')
    }

    var recording = recordingStartedAt !== null
    recBtn.className = 'btn' + (recording ? ' live' : '')
    setIcon(recIcon, recording ? 'stop' : 'record', true)
    recIcon.style.color = recording ? '#ffffff' : '#ef4444'
    recClock.textContent = recording
      ? formatElapsed(Math.floor((Date.now() - (recordingStartedAt as number)) / 1000))
      : ''
    recClock.style.display = recording ? 'block' : 'none'
    recBtn.title = recording
      ? 'Stop recording and save'
      : 'Record a screen you pick, with your camera and narration'

    setIcon(camBtn, cameraOn ? 'video' : 'videoOff')
    camBtn.className = 'btn' + (cameraOn ? ' on' : '') + (recording ? ' dim' : '')
    camBtn.title = recording
      ? 'The camera cannot be changed while recording'
      : cameraOn
        ? 'Camera bubble on — click to record the screen alone'
        : 'Camera bubble off — click to include yourself'
    cornerBtn.style.display = cameraOn ? 'flex' : 'none'
    cornerBtn.title = 'Camera bubble: ' + cameraCorner.replace('-', ' ') + ' — click to move it'

    modeBtn.className = 'mode' + (drawMode ? ' drawing' : '')
    modeDot.textContent = drawMode ? '●' : '○'
    modeWord.textContent = drawMode ? 'Draw' : 'Click'
    modeBtn.title = drawMode
      ? 'The sheet is taking clicks. Switch to let them reach the page.'
      : 'Clicks are reaching the page. Switch to draw again.'
  }

  function setMode(next: boolean): void {
    drawMode = next
    if (!next) finishStroke()
    refresh()
  }

  function syncClock(): void {
    if (recordTick) {
      clearInterval(recordTick)
      recordTick = null
    }
    // A clock, because a recorder with no visible elapsed time is one people
    // leave running.
    if (recordingStartedAt !== null) recordTick = setInterval(refresh, 1000)
  }

  // ── Dragging ───────────────────────────────────────────────────────────
  // On the grip, not the whole bar: dragging from a button would make every
  // tool change feel like a slip. Pointer capture keeps the drag alive when
  // the cursor outruns the grip, with no document-level listeners to leak.

  var dragOffset: Point | null = null

  function clampBar(x: number, y: number): Point {
    var size = surfaceSize()
    var h = bar.offsetHeight || 40
    // Clamped, so the toolbar cannot be dragged off the surface and lost.
    return {
      x: Math.round(Math.min(Math.max(0, size.w - BAR_WIDTH), Math.max(0, x))),
      y: Math.round(Math.min(Math.max(0, size.h - Math.min(h, 60)), Math.max(0, y))),
    }
  }

  function placeBar(x: number, y: number): Point {
    var p = clampBar(x, y)
    bar.style.left = p.x + 'px'
    bar.style.top = p.y + 'px'
    return p
  }

  grip.addEventListener('pointerdown', function (e: PointerEvent) {
    if (e.button !== 0) return
    var r = bar.getBoundingClientRect()
    dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top }
    grip.classList.add('dragging')
    try { grip.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
    e.preventDefault()
  })
  grip.addEventListener('pointermove', function (e: PointerEvent) {
    if (!dragOffset) return
    var rr = root.getBoundingClientRect()
    placeBar(e.clientX - rr.left - dragOffset.x, e.clientY - rr.top - dragOffset.y)
  })
  function endDrag(): void {
    if (!dragOffset) return
    dragOffset = null
    grip.classList.remove('dragging')
    // Remembered, since somebody who moved it once meant it.
    emit({ kind: 'position', x: parseInt(bar.style.left, 10) || 0, y: parseInt(bar.style.top, 10) || 0 })
  }
  grip.addEventListener('pointerup', endDrag)
  grip.addEventListener('pointercancel', endDrag)

  // ── Escape hands the page back ─────────────────────────────────────────
  // Capture phase, because the pen must win over a page's own Escape while it
  // is holding the pointer. Only in Draw, so a click-through pen never
  // intercepts anybody's Escape.

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !drawMode) return
    e.preventDefault()
    e.stopPropagation()
    setMode(false)
    toast('Click-through — the page takes clicks again.', 'info')
  }
  doc.addEventListener('keydown', onKey, true)

  var resizeObserver: ResizeObserver | null = null
  function onResize(): void {
    sizeCanvas()
    placeBar(parseInt(bar.style.left, 10) || 0, parseInt(bar.style.top, 10) || 0)
  }
  if (typeof (win as any).ResizeObserver === 'function') {
    resizeObserver = new (win as any).ResizeObserver(onResize)
    ;(resizeObserver as ResizeObserver).observe(root)
  } else {
    win.addEventListener('resize', onResize)
  }

  // ── Start ──────────────────────────────────────────────────────────────

  refresh()
  syncClock()
  sizeCanvas()
  var start = config.position || { x: 16, y: Math.max(16, Math.round(surfaceSize().h / 2 - 300)) }
  placeBar(start.x, start.y)
  toast('Screen Pen ready, click-through. Pick a tool to draw; Esc gives the page back.', 'info')

  return {
    setRecording: function (startedAt: number | null) {
      recordingStartedAt = startedAt
      syncClock()
      refresh()
    },
    setCamera: function (on: boolean, corner: CameraCorner) {
      cameraOn = !!on
      cameraCorner = corner || cameraCorner
      refresh()
    },
    toast: toast,
    showChrome: function () {
      root.classList.remove('capturing')
    },
    barRect: function () {
      var r = bar.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    },
    destroy: function () {
      if (destroyed) return
      destroyed = true
      if (recordTick) clearInterval(recordTick)
      if (toastTimer) clearTimeout(toastTimer)
      doc.removeEventListener('keydown', onKey, true)
      if (resizeObserver) resizeObserver.disconnect()
      else win.removeEventListener('resize', onResize)
      hostEl.remove()
    },
  }
}

/** The runtime as source text, for injection into a tab's own document. */
export const SCREEN_PEN_RUNTIME_SOURCE: string = screenPenRuntime.toString()
