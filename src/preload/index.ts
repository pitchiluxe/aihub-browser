import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  window: {
    minimize:        () => ipcRenderer.invoke('window:minimize'),
    maximize:        () => ipcRenderer.invoke('window:maximize'),
    close:           () => ipcRenderer.invoke('window:close'),
    isMaximized:     () => ipcRenderer.invoke('window:isMaximized'),
    setTransparency: (m:string) => ipcRenderer.invoke('window:setTransparency', m),
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
  wifi: {
    scan:    () => ipcRenderer.invoke('wifi:scan'),
    connect: (ssid:string) => ipcRenderer.invoke('wifi:connect', ssid),
  },
  file: {
    saveMd: (opts: { title: string; content: string }) => ipcRenderer.invoke('file:saveMd', opts),
  },
  ai: {
    checkDuplicate:     (url:string, e:string[]) => ipcRenderer.invoke('ai:checkDuplicate', url, e),
    categorizeBookmark: (url:string, t:string)   => ipcRenderer.invoke('ai:categorizeBookmark', url, t),
    chat:               (msgs:any[], m?:string)  => ipcRenderer.invoke('ai:chat', msgs, m),
    summarizePage:      (t:string, url:string)   => ipcRenderer.invoke('ai:summarizePage', t, url),
    getLatestNews:      ()                       => ipcRenderer.invoke('ai:getLatestNews'),
  },
  vpn: {
    getStatus:  () => ipcRenderer.invoke('vpn:getStatus'),
    setProxy:   (cfg: any) => ipcRenderer.invoke('vpn:setProxy', cfg),
    clearProxy: () => ipcRenderer.invoke('vpn:clearProxy'),
    getIp:      () => ipcRenderer.invoke('vpn:getIp'),
  },
  app: {
    isDefaultBrowser:  () => ipcRenderer.invoke('app:isDefaultBrowser'),
    setDefaultBrowser: () => ipcRenderer.invoke('app:setDefaultBrowser'),
  },
  webview: {
    capture:     (wcId: number)                 => ipcRenderer.invoke('webview:capture', wcId),
    execScript:  (wcId: number, script: string) => ipcRenderer.invoke('webview:execScript', wcId, script),
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
  theme: {
    onTransparency: (cb: (mode: string) => void) => {
      const h = (_e: any, mode: string) => cb(mode)
      ipcRenderer.on('theme:transparency', h)
      return () => ipcRenderer.removeListener('theme:transparency', h)
    },
  },
})

export {}
