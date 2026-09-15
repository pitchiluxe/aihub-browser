import type { ScreenPenEvent } from './screenPenRuntime'
import { penSession } from '../../../services/screenPen/penSession'
import { useBrowserStore } from '../../../store/browserStore'

/**
 * What a toolbar event means, shared by both surfaces. Only the screenshot
 * differs — a tab photographs its page, an app page photographs the window —
 * and sticky notes are handled inside the page before they ever get here.
 */
export function dispatchPenEvent(event: ScreenPenEvent, onScreenshot: () => void): void {
  switch (event?.kind) {
    case 'screenshot':
      onScreenshot()
      break
    case 'record':
      penSession.toggleRecording()
      break
    case 'camera':
      penSession.setCameraOn(!!event.on)
      break
    case 'corner':
      penSession.setCameraCorner(event.corner)
      break
    case 'position':
      penSession.savePosition(Number(event.x) || 0, Number(event.y) || 0)
      break
    case 'close': {
      const store = useBrowserStore.getState()
      if (store.isAnnotationMode) store.toggleAnnotationMode()
      break
    }
  }
}

/** Save a captured PNG through the app's save dialog, and say what happened. */
export async function savePenScreenshot(dataUrl: string | null): Promise<void> {
  if (!dataUrl) {
    penSession.toast('Nothing was captured.', 'warn')
    return
  }
  try {
    const result = await window.electronAPI.file.saveImage({ dataUrl, baseName: 'annotation' })
    if (result?.success) {
      penSession.toast(`Screenshot saved${result.filePath ? ` — ${result.filePath}` : ''}.`, 'success')
    } else if (result?.error) {
      penSession.toast(`The screenshot could not be saved: ${result.error}`, 'error')
    }
    // A cancelled dialog reports neither — silent, like every file:save* caller.
  } catch (e: any) {
    penSession.toast(`The screenshot could not be saved: ${e?.message || e}`, 'error')
  }
}
