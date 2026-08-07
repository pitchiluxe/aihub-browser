import { useBrowserStore } from '../store/browserStore'
import { pageTypeForUrl } from './navIntent'

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

// The documented ###ACTIONS### marker, plus the spacing/casing variants models
// produce ("### ACTION ###", "##actions##").
const ACTIONS_MARKER_RE = /#{2,}\s*ACTIONS?\s*#{2,}/i

// Tags models wrap tool calls (or their private reasoning) in. Small local
// models emit whatever their fine-tune used rather than the documented marker,
// so all of these have to be recognised as protocol — never shown as text.
const PROTOCOL_TAGS = [
  'action', 'actions', 'tool', 'tools', 'tool_call', 'tool_calls', 'toolcall',
  'tool_code', 'function_call', 'functioncall', 'invoke', 'antml:invoke',
  'think', 'thinking', 'thought', 'reasoning', 'scratchpad', 'internal',
].join('|')
const TAG_PAIR     = new RegExp(`<(${PROTOCOL_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi')
// An opener the model never closed: everything after it is machine output.
const TAG_UNCLOSED = new RegExp(`<(?:${PROTOCOL_TAGS})\\b[^>]*>[\\s\\S]*$`, 'i')
const TAG_STRAY    = new RegExp(`<\\/?(?:${PROTOCOL_TAGS})\\b[^>]*>`, 'gi')
// Chat-template control tokens: <|im_start|>, <|channel|>, <|eot_id|>,
// [TOOL_CALLS], [INST], <s>, <end_of_turn> …
const CONTROL_TOKENS = /<\|[^|>]*\|>|\[\/?(?:TOOL_CALLS?|INST|OUT|AVAILABLE_TOOLS)\]|<\/?s>|<\/?(?:end|start)_of_turn>|<\/?(?:eos|bos|pad)>/gi

// Every tool executeAction can run. Keep in sync with its switch. Calls that
// name the tool under an aliased key are only accepted when the name is in
// here, so ordinary JSON in a reply — {"name":"Erick","action":"renew"} — is
// never mistaken for a tool call.
const KNOWN_TOOLS = new Set([
  'list_tabs', 'open_tab', 'close_tab', 'navigate_tab', 'switch_tab',
  'list_bookmarks', 'add_bookmark', 'remove_bookmark',
  'read_page', 'web_search', 'read_chart', 'recall_pages', 'fetch_url', 'remember',
  'read_tab', 'scan_page', 'fill_field', 'click_element', 'wait',
  'list_dir', 'read_file', 'write_file', 'find_files', 'move_file',
  'save_file', 'save_zip', 'pick_directory', 'exec_command',
])

// Only "tool" is documented, but a model reaches for whatever key its
// fine-tune used — "action", OpenAI's "name"/"arguments", a nested
// "function". An unrecognised key used to mean the call was neither run nor
// stripped, so the user saw raw JSON and nothing happened.
// Models generalise the documented ###ACTIONS### marker into a per-tool
// marker of their own — "###SCAN_PAGE###", "###FILL_FIELD### telephone
// 555-0142" — and emit that instead of JSON. Only names in KNOWN_TOOLS count
// and the closing hashes are required, so a markdown heading ("### Overview",
// "### fill_field explained") is never mistaken for a call. Group 2 is the
// argument tail, which always ends at the line break.
const HASH_CALL_RE = new RegExp(
  `^[ \\t]*#{2,}[ \\t]*(${[...KNOWN_TOOLS].join('|')})[ \\t]*#{2,}[ \\t]*(.*?)[ \\t]*(?:\\r?\\n|$)`,
  'gim',
)

// Single-word tools ("remember", "wait") collide with closed-ATX markdown
// headings — "## Remember ##" is prose, "###REMEMBER###" is a call. A machine
// marker is written the way the doc writes it: all caps, or snake_case.
const isHashCall = (name: string): boolean =>
  name.includes('_') || name === name.toUpperCase()

// Where a hash call's unnamed arguments go, in the order models write them.
// The last entry absorbs the rest of the line, so a value with spaces
// ("Leave at front desk") survives intact.
const POSITIONAL_ARGS: Record<string, string[]> = {
  open_tab: ['url'], close_tab: ['tabId'], switch_tab: ['tabId'], navigate_tab: ['tabId', 'url'],
  add_bookmark: ['url', 'title'], remove_bookmark: ['id'],
  web_search: ['query'], recall_pages: ['query'], find_files: ['query'], fetch_url: ['url'],
  remember: ['text'], wait: ['ms'],
  fill_field: ['elementId', 'value'], click_element: ['elementId'],
  list_dir: ['path'], read_file: ['path'],
}

const NAME_KEYS = ['tool', 'action', 'name', 'tool_name', 'function', 'function_name', 'recipient_name']
const ARG_KEYS  = ['arguments', 'parameters', 'params', 'args', 'input', 'tool_input', 'action_input']
const LIST_KEYS = ['actions', 'tool_calls', 'toolcalls', 'tools', 'calls', 'steps']
// Cheap prefilter — "name" is common enough in ordinary JSON that the
// KNOWN_TOOLS check downstream, not this regex, is what prevents false hits.
const ACTION_KEY_RE = new RegExp(`"(?:${[...NAME_KEYS, ...LIST_KEYS].join('|')})"\\s*:`, 'i')

