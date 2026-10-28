// The natural voice, running in its own utility process.
//
// Kokoro-82M is a small neural text-to-speech model that sounds like a person
// reading rather than a machine announcing. It runs on the CPU through
// onnxruntime-node, which keeps every core busy for the second or two each
// sentence takes — so it lives here, out of the main process, where it cannot
// stall the window (see the freeze audit: anything heavy on main shows up as
// "Not Responding").
//
// Protocol, over process.parentPort:
//   in:  { type: 'install' }                       download the model once
//        { type: 'speak', id, text, voice, speed } synthesise one chunk
//   out: { type: 'progress', loaded, total }
//        { type: 'installed' } | { type: 'install-error', message }
//        { type: 'audio', id, samples, sampleRate } | { type: 'error', id, message }

import { KokoroTTS } from 'kokoro-js'
import { env } from '@huggingface/transformers'
import { MODEL_ID, MODEL_DTYPE } from './voiceModel'

const port = (process as any).parentPort as {
  on: (event: 'message', cb: (e: { data: any }) => void) => void
  postMessage: (msg: any) => void
}

env.cacheDir = process.env.AIHUB_VOICE_DIR || env.cacheDir
// Never touch the network unless the user has asked for the download.
env.allowRemoteModels = false

let tts: Promise<KokoroTTS> | null = null

function load(progress?: (loaded: number, total: number) => void): Promise<KokoroTTS> {
  if (!tts) {
    // Several files download in turn (config, tokenizer, the model itself);
    // summed, so the bar moves once from 0 to 100 instead of once per file.
    const files = new Map<string, { loaded: number; total: number }>()
    tts = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'cpu',
      progress_callback: progress
        ? (p: any) => {
            if (p?.status !== 'progress' || !p.total) return
            files.set(p.file, { loaded: p.loaded, total: p.total })
            let loaded = 0, total = 0
            for (const f of files.values()) { loaded += f.loaded; total += f.total }
            progress(loaded, total)
          }
        : undefined,
    }).catch(err => { tts = null; throw err })
  }
  return tts
}

// One at a time: two generate() calls in parallel just split the same cores
// and both arrive late.
let queue: Promise<unknown> = Promise.resolve()

port.on('message', ({ data }) => {
  if (!data || typeof data !== 'object') return

  if (data.type === 'install') {
    env.allowRemoteModels = true
    load((loaded, total) => port.postMessage({ type: 'progress', loaded, total }))
      .then(() => port.postMessage({ type: 'installed' }))
      .catch(err => port.postMessage({ type: 'install-error', message: String(err?.message || err) }))
      .finally(() => { env.allowRemoteModels = false })
    return
  }

  if (data.type === 'speak') {
    const { id, text, voice, speed } = data
    queue = queue.then(async () => {
      try {
        const model = await load()
        const audio = await model.generate(String(text), { voice, speed })
        port.postMessage({ type: 'audio', id, samples: audio.audio, sampleRate: audio.sampling_rate })
      } catch (err: any) {
        port.postMessage({ type: 'error', id, message: String(err?.message || err) })
      }
    })
  }
})
