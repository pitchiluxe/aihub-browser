// Recording a walkthrough for the Screen Pen: screen, camera, voice.
//
// Ported from the IAM Range workstation's recorder. What it composes:
//
//   video   the screen or window the user picked, with the webcam drawn into
//           a corner as a circular bubble
//   audio   the microphone, mixed with system audio where the platform gives
//           a loopback (Windows)
//
// Where the bubble comes from depends on what is being recorded:
//
//   a whole screen   the screen track is recorded as it is. The presenter's
//                    live bubble is a real window inside AIHub's border (see
//                    recorder:cameraBubble in main), so the capture already
//                    contains it exactly where they see it. Nothing is composed
//                    on this page, so a minimised or covered AIHub cannot
//                    throttle the video — the encoder never waits on this thread.
//   a single window  a window capture does not include other windows, so the
//                    bubble is composed into the recorded window's corner on a
//                    canvas here.
//
// The screen comes from a desktopCapturer source id the user chose in the
// app's own picker (Electron has no browser picker), opened with the
// chromeMediaSource constraints the tab recorder already uses. Nothing here
// chooses a screen or turns on a camera by itself, and every track opened is
// stopped when the recording stops — a live camera afterwards is a light left on.

import type { CameraCorner } from '../../components/browser/screenPen/screenPenRuntime'

export type { CameraCorner }

export interface RecorderHandle {
  stop(): Promise<Blob | null>
  /** Seconds elapsed, for a running clock in the UI. */
  elapsed(): number
  startedAt(): number
  hasAudio(): boolean
  hasCamera(): boolean
  /** Whether system audio came through as well as the microphone. */
  hasSystemAudio(): boolean
  /** Move the bubble mid-recording, when it lands over the thing being shown. */
  setCameraCorner(corner: CameraCorner): void
}

export interface RecorderOptions {
  /** desktopCapturer source id of the screen or window to record. */
  sourceId: string
  fps?: number
  /** Ask for the microphone. False records without narration. */
  audio?: boolean
  /** Include the webcam bubble. For a whole screen the live bubble window provides it; a window recording has it drawn in. */
  camera?: boolean
  cameraCorner?: CameraCorner
  /** Bubble diameter as a fraction of the shorter edge of the screen. */
  cameraScale?: number
  /** Called when the recorded source goes away (window closed, display unplugged). */
  onEnded?: () => void
  /** Called when the webcam disconnects mid-recording (window recordings, where it is drawn in). */
  onCameraLost?: () => void
}

/** Whether this runtime can record at all. */
export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

/** Whether a webcam bubble is possible. */
export function canRecordCamera(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function pickMimeType(): string | undefined {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find(t => MediaRecorder.isTypeSupported(t))
}

/**
 * Open the chosen source. System audio is asked for alongside it, because a
 * desktop loopback can only be requested in the same call as the video; where
 * the platform has no loopback that call fails, and the screen is opened alone.
 */
async function openScreen(sourceId: string, fps: number): Promise<MediaStream | null> {
  const ratio = window.devicePixelRatio || 1
  const video = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxFrameRate: fps,
      maxWidth: Math.round(window.screen.width * ratio),
      maxHeight: Math.round(window.screen.height * ratio),
    },
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video,
    } as unknown as MediaStreamConstraints)
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video } as unknown as MediaStreamConstraints)
    } catch {
      return null
    }
  }
}

// ── Compositors ──────────────────────────────────────────────────────────

interface CompositorInput {
  screen: MediaStreamTrack
  camera: MediaStreamTrack | null
  fps: number
  corner: CameraCorner
  cameraScale: number
}

interface Compositor {
  /** The composed video track, for MediaRecorder. */
  track: MediaStreamTrack
  setCorner(corner: CameraCorner): void
  dropCamera(): void
  stop(): void
}

/** A playing, muted <video> bound to a track, ready to draw from. */
async function videoFor(track: MediaStreamTrack): Promise<HTMLVideoElement> {
  const el = document.createElement('video')
  el.srcObject = new MediaStream([track])
  el.muted = true
  el.playsInline = true
  await el.play()
  // Dimensions arrive a frame or two after play() resolves.
  await new Promise<void>(resolve => {
    let tries = 0
    const check = () => {
      if (el.videoWidth > 0 || tries > 60) { resolve(); return }
      tries += 1
      setTimeout(check, 16)
    }
    check()
  })
  return el
}

/** The bubble composed into a window recording, on a canvas on this page. */
async function canvasCompositor(input: CompositorInput): Promise<Compositor | null> {
  let screenVideo: HTMLVideoElement
  let cameraVideo: HTMLVideoElement | null = null
  try {
    screenVideo = await videoFor(input.screen)
    if (input.camera) cameraVideo = await videoFor(input.camera)
  } catch {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = screenVideo.videoWidth || 1280
  canvas.height = screenVideo.videoHeight || 720
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Frame rate 0: a frame is taken only when requestFrame() is called. Left to
  // decide for itself, canvas capture emits a frame only when it sees new
  // pixels, and a still screen became a video that stopped before its audio.
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  let corner = input.corner

  const draw = () => {
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height)
    const cam = cameraVideo
    if (!cam || !cam.videoWidth) return
    const size = Math.round(Math.min(canvas.width, canvas.height) * input.cameraScale)
    const margin = Math.round(size * 0.16)
    const x = corner.endsWith('right') ? canvas.width - size - margin : margin
    const y = corner.startsWith('bottom') ? canvas.height - size - margin : margin
    const r = size / 2

    // Just the round camera image — no ring, no shadow — matching the live
    // bubble the presenter sees.
    const side = Math.min(cam.videoWidth, cam.videoHeight)
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(cam, (cam.videoWidth - side) / 2, (cam.videoHeight - side) / 2, side, side, x, y, size, size)
    ctx.restore()
  }

  const tick = () => {
    try { draw() } catch { /* one bad frame must not end the loop */ }
    track.requestFrame?.()
  }
  tick()
  const ticker = setInterval(tick, Math.round(1000 / input.fps))

  return {
    track,
    setCorner: next => { corner = next },
    dropCamera: () => { cameraVideo = null },
    stop: () => {
      clearInterval(ticker)
      track.stop()
      screenVideo.srcObject = null
      if (cameraVideo) cameraVideo.srcObject = null
    },
  }
}