// Placeholder-protect fenced blocks and inline code so a user's own HTML,
// template tags or JSON survive the strippers below untouched.
const protectCode = (text: string): { text: string; blocks: string[] } => {
  const blocks: string[] = []
  const out = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, block => {
    blocks.push(block)
    return `%%__CODE${blocks.length - 1}__%%`
  })
  return { text: out, blocks }
}
const restoreCode = (text: string, blocks: string[]): string =>
  text.replace(/%%__CODE(\d+)__%%/g, (_m, i) => blocks[Number(i)] ?? '')

/**
 * Strip every trace of the machine protocol from user-facing text: the marker,
 * XML-style tool tags and their contents, chat-template control tokens, and
 * bare action JSON. Code the user asked for is protected and comes back
 * verbatim. The chat should only ever show prose.
 */
export function cleanNarration(text: string): string {
  // Everything from the marker onward is machine protocol — drop it.
  const marker = text.match(ACTIONS_MARKER_RE)
  let out = marker ? text.slice(0, text.indexOf(marker[0])) : text

  // A fenced block that carries an action call is protocol, not an example.
  out = out.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, body) =>
    toActions(tryParseLoose(stripFences(body))) ? '' : block)

  const { text: masked, blocks } = protectCode(out)
  out = masked

  // Control tokens become a space so "<|channel|>analysis" doesn't fuse into
  // the next word; runs of spaces mid-line collapse back afterwards.
  out = out.replace(CONTROL_TOKENS, ' ')
  out = out.replace(TAG_PAIR, '')
  out = out.replace(TAG_UNCLOSED, '')
  out = out.replace(TAG_STRAY, '')
  // "###FILL_FIELD### telephone 555-0142" — the whole line is protocol.
  out = out.replace(HASH_CALL_RE, (line, name) => isHashCall(name) ? '' : line)

  // Bare action JSON the model emitted with no marker and no tags.
  out = stripActionJson(out)
  // A call the model cut off mid-object never balances, so stripActionJson
  // can't find its end — drop from the opening brace onward.
  out = out.replace(/\{\s*"tool"\s*:\s*"[^"]*"[^{}]*$/, '')

  out = restoreCode(out, blocks)
  out = out.replace(/(?<=\S) {2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

// Best-effort repair of the almost-JSON models sometimes emit: trailing commas,
// and truncated output missing its closing brackets/braces (a streaming cut-off
// or the model just stopping mid-object). Returns null if it still won't parse.
function tryParseLoose(src: string): any {
  const attempts: string[] = [src]
  const noTrailingComma = src.replace(/,\s*([}\]])/g, '$1')
  if (noTrailingComma !== src) attempts.push(noTrailingComma)
  // Balance brackets by appending whatever closers are missing, in the right
  // order (stack-based), for each candidate.
  for (const base of [src, noTrailingComma]) {
    const stack: string[] = []
    let inStr = false, esc = false
    for (const ch of base) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{' || ch === '[') stack.push(ch)
      else if (ch === '}' || ch === ']') stack.pop()
    }
    if (stack.length) {
      let repaired = base
      if (inStr) repaired += '"'
      for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i] === '{' ? '}' : ']'
      attempts.push(repaired)
    }
  }
  for (const a of attempts) {
    try { return JSON.parse(a) } catch { /* try next */ }
  }
  return null
}

// Normalize one call object into {tool, ...args}, whatever key the model used
// for the tool name and wherever it put the arguments:
//   {"tool":"scan_page","tabId":"t1"}                       ← documented
//   {"action":"scan_page","tabId":"t1"}                     ← alias key
//   {"name":"scan_page","arguments":{"tabId":"t1"}}         ← OpenAI shape
//   {"function":{"name":"scan_page","arguments":"{…}"}}     ← nested, args as a string
// Returns null when it isn't a tool call at all.
function normalizeCall(raw: any, depth = 0): ToolAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 2) return null

  const lower: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v

  // A call nested under one of the name keys — unwrap it and use that.
  for (const k of NAME_KEYS) {
    const nested = lower[k] && typeof lower[k] === 'object' ? normalizeCall(lower[k], depth + 1) : null
    if (nested) return nested
  }

  let tool: string | null = null
  let aliased = false
  for (const k of NAME_KEYS) {
    if (typeof lower[k] === 'string' && lower[k].trim()) {
      tool = lower[k].trim()
      aliased = k !== 'tool'
      break
    }
  }
  if (!tool) return null
  // "tool" is the documented key, so an unknown name there is a typo worth
  // reporting back to the model. An aliased key naming something we can't run
  // is far more likely to be ordinary JSON — leave it as prose.
  if (aliased && !KNOWN_TOOLS.has(tool)) return null

  // Arguments sit inline on the object, or nested under an arg key as an
  // object or as a JSON string.
  const args: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase()
    if (NAME_KEYS.includes(key) || ARG_KEYS.includes(key)) continue
    args[k] = v
  }
  for (const k of ARG_KEYS) {
    let v = lower[k]
    if (typeof v === 'string') { try { v = JSON.parse(v) } catch { continue } }
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(args, v)
  }
  return { ...args, tool }
}

