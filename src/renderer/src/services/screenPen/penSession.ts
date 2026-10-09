// Host-side state for the Screen Pen that outlives any one page.
//
// The toolbar itself lives in whatever page is showing — injected into a tab,
// or mounted over one of the app's own pages — and is thrown away on every tab
// switch. A recording must not be: switching tabs mid-walkthrough is the
// walkthrough. So the recorder, the camera preferences and the remembered
// toolbar position live here, and each surface subscribes and mirrors them.
//
// Recording does not need the pen at all. It can be started from the nav bar's
// record menu and keeps running with the pen closed; the pen is there for when
// something needs drawing on. The nav bar's badge is the always-reachable stop
// control, so a recording is never left running with no way to end it.

import type { CameraCorner, PenToastKind } from '../../components/browser/screenPen/screenPenRuntime'
import { startRecording, canRecord, canRecordCamera, type RecorderHandle } from './screenRecorder'

export interface PenSessionState {
  recordingStartedAt: number | null
  cameraOn: boolean
  cameraCorner: CameraCorner
  /** The screen picker is waiting for a choice. */
  pickerOpen: boolean
  /** A recording is being opened or finalised; ignore further toggles. */
  busy: boolean
}

type Listener = (state: PenSessionState) => void
type ToastListener = (message: string, kind: PenToastKind) => void

const POSITION_KEY = 'aihub_pen_toolbar_position'
const CAMERA_KEY = 'aihub_pen_camera_on'
const CORNER_KEY = 'aihub_pen_camera_corner'
const CORNERS: CameraCorner[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right']

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* lasts the session, which is not fatal */ }
}

/** Defaults to on where a camera is possible: recording a walkthrough is what this is for. */
function loadCameraOn(): boolean {
  const raw = readStorage(CAMERA_KEY)
  return raw !== null ? raw === '1' : canRecordCamera()
}

function loadCorner(): CameraCorner {
  const raw = readStorage(CORNER_KEY) as CameraCorner | null
  return raw && CORNERS.includes(raw) ? raw : 'bottom-right'
}

let state: PenSessionState = {
  recordingStartedAt: null,
  cameraOn: loadCameraOn(),
  cameraCorner: loadCorner(),
  pickerOpen: false,
  busy: false,
}
let recorder: RecorderHandle | null = null
const listeners = new Set<Listener>()
const toastListeners = new Set<ToastListener>()

function set(patch: Partial<PenSessionState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l(state)
}

function toast(message: string, kind: PenToastKind = 'info') {
  for (const l of toastListeners) l(message, kind)
}

async function deliver(blob: Blob) {
  try {
    const buffer = await blob.arrayBuffer()
    const result = await window.electronAPI.file.saveVideo({ buffer })
    if (result?.success) toast(`Recording saved${result.filePath ? ` — ${result.filePath}` : ''}.`, 'success')
    else if (result?.error) toast(`The recording could not be saved: ${result.error}`, 'error')
    else toast('Save cancelled — the recording was discarded.', 'warn')
  } catch (e: any) {
    toast(`The recording could not be saved: ${e?.message || e}`, 'error')
  }
}

function keepPaceInBackground(active: boolean) {
  window.electronAPI?.recorder?.setRecordingActive?.(active)?.catch?.(() => {})
}

/** The live bubble the presenter sees of themselves; main owns the window. */
function liveBubble(opts: { show: boolean; corner?: CameraCorner; sourceId?: string }) {
  window.electronAPI?.recorder?.cameraBubble?.(opts)?.catch?.(() => {})
}

let bubbleShown = false

// The bubble window says whether the camera came on. Only the first report of
// a recording is news; a later 'none' means the camera went away mid-way.
let bubbleReported = false
window.electronAPI?.recorder?.onCameraBubbleState?.((bubble: 'live' | 'none') => {
  if (!recorder || !bubbleShown) return
  if (bubble === 'live') {
    if (!bubbleReported) toast('Camera on — you are in the bubble.', 'success')
    bubbleReported = true
    return
  }
  bubbleShown = false
  liveBubble({ show: false })
  toast(
    bubbleReported
      ? 'The camera disconnected — the recording continues without the bubble.'
      : 'The camera could not be opened — recording without the bubble. Check that no other app is using it.',
    'warn',
  )
})

