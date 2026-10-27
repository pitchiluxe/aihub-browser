/**
 * AIHub DJ song suggester — the main-process half (same feature as the AIHub DJ
 * app, wired into this browser's own AI routing and stores):
 *
 *  - the library database (dj-library.json): records the DJ page writes, and
 *    the candidate query (tempo ±6 %, Camelot-compatible keys) over them;
 *  - `ai:json`: a structured answer from local Ollama, decoded against a JSON
 *    schema, with the browser's AI router as the fallback;
 *  - `stt:transcribe`: voice commands sent to a local speech-to-text server;
 *  - the optional floor-energy feed on 127.0.0.1 (floorFeed.ts).
 *
 * `dj:db:upsert` is registered in index.ts through handlePersistent, so private
 * windows never write the library (incognito.test.ts checks it there).
 */
import { app, ipcMain, net } from 'electron'
import { join } from 'path'
import { createManagedJsonStore } from './jsonStore'
import { queryCandidates, upsertRecords, type CandidateQuery, type TrackRecord } from './dj/trackDb'
import { setFloorFeed } from './floorFeed'

export interface DjSuggestDeps {
  appDir: string
  /** Normalised Ollama base URL from the AI settings. */
  ollamaBase(): string
  /** An installed Ollama model, preferring `preferred`; '' when none. */
  resolveModel(preferred: string): Promise<string>
  /** The browser's AI router, for when Ollama cannot answer. */
  fallback(messages: { role: string; content: string }[]): Promise<{ provider: string; content: string; model?: string }>
}

type Msg = { role: string; content: string }
let store: ReturnType<typeof createManagedJsonStore<Record<string, TrackRecord>>> | null = null
let sttStore: ReturnType<typeof createManagedJsonStore<{ sttUrl: string; sttModel: string }>> | null = null
const STT_DEFAULTS = { sttUrl: 'http://127.0.0.1:8080/inference', sttModel: 'whisper-1' }

/** For index.ts's handlePersistent('dj:db:upsert', …). */
export function upsertTrackRecords(records: unknown): { ok: boolean; changed: number } {
  if (!store || !Array.isArray(records)) return { ok: false, changed: 0 }
  const { db, changed } = upsertRecords(store.get(), records)
  if (changed) store.set(db)
  return { ok: true, changed }
}

function clean(messages: unknown): Msg[] {
  return (Array.isArray(messages) ? messages : [])
    .map((m: any) => ({ role: m?.role === 'system' || m?.role === 'assistant' ? m.role : 'user', content: typeof m?.content === 'string' ? m.content : '' }))
    .filter(m => m.content.trim())
}

