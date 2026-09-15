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
  /** Optional accent color for theming (e.g., agent color, channel accent) */
  accent?: string
}

// Language color mapping for code block headers
const LANG_COLORS: Record<string, string> = {
  javascript: '#f7df1e', js: '#f7df1e', typescript: '#3178c6', ts: '#3178c6',
  tsx: '#3178c6', jsx: '#61dafb', python: '#3776ab', py: '#3776ab',
  markdown: '#083fa1', md: '#083fa1', html: '#e34c26', css: '#1572b6',
  json: '#292929', bash: '#4eaa25', sh: '#4eaa25', shell: '#4eaa25',
  powershell: '#012456', ps1: '#012456', sql: '#e38c00', java: '#b07219',
  csharp: '#178600', cs: '#178600', cpp: '#f34b7d', 'c++': '#f34b7d',
  c: '#555555', go: '#00add8', rust: '#dea584', ruby: '#701516',
  php: '#4f5d95', yaml: '#cb171e', yml: '#cb171e', xml: '#0060ac',
  csv: '#237346', text: '#666666', txt: '#666666',
}

export default function Markdown({ content, onNavigate, accent }: Props) {
  return (
    <div className="aihub-md" style={accent ? { ['--md-accent' as string]: accent } : undefined}>
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
            <div style={{
              overflowX: 'auto', margin: '10px 0', borderRadius: 10,
              border: '1px solid rgb(var(--ds-accent) / 0.18)',
              boxShadow: '0 1px 0 rgb(var(--ds-accent) / 0.06) inset',
            }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5, lineHeight: 1.5 }}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{
              background: 'linear-gradient(180deg, rgb(var(--ds-accent) / 0.16), rgb(var(--ds-accent) / 0.10))',
            }}>{children}</thead>
          ),
          th: ({ children }) => (
            <th style={{
              padding: '8px 11px', textAlign: 'left', fontWeight: 700,
              color: 'rgb(var(--ds-accent-soft))', borderBottom: '1.5px solid rgb(var(--ds-accent) / 0.28)',
              whiteSpace: 'nowrap', fontSize: 10.5, letterSpacing: '0.02em',
            }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{
              padding: '7px 11px', color: 'rgb(var(--ds-text-2))',
              borderBottom: '1px solid rgb(var(--ds-glass-sm))', verticalAlign: 'top',
            }}>{children}</td>
          ),
          tr: ({ children }) => <tr style={{ transition: 'background 0.1s' }}>{children}</tr>,
          tbody: ({ children }) => <tbody>{children}</tbody>,

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
                  borderRadius: 5, padding: '1px 6px', fontSize: '0.9em',
                  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                  border: '1px solid rgb(var(--ds-accent) / 0.10)',
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

          h1: ({ children }) => (
            <div style={{
              fontSize: 16, fontWeight: 800, color: 'rgb(var(--ds-text-1, var(--ds-text-2)))',
              margin: '12px 0 6px', paddingBottom: 4,
              borderBottom: '1px solid rgb(var(--ds-glass-sm))',
            }}>{children}</div>
          ),
          h2: ({ children }) => (
            <div style={{
              fontSize: 14, fontWeight: 800, color: 'rgb(var(--ds-accent-soft))',
              margin: '12px 0 5px', letterSpacing: '-0.01em',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 4, height: 14, borderRadius: 2,
                background: 'linear-gradient(180deg, rgb(var(--ds-accent)), rgb(var(--ds-accent-2)))',
                flexShrink: 0,
              }} />
              {children}
            </div>
          ),
          h3: ({ children }) => (
            <div style={{
              fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--ds-text-1))',
              margin: '10px 0 4px',
            }}>{children}</div>
          ),
          h4: ({ children }) => (
            <div style={{
              fontSize: 12, fontWeight: 700, color: 'rgb(var(--ds-text-3))',
              margin: '8px 0 3px', textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>{children}</div>
          ),

          p:  ({ children }) => <p style={{ margin: '5px 0', lineHeight: 1.6 }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: '5px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '5px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</ol>,
          li: ({ children }) => <li style={{ lineHeight: 1.55 }}>{children}</li>,

          blockquote: ({ children }) => (
            <blockquote style={{
              margin: '8px 0', padding: '8px 12px',
              borderLeft: '3px solid rgb(var(--ds-accent) / 0.6)',
              background: 'linear-gradient(90deg, rgb(var(--ds-accent) / 0.08), rgb(var(--ds-accent) / 0.02))',
              borderRadius: '0 10px 10px 0',
              color: 'rgb(var(--ds-text-2))',
              fontStyle: 'italic',
            }}>{children}</blockquote>
          ),

          hr: () => (
            <div style={{
              height: 1, margin: '12px 0',
              background: 'linear-gradient(90deg, transparent, rgb(var(--ds-glass-md)), transparent)',
            }} />
          ),

          strong: ({ children }) => (
            <strong style={{ fontWeight: 700, color: 'rgb(var(--ds-text-1))' }}>{children}</strong>
          ),
          em: ({ children }) => <em style={{ color: 'rgb(var(--ds-text-2))' }}>{children}</em>,

          // Task list support (GFM)
          input: ({ checked, ...props }: any) => (
            <input
              type="checkbox"
              checked={!!checked}
              readOnly
              {...props}
              style={{
                marginRight: 6, accentColor: 'rgb(var(--ds-accent))',
                verticalAlign: 'middle',
              }}
            />
          ),
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

  // Language color for the header dot
  const langColor = LANG_COLORS[lang.toLowerCase()] || 'rgb(var(--ds-text-4))'
  const displayLabel = filename || lang || 'code'

  return (
    <div style={{
      margin: '10px 0', borderRadius: 10, overflow: 'hidden',
      border: '1px solid rgb(var(--ds-accent) / 0.15)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.22))',
        borderBottom: '1px solid rgb(var(--ds-glass-sm))',
      }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 7,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
          textTransform: 'lowercase', color: 'rgb(var(--ds-text-3))',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: langColor,
            boxShadow: `0 0 6px ${langColor}88`,
          }} />
          {displayLabel}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!!saveText && (
            <button onClick={download} title="Save as a file" style={{
              display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
              cursor: 'pointer', color: saved ? '#34d399' : 'rgb(var(--ds-text-4))', fontSize: 10,
              padding: '3px 6px', borderRadius: 6,
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--ds-glass-sm))' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              {saved ? <Check size={11} /> : <Download size={11} />}
              {saved ? 'Saved' : 'Save'}
            </button>
          )}
          <button onClick={copy} title="Copy code" style={{
            display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
            cursor: 'pointer', color: copied ? '#34d399' : 'rgb(var(--ds-text-4))', fontSize: 10,
            padding: '3px 6px', borderRadius: 6,
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--ds-glass-sm))' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </div>
      <pre style={{
        margin: 0, padding: '10px 12px', overflowX: 'auto',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.38), rgba(0,0,0,0.32))',
        fontSize: 11.5, lineHeight: 1.6,
        fontFamily: 'ui-monospace, "Cascadia Code", SFMono-Regular, Consolas, monospace',
        color: 'rgb(var(--ds-text-2))', userSelect: 'text',
      }}>
        <code>{text}</code>
      </pre>
    </div>
  )
}