// ── Recording ────────────────────────────────────────────────────────────

/**
 * Start recording. Returns null when the source could not be opened — null
 * rather than a throw, because the caller says so and carries on.
 */
export async function startRecording(opts: RecorderOptions): Promise<RecorderHandle | null> {
  if (!canRecord()) return null

  const fps = Math.min(60, Math.max(1, opts.fps ?? 30))
  const cameraScale = Math.min(0.4, Math.max(0.08, opts.cameraScale ?? 0.18))
  let corner: CameraCorner = opts.cameraCorner ?? 'bottom-right'
  let running = false

  // The screen first, so a source that will not open costs no camera light.
  const screenStream = await openScreen(opts.sourceId, fps)
  if (!screenStream) return null
  const screenTrack = screenStream.getVideoTracks()[0]
  if (!screenTrack) {
    for (const t of screenStream.getTracks()) t.stop()
    return null
  }

  const cleanup: MediaStream[] = [screenStream]
  const stopAll = () => { for (const s of cleanup) for (const t of s.getTracks()) t.stop() }

  // A whole screen already contains the live bubble window, so only a window
  // recording needs the camera opened here and drawn in.
  const composeBubble = !opts.sourceId.startsWith('screen:')

  // Camera, best effort. A declined camera loses the bubble, not the recording.
  let cameraTrack: MediaStreamTrack | null = null
  if (composeBubble && opts.camera !== false && canRecordCamera()) {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      cleanup.push(cam)
      cameraTrack = cam.getVideoTracks()[0] ?? null
    } catch {
      cameraTrack = null
    }
  }

  // Microphone, separate from the camera so a refused camera keeps the narration.
  let micStream: MediaStream | null = null
  if (opts.audio !== false) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      cleanup.push(micStream)
    } catch {
      micStream = null
    }
  }

  let compositor: Compositor | null = null
  if (cameraTrack) {
    compositor = await canvasCompositor({ screen: screenTrack, camera: cameraTrack, fps, corner, cameraScale })
    if (!compositor) {
      stopAll()
      return null
    }
  }
  let hasCamera = cameraTrack !== null

  // A webcam can go away mid-recording — unplugged, the laptop lid, another
  // application taking it. That loses the bubble, never the recording.
  cameraTrack?.addEventListener('ended', () => {
    if (!running || !hasCamera) return
    hasCamera = false
    compositor?.dropCamera()
    opts.onCameraLost?.()
  })

  const stream = new MediaStream([compositor ? compositor.track : screenTrack])

  // Microphone and system audio are two tracks and MediaRecorder writes one,
  // so they are summed through WebAudio: the narration over whatever played.
  const systemAudio = screenStream.getAudioTracks()
  let audioCtx: AudioContext | null = null
  let hasAnyAudio = false
  if (micStream || systemAudio.length > 0) {
    try {
      audioCtx = new AudioContext()
      const mix = audioCtx.createMediaStreamDestination()
      if (micStream) audioCtx.createMediaStreamSource(micStream).connect(mix)
      if (systemAudio.length > 0) {
        const sysGain = audioCtx.createGain()
        // Under the voice on purpose: system audio at full level talks over
        // the person explaining.
        sysGain.gain.value = 0.6
        audioCtx.createMediaStreamSource(new MediaStream(systemAudio)).connect(sysGain)
        sysGain.connect(mix)
      }
      for (const track of mix.stream.getAudioTracks()) stream.addTrack(track)
      hasAnyAudio = true
    } catch {
      // No WebAudio. The microphone alone rather than silence.
      audioCtx = null
      if (micStream) {
        for (const track of micStream.getAudioTracks()) stream.addTrack(track)
        hasAnyAudio = true
      }
    }
  }

  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  // A timeslice, so a crash mid-recording still leaves the frames already flushed.
  recorder.start(1000)
  running = true

  const startedAt = Date.now()

  let stopped: Promise<Blob | null> | null = null
  const finish = (): Promise<Blob | null> => {
    if (stopped) return stopped
    stopped = new Promise<Blob | null>(resolve => {
      running = false
      const done = () => {
        compositor?.stop()
        stopAll()
        for (const track of stream.getTracks()) track.stop()
        void audioCtx?.close().catch(() => undefined)
        resolve(chunks.length > 0 ? new Blob(chunks, { type: mimeType ?? 'video/webm' }) : null)
      }
      if (recorder.state === 'inactive') { done(); return }
      recorder.onstop = done
      recorder.stop()
    })
    return stopped
  }

  // A source that goes away is a stop, not a stall — left unhandled, the video
  // would keep repeating the last frame it saw.
  screenTrack.addEventListener('ended', () => {
    if (!running) return
    opts.onEnded?.()
  })

  return {
    elapsed: () => Math.floor((Date.now() - startedAt) / 1000),
    startedAt: () => startedAt,
    hasAudio: () => hasAnyAudio,
    hasCamera: () => hasCamera,
    hasSystemAudio: () => systemAudio.length > 0,
    setCameraCorner: next => {
      corner = next
      compositor?.setCorner(corner)
    },
    stop: finish,
  }
}
