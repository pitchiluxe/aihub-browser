import { parse } from 'parse5'
import type { AgentReport, SecurityFinding } from '../../shared/security'

export interface PageEvidence { url: string; passwordForms?: string[] }
const finding = (code: string, severity: SecurityFinding['severity'], title: string, detail: string): SecurityFinding => ({ code, severity, title, detail })

export function inspectPage(page: PageEvidence): SecurityFinding[] {
  const out: SecurityFinding[] = []
  let url: URL
  try { url = new URL(page.url) } catch { return out }
  if (!['http:', 'https:'].includes(url.protocol)) return out
  if (url.username || url.password) out.push(finding('url-credentials', 'high', 'Misleading URL credentials', 'The real destination appears after the @ character.'))
  if (url.hostname.includes('xn--')) out.push(finding('punycode', 'warning', 'Internationalized domain', 'This domain uses encoded international characters. Verify its spelling before signing in.'))
  for (const raw of (page.passwordForms || []).slice(0, 20)) {
    let action: URL
    try { action = new URL(raw, url) } catch { continue }
    if (url.protocol === 'http:' || action.protocol !== 'https:') out.push(finding('insecure-password', 'high', 'Password form uses an insecure destination', 'A password could be sent without HTTPS protection.'))
    if (action.origin !== url.origin) out.push(finding('external-password', 'warning', 'Password form sends to another origin', `Verify the sign-in provider: ${action.origin.slice(0, 160)}`))
  }
  return out.filter((f, i) => out.findIndex(x => x.code === f.code) === i)
}

/** Static indicators only: no page scripts or fetched resources execute here. */
export function inspectHtml(html: string): SecurityFinding[] {
  const out: SecurityFinding[] = []
  const add = (f: SecurityFinding) => { if (!out.some(x => x.code === f.code)) out.push(f) }
  const walk = (node: any) => {
    const attrs = Object.fromEntries((node.attrs || []).map((a: any) => [a.name, a.value])) as Record<string, string>
    if (node.tagName === 'script' && /^(?:https?:)?\/\//i.test(attrs.src || '')) add(finding('remote-script', 'warning', 'Loads remote JavaScript', 'This local file can execute scripts supplied by an external website.'))
    if (node.tagName === 'script') {
      const text = (node.childNodes || []).map((n: any) => n.value || '').join('')
      if (/\b(?:eval|Function)\s*\(|\batob\s*\(/i.test(text)) add(finding('encoded-script', 'warning', 'Dynamic or encoded JavaScript', 'Dynamic code execution can conceal behavior. This is an indicator, not a malware verdict.'))
    }
    if (node.tagName === 'input' && (attrs.type || '').toLowerCase() === 'password') add(finding('html-password', 'high', 'Local file requests a password', 'Verify who supplied this file before entering credentials.'))
    if (node.tagName === 'iframe' && /^(?:https?:)?\/\//i.test(attrs.src || '')) add(finding('remote-frame', 'warning', 'Embeds an external page', 'An external page may display sign-in prompts or other untrusted content.'))
    for (const child of node.childNodes || []) walk(child)
    if (node.content) walk(node.content)
  }
  walk(parse(html.slice(0, 2_000_000)))
  return out
}

export function localOllamaUrl(base: string, model: string): string {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error('Security analysis requires a local Ollama server on loopback.')
  if (!model || model.length > 160 || /cloud/i.test(model)) throw Error('Choose an installed local Ollama model in Settings.')
  return `${url.origin}/api/chat`
}

export function parseAgentReport(text: string): AgentReport {
  let raw: any
  try { raw = JSON.parse(text) } catch { throw Error('The local model returned an incomplete report. Try again or choose a stronger local model. No action was taken.') }
  if (!raw || typeof raw.summary !== 'string' || !raw.summary.trim() || raw.summary.length > 4000 || !Array.isArray(raw.recommendations) || raw.recommendations.length > 8 || !raw.recommendations.every((r: unknown) => typeof r === 'string' && r.length > 0 && r.length <= 600)) throw Error('Ollama returned an invalid security report. No action was taken.')
  return { summary: raw.summary, recommendations: raw.recommendations }
}

export const PAGE_EVIDENCE_SCRIPT = `JSON.stringify({url:location.href,passwordForms:Array.from(document.forms).filter(f=>f.querySelector('input[type="password"]')).slice(0,20).map(f=>f.action.slice(0,2048))})`
