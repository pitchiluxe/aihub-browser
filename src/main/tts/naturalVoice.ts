// The natural voice service: installs the model on request, runs it in a
// utility process, and hands synthesised audio to the renderer.
//
// Nothing is downloaded until the user asks for it in Settings → Bible. Until
// then, and whenever this fails, scripture is read by the system voice — the
// natural voice is an upgrade, never a dependency.

import { ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { isNaturalVoice, MODEL_SIZE_MB, NATURAL_VOICES } from './voiceModel'

export interface NaturalVoiceDeps {
  appDir: string
  /** Broadcast to every app window. */
  send: (channel: string, ...args: any[]) => void
}

export interface VoiceStatus {
  installed: boolean
  installing: boolean
  /** 0–1 while installing. */
  progress: number
  sizeMb: number
  voices: typeof NATURAL_VOICES
  error?: string
}

// The model weighs ~0.5 GB resident. Kept warm between sentences and between
// chapters, released after a quiet spell so it is not held all day for one
// psalm read in the morning.
const IDLE_MS = 3 * 60_000
const SPEAK_TIMEOUT_MS = 60_000

let deps: NaturalVoiceDeps
let worker: UtilityProcess | null = null
let idleTimer: NodeJS.Timeout | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: any) => void; timer: NodeJS.Timeout }>()
let installing: Promise<VoiceStatus> | null = null
let progress = 0
let lastError: string | undefined

const voiceDir = () => join(deps.appDir, 'voices', 'kokoro')
// Written only after a complete, successful load — a half-finished download
// never counts as installed.
const readyMarker = () => join(voiceDir(), 'ready.json')

function status(): VoiceStatus {
  return {
    installed: existsSync(readyMarker()),
    installing: !!installing,
    progress,
    sizeMb: MODEL_SIZE_MB,
    voices: NATURAL_VOICES,
    error: lastError,
  }
}

function settle(id: number, value: any) {
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(id)
  p.resolve(value)
}

function ensureWorker(): UtilityProcess {
  if (worker) return worker
  mkdirSync(voiceDir(), { recursive: true })
  const w = utilityProcess.fork(join(__dirname, 'ttsWorker.js'), [], {
    serviceName: 'AIHub Natural Voice',
    env: { ...process.env, AIHUB_VOICE_DIR: voiceDir() },
  })
  w.on('message', (msg: any) => {
    if (msg?.type === 'audio') settle(msg.id, { samples: msg.samples, sampleRate: msg.sampleRate })
    else if (msg?.type === 'error') settle(msg.id, { error: msg.message })
    else if (msg?.type === 'progress') {
      progress = msg.total ? Math.min(1, msg.loaded / msg.total) : 0
      deps.send('voice:progress', status())
    }
  })
  w.on('exit', () => {
    if (worker === w) worker = null
    for (const id of [...pending.keys()]) settle(id, { error: 'The voice process stopped.' })
  })
  worker = w
  return w
}

function touch() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (pending.size || installing) { touch(); return }
    worker?.kill()
    worker = null
  }, IDLE_MS)
}

function install(): Promise<VoiceStatus> {
  if (status().installed) return Promise.resolve(status())
  if (installing) return installing
  lastError = undefined
  progress = 0
  const w = ensureWorker()
  installing = new Promise<VoiceStatus>(resolve => {
    const onMessage = (msg: any) => {
      if (msg?.type !== 'installed' && msg?.type !== 'install-error') return
      w.removeListener('message', onMessage)
      w.removeListener('exit', onExit)
      if (msg.type === 'installed') {
        writeFileSync(readyMarker(), JSON.stringify({ installedAt: Date.now() }))
      } else {
        lastError = msg.message
      }
      finish()
    }
    const onExit = () => { lastError = 'The download was interrupted.'; finish() }
    const finish = () => {
      installing = null
      progress = 0
      touch()
      const s = status()
      deps.send('voice:progress', s)
      resolve(s)
    }
    w.on('message', onMessage)
    w.on('exit', onExit)
    w.postMessage({ type: 'install' })
  })
  deps.send('voice:progress', status())
  return installing
}

function speak(text: unknown, voice: unknown, speed: unknown): Promise<any> {
  if (!status().installed) return Promise.resolve({ error: 'not-installed' })
  const clean = String(text ?? '').slice(0, 1000).trim()
  if (!clean) return Promise.resolve({ error: 'empty' })
  const v = isNaturalVoice(voice) ? voice : NATURAL_VOICES[0].id
  const s = typeof speed === 'number' && speed >= 0.6 && speed <= 1.4 ? speed : 0.92
  const w = ensureWorker()
  touch()
  const id = nextId++
  return new Promise(resolve => {
    const timer = setTimeout(() => settle(id, { error: 'timeout' }), SPEAK_TIMEOUT_MS)
    pending.set(id, { resolve, timer })
    w.postMessage({ type: 'speak', id, text: clean, voice: v, speed: s })
  })
}

function remove(): VoiceStatus {
  worker?.kill()
  worker = null
  try { rmSync(voiceDir(), { recursive: true, force: true }) } catch { /* reported by status */ }
  return status()
}

export function registerNaturalVoiceIpc(d: NaturalVoiceDeps): void {
  deps = d
  ipcMain.handle('voice:status', () => status())
  ipcMain.handle('voice:install', () => install())
  ipcMain.handle('voice:remove', () => remove())
  ipcMain.handle('voice:speak', (_e, text: unknown, voice: unknown, speed: unknown) => speak(text, voice, speed))
}
