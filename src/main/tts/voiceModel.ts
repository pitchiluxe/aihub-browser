// What the natural voice is made of. Shared by the worker that runs it, the
// main-process service that installs it, and the build step that ships the
// voice files — one list, so a voice offered in Settings is always a voice the
// build actually copied.

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
/** fp16 is half the download of fp32 (163 MB) and measured just as fast on a
 *  laptop i3 — about 0.65× real time, so sentence N+1 is ready before N ends. */
export const MODEL_DTYPE = 'fp16' as const
export const MODEL_SIZE_MB = 165

export interface NaturalVoice { id: string; label: string; description: string }

/** Best-rated first. The first entry is the default. */
export const NATURAL_VOICES: NaturalVoice[] = [
  { id: 'af_heart',   label: 'Heart',   description: 'Warm, unhurried — American' },
  { id: 'af_bella',   label: 'Bella',   description: 'Bright and clear — American' },
  { id: 'am_michael', label: 'Michael', description: 'Calm, deeper — American' },
  { id: 'bf_emma',    label: 'Emma',    description: 'Gentle — British' },
  { id: 'bm_george',  label: 'George',  description: 'Steady — British' },
]

export function isNaturalVoice(id: unknown): id is string {
  return typeof id === 'string' && NATURAL_VOICES.some(v => v.id === id)
}
