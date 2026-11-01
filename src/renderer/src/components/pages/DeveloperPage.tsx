import React, { useEffect, useRef, useState } from 'react'
import { Play, Square, Save, Trash2, RefreshCw, Terminal, Network, ExternalLink } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import { DEFAULT_DEV_PORTS, type ApiRequest, type ApiResponse, type LocalService } from '../../../../shared/developer'

const field = 'bg-aihub-bg border border-aihub-border rounded-lg px-3 py-2 text-sm text-aihub-text focus:outline-none focus:border-aihub-accent w-full'
const button = 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-aihub-border hover:bg-aihub-card disabled:opacity-40 text-sm'
const empty: ApiRequest = { id: '', url: '', method: 'GET', headers: {}, ts: 0 }
async function unwrap<T = any>(promise: Promise<{ ok: boolean; value?: T; error?: string }>): Promise<T> {
  const result = await promise
  if (!result.ok) throw Error(result.error || 'Developer action failed.')
  return result.value as T
}
export default function DeveloperPage() {
  const tabs = useBrowserStore(state => state.tabs)
  const webTabs = tabs.filter(tab => !tab.isHome && tab.pageType === 'browser' && !tab.asleep)
  const [tabId, setTabId] = useState(webTabs[0]?.id || '')
  const [requests, setRequests] = useState<ApiRequest[]>([])
  const [templates, setTemplates] = useState<ApiRequest[]>([])
  const [recording, setRecording] = useState(false)
  const [intercept, setIntercept] = useState(false)
  const [request, setRequest] = useState<ApiRequest>(empty)
  const [headers, setHeaders] = useState('{}')
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [services, setServices] = useState<LocalService[]>([])
  const [ports, setPorts] = useState(DEFAULT_DEV_PORTS.join(', '))
  const [localUrl, setLocalUrl] = useState('http://localhost:3000')
  const [section, setSection] = useState<'requests' | 'services'>('requests')
  const api = window.electronAPI.developer
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn() } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Developer action failed.') }
    finally { if (mounted.current) setBusy(false) }
  }
  useEffect(() => { if (!IS_INCOGNITO) void unwrap<ApiRequest[]>(api.templates()).then(setTemplates).catch(error => setError(error.message)) }, [])
  useEffect(() => {
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        if (!tabId) return
        const value = await unwrap<{ requests: ApiRequest[]; recording: boolean; intercept: boolean }>(api.snapshot(tabId))
        if (!cancelled) { setRequests(value.requests); setRecording(value.recording); if (value.recording) setIntercept(value.intercept) }
      } catch { if (!cancelled) { setRecording(false); setRequests([]) } }
      if (!cancelled) timeout = setTimeout(poll, 1200)
    }
    if (!IS_INCOGNITO) void poll()
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [tabId])
  const choose = (row: ApiRequest) => { setRequest(row); setHeaders(JSON.stringify(row.headers, null, 2)); setResponse(null) }
  const edited = () => ({ ...request, headers: JSON.parse(headers) })
  const openLocal = (url: string) => action(async () => {
    const local = await unwrap<{ url: string; containerId: string }>(api.openLocal(url))
    useBrowserStore.getState().addTab(local.url, 'browser', local.containerId)
  })
  if (IS_INCOGNITO) return <div className="p-10 text-aihub-muted">Open Developer tools in a regular window. Captures and saved templates are disabled in Incognito.</div>
  return <div className="h-full flex flex-col bg-aihub-bg text-aihub-text overflow-hidden">
    <header className="px-7 pt-6 pb-4 border-b border-aihub-border flex items-center justify-between gap-4 flex-wrap">
      <div><h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3"><Terminal size={24} />Developer tools</h1><p className="text-sm text-aihub-muted mt-1">Inspect a tab’s API traffic, replay a request, or open a local service.</p></div>
      <div className="flex gap-2" role="tablist" aria-label="Developer tools">
        <button role="tab" aria-selected={section === 'requests'} className={button} onClick={() => setSection('requests')}>API sandbox</button>
        <button role="tab" aria-selected={section === 'services'} className={button} onClick={() => setSection('services')}>Local services</button>
      </div>
    </header>
    {error && <div role="alert" className="mx-7 mt-3 px-4 py-3 rounded-lg bg-red-500/10 text-red-300 text-sm">{error}</div>}
    {section === 'services' ? <div className="p-7 overflow-auto space-y-6 max-w-4xl">
      <div><h2 className="text-lg font-medium">Services on this computer</h2><p className="text-sm text-aihub-muted mt-1">Scan loopback ports on demand. Development tabs use a separate cookie jar, a direct connection, and local-only CORS rules between services you open here.</p></div>
      <label className="block text-sm">Ports<input aria-label="Ports" className={`${field} mt-2`} value={ports} onChange={event => setPorts(event.target.value)} /></label>
      <button className={button} disabled={busy} onClick={() => action(async () => setServices(await unwrap(api.probe(ports.split(',').map(value => Number(value.trim()))))))}><RefreshCw size={15} />Scan ports</button>
      {services.length > 0 && <div className="divide-y divide-aihub-border">{services.filter(service => service.reachable).map(service => <div key={service.port} className="flex justify-between items-center py-3 gap-4"><span>{service.url}</span><button className={button} disabled={busy} onClick={() => openLocal(service.url)}>Open isolated tab<ExternalLink size={14} /></button></div>)}{!services.some(service => service.reachable) && <p className="py-4 text-aihub-muted">No service answered on these ports. Start your development server, then scan again.</p>}</div>}
      <div className="border-t border-aihub-border pt-5"><label className="block text-sm">Local address<input aria-label="Local address" className={`${field} mt-2`} value={localUrl} onChange={event => setLocalUrl(event.target.value)} placeholder="http://my-project.localhost:3000" /></label><button className={`${button} mt-3`} disabled={busy} onClick={() => openLocal(localUrl)}>Open development tab</button></div>
    </div> : <>
      <div className="px-7 py-4 border-b border-aihub-border flex items-center gap-3 flex-wrap">
        <select aria-label="Source tab" className={`${field} max-w-xs`} value={tabId} disabled={recording || busy} onChange={event => { setTabId(event.target.value); setRequests([]) }}><option value="">Choose an open web tab</option>{webTabs.map(tab => <option key={tab.id} value={tab.id}>{tab.title || tab.url}</option>)}</select>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={intercept} disabled={recording} onChange={event => setIntercept(event.target.checked)} />Pause fetch/XHR before sending</label>
        <button className={`${button} ${recording ? 'text-red-300' : 'text-aihub-accent'}`} disabled={busy || !tabId} onClick={() => action(async () => { await unwrap(recording ? api.stop(tabId) : api.start(tabId, intercept)); setRecording(!recording) })}>{recording ? <Square size={14} /> : <Network size={14} />}{recording ? 'Stop and release requests' : 'Start capture'}</button>
        <button className={button} disabled={!tabId || busy} onClick={() => action(async () => { await unwrap(api.devtools(tabId)); setRecording(false) })}>Open DevTools</button>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="overflow-auto border-r border-aihub-border px-4 py-4">
          <h2 className="text-sm font-medium mb-2">Captured requests <span className="text-aihub-muted">{requests.length}/200</span></h2>
          {!requests.length && <p className="text-xs text-aihub-muted leading-relaxed pb-5">Start capture, then use the source tab. Only fetch and XHR requests are recorded. Stop capture to release every paused request.</p>}
          {requests.map(row => <button key={row.id} className={`block w-full text-left px-2 py-2 rounded-lg text-xs mb-1 ${request.id === row.id ? 'bg-aihub-card' : 'hover:bg-aihub-card/50'}`} onClick={() => choose(row)}><span className="font-semibold text-aihub-accent">{row.method} {row.paused ? 'Paused' : row.status || ''}</span><span className="block truncate mt-1 text-aihub-muted">{row.url}</span></button>)}
          <h2 className="text-sm font-medium mt-6 mb-2">Saved templates</h2>
          <p className="text-xs text-aihub-muted mb-3">Credentials and bodies are never saved.</p>
          {templates.map(row => <div key={row.id} className="flex items-center gap-1"><button className="flex-1 min-w-0 text-left text-xs py-2 truncate" onClick={() => choose(row)}>{row.method} {row.url}</button><button aria-label="Delete template" className="p-2 text-aihub-muted hover:text-red-300" onClick={() => action(async () => { await unwrap(api.delete(row.id)); setTemplates(await unwrap(api.templates())) })}><Trash2 size={13} /></button></div>)}
        </aside>
        <main className="overflow-auto p-5 space-y-4">
          <div className="flex gap-2"><select aria-label="HTTP method" className={`${field} !w-28`} value={request.method} onChange={event => setRequest({ ...request, method: event.target.value })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(method => <option key={method}>{method}</option>)}</select><input aria-label="Request URL" className={field} value={request.url} onChange={event => setRequest({ ...request, url: event.target.value })} placeholder="https://api.example.com/resource" /></div>
          <label className="block text-sm">Headers (JSON)<textarea aria-label="Request headers" spellCheck={false} className={`${field} mt-2 font-mono min-h-28`} value={headers} onChange={event => setHeaders(event.target.value)} /></label>
          <label className="block text-sm">Body<textarea aria-label="Request body" spellCheck={false} className={`${field} mt-2 font-mono min-h-24`} value={request.body || ''} onChange={event => setRequest({ ...request, body: event.target.value })} /></label>
          <div className="flex gap-2 flex-wrap">
            <button className={`${button} text-aihub-accent`} disabled={busy || !request.url} onClick={() => action(async () => setResponse(await unwrap(api.replay(edited()))))}><Play size={14} />Send request</button>
            <button className={button} disabled={busy || !request.url} onClick={() => action(async () => { await unwrap(api.save(edited())); setTemplates(await unwrap(api.templates())) })}><Save size={14} />Save template</button>
            {requests.some(row => row.id === request.id && row.paused) && <><button className={button} disabled={busy} onClick={() => action(async () => { await unwrap(api.resolve({ tabId, id: request.id, request: edited() })); setRequest({ ...request, paused: false }) })}>Forward edited request</button><button className={button} disabled={busy} onClick={() => action(async () => { await unwrap(api.resolve({ tabId, id: request.id, abort: true })); setRequest({ ...request, paused: false }) })}>Abort request</button></>}
          </div>
          <p className="text-xs text-aihub-muted">Send request runs in a separate process without browser cookies. Redirects are shown without following them. Forward uses the source tab’s session. Paused requests are aborted after 60 seconds.</p>
          {response && <section className="border-t border-aihub-border pt-4"><h2 className="text-sm font-medium">Response {response.status} <span className="text-aihub-muted ml-2">{response.elapsedMs} ms{response.truncated ? ' · First 1 MB' : ''}</span></h2><details className="text-xs text-aihub-muted mt-2"><summary>Response headers</summary><pre className="whitespace-pre-wrap mt-2">{JSON.stringify(response.headers, null, 2)}</pre></details><pre className="text-xs font-mono whitespace-pre-wrap break-all mt-4 p-4 bg-aihub-card rounded-lg">{response.body}</pre></section>}
        </main>
      </div>
    </>}
  </div>
}
