/** Self-contained: serialized into the isolated page context on explicit clipping. */
export function extractStructuredClip(): { text: string; markdown: string } {
  const source = document.querySelector('article, main, [role="main"]') || document.body
  if (!source) return { text: '', markdown: '' }
  const root = source.cloneNode(true) as HTMLElement
  root.querySelectorAll('script,style,noscript,iframe,svg,nav,footer,aside,form,button,[hidden],[aria-hidden="true"],[role="navigation"],[role="banner"],[role="contentinfo"],.advertisement,.adsbygoogle').forEach(node => node.remove())
  const escape = (value: string) => value.replace(/([\\`*_[\]<>])/g, '\\$1')
  const url = (value: string | null) => {
    try {
      const parsed = new URL(value || '', document.baseURI)
      return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
        ? parsed.href.replace(/\(/g, '%28').replace(/\)/g, '%29') : ''
    } catch { return '' }
  }
  let visited = 0
  const render = (node: Node, depth = 0): string => {
    if (++visited > 20_000 || depth > 60) return ''
    if (node.nodeType === Node.TEXT_NODE) return escape((node.textContent || '').replace(/\s+/g, ' '))
    if (!(node instanceof Element)) return ''
    const tag = node.tagName.toLowerCase()
    if (tag === 'pre') {
      const text = (node.textContent || '').slice(0, 30_000)
      const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) || []).map(run => run.length + 1)))
      return `\n\n${fence}\n${text}\n${fence}\n\n`
    }
    if (tag === 'img') {
      const src = url(node.getAttribute('src'))
      return src ? `![${escape(node.getAttribute('alt') || '')}](${src})` : ''
    }
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).slice(0, 200).map(row =>
        Array.from(row.children).filter(cell => /^(TD|TH)$/.test(cell.tagName)).slice(0, 30)
          .map(cell => render(cell, depth + 1).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')))
      if (!rows.length) return ''
      const width = Math.max(...rows.map(row => row.length))
      const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] || '').join(' | ')} |`
      return `\n\n${[line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n')}\n\n`
    }
    const body = Array.from(node.childNodes).map(child => render(child, depth + 1)).join('')
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${body.trim()}\n\n`
    if (tag === 'a') { const href = url(node.getAttribute('href')); return href ? `[${body.trim()}](${href})` : body }
    if (tag === 'strong' || tag === 'b') return `**${body}**`
    if (tag === 'em' || tag === 'i') return `*${body}*`
    if (tag === 'code') return '`` ' + (node.textContent || '').replace(/\n/g, ' ') + ' ``'
    if (tag === 'br') return '\n'
    if (tag === 'li') return `\n${node.parentElement?.tagName === 'OL' ? '1.' : '-'} ${body.trim()}\n`
    if (tag === 'blockquote') return '\n\n' + body.trim().split('\n').map(line => `> ${line}`).join('\n') + '\n\n'
    if (/^(p|div|section|article|main|ul|ol|tr)$/.test(tag)) return `\n\n${body.trim()}\n\n`
    return body
  }
  return {
    text: (root.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20_000),
    markdown: render(root).replace(/\n{3,}/g, '\n\n').trim().slice(0, 100_000),
  }
}