async function finishRecording() {
  const handle = recorder
  if (!handle) return
  recorder = null
  keepPaceInBackground(false)
  bubbleShown = false
  bubbleReported = false
  liveBubble({ show: false })
  set({ recordingStartedAt: null, busy: true })
  try {
    const blob = await handle.stop()
    if (!blob) toast('The recording produced nothing.', 'warn')
    else await deliver(blob)
  } finally {
    set({ busy: false })
  }
}

export const penSession = {
  getState: (): PenSessionState => state,

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },

  onToast(listener: ToastListener): () => void {
    toastListeners.add(listener)
    return () => { toastListeners.delete(listener) }
  },

  toast,

  canRecord,
  canRecordCamera,

  position(): { x: number; y: number } | null {
    try {
      const raw = readStorage(POSITION_KEY)
      if (!raw) return null
      const p = JSON.parse(raw)
      return typeof p?.x === 'number' && typeof p?.y === 'number' ? { x: p.x, y: p.y } : null
    } catch {
      return null
    }
  },

  savePosition(x: number, y: number) {
    writeStorage(POSITION_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }))
  },

  setCameraOn(on: boolean) {
    // The toolbar refuses this mid-recording; guard here too, since the two
    // could disagree for the length of one poll.
    if (recorder) return
    writeStorage(CAMERA_KEY, on ? '1' : '0')
    set({ cameraOn: on })
  },

  setCameraCorner(corner: CameraCorner) {
    if (!CORNERS.includes(corner)) return
    writeStorage(CORNER_KEY, corner)
    // Mid-recording the handle owns the corner, so it has to be told.
    recorder?.setCameraCorner(corner)
    if (recorder && bubbleShown) liveBubble({ show: true, corner })
    set({ cameraCorner: corner })
  },

  /** The toolbar's record button: stop a running recording, or ask for a screen. */
  toggleRecording() {
    if (state.busy) return
    if (recorder) { void finishRecording(); return }
    if (!canRecord()) {
      toast('Recording is not available in this build.', 'warn')
      return
    }
    set({ pickerOpen: true })
  },

  /** The picker's answer. Null is "cancelled", which is ordinary and not an error. */
  async chooseSource(sourceId: string | null) {
    set({ pickerOpen: false })
    if (!sourceId) {
      toast('No screen was chosen, so nothing is being recorded.', 'info')
      return
    }
    if (recorder || state.busy) return
    set({ busy: true })
    try {
      const handle = await startRecording({
        sourceId,
        fps: 30,
        audio: true,
        camera: state.cameraOn,
        cameraCorner: state.cameraCorner,
        onEnded: () => {
          if (recorder === handle) {
            toast('The recorded screen went away, so the recording stopped.', 'warn')
            void finishRecording()
          }
        },
        onCameraLost: () => {
          // A window recording's drawn-in bubble; the live bubble reports its own.
          if (!bubbleShown) toast('The camera disconnected — the recording continues without the bubble.', 'warn')
        },
      })
      if (!handle) {
        toast('That screen could not be opened for recording.', 'error')
        return
      }
      recorder = handle
      keepPaceInBackground(true)
      // The presenter's own view of themselves, inside the browser's border.
      // It reports whether the camera actually came on (see onCameraBubbleState).
      if (state.cameraOn && canRecordCamera()) {
        bubbleShown = true
        liveBubble({ show: true, corner: state.cameraCorner })
      }
      set({ recordingStartedAt: handle.startedAt() })

      const parts = [sourceId.startsWith('screen:') ? 'Recording your screen' : 'Recording the window you picked']
      if (handle.hasAudio()) {
        parts.push(handle.hasSystemAudio() ? 'and microphone + system audio' : 'and your microphone')
      }
      toast(
        handle.hasAudio()
          ? `${parts.join(' ')}.`
          : `${parts.join(' ')} — but with no audio: no microphone, or permission was declined.`,
        handle.hasAudio() ? 'success' : 'warn',
      )
    } finally {
      set({ busy: false })
    }
  },

  /** The app shell is going away: finalise anything still running. */
  shutdown() {
    if (state.pickerOpen) set({ pickerOpen: false })
    if (recorder) void finishRecording()
  },
}