// Normalize any of the shapes models actually produce into an actions array:
// a wrapper object holding a list ({"actions":[…]}, {"tool_calls":[…]}), a
// bare array of calls, or a single bare call.
function toActions(parsed: any): ToolAction[] | null {
  if (!parsed) return null
  if (Array.isArray(parsed)) {
    const calls = parsed.map(x => normalizeCall(x))
    // All-or-nothing: a partial match means this array is probably data.
    return calls.length && calls.every(Boolean) ? calls as ToolAction[] : null
  }
  if (typeof parsed !== 'object') return null
  for (const k of Object.keys(parsed)) {
    if (!LIST_KEYS.includes(k.toLowerCase()) || !Array.isArray(parsed[k])) continue
    const calls = toActions(parsed[k])
    if (calls) return calls
  }
  const single = normalizeCall(parsed)
  return single ? [single] : null
}

// Remove every balanced JSON value in `text` that is a tool call, leaving the
// prose around it. This is what keeps `{"action":"scan_page"}` out of the
// chat — matching on parse rather than on a key-name regex means any shape
// toActions can run is also a shape cleanNarration can strip.
function stripActionJson(text: string): string {
  if (!ACTION_KEY_RE.test(text)) return text
  let out = '', i = 0, tried = 0
  while (i < text.length) {
    const ch = text[i]
    if ((ch === '{' || ch === '[') && tried < MAX_JSON_CANDIDATES) {
      tried++
      const slice = balancedSlice(text, i)
      const actions = toActions(tryParseLoose(slice))
      if (actions && actions.length) { i += slice.length; continue }
    }
    out += ch
    i++
  }
  return out
}

// A tail of `key=value` pairs and nothing else — "elementId=4 value="Test"".
const KV_TAIL_RE   = /^(?:[a-zA-Z_][\w-]*\s*=\s*(?:"[^"]*"|'[^']*'|\S+)\s*)+$/
const KV_PAIR_RE   = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g

// Turn the text after a hash tag into arguments. Three shapes, because models
// pick whichever one they feel like: a JSON object, `key=value` pairs, or bare
// positional values in the order POSITIONAL_ARGS lists them.
function parseHashArgs(tool: string, tail: string): Record<string, any> {
  const rest = tail.trim()
  if (!rest) return {}

  if (rest.startsWith('{')) {
    const parsed = tryParseLoose(balancedSlice(rest, 0))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  }

  if (KV_TAIL_RE.test(rest)) {
    const args: Record<string, any> = {}
    for (const m of rest.matchAll(KV_PAIR_RE)) args[m[1]] = m[2] ?? m[3] ?? m[4]
    return args
  }

  const slots = POSITIONAL_ARGS[tool]
  if (!slots || !slots.length) return {}
  const args: Record<string, any> = {}
  let remaining = rest
  for (let i = 0; i < slots.length; i++) {
    if (!remaining) break
    // The last slot takes everything left, so a value with spaces stays whole.
    if (i === slots.length - 1) { args[slots[i]] = remaining; break }
    const sp = remaining.search(/\s/)
    if (sp === -1) { args[slots[i]] = remaining; remaining = ''; break }
    args[slots[i]] = remaining.slice(0, sp)
    remaining = remaining.slice(sp + 1).trim()
  }
  return args
}

// Every hash-wrapped call in the response, in order. Null when there are none,
// so callers can fall through to the other protocol shapes.
function parseHashCalls(raw: string): ToolAction[] | null {
  const actions: ToolAction[] = []
  for (const m of raw.matchAll(HASH_CALL_RE)) {
    if (!isHashCall(m[1])) continue
    const tool = m[1].toLowerCase()
    actions.push({ ...parseHashArgs(tool, m[2] || ''), tool })
  }
  return actions.length ? actions : null
}

// Extracts the action block from a raw model response. Anything before the
// marker is the user-facing narration; the block is parsed and stripped. This
// is deliberately forgiving — it recognizes the marker OR a bare JSON action
// object even without it, repairs truncated/loose JSON, and accepts every
// shape models emit — so a mis-formatted tool call still EXECUTES instead of
// being printed. It never throws and never leaks the JSON to the chat.
export function parseActionsBlock(raw: string): ParsedResponse {
  const narration = cleanNarration(raw)

  // 1) The documented path: text after the ###ACTIONS### marker.
  const marker = raw.match(ACTIONS_MARKER_RE)
  if (marker) {
    const start = raw.indexOf(marker[0]) + marker[0].length
    const jsonPart = stripFences(raw.slice(start))
    const actions = findActionJson(jsonPart)
    if (actions) return { narration, actions }
    return { narration, actions: parseHashCalls(raw) }
  }

  // 2) The call came wrapped in a tag (<ACTION>…</ACTION>, <tool_call>…) —
  //    run what's inside instead of printing it.
  const tagged = raw.match(new RegExp(`<(?:${PROTOCOL_TAGS})\\b[^>]*>([\\s\\S]*)`, 'i'))
  if (tagged) {
    const actions = findActionJson(stripFences(tagged[1]))
    if (actions) return { narration, actions }
  }

  // 3) No marker, no tags, but the model still emitted a JSON action call
  //    somewhere (a common mistake) — run it rather than print it.
  const actions = findActionJson(raw)
  if (actions) return { narration, actions }

  // 4) The model invented its own per-tool marker ("###SCAN_PAGE###"). It is
  //    still unambiguously a call — run it rather than print it.
  return { narration, actions: parseHashCalls(raw) }
}

const stripFences = (s: string): string =>
  s.trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim()

// Walk out a balanced {...} / [...] starting at `from`, string-aware. Returns
// the rest of the text when it never closes — tryParseLoose repairs those.
function balancedSlice(text: string, from: number): string {
  let depth = 0, inStr = false, esc = false
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return text.slice(from, i + 1)
    }
  }
  return text.slice(from)
}

