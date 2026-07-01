import { useBrowserStore } from '../store/browserStore'

export interface ToolAction {
  tool: string
  [key: string]: any
}

export interface ToolResult {
  [key: string]: any
  error?: string
}

export interface ParsedResponse {
  narration: string
  actions: ToolAction[] | null
}

const ACTIONS_MARKER = '###ACTIONS###'

// Extracts a trailing `###ACTIONS###\n{"actions":[...]}` block from a raw
// model response. Anything before the marker is the user-facing narration;
// the block itself is parsed and stripped. A missing or malformed block
// means "no actions this turn" — never throws.
export function parseActionsBlock(raw: string): ParsedResponse {
  const idx = raw.indexOf(ACTIONS_MARKER)
  if (idx === -1) return { narration: raw.trim(), actions: null }

  const narration = raw.slice(0, idx).trim()
  let jsonPart = raw.slice(idx + ACTIONS_MARKER.length).trim()
  jsonPart = jsonPart.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  try {
    const parsed = JSON.parse(jsonPart)
    if (Array.isArray(parsed?.actions)) {
      return { narration, actions: parsed.actions }
    }
  } catch {
    // fall through — malformed JSON degrades to plain text, never crashes
  }
  return { narration: raw.trim(), actions: null }
}

export function describeAction(a: ToolAction): string {
  switch (a.tool) {
    case 'list_tabs':       return 'Listing open tabs'
    case 'open_tab':        return `Opening ${a.url}`
    case 'close_tab':       return 'Closing tab'
    case 'navigate_tab':    return `Navigating to ${a.url}`
    case 'switch_tab':      return 'Switching tab'
    case 'list_bookmarks':  return 'Listing bookmarks'
    case 'add_bookmark':    return `Bookmarking ${a.title || a.url}`
    case 'remove_bookmark': return 'Removing bookmark'
    case 'read_page':       return 'Reading page content'
    default:                 return `Running ${a.tool}`
  }
}

