import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import TradePlanCard, { parseTradePlan } from './TradePlanCard'
import remarkGfm from 'remark-gfm'
import { Copy, Check, Download, ExternalLink } from 'lucide-react'

// Full GitHub-flavored markdown renderer for AI chat messages — tables,
// fenced code with copy button, headings, lists, blockquotes, task lists.
// Links open inside the browser (new tab) via onNavigate, never externally.

interface Props {
  content: string
  onNavigate: (url: string) => void
}

export default function Markdown({ content, onNavigate }: Props) {
  return (
    <div className="aihub-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <button
              onClick={() => href && onNavigate(href)}
              title={href}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: 'rgb(var(--ds-accent-soft))', textDecoration: 'underline',
                textUnderlineOffset: 2, fontSize: 'inherit', fontWeight: 500,
                display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'baseline',
                wordBreak: 'break-word', textAlign: 'left',
              }}
            >
              {children}
              <ExternalLink size={9} style={{ flexShrink: 0, opacity: 0.7 }} />
            </button>
          ),

          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '8px 0', borderRadius: 10, border: '1px solid var(--ds-border)' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5, lineHeight: 1.45 }}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{ background: 'rgb(var(--ds-accent) / 0.12)' }}>{children}</thead>
          ),
          th: ({ children }) => (
            <th style={{
              padding: '7px 10px', textAlign: 'left', fontWeight: 700,
              color: 'rgb(var(--ds-accent-soft))', borderBottom: '1.5px solid rgb(var(--ds-accent) / 0.25)',
              whiteSpace: 'nowrap',
            }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{
              padding: '6px 10px', color: 'rgb(var(--ds-text-2))',
              borderBottom: '1px solid var(--ds-glass-sm)', verticalAlign: 'top',
            }}>{children}</td>
          ),
          tr: ({ children }) => <tr>{children}</tr>,

          code: (props: any) => {
            const { inline, className, children } = props
            const text = String(children ?? '').replace(/\n$/, '')
            // react-markdown v9 drops `inline`; block code always arrives
            // wrapped in <pre> (handled below), so single-line no-lang code
            // with no newlines is treated as inline.
            const isBlock = inline === false || /language-/.test(className || '') || text.includes('\n')
            if (!isBlock) {
              return (
                <code style={{
                  background: 'rgb(var(--ds-accent) / 0.12)', color: 'rgb(var(--ds-accent-soft))',
                  borderRadius: 5, padding: '1px 5px', fontSize: '0.92em',
                  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                }}>{text}</code>
              )
            }
            const lang = (className || '').replace('language-', '')
            // A ```trade-plan block is data, not code: render the plan as a
            // chart with its levels drawn, so the numbers can be checked
            // against the chart they were read from.
            if (lang === 'trade-plan') {
              const plan = parseTradePlan(text)
              if (plan) return <TradePlanCard plan={plan} />
            }
            // The fence info line may carry a filename after the language:
            // ```python resume.py — used as the download name.
            const [, filename] = (props.node?.data?.meta ?? '').split(/\s+/)
            return <CodeBlock text={text} lang={lang} filename={filename} />
          },
          pre: ({ children }) => <>{children}</>,

          h1: ({ children }) => <div style={{ fontSize: 15, fontWeight: 800, color: 'rgb(var(--ds-text-1, var(--ds-text-2)))', margin: '10px 0 4px' }}>{children}</div>,
          h2: ({ children }) => <div style={{ fontSize: 13.5, fontWeight: 700, color: 'rgb(var(--ds-text-2))', margin: '10px 0 4px' }}>{children}</div>,
          h3: ({ children }) => <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--ds-text-2))', margin: '8px 0 3px' }}>{children}</div>,
          h4: ({ children }) => <div style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--ds-text-3))', margin: '6px 0 2px' }}>{children}</div>,

          p:  ({ children }) => <p style={{ margin: '4px 0', lineHeight: 1.55 }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</ol>,
          li: ({ children }) => <li style={{ lineHeight: 1.5 }}>{children}</li>,

          blockquote: ({ children }) => (
            <blockquote style={{
              margin: '6px 0', padding: '4px 10px',
              borderLeft: '3px solid rgb(var(--ds-accent) / 0.5)',
              background: 'rgb(var(--ds-accent) / 0.06)', borderRadius: '0 8px 8px 0',
              color: 'rgb(var(--ds-text-3))',
            }}>{children}</blockquote>
          ),

          hr: () => <div style={{ height: 1, background: 'var(--ds-border)', margin: '10px 0' }} />,

          strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'rgb(var(--ds-text-2))' }}>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// Extensions for the languages a model actually emits, so a downloaded block
// opens in the right editor instead of as `snippet.txt`.
const LANG_EXT: Record<string, string> = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx',
  python: 'py', py: 'py', markdown: 'md', md: 'md', html: 'html', css: 'css',
  json: 'json', bash: 'sh', sh: 'sh', shell: 'sh', powershell: 'ps1', sql: 'sql',
  java: 'java', csharp: 'cs', cs: 'cs', cpp: 'cpp', 'c++': 'cpp', c: 'c',
  go: 'go', rust: 'rs', ruby: 'rb', php: 'php', yaml: 'yml', yml: 'yml',
  xml: 'xml', csv: 'csv', text: 'txt', txt: 'txt',
}

function CodeBlock({ text, lang, filename }: { text: string; lang: string; filename?: string }) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }).catch(() => {})
  }
  // A generated file is worth more as a file than as text on a screen. The
  // main process owns the save dialog; if it is not there (a preload without
  // it), the button simply does not appear rather than failing on click.
  const saveText = (window as any).electronAPI?.file?.saveText
  const download = async () => {
    const name = filename && /^[\w.\- ]+\.\w+$/.test(filename)
      ? filename
      : `snippet.${LANG_EXT[lang.toLowerCase()] || 'txt'}`
    const res = await saveText({ filename: name, content: text }).catch(() => null)
    if (res?.success) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }
  return (
    <div style={{ margin: '8px 0', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ds-border)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 10px', background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid var(--ds-glass-sm)',
      }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgb(var(--ds-text-4))' }}>
          {filename || lang || 'code'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!!saveText && (
            <button onClick={download} title="Save as a file" style={{
              display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
              cursor: 'pointer', color: saved ? '#34d399' : 'rgb(var(--ds-text-4))', fontSize: 10, padding: 2,
            }}>
              {saved ? <Check size={11} /> : <Download size={11} />}
              {saved ? 'Saved' : 'Save'}
            </button>
          )}
          <button onClick={copy} title="Copy code" style={{
            display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
            cursor: 'pointer', color: copied ? '#34d399' : 'rgb(var(--ds-text-4))', fontSize: 10, padding: 2,
          }}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </div>
      <pre style={{
        margin: 0, padding: '8px 10px', overflowX: 'auto',
        background: 'rgba(0,0,0,0.35)', fontSize: 11, lineHeight: 1.55,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        color: 'rgb(var(--ds-text-2))', userSelect: 'text',
      }}>
        <code>{text}</code>
      </pre>
    </div>
  )
}
