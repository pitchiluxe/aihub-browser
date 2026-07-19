import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, ExternalLink } from 'lucide-react'

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
            return <CodeBlock text={text} lang={(className || '').replace('language-', '')} />
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

function CodeBlock({ text, lang }: { text: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }).catch(() => {})
  }
  return (
    <div style={{ margin: '8px 0', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ds-border)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 10px', background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid var(--ds-glass-sm)',
      }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgb(var(--ds-text-4))' }}>
          {lang || 'code'}
        </span>
        <button onClick={copy} title="Copy code" style={{
          display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          cursor: 'pointer', color: copied ? '#34d399' : 'rgb(var(--ds-text-4))', fontSize: 10, padding: 2,
        }}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
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
