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
    // Moving a tab BACK: list the other windows, hand one a page, or pull
    // everything into this window.
    list:            () => ipcRenderer.invoke('windows:list'),
    sendTabTo:       (targetId:number, tab:{ url:string; title?:string }) => ipcRenderer.invoke('window:sendTabTo', targetId, tab),
    mergeAllInto:    () => ipcRenderer.invoke('windows:mergeAllInto'),
    onMergeInto:     (cb:(targetId:number)=>void) => {
      const h = (_e:any, targetId:number) => cb(targetId)
      ipcRenderer.on('merge-into-window', h)
      return () => ipcRenderer.removeListener('merge-into-window', h)
    },
  },
  gmail: {
    status:         () => ipcRenderer.invoke('gmail:status'),
    connect:        () => ipcRenderer.invoke('gmail:connect'),
    disconnect:     () => ipcRenderer.invoke('gmail:disconnect'),
    setCredentials: (clientId: string, clientSecret: string) => ipcRenderer.invoke('gmail:setCredentials', clientId, clientSecret),
    listThreads:    (q: string, pageToken?: string) => ipcRenderer.invoke('gmail:listThreads', { q, pageToken }),
    getThread:      (id: string) => ipcRenderer.invoke('gmail:getThread', { id }),
    markRead:       (id: string) => ipcRenderer.invoke('gmail:markRead', { id }),
    markUnread:     (id: string) => ipcRenderer.invoke('gmail:markUnread', { id }),
    setStarred:     (id: string, starred: boolean) => ipcRenderer.invoke('gmail:setStarred', { id, starred }),
    archive:        (id: string) => ipcRenderer.invoke('gmail:archive', { id }),
    trash:          (id: string) => ipcRenderer.invoke('gmail:trash', { id }),
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
  handoff: {
    push:  (tabs: { url: string; title: string }[]) => ipcRenderer.invoke('handoff:push', { tabs }),
    pull:  () => ipcRenderer.invoke('handoff:pull'),
    clear: () => ipcRenderer.invoke('handoff:clear'),
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
  privacy: {
    getDoh: () => ipcRenderer.invoke('privacy:getDoh'),
    setDoh: (provider: string) => ipcRenderer.invoke('privacy:setDoh', provider),
  },
  trading: {
    readChart: (tabId: string) => ipcRenderer.invoke('trading:readChart', tabId),
  },
  backup: {
    // Export hands over the localStorage-only pieces (themes, window styles);
    // everything else the main process reads from disk itself.
    export:  (local: Record<string, string>) => ipcRenderer.invoke('backup:export', local),
    preview: () => ipcRenderer.invoke('backup:preview'),
    apply:   () => ipcRenderer.invoke('backup:apply'),
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    push:   (passphrase: string) => ipcRenderer.invoke('sync:push', passphrase),
    pull:   (passphrase: string) => ipcRenderer.invoke('sync:pull', passphrase),
    clear:  () => ipcRenderer.invoke('sync:clear'),
  },
  containers: {
    list:   () => ipcRenderer.invoke('containers:list'),
    add:    (name: string, color: string) => ipcRenderer.invoke('containers:add', name, color),
    remove: (id: string) => ipcRenderer.invoke('containers:remove', id),
    clear:  (id: string) => ipcRenderer.invoke('containers:clear', id),
  },
  obsidian: {
    status:      () => ipcRenderer.invoke('obsidian:status'),
    chooseVault: () => ipcRenderer.invoke('obsidian:chooseVault'),
    clearVault:  () => ipcRenderer.invoke('obsidian:clearVault'),
    save:        (note: { kind: 'clip' | 'bookmark' | 'answer'; title: string; url?: string; content: string; tags?: string[]; extra?: Record<string, any> }) =>
      ipcRenderer.invoke('obsidian:save', note),
  },
  chat: {
    load:  () => ipcRenderer.invoke('chat:load'),
    save:  (messages: { role: string; content: string }[]) => ipcRenderer.invoke('chat:save', messages),
    clear: () => ipcRenderer.invoke('chat:clear'),
  },
  session: {
    save:        (tabs: any[], activeIndex: number) => ipcRenderer.invoke('session:save', tabs, activeIndex),
    getLast:     () => ipcRenderer.invoke('session:getLast'),
    getPrevious: () => ipcRenderer.invoke('session:getPrevious'),
  },
  workspaces: {
    list:   () => ipcRenderer.invoke('workspace:list'),
    save:   (name: string, tabs: any[], activeIndex: number) => ipcRenderer.invoke('workspace:save', name, tabs, activeIndex),
    get:    (id: string) => ipcRenderer.invoke('workspace:get', id),
    remove: (id: string) => ipcRenderer.invoke('workspace:delete', id),
  },
  adblock: {
    get:         () => ipcRenderer.invoke('adblock:get'),
    setEnabled:  (on: boolean) => ipcRenderer.invoke('adblock:setEnabled', on),
    toggleSite:  (url: string) => ipcRenderer.invoke('adblock:toggleSite', url),
    setCustom:   (domains: string[]) => ipcRenderer.invoke('adblock:setCustom', domains),
    countForTab: (wcId: number) => ipcRenderer.invoke('adblock:countForTab', wcId),
  },
  favicon: {
    get:     (url: string)    => ipcRenderer.invoke('favicon:get', url),
    getMany: (urls: string[]) => ipcRenderer.invoke('favicon:getMany', urls),
  },
  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    pull:   (m:string) => ipcRenderer.invoke('ollama:pull', m),
  },
  community: {
    status:   ()                        => ipcRenderer.invoke('community:status'),
    channels: ()                        => ipcRenderer.invoke('community:channels'),
    join:     (handle: string)          => ipcRenderer.invoke('community:join', handle),
    handleAvailable: (handle: string)   => ipcRenderer.invoke('community:handleAvailable', handle),
    moderatorStatus: ()                 => ipcRenderer.invoke('community:moderatorStatus'),
    reports:  ()                        => ipcRenderer.invoke('community:reports'),
    resolveReport: (args: { messageId: string; action: string; reason?: string }) =>
      ipcRenderer.invoke('community:resolveReport', args),
    setBanned: (args: { memberId: string; banned: boolean; reason?: string }) =>
      ipcRenderer.invoke('community:setBanned', args),
    deleteMessage: (messageId: string)  => ipcRenderer.invoke('community:deleteMessage', messageId),
    deleteMyData: ()                    => ipcRenderer.invoke('community:deleteMyData'),
    messages: (channel: string)         => ipcRenderer.invoke('community:messages', channel),
    post:     (input: any)              => ipcRenderer.invoke('community:post', input),
    react:    (id: string, r: string)   => ipcRenderer.invoke('community:react', id, r),
    block:    (id: string, on: boolean) => ipcRenderer.invoke('community:block', id, on),
    report:   (id: string, why: string) => ipcRenderer.invoke('community:report', id, why),
    resetIdentity: ()                   => ipcRenderer.invoke('community:resetIdentity'),
    exportKey:     ()                   => ipcRenderer.invoke('community:exportKey'),
    importKey:     (v: string)          => ipcRenderer.invoke('community:importKey', v),
    // Push, not polling: the same subscription shape works unchanged once a
    // server is the thing emitting these rather than the local store.
    onMessage: (cb: (p: any) => void) => {
      const handler = (_e: any, p: any) => cb(p)
      ipcRenderer.on('community:message', handler)
      return () => ipcRenderer.removeListener('community:message', handler)
    },
    onStatus: (cb: (p: any) => void) => {
      const handler = (_e: any, p: any) => cb(p)
      ipcRenderer.on('community:status', handler)
      return () => ipcRenderer.removeListener('community:status', handler)
    },
    onRefresh: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('community:refresh', handler)
      return () => ipcRenderer.removeListener('community:refresh', handler)
    },

    // ── Reading the room ───────────────────────────────────────────────────
    snapshot:  ()                       => ipcRenderer.invoke('community:snapshot'),
    categories: ()                      => ipcRenderer.invoke('community:categories'),
    roles:     ()                       => ipcRenderer.invoke('community:roles'),
    permissions: (channel?: string)     => ipcRenderer.invoke('community:permissions', channel),
    history:   (channel: string, before?: string) =>
      ipcRenderer.invoke('community:history', channel, before),
    thread:    (rootId: string)         => ipcRenderer.invoke('community:thread', rootId),
    editMessage: (id: string, body: string) =>
      ipcRenderer.invoke('community:editMessage', id, body),
    search:    (query: string, options?: any) =>
      ipcRenderer.invoke('community:search', query, options),

    // ── Unread and notifications ───────────────────────────────────────────
    markRead:  (channel: string, at?: number) => ipcRenderer.invoke('community:markRead', channel, at),
    unread:    ()                       => ipcRenderer.invoke('community:unread'),
    setNotifPref: (channel: string, level: string) =>
      ipcRenderer.invoke('community:setNotifPref', channel, level),

    // ── Presence and typing ────────────────────────────────────────────────
    heartbeat: (status: string)         => ipcRenderer.invoke('community:heartbeat', status),
    typing:    (channel: string, on: boolean) => ipcRenderer.invoke('community:typing', channel, on),

    // ── Ownership and administration ───────────────────────────────────────
    ownership: ()                       => ipcRenderer.invoke('community:ownership'),
    claimOwnership: ()                  => ipcRenderer.invoke('community:claimOwnership'),
    releaseOwnership: ()                => ipcRenderer.invoke('community:releaseOwnership'),
    createChannel:  (input: any)        => ipcRenderer.invoke('community:createChannel', input),
    updateChannel:  (slug: string, edit: any) => ipcRenderer.invoke('community:updateChannel', slug, edit),
    deleteChannel:  (slug: string)      => ipcRenderer.invoke('community:deleteChannel', slug),
    restoreChannel: (slug: string)      => ipcRenderer.invoke('community:restoreChannel', slug),
    purgeChannel:   (slug: string, confirmSlug: string) =>
      ipcRenderer.invoke('community:purgeChannel', slug, confirmSlug),
    reorderChannels: (order: any[])     => ipcRenderer.invoke('community:reorderChannels', order),
    createCategory: (name: string)      => ipcRenderer.invoke('community:createCategory', name),
    updateCategory: (id: string, name: string) => ipcRenderer.invoke('community:updateCategory', id, name),
    deleteCategory: (id: string)        => ipcRenderer.invoke('community:deleteCategory', id),
    createRole: (input: any)            => ipcRenderer.invoke('community:createRole', input),
    updateRole: (id: string, edit: any) => ipcRenderer.invoke('community:updateRole', id, edit),
    deleteRole: (id: string)            => ipcRenderer.invoke('community:deleteRole', id),
    assignRole: (memberId: string, roleId: string) =>
      ipcRenderer.invoke('community:assignRole', memberId, roleId),
    revokeRole: (memberId: string, roleId: string) =>
      ipcRenderer.invoke('community:revokeRole', memberId, roleId),
    timeoutMember: (args: { memberId: string; durationMs: number; reason?: string }) =>
      ipcRenderer.invoke('community:timeoutMember', args),
    auditLog:  (limit?: number)         => ipcRenderer.invoke('community:auditLog', limit),

    // ── Attachments ────────────────────────────────────────────────────────
    // Bytes, never a path: the renderer hands over contents and gets a record
    // back. It does not choose the filename and never learns the directory.
    uploadAttachment: (name: string, bytes: Uint8Array) =>
      ipcRenderer.invoke('community:uploadAttachment', name, bytes),

    // ── Voice, video and screen share ──────────────────────────────────────
    voiceJoin:  (channel: string)       => ipcRenderer.invoke('community:voice:join', channel),
    voiceLeave: ()                      => ipcRenderer.invoke('community:voice:leave'),
    voiceSignal: (toPeerId: string, payload: any) =>
      ipcRenderer.invoke('community:voice:signal', toPeerId, payload),
    voiceState: (patch: any)            => ipcRenderer.invoke('community:voice:state', patch),
    screenSources: ()                   => ipcRenderer.invoke('community:screenSources'),
    screenShareChoice: (sourceId: string) =>
      ipcRenderer.invoke('community:screenShareChoice', sourceId),

    /**
     * One typed event stream for everything real-time.
     *
     * Replaces the three ad-hoc channels above, which are still forwarded for
     * one version so nothing breaks mid-migration. A single stream means the
     * renderer has one reducer rather than one subscription per event kind.
     */
    onEvent: (cb: (event: any) => void) => {
      const handler = (_e: any, event: any) => cb(event)
      ipcRenderer.on('community:event', handler)
      return () => ipcRenderer.removeListener('community:event', handler)
    },
    onVoicePeers: (cb: (payload: any) => void) => {
      const handler = (_e: any, payload: any) => cb(payload)
      ipcRenderer.on('community:voice:peers', handler)
      return () => ipcRenderer.removeListener('community:voice:peers', handler)
    },
    onVoiceSignal: (cb: (payload: any) => void) => {
      const handler = (_e: any, payload: any) => cb(payload)
      ipcRenderer.on('community:voice:signal', handler)
      return () => ipcRenderer.removeListener('community:voice:signal', handler)
    },
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
  focus: {
    apply: (blocked: string[] | null) => ipcRenderer.invoke('focus:apply', blocked),
  },
  watch: {
    list:     () => ipcRenderer.invoke('watch:list'),
    add:      (w: { url: string; title?: string; mode?: 'change' | 'contains'; keyword?: string; intervalMin?: number }) => ipcRenderer.invoke('watch:add', w),
    remove:   (id: string) => ipcRenderer.invoke('watch:remove', id),
    toggle:   (id: string) => ipcRenderer.invoke('watch:toggle', id),
    rearm:    (id: string) => ipcRenderer.invoke('watch:rearm', id),
    checkNow: (id: string) => ipcRenderer.invoke('watch:checkNow', id),
    onChanged: (cb: () => void) => { const h = () => cb(); ipcRenderer.on('watch:changed', h); return () => ipcRenderer.removeListener('watch:changed', h) },
    onTriggered: (cb: (d: any) => void) => { const h = (_: any, d: any) => cb(d); ipcRenderer.on('watch:triggered', h); return () => ipcRenderer.removeListener('watch:triggered', h) },
  },
  rewind: {
    add:    (entry: { url: string; title?: string; favicon?: string; text?: string }) => ipcRenderer.invoke('rewind:add', entry),
    search: (query: string) => ipcRenderer.invoke('rewind:search', query),
    smartSearch: (query: string) => ipcRenderer.invoke('rewind:smartSearch', query),
    semanticStats: () => ipcRenderer.invoke('semantic:stats'),
    stats:  () => ipcRenderer.invoke('rewind:stats'),
    remove: (id: string) => ipcRenderer.invoke('rewind:remove', id),
    clear:  () => ipcRenderer.invoke('rewind:clear'),
  },
  gospel: {
    /** Gospel music from YouTube. Omit the query for a random tradition. */
    search: (query?: string) => ipcRenderer.invoke('gospel:search', query),
  },
  bible: {
    getMarks: () => ipcRenderer.invoke('bible:getMarks'),
    setMarks: (marks: any, opts?: { allowEmpty?: boolean }) => ipcRenderer.invoke('bible:setMarks', marks, opts),
    getStudy: () => ipcRenderer.invoke('bible:getStudy'),
    setStudy: (study: any, opts?: { allowEmpty?: boolean }) => ipcRenderer.invoke('bible:setStudy', study, opts),
  },
  // Opens a URL in the user's default system browser (or default mail
  // client for mailto:), never inside the app shell. Used by the Bible
  // share sheet to hand social-share links off to the real browser instead
  // of navigating AIHub itself away from the reader.
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  siteMemory: {
    get:    (url: string) => ipcRenderer.invoke('siteMemory:get', url),
    set:    (url: string, text: string, title?: string) => ipcRenderer.invoke('siteMemory:set', url, text, title),
    getAll: () => ipcRenderer.invoke('siteMemory:getAll'),
    onChanged: (cb: (e: { origin: string }) => void) => {
      const h = (_: any, d: any) => cb(d)
      ipcRenderer.on('siteMemory:changed', h)
      return () => ipcRenderer.removeListener('siteMemory:changed', h)
    },
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
    findFiles: (opts: { query: string; root?: string; ext?: string; limit?: number }) => ipcRenderer.invoke('agentfs:findFiles', opts),
    moveFile:  (from: string, to: string, overwrite?: boolean) => ipcRenderer.invoke('agentfs:moveFile', from, to, overwrite),
    pickDirectory: () => ipcRenderer.invoke('agentfs:pickDirectory'),
    exec: (opts: { command: string; cwd: string; timeoutMs?: number }) => ipcRenderer.invoke('agentfs:exec', opts),
  },
  appInfo: () => ipcRenderer.invoke('app:info'),
  ai: {
    checkDuplicate:     (url:string, e:string[]) => ipcRenderer.invoke('ai:checkDuplicate', url, e),
    categorizeBookmark: (url:string, t:string)   => ipcRenderer.invoke('ai:categorizeBookmark', url, t),
    chat:               (msgs:any[], m?:string, opts?:{preferCloud?:boolean; needsTools?:boolean; streamId?:string}) => ipcRenderer.invoke('ai:chat', msgs, m, opts),
    // Partial tokens for the request that passed a matching streamId. The
    // promise from chat() still resolves with the complete text — this is
    // purely so the answer can be shown while it is still being written.
    onChunk: (cb: (c: { streamId: string; delta?: string; reset?: boolean; done?: boolean }) => void) => {
      const handler = (_e: any, c: any) => cb(c)
      ipcRenderer.on('ai:chunk', handler)
      return () => ipcRenderer.removeListener('ai:chunk', handler)
    },
    // Live OpenRouter catalog for the Settings model picker — never a baked-in list.
    models:             (opts?:{filter?:string; refresh?:boolean}) => ipcRenderer.invoke('ai:models', opts),
    routing:            ()                       => ipcRenderer.invoke('ai:routing'),
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
    showMenu:    (countries: { cc: string; name: string }[]): Promise<string> =>
      ipcRenderer.invoke('vpn:showMenu', countries),
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
    showContextMenu: (info: { tabId?: string; isBrowser: boolean; hasRight: boolean; count: number; canSleep?: boolean }): Promise<string> =>
      ipcRenderer.invoke('tabs:showContextMenu', info),
  },
  urlbar: {
    showContextMenu: (hasText: boolean) => ipcRenderer.invoke('urlbar:showContextMenu', hasText),
  },
  tabView: {
    create:          (tabId: string, url: string, containerId?: string | null)                    => ipcRenderer.invoke('tabview:create', tabId, url, containerId),
    destroy:         (tabId: string)                                                            => ipcRenderer.invoke('tabview:destroy', tabId),
    setActive:       (tabId: string | null)                                                      => ipcRenderer.invoke('tabview:setActive', tabId),
    setBounds:       (bounds: { x: number; y: number; width: number; height: number })          => ipcRenderer.invoke('tabview:setBounds', bounds),
    pictureInPicture:(tabId: string)                                                            => ipcRenderer.invoke('tabview:pictureInPicture', tabId),
    captureFullPage: (tabId: string)                                                            => ipcRenderer.invoke('tabview:captureFullPage', tabId),
    getLayout:       ()                                                                         => ipcRenderer.invoke('tabview:getLayout'),
    setSplit:        (tabId: string | null, ratio?: number)                                     => ipcRenderer.invoke('tabview:setSplit', tabId, ratio),
    setOverlayHidden:(hidden: boolean)                                                          => ipcRenderer.invoke('tabview:setOverlayHidden', hidden),
    navigate:        (tabId: string, url: string)                                               => ipcRenderer.invoke('tabview:navigate', tabId, url),
    preconnect:      (url: string)                                                              => ipcRenderer.invoke('tabview:preconnect', url),
    goBack:          (tabId: string)                                                             => ipcRenderer.invoke('tabview:goBack', tabId),
    goForward:       (tabId: string)                                                             => ipcRenderer.invoke('tabview:goForward', tabId),
    reload:          (tabId: string)                                                             => ipcRenderer.invoke('tabview:reload', tabId),
    stop:            (tabId: string)                                                             => ipcRenderer.invoke('tabview:stop', tabId),
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