async function postJson(url: string, data: unknown, timeoutMs: number): Promise<{ status: number; body: string }> {
  await app.whenReady()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await net.fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    return { status: res.status, body: await res.text() }
  } catch (e: any) {
    throw new Error(e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network'))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ollama decodes against `schema` (structured outputs): the answer is the JSON,
 * nothing else. Small models first — the DJ needs an answer within a song.
 */
async function chatJson(deps: DjSuggestDeps, raw: unknown, schema: unknown) {
  const messages = clean(raw)
  if (!messages.length) return { ok: false, content: '', provider: 'none', error: 'empty' }
  const format = schema && typeof schema === 'object' && JSON.stringify(schema).length < 20_000 ? schema : 'json'
  let localError = ''
  try {
    const model = await deps.resolveModel('llama3.2:3b')
    if (!model) throw new Error('No Ollama chat model installed (try: ollama pull llama3.2:3b)')
    const chars = messages.reduce((n, m) => n + m.content.length, 0)
    // Thinking models would reason for minutes first; a CPU-only machine needs the full 10 minutes for a structured answer.
    const { status, body } = await postJson(`${deps.ollamaBase()}/api/chat`, {
      model, messages, stream: false, keep_alive: '30m', format, think: false,
      options: { num_ctx: chars / 3.5 + 1536 <= 8192 ? 8192 : 16384, temperature: 0.2, num_predict: 1200 },
    }, 600_000)
    if (status !== 200) throw new Error(`Ollama HTTP ${status}: ${body.slice(0, 160)}`)
    const content = String(JSON.parse(body)?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    if (!content) throw new Error('Ollama returned an empty answer')
    return { ok: true, content, provider: 'ollama', model }
  } catch (e: any) {
    localError = e?.message || String(e)
  }
  try {
    const r = await deps.fallback([...messages, { role: 'user', content: 'Reply with the JSON object only — no prose, no code fence.' }])
    if (r.provider !== 'none' && r.content) return { ok: true, content: r.content, provider: r.provider, model: r.model }
    return { ok: false, content: '', provider: 'none', error: `Ollama: ${localError} · ${r.content || 'no fallback'}` }
  } catch (e: any) {
    return { ok: false, content: '', provider: 'none', error: `Ollama: ${localError} · ${e?.message || e}` }
  }
}

async function transcribe(wav: unknown): Promise<{ ok: boolean; text: string; error?: string }> {
  if (!(wav instanceof ArrayBuffer) || wav.byteLength < 44 || wav.byteLength > 8 * 1024 * 1024) return { ok: false, text: '', error: 'bad-audio' }
  const { sttUrl: url, sttModel } = sttStore!.get()
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'command.wav')
  form.append('response_format', 'json')
  if (/\/audio\/transcriptions\/?$/.test(url)) form.append('model', sttModel || 'whisper-1')
  else form.append('temperature', '0')
  await app.whenReady()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 60_000)
  try {
    const res = await net.fetch(url, { method: 'POST', body: form, signal: ctl.signal })
    const body = await res.text()
    if (res.status !== 200) {
      // An HTML error page means something else answers on that port, not a speech server.
      const detail = /<html|<!doctype/i.test(body) ? '' : `: ${body.replace(/\s+/g, ' ').slice(0, 100)}`
      return { ok: false, text: '', error: res.status === 404
        ? `No speech-to-text server at ${url} (HTTP 404) — start whisper.cpp's whisper-server there, or set its URL below`
        : `Speech server at ${url} answered HTTP ${res.status}${detail}` }
    }
    let text = ''
    try { text = String(JSON.parse(body)?.text ?? '') } catch { text = body }
    text = text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    return text ? { ok: true, text } : { ok: false, text: '', error: 'Nothing was heard' }
  } catch (e: any) {
    return { ok: false, text: '', error: e?.name === 'AbortError' ? 'Speech server timed out' : `Speech server unreachable at ${url}` }
  } finally {
    clearTimeout(timer)
  }
}

export function registerDjSuggestIpc(deps: DjSuggestDeps): void {
  store = createManagedJsonStore<Record<string, TrackRecord>>(join(deps.appDir, 'dj-library.json'), () => ({}), { debounceMs: 3000 })
  sttStore = createManagedJsonStore(join(deps.appDir, 'dj-stt.json'), () => ({ ...STT_DEFAULTS }), { debounceMs: 500 })

  ipcMain.handle('dj:db:get', (_e, ids: unknown) => {
    const all = store!.get()
    const out: Record<string, TrackRecord> = {}
    if (Array.isArray(ids)) for (const id of ids.slice(0, 500)) if (typeof id === 'string' && all[id]) out[id] = all[id]
    return out
  })
  ipcMain.handle('dj:db:query', (_e, q: unknown) => {
    const query = q as CandidateQuery
    if (!query || typeof query.bpm !== 'number' || !(query.bpm > 30 && query.bpm < 300)) return []
    return queryCandidates(store!.get(), query)
  })
  ipcMain.handle('dj:db:count', () => Object.keys(store!.get()).length)

  ipcMain.handle('ai:json', (_e, messages: unknown, schema: unknown) => chatJson(deps, messages, schema))

  ipcMain.handle('stt:transcribe', (_e, wav: unknown) => transcribe(wav))
  ipcMain.handle('dj:stt:get', () => ({ ...STT_DEFAULTS, ...sttStore!.get() }))
  ipcMain.handle('dj:stt:set', (_e, s: unknown) => {
    const x = (s || {}) as { sttUrl?: unknown; sttModel?: unknown }
    const next = { ...STT_DEFAULTS, ...sttStore!.get() }
    if (typeof x.sttUrl === 'string' && /^https?:\/\//.test(x.sttUrl)) next.sttUrl = x.sttUrl.slice(0, 300)
    if (typeof x.sttModel === 'string') next.sttModel = x.sttModel.slice(0, 80)
    sttStore!.set(next)
    return next
  })

  // Readings go to the window that switched the feed on.
  ipcMain.handle('dj:floor:feed', (e, on: unknown) => {
    const sender = e.sender
    return setFloorFeed(on === true, r => { if (!sender.isDestroyed()) sender.send('dj:floor:reading', r) })
  })
}