// Find the first JSON value in `text` that is an action call, ignoring any
// prose or leftover tags around it. Bounded so a long code answer can't turn
// this into a quadratic scan.
const MAX_JSON_CANDIDATES = 20
function findActionJson(text: string): ToolAction[] | null {
  if (!ACTION_KEY_RE.test(text)) return null
  let tried = 0
  for (let i = 0; i < text.length && tried < MAX_JSON_CANDIDATES; i++) {
    const ch = text[i]
    if (ch !== '{' && ch !== '[') continue
    tried++
    const actions = toActions(tryParseLoose(balancedSlice(text, i)))
    if (actions && actions.length) return actions
  }
  return null
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
    case 'web_search':      return `Searching the web: "${String(a.query || '').slice(0, 50)}"`
    case 'recall_pages':    return `Searching pages you've read: "${String(a.query || '').slice(0, 50)}"`
    case 'read_chart':      return 'Reading the live chart on screen'
    case 'remember':        return 'Saving to this site’s memory'
    case 'fetch_url':       return `Fetching ${String(a.url || '').slice(0, 60)}`
    case 'read_tab':        return 'Reading tab content'
    case 'scan_page':       return 'Scanning page elements'
    case 'fill_field':      return `Filling field ${elementRef(a) || '?'}`
    case 'click_element':   return `Clicking element ${elementRef(a) || '?'}`
    case 'wait':            return `Waiting ${a.ms || 1000}ms`
    case 'list_dir':        return `Listing folder ${a.path}`
    case 'find_files':      return `Searching your files for "${String(a.query || '').slice(0, 40)}"`
    case 'move_file':       return `Moving ${a.from} → ${a.to}`
    case 'read_file':       return `Reading ${a.path}`
    case 'write_file':      return `Writing ${a.path}`
    case 'save_file':       return `Offering ${a.filename || 'file'} for download`
    case 'save_zip':        return `Packaging ${a.filename || 'files'} as ZIP`
    case 'pick_directory':  return 'Asking you to choose a folder'
    case 'exec_command':    return `Running: ${String(a.command || '').slice(0, 60)}`
    default:                 return `Running ${a.tool}`
  }
}

