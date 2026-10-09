import { useEffect, useRef } from 'react'
import { useBrowserStore } from '../../store/browserStore'
import { buildPageExtractionScript } from '../../services/pageExtractor'
import { cleanNarration } from '../../services/agentTools'
import { penSession } from '../../services/screenPen/penSession'
import type { ScreenPenConfig, ScreenPenEvent } from './screenPen/screenPenRuntime'
import { buildInjectScript, DRAIN_SCRIPT, SNAPSHOT_SCRIPT } from './screenPen/injectScript'
import { dispatchPenEvent, savePenScreenshot } from './screenPen/penEvents'

// The Screen Pen on a web tab. Toolbar, canvas and sticky notes are all
// injected into the guest page's own DOM — not rendered as host React overlays.
// BrowserView (the tab's native content view) always paints above our host
// HTML, so a host-rendered toolbar could only be seen by permanently cropping
// the page. Injected, it is real content in the same document as the canvas
// and floats anywhere over the full, uncropped page.
//
// Guest pages cannot reach electronAPI, so the toolbar only enqueues; the host
// polls the queue and does the work (screenshots, recording, AI for notes).

function penConfig(): ScreenPenConfig {
  const s = penSession.getState()
  return {
    position: penSession.position(),
    canRecord: penSession.canRecord(),
    canCamera: penSession.canRecordCamera(),
    cameraOn: s.cameraOn,
    cameraCorner: s.cameraCorner,
    recordingStartedAt: s.recordingStartedAt,
    notes: true,
    fixed: true,
    zIndex: 2147483646,
  }
}

export default function AnnotationCanvas() {
  const activeTabId = useBrowserStore(s => s.activeTabId)
  const tabWcIds    = useBrowserStore(s => s.tabWcIds)
  const wcId = activeTabId ? tabWcIds[activeTabId] : null
  const wcIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!wcId) return
    wcIdRef.current = wcId
    let disposed = false
    const exec = (script: string) =>
      window.electronAPI.webview.execScript(wcId, script).catch(() => null)

    // Inject, then push any notes the app has saved for this page back into it.
    let injecting = false
    const inject = async () => {
      if (injecting || disposed) return
      injecting = true
      try {
        const res = await exec(buildInjectScript(penConfig()))
        if (disposed) {
          // Annotation closed while this was in flight; don't leave a pen behind.
          if (res?.result === 'injected') void exec('window.__aihub&&window.__aihub.remove()')
          return
        }
        if (res?.result !== 'injected') return
        const urlRes = await exec('location.href')
        const url = urlRes?.ok ? String(urlRes.result || '') : ''
        if (!url) return
        const saved = await window.electronAPI.notes.getForUrl(url)
        if (!disposed && Array.isArray(saved) && saved.length > 0) {
          await exec(`window.__aihub_restoreNotes&&window.__aihub_restoreNotes(${JSON.stringify(JSON.stringify(saved))})`)
        }
      } catch {
        /* the next poll retries a page that was not ready */
      } finally {
        injecting = false
      }
    }
    void inject()

    // The recorder lives host-side; mirror its state into the page's toolbar.
    const unsubState = penSession.subscribe(s => {
      void exec(`window.__aihub_pen&&(window.__aihub_pen.setRecording(${JSON.stringify(s.recordingStartedAt)}),window.__aihub_pen.setCamera(${JSON.stringify(s.cameraOn)},${JSON.stringify(s.cameraCorner)}))`)
    })
    const unsubToast = penSession.onToast((message, kind) => {
      void exec(`window.__aihub_pen&&window.__aihub_pen.toast(${JSON.stringify(message)},${JSON.stringify(kind)})`)
    })

    const screenshot = async () => {
      const dataUrl = await window.electronAPI.webview.capture(wcId).catch(() => null)
      // Bring the toolbar back before the save dialog, not after it.
      await exec('window.__aihub_pen&&window.__aihub_pen.showChrome()')
      await savePenScreenshot(dataUrl || null)
    }

    // Note-AI runs outside the poll: a slow model must not hold up the queue
    // behind it, or a screenshot would wait for a summary to finish.
    const answerNotes = async (requests: any[]) => {
      const pageRes = await exec(buildPageExtractionScript())
      const pageText = pageRes?.ok ? String(pageRes.result || '').trim() : ''
      for (const req of requests) {
        if (!req || typeof req.noteId !== 'string') continue
        const prompt = req.text
          ? `Answer briefly based on this page.\nQUESTION/INSTRUCTION: ${req.text}\n\nPAGE CONTENT:\n${pageText}`
          : `Summarize this page in 3-5 short bullet points.\n\nPAGE CONTENT:\n${pageText}`
        let answer = ''
        try {
          const result = await window.electronAPI.ai.chat([{ role: 'user', content: prompt }])
          answer = cleanNarration(result?.content || '') || 'No response from AI.'
        } catch (e: any) {
          answer = `AI error: ${e?.message || e}`
        }
        if (disposed) break
        await exec(`window.__aihub_setNoteText&&window.__aihub_setNoteText(${JSON.stringify(req.noteId)},${JSON.stringify(answer)})`)
      }
    }

    let polling = false
    const poll = setInterval(async () => {
      if (polling || disposed) return
      polling = true
      try {
        const res = await exec(DRAIN_SCRIPT)
        if (!res?.ok) return
        const drained = JSON.parse(String(res.result || '{}'))

        // A navigation replaces the document and the pen with it; put it back.
        if (drained.missing) { void inject(); return }

        const noteSync = drained.notes
        if (noteSync && typeof noteSync.url === 'string' && Array.isArray(noteSync.notes)) {
          window.electronAPI.notes.saveForUrl(noteSync.url, noteSync.notes, noteSync.title || '').catch(() => {})
        }

        const aiQueue: any[] = Array.isArray(drained.ai) ? drained.ai : []
        if (aiQueue.length > 0) void answerNotes(aiQueue)

        const events: ScreenPenEvent[] = Array.isArray(drained.events) ? drained.events : []
        for (const event of events) {
          if (disposed) break
          if (event?.kind === 'screenshot') await screenshot()
          else dispatchPenEvent(event, () => {})
        }
      } catch {
        /* one failed tick shouldn't block the next */
      } finally {
        polling = false
      }
    }, 400)

    return () => {
      disposed = true
      clearInterval(poll)
      unsubState()
      unsubToast()
      const id = wcIdRef.current
      wcIdRef.current = null
      if (id !== null) {
        // Final flush BEFORE removing the overlay: snapshot the notes exactly
        // as they are (even mid-debounce) so closing annotation mode right
        // after typing never drops the last edit.
        ;(async () => {
          try {
            const res = await window.electronAPI.webview.execScript(id, SNAPSHOT_SCRIPT)
            if (res?.ok && res.result) {
              const snap = JSON.parse(String(res.result))
              if (snap && typeof snap.url === 'string' && Array.isArray(snap.notes)) {
                await window.electronAPI.notes.saveForUrl(snap.url, snap.notes, snap.title || '')
              }
            }
          } catch {}
          window.electronAPI.webview.execScript(id, `window.__aihub&&window.__aihub.remove()`).catch(() => {})
        })()
      }
    }
  }, [wcId])

  return null
}
