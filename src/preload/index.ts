import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 'darwin' | 'win32' | 'linux' — lets the renderer adapt chrome layout
  // (macOS native traffic lights vs custom window buttons).
  platform: process.platform,
  window: {
    minimize:        () => ipcRenderer.invoke('window:minimize'),
    maximize:        () => ipcRenderer.invoke('window:maximize'),
    close:           () => ipcRenderer.invoke('window:close'),
    isMaximized:     () => ipcRenderer.invoke('window:isMaximized'),
    setTransparency: (m:string) => ipcRenderer.invoke('window:setTransparency', m),
    setOpacity:      (o:number) => ipcRenderer.invoke('window:setOpacity', o),
    detachTab:       (url:string, title?:string) => ipcRenderer.invoke('window:detachTab', url, title),
  },
  gmail: {
    status:         () => ipcRenderer.invoke('gmail:status'),
    connect:        () => ipcRenderer.invoke('gmail:connect'),
    disconnect:     () => ipcRenderer.invoke('gmail:disconnect'),
    setCredentials: (clientId: string, clientSecret: string) => ipcRenderer.invoke('gmail:setCredentials', clientId, clientSecret),
    listThreads:    (q: string, pageToken?: string) => ipcRenderer.invoke('gmail:listThreads', { q, pageToken }),
    getThread:      (id: string) => ipcRenderer.invoke('gmail:getThread', { id }),
    getAttachment:  (messageId: string, attachmentId: string, filename: string) => ipcRenderer.invoke('gmail:getAttachment', { messageId, attachmentId, filename }),
    send:           (opts: any) => ipcRenderer.invoke('gmail:send', opts),
    onConnected:    (cb: (e: { email: string }) => void) => { const h = (_: any, d: any) => cb(d); ipcRenderer.on('gmail:connected', h); return () => ipcRenderer.removeListener('gmail:connected', h) },
  },
  // Modular Google OAuth (Authorization Code + PKCE, system browser). One
  // account, incremental scopes: connect(['gmail','drive','calendar']).
  google: {
    status:         () => ipcRenderer.invoke('google:status'),
    connect:        (apis: string[]) => ipcRenderer.invoke('google:connect', apis),
    disconnect:     () => ipcRenderer.invoke('google:disconnect'),
    setCredentials: (clientId: string, clientSecret: string) => ipcRenderer.invoke('google:setCredentials', clientId, clientSecret),
    onConnected:    (cb: (e: { email: string; apis: string[] }) => void) => { const h = (_: any, d: any) => cb(d); ipcRenderer.on('google:connected', h); return () => ipcRenderer.removeListener('google:connected', h) },
  },
  drive: {
    list:  (q?: string, pageToken?: string) => ipcRenderer.invoke('drive:list', { q, pageToken }),
    about: () => ipcRenderer.invoke('drive:about'),
  },
  calendar: {
    list:   () => ipcRenderer.invoke('calendar:list'),
    events: (args?: { calendarId?: string; timeMin?: string; timeMax?: string; maxResults?: number }) => ipcRenderer.invoke('calendar:events', args || {}),
  },
  bookmarks: {
    getAll:  () => ipcRenderer.invoke('bookmarks:getAll'),
    add:     (b:any)            => ipcRenderer.invoke('bookmarks:add', b),
    remove:  (id:string)        => ipcRenderer.invoke('bookmarks:remove', id),
    update:  (id:string, u:any) => ipcRenderer.invoke('bookmarks:update', id, u),
    export:  (fmt:'json'|'html') => ipcRenderer.invoke('bookmarks:export', fmt),
    import:  ()                 => ipcRenderer.invoke('bookmarks:import'),
  },
  history: {
    getAll:     () => ipcRenderer.invoke('history:getAll'),
    add:        (e:any) => ipcRenderer.invoke('history:add', e),
    clear:      () => ipcRenderer.invoke('history:clear'),
    deleteItem: (id:string) => ipcRenderer.invoke('history:deleteItem', id),
  },
  downloads: {
    getAll:       () => ipcRenderer.invoke('downloads:getAll'),
    clear:        () => ipcRenderer.invoke('downloads:clear'),
    openFile:     (p:string) => ipcRenderer.invoke('downloads:openFile', p),
    showInFolder: (p:string) => ipcRenderer.invoke('downloads:showInFolder', p),
    onUpdate: (cb:(item:any)=>void) => {
      const handler = (_e:any, item:any) => cb(item)
      ipcRenderer.on('download:update', handler)
      return () => ipcRenderer.removeListener('download:update', handler)
    },
  },
  cache:    { clear: () => ipcRenderer.invoke('cache:clear') },
  extStore: {
    load: () => ipcRenderer.invoke('extstore:load'),
    save: (patch: { customExts?: any[]; states?: any }) => ipcRenderer.invoke('extstore:save', patch),
  },
  settings: {
    get:           () => ipcRenderer.invoke('settings:get'),
    set:           (u:any) => ipcRenderer.invoke('settings:set', u),
    getAIConfig:   () => ipcRenderer.invoke('settings:getAIConfig'),
    setAIConfig:   (cfg:any) => ipcRenderer.invoke('settings:setAIConfig', cfg),
  },
  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    pull:   (m:string) => ipcRenderer.invoke('ollama:pull', m),
  },
  brain: {
    getRecommendations:    () => ipcRenderer.invoke('brain:getRecommendations'),
    getProfile:            () => ipcRenderer.invoke('brain:getProfile'),
    refreshRecommendations:() => ipcRenderer.invoke('brain:refreshRecommendations'),
    onRecommendations: (cb:(recs:any)=>void) => {
      const handler = (_e:any, recs:any) => cb(recs)
      ipcRenderer.on('brain:recommendations', handler)
      return () => ipcRenderer.removeListener('brain:recommendations', handler)
    },
  },
  notes: {
    getForUrl:  (url: string) => ipcRenderer.invoke('notes:getForUrl', url),
    saveForUrl: (url: string, notes: any[], pageTitle?: string) => ipcRenderer.invoke('notes:saveForUrl', url, notes, pageTitle),
    getAll:     () => ipcRenderer.invoke('notes:getAll'),
    deleteUrl:  (url: string) => ipcRenderer.invoke('notes:deleteUrl', url),
    deleteNote: (url: string, noteId: string) => ipcRenderer.invoke('notes:deleteNote', url, noteId),
  },
  wifi: {
    scan:    () => ipcRenderer.invoke('wifi:scan'),
    connect: (ssid:string, open?:boolean, password?:string, auth?:string) => ipcRenderer.invoke('wifi:connect', ssid, open, password, auth),
  },
  file: {
    saveMd:    (opts: { title: string; content: string })      => ipcRenderer.invoke('file:saveMd', opts),
    saveImage: (opts: { dataUrl: string; baseName?: string })  => ipcRenderer.invoke('file:saveImage', opts),
    saveVideo: (opts: { buffer: ArrayBuffer })                  => ipcRenderer.invoke('file:saveVideo', opts),
    saveText:  (opts: { filename: string; content: string })   => ipcRenderer.invoke('file:saveText', opts),
    saveZip:   (opts: { filename?: string; files: { path: string; content: string }[] }) => ipcRenderer.invoke('file:saveZip', opts),
  },
  agents: {
    load:               () => ipcRenderer.invoke('agents:load'),
    saveAgent:          (a: any) => ipcRenderer.invoke('agents:saveAgent', a),
    deleteAgent:        (id: string) => ipcRenderer.invoke('agents:deleteAgent', id),
    saveConversation:   (c: any) => ipcRenderer.invoke('agents:saveConversation', c),
    deleteConversation: (id: string) => ipcRenderer.invoke('agents:deleteConversation', id),
  },
  agentFs: {
    listDir:   (p: string) => ipcRenderer.invoke('agentfs:listDir', p),
    readFile:  (p: string) => ipcRenderer.invoke('agentfs:readFile', p),
    writeFile: (p: string, content: string, overwrite?: boolean) => ipcRenderer.invoke('agentfs:writeFile', p, content, overwrite),
    pickDirectory: () => ipcRenderer.invoke('agentfs:pickDirectory'),
    exec: (opts: { command: string; cwd: string; timeoutMs?: number }) => ipcRenderer.invoke('agentfs:exec', opts),
  },
  appInfo: () => ipcRenderer.invoke('app:info'),
  ai: {
    checkDuplicate:     (url:string, e:string[]) => ipcRenderer.invoke('ai:checkDuplicate', url, e),
    categorizeBookmark: (url:string, t:string)   => ipcRenderer.invoke('ai:categorizeBookmark', url, t),
    chat:               (msgs:any[], m?:string, opts?:{preferCloud?:boolean}) => ipcRenderer.invoke('ai:chat', msgs, m, opts),
    summarizePage:      (t:string, url:string)   => ipcRenderer.invoke('ai:summarizePage', t, url),
    getLatestNews:      ()                       => ipcRenderer.invoke('ai:getLatestNews'),
    webSearch:          (query:string)           => ipcRenderer.invoke('ai:webSearch', query),
    fetchPage:          (url:string)             => ipcRenderer.invoke('ai:fetchPage', url),
  },
  vpn: {
    getStatus:   () => ipcRenderer.invoke('vpn:getStatus'),
    setProxy:    (cfg: any) => ipcRenderer.invoke('vpn:setProxy', cfg),
    clearProxy:  () => ipcRenderer.invoke('vpn:clearProxy'),
    getIp:       () => ipcRenderer.invoke('vpn:getIp'),
    freeConnect: (cc: string, name?: string) => ipcRenderer.invoke('vpn:freeConnect', cc, name),
    freeCancel:  () => ipcRenderer.invoke('vpn:freeCancel'),
    onFreeProgress: (cb: (p: any) => void) => {
      const handler = (_e: any, p: any) => cb(p)
      ipcRenderer.on('vpn:freeProgress', handler)
      return () => ipcRenderer.removeListener('vpn:freeProgress', handler)
    },
    onState: (cb: (s: { connected: boolean; config: any }) => void) => {
      const handler = (_e: any, s: any) => cb(s)
      ipcRenderer.on('vpn:state', handler)
      return () => ipcRenderer.removeListener('vpn:state', handler)
    },
  },
  app: {
    isDefaultBrowser:  () => ipcRenderer.invoke('app:isDefaultBrowser'),
    setDefaultBrowser: () => ipcRenderer.invoke('app:setDefaultBrowser'),
  },
  webview: {
    capture:     (wcId: number)                 => ipcRenderer.invoke('webview:capture', wcId),
    execScript:  (wcId: number, script: string) => ipcRenderer.invoke('webview:execScript', wcId, script),
  },
  recorder: {
    getSourceId: (): Promise<string | null> => ipcRenderer.invoke('recorder:getSourceId'),
  },
  tabs: {
    showContextMenu: (info: { tabId?: string; isBrowser: boolean; hasRight: boolean; count: number }): Promise<string> =>
      ipcRenderer.invoke('tabs:showContextMenu', info),
  },
  urlbar: {
    showContextMenu: (hasText: boolean) => ipcRenderer.invoke('urlbar:showContextMenu', hasText),
  },
  tabView: {
    create:          (tabId: string, url: string)                                              => ipcRenderer.invoke('tabview:create', tabId, url),
    destroy:         (tabId: string)                                                            => ipcRenderer.invoke('tabview:destroy', tabId),
    setActive:       (tabId: string | null)                                                      => ipcRenderer.invoke('tabview:setActive', tabId),
    setBounds:       (bounds: { x: number; y: number; width: number; height: number })          => ipcRenderer.invoke('tabview:setBounds', bounds),
    setOverlayHidden:(hidden: boolean)                                                          => ipcRenderer.invoke('tabview:setOverlayHidden', hidden),
    navigate:        (tabId: string, url: string)                                               => ipcRenderer.invoke('tabview:navigate', tabId, url),
    goBack:          (tabId: string)                                                             => ipcRenderer.invoke('tabview:goBack', tabId),
    goForward:       (tabId: string)                                                             => ipcRenderer.invoke('tabview:goForward', tabId),
    reload:          (tabId: string)                                                             => ipcRenderer.invoke('tabview:reload', tabId),
    getNavState:     (tabId: string): Promise<{ canGoBack: boolean; canGoForward: boolean }>     => ipcRenderer.invoke('tabview:getNavState', tabId),
    execJs:          (tabId: string, script: string)                                             => ipcRenderer.invoke('tabview:execJs', tabId, script),
    find:            (tabId: string, text: string, forward?: boolean, findNext?: boolean)        => ipcRenderer.invoke('tabview:find', tabId, text, forward, findNext),
    stopFind:        (tabId: string, action?: string)                                            => ipcRenderer.invoke('tabview:stopFind', tabId, action),
    zoom:            (tabId: string, dir: 'in' | 'out' | 'reset')                                => ipcRenderer.invoke('tabview:zoom', tabId, dir),
    onEvent: (cb: (tabId: string, type: string, payload: any) => void) => {
      const handler = (_e: any, tabId: string, type: string, payload: any) => cb(tabId, type, payload)
      ipcRenderer.on('tabview:event', handler)
      return () => ipcRenderer.removeListener('tabview:event', handler)
    },
  },
  ipc: {
    on: (channel: string, cb: (...args: any[]) => void) => {
      const handler = (_e: any, ...args: any[]) => cb(_e, ...args)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
  },
  updater: {
    check:      () => ipcRenderer.invoke('updater:check'),
    download:   () => ipcRenderer.invoke('updater:download'),
    install:    () => ipcRenderer.invoke('updater:install'),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    onEvent: (cb: (e: any) => void) => {
      const h = (_: any, d: any) => cb(d)
      ipcRenderer.on('updater:event', h)
      return () => ipcRenderer.removeListener('updater:event', h)
    },
  },
  theme: {
    onTransparency: (cb: (mode: string) => void) => {
      const h = (_e: any, mode: string) => cb(mode)
      ipcRenderer.on('theme:transparency', h)
      return () => ipcRenderer.removeListener('theme:transparency', h)
    },
  },
})

export {}
