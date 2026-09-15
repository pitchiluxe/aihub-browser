import { useEffect, useRef } from 'react'
import { penSession } from '../../services/screenPen/penSession'
import { screenPenRuntime, type ScreenPenApi } from './screenPen/screenPenRuntime'
import { dispatchPenEvent, savePenScreenshot } from './screenPen/penEvents'

// The Screen Pen on the app's OWN pages (home, Notes, Settings, the Bible…).
// A web tab gets the pen injected into its BrowserView (AnnotationCanvas);
// host React pages have no BrowserView, so the very same runtime is mounted
// straight into this element and its events are handled with no queue between.
//
// Sticky notes stay a web-page feature: they are pinned to, and stored under,
// a site's URL, which the app's own pages do not have in the same sense.

const waitForPaint = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

export default function HostAnnotationCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let pen: ScreenPenApi | null = null

    const screenshot = async () => {
      // Photograph just the page area, annotations included, toolbar hidden.
      await waitForPaint()
      const r = container.getBoundingClientRect()
      const dataUrl = await window.electronAPI.recorder
        .captureWindow({ x: r.left, y: r.top, width: r.width, height: r.height })
        .catch(() => null)
      pen?.showChrome()
      await savePenScreenshot(dataUrl)
    }

    const s = penSession.getState()
    pen = screenPenRuntime(
      container,
      {
        position: penSession.position(),
        canRecord: penSession.canRecord(),
        canCamera: penSession.canRecordCamera(),
        cameraOn: s.cameraOn,
        cameraCorner: s.cameraCorner,
        recordingStartedAt: s.recordingStartedAt,
        notes: false,
        fixed: false,
        zIndex: 60,
      },
      event => dispatchPenEvent(event, () => void screenshot()),
    )

    const unsubState = penSession.subscribe(next => {
      pen?.setRecording(next.recordingStartedAt)
      pen?.setCamera(next.cameraOn, next.cameraCorner)
    })
    const unsubToast = penSession.onToast((message, kind) => pen?.toast(message, kind))

    return () => {
      unsubState()
      unsubToast()
      pen?.destroy()
      pen = null
    }
  }, [])

  return <div ref={containerRef} className="absolute inset-0 z-[60]" style={{ pointerEvents: 'none' }} />
}