function deriveTitle(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export interface ToolContext {
  getPageContent?: () => Promise<string>
}

// Executes one parsed action against the existing store/IPC surface. Never
// throws — failures come back as {error} so the model can see and react to
// them on the next loop turn.
export async function executeAction(action: ToolAction, ctx: ToolContext): Promise<ToolResult> {
  const store = useBrowserStore.getState()

  try {
    switch (action.tool) {
      case 'list_tabs': {
        return { tabs: store.tabs.map(t => ({ id: t.id, url: t.url, title: t.title, isHome: t.isHome })) }
      }

      case 'open_tab': {
        if (!action.url) return { error: 'url is required' }
        const tabId = store.addTab(action.url, 'browser')
        return { tabId, url: action.url }
      }

      case 'close_tab': {
        if (!action.tabId) return { error: 'tabId is required' }
        if (!store.tabs.some(t => t.id === action.tabId)) return { error: 'tab not found' }
        store.closeTab(action.tabId)
        return { ok: true }
      }

      case 'navigate_tab': {
        if (!action.tabId || !action.url) return { error: 'tabId and url are required' }
        if (!store.tabs.some(t => t.id === action.tabId)) return { error: 'tab not found' }
        store.updateTab(action.tabId, {
          url: action.url, title: deriveTitle(action.url), isHome: false, isLoading: true, pageType: 'browser',
        })
        window.electronAPI.tabView.navigate(action.tabId, action.url)
        return { ok: true }
      }

      case 'switch_tab': {
        if (!action.tabId) return { error: 'tabId is required' }
        if (!store.tabs.some(t => t.id === action.tabId)) return { error: 'tab not found' }
        store.setActiveTab(action.tabId)
        return { ok: true }
      }

      case 'list_bookmarks': {
        return { bookmarks: store.bookmarks.map(b => ({ id: b.id, url: b.url, title: b.title, category: b.category })) }
      }

      case 'add_bookmark': {
        if (!action.url || !action.title) return { error: 'url and title are required' }
        let category = action.category
        let color = '#60a5fa'
        if (!category) {
          try {
            const cat = await window.electronAPI.ai.categorizeBookmark(action.url, action.title)
            category = cat.category
            color = cat.color
          } catch { category = 'Tools' }
        }
        const favicon = `https://www.google.com/s2/favicons?domain=${action.url}&sz=32`
        const saved = await window.electronAPI.bookmarks.add({
          url: action.url, title: action.title, favicon, category, color,
        })
        store.addBookmark(saved)
        return { id: saved.id }
      }

      case 'remove_bookmark': {
        if (!action.id) return { error: 'id is required' }
        await window.electronAPI.bookmarks.remove(action.id)
        store.removeBookmark(action.id)
        return { ok: true }
      }

      case 'read_page': {
        if (!ctx.getPageContent) return { error: 'no active page to read' }
        const text = await ctx.getPageContent()
        if (!text) return { error: 'page has no readable text' }
        // Sanitize: neutralize any literal ###ACTIONS### marker in page
        // content so a malicious page can't spoof the actions-block protocol
        // when this text gets fed back to the model as a tool result.
        const sanitized = text.replace(/###ACTIONS###/gi, '[ACTIONS marker removed]')
        return { text: sanitized }
      }

      default:
        return { error: `unknown tool "${action.tool}"` }
    }
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

// Appended to the system prompt so the model knows what it can do and the
// exact protocol for doing it. Provider-agnostic on purpose — see the
// design doc's "Tool protocol" section for why this isn't native
// function-calling.
export const AGENT_TOOLS_DOC = `
## Taking actions

You can act on the browser, not just talk. When the user's request needs an
action (opening/closing/navigating tabs, saving or removing bookmarks,
reading the current page's actual text), end your reply with a JSON block
in exactly this format:

###ACTIONS###
{"actions":[{"tool":"open_tab","url":"https://example.com"}]}

Rules:
- Everything BEFORE the ###ACTIONS### marker is shown to the user as your message — briefly say what you're about to do.
- Everything AFTER the marker must be ONLY the JSON object, nothing else.
- You can include multiple actions in one block — they run in order.
- Only include the block when you actually need to act. Plain questions get a plain answer, no block.
- After actions run, you'll be told the results and can respond again — either take more actions or give a final answer (no block = done).

Available tools:
- list_tabs() — no args. Returns open tabs.
- open_tab({url}) — opens a new tab at url.
- close_tab({tabId}) — closes a tab by id (get ids from list_tabs).
- navigate_tab({tabId, url}) — navigates an existing tab to url.
- switch_tab({tabId}) — makes a tab the active one.
- list_bookmarks() — no args. Returns saved bookmarks.
- add_bookmark({url, title, category?}) — saves a bookmark. This is what "save this link/page for me" means — category is optional, auto-detected if omitted.
- remove_bookmark({id}) — deletes a bookmark by id.
- read_page() — returns the visible text of the page in the CURRENT active tab. Use this whenever you need to actually know what a page says (summarizing, answering questions about it, or writing a good bookmark title) rather than guessing from the URL alone.

Example — "open 5 real websites and bookmark them":
I'll open 5 sites and bookmark each one.
###ACTIONS###
{"actions":[
  {"tool":"open_tab","url":"https://news.ycombinator.com"},
  {"tool":"open_tab","url":"https://github.com"},
  {"tool":"open_tab","url":"https://wikipedia.org"},
  {"tool":"open_tab","url":"https://developer.mozilla.org"},
  {"tool":"open_tab","url":"https://arstechnica.com"},
  {"tool":"add_bookmark","url":"https://news.ycombinator.com","title":"Hacker News"},
  {"tool":"add_bookmark","url":"https://github.com","title":"GitHub"},
  {"tool":"add_bookmark","url":"https://wikipedia.org","title":"Wikipedia"},
  {"tool":"add_bookmark","url":"https://developer.mozilla.org","title":"MDN Web Docs"},
  {"tool":"add_bookmark","url":"https://arstechnica.com","title":"Ars Technica"}
]}
`
