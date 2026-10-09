import { parse } from 'parse5'
import { MONITOR_LIMITS } from '../../../shared/research/monitorTypes'

type HtmlNode = { nodeName?: string; tagName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] }
const excluded = new Set(['script', 'style', 'noscript', 'template', 'svg', 'form', 'input', 'textarea', 'select', 'option', 'button', 'iframe', 'object', 'embed'])
function hidden(node: HtmlNode): boolean {
  const attrs = new Map((node.attrs || []).map(a => [a.name.toLowerCase(), a.value.toLowerCase()]))
  const style = attrs.get('style') || ''
  return attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || (attrs.has('contenteditable') && attrs.get('contenteditable') !== 'false') || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i.test(style)
}

export function extractPublicText(html: string): { text: string; truncated: boolean } {
  const root = parse(html) as unknown as HtmlNode
  const find = (node: HtmlNode, tag: string, visible: boolean, budget: { count: number }): HtmlNode | undefined => {
    if (++budget.count > 50_000 || !visible || excluded.has(node.tagName || '') || hidden(node)) return undefined
    if (node.tagName === tag) return node
    for (const child of node.childNodes || []) {
      const found = find(child, tag, true, budget)
      if (found) return found
    }
    return undefined
  }
  const budget = { count: 0 }
  const content = find(root, 'article', true, budget) || find(root, 'main', true, budget) || find(root, 'body', true, budget) || root
  let count = 0, length = 0, truncated = false
  const blocks: string[] = []
  const walk = (node: HtmlNode, ancestorsVisible: boolean) => {
    if (++count > 50_000 || length >= MONITOR_LIMITS.chars) { truncated = true; return }
    if (!ancestorsVisible || excluded.has(node.tagName || '') || hidden(node)) return
    if (node.nodeName === '#text') {
      const value = (node.value || '').replace(/\s+/g, ' ').trim()
      if (!value) return
      const remaining = MONITOR_LIMITS.chars - length
      const chunk = value.slice(0, remaining)
      if (chunk) { blocks.push(chunk); length += chunk.length }
      if (chunk.length < value.length) truncated = true
      return
    }
    const block = /^(?:article|main|section|p|h[1-6]|li|blockquote|pre|div|tr|td|th)$/.test(node.tagName || '')
    if (block) blocks.push('\n')
    for (const child of node.childNodes || []) {
      if (length >= MONITOR_LIMITS.chars || count >= 50_000) { truncated = true; break }
      walk(child, true)
    }
    if (block) blocks.push('\n')
  }
  walk(content, true)
  const text = blocks.join('').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw Error('This page does not expose readable public HTML. Open the page and use Check loaded page instead.')
  return { text: text.slice(0, MONITOR_LIMITS.chars), truncated: truncated || text.length > MONITOR_LIMITS.chars }
}
