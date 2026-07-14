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
    case 'read_tab':        return 'Reading tab content'
    case 'scan_page':       return 'Scanning page elements'
    case 'fill_field':      return `Filling field #${a.elementId}`
    case 'click_element':   return `Clicking element #${a.elementId}`
    case 'wait':            return `Waiting ${a.ms || 1000}ms`
    case 'list_dir':        return `Listing folder ${a.path}`
    case 'read_file':       return `Reading ${a.path}`
    case 'write_file':      return `Writing ${a.path}`
    case 'save_file':       return `Offering ${a.filename || 'file'} for download`
    case 'save_zip':        return `Packaging ${a.filename || 'files'} as ZIP`
    default:                 return `Running ${a.tool}`
  }
}

function deriveTitle(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export interface ToolContext {
  getPageContent?: () => Promise<string>
}

// Neutralize the actions-block marker anywhere inside a tool result so
// untrusted page/file content can't spoof the protocol when the result is
// fed back to the model.
function sanitizeResult<T>(obj: T): T {
  try {
    return JSON.parse(JSON.stringify(obj).replace(/###ACTIONS###/gi, '[ACTIONS marker removed]'))
  } catch { return obj }
}

// ── In-page scripts for tab interaction ────────────────────────────────────
// These run inside the target tab via tabview:execJs. scan_page tags every
// interactive element with data-agent-id so fill/click can address them; the
// ids die on navigation, which is why the doc tells the model to re-scan.

const READ_TAB_SCRIPT = `(() => {
  const text = document.body ? document.body.innerText : ''
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== 'complete',
    text: text.replace(/\\n{3,}/g, '\\n\\n').slice(0, 12000),
  }
})()`

const SCAN_PAGE_SCRIPT = `(() => {
  let n = 0
  const items = []
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const labelFor = (el) => {
    if (el.labels && el.labels[0]) return el.labels[0].innerText.trim().slice(0, 80)
    const aria = el.getAttribute('aria-label'); if (aria) return aria.slice(0, 80)
    if (el.placeholder) return el.placeholder.slice(0, 80)
    const wrap = el.closest('label'); if (wrap) return wrap.innerText.trim().slice(0, 80)
    return (el.name || el.id || '').slice(0, 80)
  }
  document.querySelectorAll('input, textarea, select').forEach(el => {
    if (!visible(el) || el.type === 'hidden' || items.length >= 60) return
    el.setAttribute('data-agent-id', String(++n))
    const item = {
      id: n,
      kind: el.tagName.toLowerCase(),
      type: el.type || '',
      label: labelFor(el),
      value: String(el.value || '').slice(0, 60),
      required: !!el.required,
    }
    if (el.tagName === 'SELECT') item.options = Array.from(el.options).slice(0, 25).map(o => o.text.trim().slice(0, 40))
    if (el.type === 'checkbox' || el.type === 'radio') item.checked = !!el.checked
    items.push(item)
  })
  document.querySelectorAll('button, [role="button"], input[type="submit"], a[href]').forEach(el => {
    if (!visible(el) || items.length >= 110) return
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 60)
    if (!text) return
    el.setAttribute('data-agent-id', String(++n))
    const item = { id: n, kind: el.tagName === 'A' ? 'link' : 'button', label: text }
    if (el.tagName === 'A') item.href = (el.getAttribute('href') || '').slice(0, 150)
    items.push(item)
  })
  return { url: location.href, title: document.title, elements: items }
})()`

function fillFieldScript(elementId: number, value: string): string {
  return `(() => {
  const el = document.querySelector('[data-agent-id="${elementId}"]')
  if (!el) return { error: 'element not found — run scan_page again (ids reset when the page changes)' }
  el.scrollIntoView({ block: 'center' })
  el.focus()
  const val = ${JSON.stringify(value)}
  if (el.tagName === 'SELECT') {
    const opts = Array.from(el.options)
    const opt = opts.find(o => o.text.trim().toLowerCase() === val.toLowerCase() || o.value === val)
      || opts.find(o => o.text.toLowerCase().includes(val.toLowerCase()))
    if (!opt) return { error: 'no option matches "' + val + '"' }
    el.value = opt.value
  } else if (el.type === 'checkbox' || el.type === 'radio') {
    const want = val === 'true' || val === 'checked' || val === 'yes'
    if (el.checked !== want) el.click()
  } else if (el.isContentEditable) {
    el.innerText = val
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(el, val); else el.value = val
  }
  el.dispatchEvent(new Event('input',  { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.blur()
  return { ok: true, nowContains: String(el.value !== undefined ? el.value : el.innerText || '').slice(0, 60) }
})()`
}

function clickElementScript(elementId: number): string {
  return `(() => {
  const el = document.querySelector('[data-agent-id="${elementId}"]')
  if (!el) return { error: 'element not found — run scan_page again (ids reset when the page changes)' }
  el.scrollIntoView({ block: 'center' })
  el.click()
  return { ok: true, clicked: (el.innerText || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 60) }
})()`
}

// Runs an in-page script against a specific tab and flattens the IPC envelope
// ({result}|{error}) into a plain tool result.
async function execInTab(tabId: string, script: string): Promise<ToolResult> {
  const store = useBrowserStore.getState()
  const tab = store.tabs.find(t => t.id === tabId)
  if (!tab) return { error: 'tab not found — use list_tabs to get valid ids' }
  if (tab.isHome || tab.pageType !== 'browser') return { error: 'that tab is not a web page' }
  const res = await window.electronAPI.tabView.execJs(tabId, script)
  if (res?.error) return { error: res.error }
  const out = res?.result
  if (out && typeof out === 'object') return sanitizeResult(out)
  return { value: out ?? null }
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

      case 'read_tab': {
        if (!action.tabId) return { error: 'tabId is required' }
        return await execInTab(action.tabId, READ_TAB_SCRIPT)
      }

      case 'scan_page': {
        if (!action.tabId) return { error: 'tabId is required' }
        return await execInTab(action.tabId, SCAN_PAGE_SCRIPT)
      }

      case 'fill_field': {
        const id = parseInt(action.elementId, 10)
        if (!action.tabId || !Number.isFinite(id)) return { error: 'tabId and elementId are required' }
        if (action.value === undefined || action.value === null) return { error: 'value is required' }
        return await execInTab(action.tabId, fillFieldScript(id, String(action.value)))
      }

      case 'click_element': {
        const id = parseInt(action.elementId, 10)
        if (!action.tabId || !Number.isFinite(id)) return { error: 'tabId and elementId are required' }
        return await execInTab(action.tabId, clickElementScript(id))
      }

      case 'wait': {
        const ms = Math.min(Math.max(parseInt(action.ms, 10) || 1000, 100), 8000)
        await new Promise(r => setTimeout(r, ms))
        return { ok: true, waitedMs: ms }
      }

      case 'list_dir': {
        if (!action.path) return { error: 'path is required' }
        return await window.electronAPI.agentFs.listDir(action.path)
      }

      case 'read_file': {
        if (!action.path) return { error: 'path is required' }
        const res = await window.electronAPI.agentFs.readFile(action.path)
        if (res.text) {
          // Same spoofing defense as read_page — file content is untrusted data
          res.text = res.text.replace(/###ACTIONS###/gi, '[ACTIONS marker removed]')
        }
        return res
      }

      case 'write_file': {
        if (!action.path || typeof action.content !== 'string') return { error: 'path and content are required' }
        return await window.electronAPI.agentFs.writeFile(action.path, action.content, !!action.overwrite)
      }

      case 'save_file': {
        if (!action.filename || typeof action.content !== 'string') return { error: 'filename and content are required' }
        return await window.electronAPI.file.saveText({ filename: action.filename, content: action.content })
      }

      case 'save_zip': {
        if (!Array.isArray(action.files) || action.files.length === 0) return { error: 'files array is required' }
        const files = action.files
          .filter((f: any) => f && typeof f.path === 'string' && typeof f.content === 'string')
        if (files.length === 0) return { error: 'each file needs {path, content}' }
        return await window.electronAPI.file.saveZip({ filename: action.filename, files })
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

Web page interaction (works on ANY open tab — use these to research, fill forms, and apply to things on the user's behalf):
- read_tab({tabId}) — returns the URL, title, and visible text of a specific tab. After open_tab or navigate_tab, call wait then read_tab to see the loaded page. If it returns loading:true or looks empty, wait again and re-read.
- scan_page({tabId}) — lists the interactive elements on that tab's page: form fields (with label, type, current value, required flag, dropdown options), buttons, and links — each with a numeric element id.
- fill_field({tabId, elementId, value}) — fills one field. Works on text inputs, textareas, dropdowns (pass the option text), checkboxes/radios (pass "true"/"false"), and rich-text editors.
- click_element({tabId, elementId}) — clicks a button or link on the page.
- wait({ms}) — pauses up to 8000 ms. Use after navigation, clicks, or form submissions so the page can settle.
IMPORTANT: element ids come from the LAST scan_page and die whenever the page changes — re-scan after every navigation or click that changes the page before filling anything else.

File tools (all paths must be inside the user's home folder; "~" means the home folder, e.g. "~/Documents/Resumes"):
- list_dir({path}) — lists the files and subfolders at a path. Use it to find a document the user mentioned.
- read_file({path}) — reads a text file's content. Also extracts the text from .docx documents (resumes, letters). Use this when asked to review, analyze or improve a document.
- write_file({path, content, overwrite?}) — writes a text file. Refuses to replace an existing file unless overwrite is true — prefer writing to a NEW filename (e.g. "resume-improved.md") instead of overwriting the original.
- save_file({filename, content}) — opens a Save dialog so the user can download a single file you produced (an improved resume, a markdown doc, a script, a CSV…). Use this to deliver your finished work.
- save_zip({filename, files:[{path, content}, …]}) — bundles MULTIPLE generated files into one downloadable ZIP. Use when you produced several code files or documents that belong together.

File rules:
- Only read files/folders the user pointed you at — never browse around out of curiosity, and never send file contents anywhere.
- When you improve a document (like a resume), deliver the result with save_file (or write_file to a new name) and tell the user where it went.
- When you present links, write full URLs (https://…) or markdown links — they render clickable for the user.

Acting on the user's behalf (job applications, sign-ups, any form submission):
1. Get the real facts first — read the user's resume/document with read_file so every field you fill uses REAL data. Never invent names, dates, employers, or qualifications. If a required field's answer isn't in the resume or the chat, ASK the user instead of guessing.
2. To find jobs, navigate directly to search result URLs (e.g. https://www.indeed.com/jobs?q=react+developer&l=remote or https://www.linkedin.com/jobs/search/?keywords=...), wait, read_tab, and present the best matches as clickable links with a one-line reason each. Let the user pick before applying.
3. On an application page: scan_page → fill fields one at a time → scan_page again to verify what the form now contains.
4. NEVER click a final "Submit" / "Apply" / "Send application" button on your own. Stop first, show the user exactly what is about to be submitted (field → value list), and click it only after they confirm in chat.
5. If the page needs a login, a CAPTCHA, or a file upload, tell the user to do that step themselves in the tab, and continue once they say it's done.
6. Report honestly — if a step failed or a site blocks automation, say so and suggest what the user can do manually.

Example — "find my resume and apply to this job", turn 1 (open_tab's result gives you the tabId for later turns):
Reading your resume and opening the application page.
###ACTIONS###
{"actions":[
  {"tool":"read_file","path":"~/Documents/Resumes/resume.docx"},
  {"tool":"open_tab","url":"https://example.com/careers/apply/123"},
  {"tool":"wait","ms":3000}
]}
Turn 2 (results gave tabId "tab-17"): scan_page with that tabId. Turn 3: fill_field each field using real resume data, re-scan to verify, then STOP and ask the user to confirm before clicking the submit button.

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