function deriveTitle(url: string): string {
  const page = pageTypeForUrl(url)
  if (page !== 'browser') return page.charAt(0).toUpperCase() + page.slice(1)
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export interface ToolContext {
  getPageContent?: () => Promise<string>
  /** Renders an Approve/Deny card in the chat and resolves with the user's
   *  choice. exec_command is refused outright when this isn't provided. */
  confirmExec?: (command: string, cwd: string) => Promise<boolean>
  /** URL of the active tab — lets `remember` scope memory to this site. */
  currentUrl?: string
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

export const SCAN_PAGE_SCRIPT = `(() => {
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

// Resolves whatever the model called the element: a scan_page id, or — when it
// skipped scan_page and named the field the way the page does — a label, name,
// id, placeholder or aria-label. Shared by fill_field and click_element.
const RESOLVE_EL_FN = `
  const norm = (s) => String(s || '').toLowerCase().replace(/[_\\s-]+/g, ' ').trim()
  const seen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  // A control's own text IS its name ("Place order"); a data-entry field's
  // value is live user content and must never be treated as one — a select
  // holding "l" would otherwise answer to any request containing an l.
  const isControl = (el) => el.tagName === 'BUTTON' || el.tagName === 'A'
    || el.getAttribute('role') === 'button' || el.type === 'submit' || el.type === 'button'
  const namesOf = (el) => [
    el.getAttribute('data-agent-id'), el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
    el.labels && el.labels[0] && el.labels[0].innerText,
    el.closest('label') && el.closest('label').innerText,
  ].concat(isControl(el) ? [el.innerText, el.value] : []).filter(Boolean).map(norm)
  const resolveEl = (ref, selector) => {
    const byId = document.querySelector('[data-agent-id="' + String(ref).replace(/"/g, '') + '"]')
    if (byId) return byId
    const want = norm(ref)
    if (!want) return null
    const els = Array.from(document.querySelectorAll(selector)).filter(el => seen(el) && el.type !== 'hidden')
    const exact = els.find(el => namesOf(el).some(n => n === want))
    if (exact) return exact
    // Substring matching needs a length floor on BOTH sides: a two-character
    // name is a substring of half the page and would match by accident.
    if (want.length < 3) return null
    return els.find(el => namesOf(el).some(n => n.length >= 3 && (n.includes(want) || want.includes(n)))) || null
  }`

export function fillFieldScript(ref: string, value: string): string {
  return `(() => {${RESOLVE_EL_FN}
  const ref = ${JSON.stringify(ref)}
  const el = resolveEl(ref, 'input, textarea, select, [contenteditable="true"]')
  if (!el) return { error: 'no field matches ' + JSON.stringify(ref) + ' — run scan_page and use the numeric id it returns' }
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

export function clickElementScript(ref: string): string {
  return `(() => {${RESOLVE_EL_FN}
  const ref = ${JSON.stringify(ref)}
  const el = resolveEl(ref, 'button, [role="button"], input[type="submit"], input[type="button"], a[href], [data-agent-id]')
  if (!el) return { error: 'nothing matches ' + JSON.stringify(ref) + ' — run scan_page and use the numeric id it returns' }
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

// The tab a page action targets. "Scan this page" carries no tab id — the
// model would have to call list_tabs first to learn one, and when it doesn't,
// every page tool used to fail outright. The active tab IS "this page".
const targetTab = (action: ToolAction): string | undefined =>
  action.tabId || useBrowserStore.getState().activeTabId || undefined

// How the model referred to an element — a scan_page id, or the field's own
// label/name when it never scanned. The page resolves either (see RESOLVE_EL_FN).
const elementRef = (action: ToolAction): string =>
  String(action.elementId ?? action.label ?? action.field ?? action.selector ?? '').trim()

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
        // aihub:// targets are the app's own pages — they render in React and
        // have no BrowserView, so they must carry their pageType.
        const tabId = store.addTab(action.url, pageTypeForUrl(action.url))
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
        const pageType = pageTypeForUrl(action.url)
        store.updateTab(action.tabId, {
          url: action.url, title: deriveTitle(action.url), isHome: false, isLoading: pageType === 'browser', pageType,
        })
        // In-app pages have no BrowserView to drive — the store update above is
        // the whole navigation.
        if (pageType === 'browser') window.electronAPI.tabView.navigate(action.tabId, action.url)
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
        // Main refuses protected bookmarks; report that back rather than
        // dropping it from the store and claiming success.
        if (!await window.electronAPI.bookmarks.remove(action.id)) {
          return { error: 'that bookmark is protected and cannot be removed' }
        }
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

      case 'web_search': {
        if (!action.query) return { error: 'query is required' }
        const res = await window.electronAPI.ai.webSearch(String(action.query))
        return sanitizeResult(res)
      }

      case 'read_chart': {
        // Reads the REAL chart in the active tab: symbol, timeframe, the bar's
        // actual OHLC, the quote, the watchlist — plus computed levels and a
        // plan. This is what makes chart answers factual instead of invented.
        const store = useBrowserStore.getState()
        const tabId = action.tabId || store.activeTabId
        if (!tabId) return { error: 'no active tab' }
        const res = await window.electronAPI.trading.readChart(String(tabId))
        if (!res?.ok) return { error: res?.error || 'could not read the chart' }
        return sanitizeResult({
          summary: res.summary,
          symbol: res.reading.symbol,
          name: res.reading.name,
          exchange: res.reading.exchange,
          interval: res.reading.interval,
          bar: res.reading.ohlc,
          price: res.reading.price,
          change: res.reading.change,
          changePercent: res.reading.changePercent,
          sessionTime: res.reading.sessionTime,
          watchlist: res.reading.watchlist,
          barsRead: res.analysis && res.analysis.barsRead,
          trend: res.analysis && res.analysis.trend,
          bracket: res.analysis && res.analysis.bracket,
          analysis: res.analysis && {
            bias: res.analysis.bias,
            reasoning: res.analysis.reasoning,
            rangePosition: res.analysis.rangePosition,
            range: res.analysis.range,
            levels: res.analysis.levels,
            plan: res.analysis.plan,
            limits: res.analysis.limits,
          },
        })
      }

      case 'recall_pages': {
        if (!action.query) return { error: 'query is required' }
        // Meaning-based search over the pages this user has actually read
        // (Rewind archive, embedded locally). Falls back to word matching when
        // no embedding model is installed, so it always returns something
        // usable rather than failing.
        const res = await window.electronAPI.rewind.smartSearch(String(action.query))
        const results = (res?.results || []).slice(0, 6).map((r: any) => ({
          title: r.title, url: r.url, when: r.ts ? new Date(r.ts).toISOString().slice(0, 10) : undefined,
          snippet: String(r.snippet || '').slice(0, 240),
        }))
        if (!results.length) {
          return { results: [], note: 'Nothing in this user’s reading history matches. Use web_search instead.' }
        }
        return sanitizeResult({ results, matchedBy: res?.semantic ? 'meaning' : 'words' })
      }

      case 'fetch_url': {
        if (!action.url) return { error: 'url is required' }
        const res = await window.electronAPI.ai.fetchPage(String(action.url))
        return sanitizeResult(res)
      }

      case 'remember': {
        const text = String(action.text || '').trim()
        if (!text) return { error: 'text is required — what should I remember?' }
        const url = ctx.currentUrl
        if (!url || !/^https?:\/\//i.test(url)) return { error: 'no website open to attach this memory to' }
        try {
          const existing = await (window.electronAPI as any).siteMemory.get(url)
          const next = existing ? `${existing}\n- ${text}` : `- ${text}`
          await (window.electronAPI as any).siteMemory.set(url, next)
          return { ok: true, remembered: text }
        } catch (e: any) { return { error: e?.message || String(e) } }
      }

      case 'read_tab': {
        const tabId = targetTab(action)
        if (!tabId) return { error: 'no tab is open' }
        return await execInTab(tabId, READ_TAB_SCRIPT)
      }

      case 'scan_page': {
        const tabId = targetTab(action)
        if (!tabId) return { error: 'no tab is open' }
        return await execInTab(tabId, SCAN_PAGE_SCRIPT)
      }

      case 'fill_field': {
        const tabId = targetTab(action)
        if (!tabId) return { error: 'no tab is open' }
        // A model that skipped scan_page names the field the way the page does
        // ("customer_name", "Telephone") instead of by id. The page can resolve
        // that itself, so accept it rather than failing the whole form.
        const ref = elementRef(action)
        if (!ref) return { error: 'elementId is required — run scan_page to get one' }
        if (action.value === undefined || action.value === null) return { error: 'value is required' }
        return await execInTab(tabId, fillFieldScript(ref, String(action.value)))
      }

      case 'click_element': {
        const tabId = targetTab(action)
        if (!tabId) return { error: 'no tab is open' }
        const ref = elementRef(action)
        if (!ref) return { error: 'elementId is required — run scan_page to get one' }
        return await execInTab(tabId, clickElementScript(ref))
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

      case 'find_files': {
        if (!action.query) return { error: 'query is required' }
        return await window.electronAPI.agentFs.findFiles({
          query: String(action.query), root: action.root, ext: action.ext, limit: action.limit,
        })
      }

      case 'move_file': {
        if (!action.from || !action.to) return { error: 'from and to are required' }
        return await window.electronAPI.agentFs.moveFile(String(action.from), String(action.to), !!action.overwrite)
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

      case 'pick_directory': {
        // Native dialog — the user, not the model, chooses the folder.
        return await window.electronAPI.agentFs.pickDirectory()
      }

      case 'exec_command': {
        if (!action.command || typeof action.command !== 'string') return { error: 'command is required' }
        if (!action.cwd || typeof action.cwd !== 'string') return { error: 'cwd is required — use the folder from pick_directory' }
        if (!ctx.confirmExec) return { error: 'command execution is not available in this context' }
        const approved = await ctx.confirmExec(action.command, action.cwd)
        if (!approved) return { error: 'the user declined to run this command' }
        const res = await window.electronAPI.agentFs.exec({
          command: action.command, cwd: action.cwd, timeoutMs: action.timeoutMs,
        })
        // Command output is untrusted data — same spoof defense as read_page
        return sanitizeResult(res)
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
- The key naming the tool is "tool". Not "action", not "name", not "function".
- Only include the block when you actually need to act. Plain questions get a plain answer, no block.
- After actions run, you'll be told the results and can respond again — either take more actions or give a final answer (no block = done).
- NEVER use XML-style tags for this. No <ACTION>, <action>, <tool_call>, <function_call>, <invoke>, <think>, <reasoning> or any other tag wrapper — the marker above is the only accepted format, and tags are shown to the user as broken text.
- NEVER invent a marker per tool. \`###SCAN_PAGE###\`, \`###FILL_FIELD### telephone 555-0142\` and anything shaped like them are wrong: there is exactly ONE marker, \`###ACTIONS###\`, and JSON follows it.
- The part the user reads must be plain prose and markdown only: no tags, no control tokens, no JSON, no mention of tools or of this protocol. Code the user asked for belongs in a fenced code block.

Available tools:
- list_tabs() — no args. Returns open tabs.
- open_tab({url}) — opens a new tab at url. Use the exact bookmark URL: an aihub:// URL (aihub://bible, aihub://mail, aihub://notes …) opens that page inside AIHub; a normal https URL opens the website.
- close_tab({tabId}) — closes a tab by id (get ids from list_tabs).
- navigate_tab({tabId, url}) — navigates an existing tab to url.
- switch_tab({tabId}) — makes a tab the active one.
- list_bookmarks() — no args. Returns saved bookmarks.
- add_bookmark({url, title, category?}) — saves a bookmark. This is what "save this link/page for me" means — category is optional, auto-detected if omitted.
- remove_bookmark({id}) — deletes a bookmark by id.
- read_page() — returns the visible text of the page in the CURRENT active tab. Use this whenever you need to actually know what a page says (summarizing, answering questions about it, or writing a good bookmark title) rather than guessing from the URL alone.
- remember({text}) — saves a durable note about the CURRENT website (scoped to its origin) so you recall it on future visits. Use it whenever the user tells you something to keep about a site ("remember my seat is 14C", "my account number here is …", "I prefer the dark theme on this site"). Any memory you've saved for the current site is shown to you at the top of this prompt under "What you remember about this site" — use it naturally, and don't ask again for things you already know.

Research tools (fast — no tab needed; prefer these for questions about current events, prices, comparisons, or anything you're not sure about):
- web_search({query}) — live web search. Returns up to 8 results with title, url, and snippet. NEVER guess or say "I can't browse the internet" — search instead.
- read_chart() — reads the LIVE chart open in the active tab, INCLUDING its real candle history taken straight from TradingView's own chart runtime (hundreds of bars — literally the data the chart is drawing). Returns: symbol, exchange, timeframe, the current bar, ATR, market-structure bias, EMA trend context, real institutional levels (prior-day high/low/close, swing highs and lows, session extremes, round numbers), a full trade plan (entry zone, stop, targets with reward-to-risk, invalidation), and — when structure has NOT confirmed a direction — a bracket holding BOTH scenarios: the level that triggers a long and the level that triggers a short, each with its own stop and targets. When a bracket comes back, present both sides as an if/then with the prices; never answer only "wait and see". ALWAYS call this before answering ANY question about a chart, symbol, trend or trade, and take every number you state from what it returned.
- recall_pages({query}) — searches the pages THIS USER has actually read (their own Rewind archive), by meaning rather than keywords. Use it FIRST whenever the question refers to something they saw before: "that article about X", "the page I read yesterday", "where did I read about Y". It answers questions the web cannot, because only this machine knows what they read. Returns title, url, date and a snippet — cite the page you used.
- fetch_url({url}) — downloads a page's readable text (plus its title) WITHOUT opening a visible tab. Use it to read search results, articles, and docs during research. Only open_tab when the user should actually SEE the page.

Research workflow for "research X / compare X / what's the latest on X":
1. web_search with 1-3 focused queries (different angles).
2. fetch_url the 2-4 most promising results to read the actual content.
3. Synthesize into a well-structured answer: sections, a comparison table when comparing anything, and a "Sources" list of markdown links at the end. Never present a source you didn't actually fetch or see in search results.

Web page interaction (works on ANY open tab — use these to research, fill forms, and apply to things on the user's behalf). tabId is OPTIONAL on all four: leave it out and the tool acts on the tab the user is looking at, which is what "this page" / "this form" means. Only pass a tabId when you're targeting some OTHER tab you got from list_tabs or open_tab:
- read_tab({tabId}) — returns the URL, title, and visible text of a specific tab. After open_tab or navigate_tab, call wait then read_tab to see the loaded page. If it returns loading:true or looks empty, wait again and re-read.
- scan_page({tabId}) — lists the interactive elements on that tab's page: form fields (with label, type, current value, required flag, dropdown options), buttons, and links — each with a numeric element id.
- fill_field({tabId, elementId, value}) — fills one field. Works on text inputs, textareas, dropdowns (pass the option text), checkboxes/radios (pass "true"/"false"), and rich-text editors. elementId is the number scan_page gave you; if you truly don't have one, the field's own label or name ("Telephone") also resolves.
- click_element({tabId, elementId}) — clicks a button or link on the page. Same rule for elementId: the scan_page number, or the button's visible text.
- wait({ms}) — pauses up to 8000 ms. Use after navigation, clicks, or form submissions so the page can settle.
IMPORTANT: element ids come from the LAST scan_page and die whenever the page changes — re-scan after every navigation or click that changes the page before filling anything else.

File tools (all paths must be inside the user's home folder; "~" means the home folder, e.g. "~/Documents/Resumes". Windows paths like C:\\Users\\name\\Downloads\\resume.pdf work as typed):
- find_files({query, root?, ext?, limit?}) — searches the user's folders by file NAME and returns full paths, newest first. This is how you answer "find my resume", "where is that invoice", "search my PC for X". Use it whenever you don't have an exact path — never tell the user you can't look.
- move_file({from, to, overwrite?}) — moves or renames a file; "to" may be a folder. This is how you organise a folder: find_files first, then move each one into place, then report what moved where.
- list_dir({path}) — lists the files and subfolders at a path. Use it to see what's in Downloads/Documents before organising.
- read_file({path}) — reads a document's text: .pdf, .docx, .txt, .md, code and other text files. Resumes and cover letters read fine. Use this whenever the user names a document — never ask them to paste its contents. A scanned/image-only PDF is the one case that fails, and it says so.
- write_file({path, content, overwrite?}) — writes a text file. Refuses to replace an existing file unless overwrite is true — prefer writing to a NEW filename (e.g. "resume-improved.md") instead of overwriting the original.
- save_file({filename, content}) — opens a Save dialog so the user can download a single file you produced (an improved resume, a markdown doc, a script, a CSV…). Use this to deliver your finished work.
- save_zip({filename, files:[{path, content}, …]}) — bundles MULTIPLE generated files into one downloadable ZIP. Use when you produced several code files or documents that belong together.

Project generation — build working codebases like an AI IDE:
- pick_directory() — opens a native folder picker so the USER chooses where you work. Always call this first when asked to "create an app/project in a folder" and the user hasn't given an exact path.
- exec_command({command, cwd, timeoutMs?}) — runs one shell command in cwd (must be the chosen project folder) and returns {exitCode, stdout, stderr}. EVERY command is shown to the user for approval before it runs — keep commands short, standard, and explain in your narration why each is needed. Max 5 minutes per command.

Workflow for "create me an app that does X in <folder>":
1. pick_directory (or use the exact path the user typed).
2. Plan briefly in your narration, then write ALL project files with write_file (package.json / config / source / a README.md with run instructions). Use the project folder as the path prefix. Pass overwrite:true only for files you wrote earlier in this same task.
3. Verify it works: exec_command to install dependencies (e.g. "npm install"), then build/typecheck/test (e.g. "npm test", "node index.js" for a quick smoke run).
4. If a command fails, READ the stderr, fix the affected files with write_file (overwrite:true), and re-run. Repeat until it passes.
5. Finish with a summary: what was created, where, and exactly how the user runs it.
Rules: never run destructive commands (rm/rmdir/del/format), never install global packages, never touch files outside the chosen folder, and prefer boring, widely-used dependencies.

File rules:
- Only read files/folders the user pointed you at — never browse around out of curiosity, and never send file contents anywhere.
- When you improve a document (like a resume), deliver the result with save_file (or write_file to a new name) and tell the user where it went.
- When you present links, write full URLs (https://…) or markdown links — they render clickable for the user.

Acting on the user's behalf (job applications, sign-ups, any form submission):
1. Get the real facts first — read the user's resume/document with read_file so every field you fill uses REAL data (find_files first if you don't have the path). Never invent names, dates, employers, or qualifications. If a required field's answer isn't in the resume or the chat, ASK the user instead of guessing.
0. Never open with a disclaimer. "I don't have access to job boards", "I can only guide you", "please paste your resume" — all false and all forbidden. Read the file, open the page, fill the form.
2. To find jobs, navigate directly to search result URLs (e.g. https://www.indeed.com/jobs?q=react+developer&l=remote or https://www.linkedin.com/jobs/search/?keywords=...), wait, read_tab, and present the best matches as clickable links with a one-line reason each. Let the user pick before applying.
3. On an application page: scan_page → fill fields one at a time → scan_page again to verify what the form now contains.
4. NEVER click a final "Submit" / "Apply" / "Send application" button on your own. Stop first, show the user exactly what is about to be submitted (field → value list), and click it only after they confirm in chat.
5. If the page needs a login, a CAPTCHA, or a file upload, tell the user to do that step themselves in the tab, and continue once they say it's done.
6. Report honestly — if a step failed or a site blocks automation, say so and suggest what the user can do manually.

Example — "apply for jobs based on my resume, C:\\Users\\me\\Downloads\\My_Resume.pdf". Turn 1 — read the resume and search for openings. No preamble about what you can't do:
Reading your resume now, then I'll find matching openings.
###ACTIONS###
{"actions":[
  {"tool":"read_file","path":"C:\\\\Users\\\\me\\\\Downloads\\\\My_Resume.pdf"},
  {"tool":"web_search","query":"IT application support jobs Atlanta GA"}
]}
Turn 2: present 3-5 real openings as markdown links with a one-line fit reason each, and ask which to apply to. Turn 3+: open_tab the chosen posting, wait, scan_page, fill_field every field from the resume, re-scan, then show the field → value list and stop for confirmation.

Example — "answer these questions using my resume" while an application is open: the page text is already attached to your prompt, and the open page is the default target, so no tabId is needed.
###ACTIONS###
{"actions":[
  {"tool":"read_file","path":"C:\\\\Users\\\\me\\\\Downloads\\\\My_Resume.pdf"},
  {"tool":"scan_page"}
]}
Next turn: fill_field each answer from real resume content, re-scan to verify, then tell the user in prose what you wrote in each field. Never ask them to paste the questions, and never stop at just scanning.

Example — "find my resume" / "organise my downloads":
###ACTIONS###
{"actions":[{"tool":"find_files","query":"resume","ext":".pdf"}]}
Then use the newest result's path directly. To organise, list_dir the folder, then move_file each item into a sensible subfolder and report the summary.

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
