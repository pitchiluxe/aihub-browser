import type { WebContents } from 'electron'
import { sanitizeRequest, validateReplay, SECRET_FIELD, type ApiRequest } from '../shared/developer'

interface Capture { wc: WebContents; rows: Map<string, ApiRequest>; protectedHeaders: Map<string, Record<string, string>>; pending: Set<string>; timers: Map<string, ReturnType<typeof setTimeout>>; intercept: boolean; listener: (...args: any[]) => void; detached: () => void }
export function createApiSandbox() {
  const captures = new Map<number, Capture>()
  const stop = async (wc: WebContents) => {
    const capture = captures.get(wc.id)
    if (!capture) return
    captures.delete(wc.id)
    for (const timer of capture.timers.values()) clearTimeout(timer)
    wc.debugger.removeListener('message', capture.listener)
    wc.debugger.removeListener('detach', capture.detached)
    // Disabling Fetch releases every paused request, including a full queue.
    try { if (capture.intercept) await wc.debugger.sendCommand('Fetch.disable') } catch {}
    try { if (wc.debugger.isAttached()) wc.debugger.detach() } catch {}
  }
  return {
    async start(wc: WebContents, intercept: boolean) {
      await stop(wc)
      if (wc.debugger.isAttached()) throw Error('Close the page debugger before starting API capture.')
      const capture: Capture = { wc, rows: new Map(), protectedHeaders: new Map(), pending: new Set(), timers: new Map(), intercept, listener: () => {}, detached: () => {} }
      const append = (row: ApiRequest) => {
        if (capture.rows.size >= 200) {
          const oldest = [...capture.rows.keys()].find(id => !capture.pending.has(id))
          if (oldest) capture.rows.delete(oldest)
        }
        capture.rows.set(row.id, row)
      }
      capture.listener = (_event, method: string, params: any) => {
        if (method === 'Network.requestWillBeSent' && ['Fetch', 'XHR'].includes(params.type)) {
          try { append({ ...sanitizeRequest({ ...params.request, id: params.requestId, type: params.type }), body: params.request.postData?.length <= 256_000 ? params.request.postData : undefined }) } catch {}
        }
        if (method === 'Network.responseReceived') {
          const row = capture.rows.get(params.requestId)
          if (row) row.status = params.response.status
        }
        if (method === 'Fetch.requestPaused') {
          const id = `pause:${params.requestId}`
          if (capture.pending.size >= 20) {
            void wc.debugger.sendCommand('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {})
            return
          }
          try {
            const row = sanitizeRequest({ ...params.request, id, type: params.resourceType })
            capture.pending.add(id)
            capture.protectedHeaders.set(id, Object.fromEntries(Object.entries(params.request.headers || {}).filter(([key]) => SECRET_FIELD.test(key))) as Record<string, string>)
            append({ ...row, body: params.request.postData?.length <= 256_000 ? params.request.postData : undefined, paused: true })
            capture.timers.set(id, setTimeout(() => {
              capture.pending.delete(id); capture.timers.delete(id)
              capture.protectedHeaders.delete(id)
              const row = capture.rows.get(id); if (row) row.paused = false
              void wc.debugger.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: 'TimedOut' }).catch(() => {})
            }, 60_000))
          } catch { void wc.debugger.sendCommand('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {}) }
        }
      }
      capture.detached = () => { captures.delete(wc.id); for (const timer of capture.timers.values()) clearTimeout(timer); wc.debugger.removeListener('message', capture.listener); wc.debugger.removeListener('detach', capture.detached) }
      try {
        wc.debugger.attach('1.3'); captures.set(wc.id, capture)
        wc.debugger.on('message', capture.listener); wc.debugger.once('detach', capture.detached)
        await wc.debugger.sendCommand('Network.enable', { maxPostDataSize: 256_000 })
        if (intercept) await wc.debugger.sendCommand('Fetch.enable', { patterns: [
          { urlPattern: '*', resourceType: 'XHR', requestStage: 'Request' },
          { urlPattern: '*', resourceType: 'Fetch', requestStage: 'Request' },
        ] })
        wc.once('destroyed', () => { for (const timer of capture.timers.values()) clearTimeout(timer); captures.delete(wc.id) })
      } catch (error) { await stop(wc); throw error }
    },
    snapshot(wc: WebContents) {
      const capture = captures.get(wc.id)
      return { recording: !!capture, intercept: capture?.intercept || false, requests: [...(capture?.rows.values() || [])].reverse() }
    },
    async resolve(wc: WebContents, id: string, input: unknown, abort = false) {
      const capture = captures.get(wc.id)
      if (!capture?.pending.has(id)) throw Error('This request is no longer paused.')
      const requestId = id.slice(6)
      if (abort) await wc.debugger.sendCommand('Fetch.failRequest', { requestId, errorReason: 'Aborted' })
      else {
        const request = validateReplay(input)
        const original = capture.rows.get(id)!
        const sameOrigin = new URL(request.url).origin === new URL(original.url).origin
        const names = new Set(Object.keys(request.headers).map(name => name.toLowerCase()))
        const headers = [...Object.entries(sameOrigin ? capture.protectedHeaders.get(id) || {} : {}).filter(([name]) => !names.has(name.toLowerCase())), ...Object.entries(request.headers)].map(([name, value]) => ({ name, value }))
        // Redacted credentials are absent from the editor. Keep Chromium's original
        // headers unless the user supplies replacements by name.
        const modifiedHeaders = !sameOrigin || JSON.stringify(request.headers) !== JSON.stringify(original.headers)
        await wc.debugger.sendCommand('Fetch.continueRequest', {
          requestId, ...(request.url !== original.url ? { url: request.url } : {}), method: request.method,
          ...(modifiedHeaders ? { headers } : {}),
          ...(typeof (input as ApiRequest)?.body === 'string' ? { postData: Buffer.from((input as ApiRequest).body || '').toString('base64') } : {}),
        })
      }
      capture.pending.delete(id)
      capture.protectedHeaders.delete(id)
      clearTimeout(capture.timers.get(id)); capture.timers.delete(id)
      const row = capture.rows.get(id); if (row) row.paused = false
    },
    stop,
    async shutdown() { await Promise.allSettled([...captures.values()].map(capture => stop(capture.wc))) },
  }
}
