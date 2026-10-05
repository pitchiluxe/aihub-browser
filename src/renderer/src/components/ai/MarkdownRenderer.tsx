import React, { useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import TradePlanCard, { parseTradePlan } from './TradePlanCard'
import remarkGfm from 'remark-gfm'
import { Copy, Check, Download, ExternalLink, Info, Lightbulb, Sparkles, AlertTriangle, ShieldAlert, type LucideIcon } from 'lucide-react'
import { normalizeAiMarkdown, calloutKind, cellTone, type CalloutKind } from '../../services/markdownNormalize'
import { highlight } from '../../services/syntaxHighlight'
import './aiMarkdown.css'

// Full GitHub-flavored markdown renderer for AI chat messages — tables,
// fenced code with copy button, headings, lists, blockquotes, task lists.
// Links open inside the browser (new tab) via onNavigate, never externally.
// Looks live in aiMarkdown.css; this file only decides structure and which
// class a piece of content earns (a callout's kind, a table cell's tone).

interface Props {
  content: string
  onNavigate: (url: string) => void
  /** Optional accent color for theming (e.g., agent color, channel accent) */
  accent?: string
  /** The text is still arriving (see normalizeAiMarkdown). */
  streaming?: boolean
  /** Takes over rendering of a link; return null to fall back to the default. */
  renderLink?: (href: string, children: React.ReactNode) => React.ReactNode | null
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

const CALLOUT_ICON: Record<CalloutKind, LucideIcon> = {
  note: Info, tip: Lightbulb, important: Sparkles, warning: AlertTriangle, caution: ShieldAlert,
}

/** Plain text of a hast node — what the reader will see, minus markup. */
function textOf(node: any): string {
  if (!node) return ''
  if (node.type === 'text') return node.value
  return (node.children ?? []).map(textOf).join('')
}

/** Cells whose only content is text — a bold or linked cell keeps its own look. */
const isPlainCell = (node: any) => (node?.children ?? []).every((c: any) => c.type === 'text')

export default function Markdown({ content, onNavigate, accent, streaming, renderLink }: Props) {
  // Repair the tables and fences small models get wrong before GFM sees them.
  const md = useMemo(() => normalizeAiMarkdown(content, { streaming }), [content, streaming])

  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => (href && renderLink?.(href, children)) ?? (
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

    table: ({ node, ...rest }) => (
      <div className="md-table-wrap"><table {...rest} /></div>
    ),
    td: ({ node, children, ...rest }) => {
      const tone = isPlainCell(node) ? cellTone(textOf(node)) : null
      if (!tone) return <td {...rest}>{children}</td>
      return (
        <td {...rest}>
          {tone === 'up' || tone === 'down'
            ? <span className={`md-${tone}`}>{children}</span>
            : <span className={`md-chip md-${tone}`}>{children}</span>}
        </td>
      )
    },

    blockquote: ({ node, children }) => {
      const kind = calloutKind(textOf(node))
      if (!kind) return <blockquote>{children}</blockquote>
      const Icon = CALLOUT_ICON[kind]
      return (
        <blockquote className={`md-callout md-${kind}`}>
          <span className="md-callout-icon"><Icon size={14} /></span>
          <div className="md-callout-body">{children}</div>
        </blockquote>
      )
    },

    code: (props: any) => {
      const { inline, className, children } = props
      const text = String(children ?? '').replace(/\n$/, '')
      // react-markdown v9 drops `inline`; block code always arrives
      // wrapped in <pre> (handled below), so single-line no-lang code
      // with no newlines is treated as inline.
      const isBlock = inline === false || /language-/.test(className || '') || text.includes('\n')
      if (!isBlock) return <code className="md-inline">{text}</code>
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

    input: ({ node, checked, ...rest }) => <input {...rest} type="checkbox" checked={!!checked} readOnly />,
  }), [onNavigate, renderLink])

  return (
    <div className="aihub-md" style={accent ? { ['--md-accent' as string]: accent } : undefined}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {md}
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
  const tokens = useMemo(() => highlight(text, lang), [text, lang])
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
    <div className="md-code" style={{
      margin: '10px 0', borderRadius: 10, overflow: 'hidden',
      border: '1px solid rgb(var(--ds-accent) / 0.15)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'var(--md-code-head)',
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
        background: 'var(--md-code-bg)',
        fontSize: 11.5, lineHeight: 1.6,
        fontFamily: 'ui-monospace, "Cascadia Code", SFMono-Regular, Consolas, monospace',
        color: 'rgb(var(--ds-text-2))', userSelect: 'text',
      }}>
        <code>
          {tokens.map((t, i) => t.type === 'plain' ? t.text : <span key={i} className={`tk-${t.type}`}>{t.text}</span>)}
        </code>
      </pre>
    </div>
  )
}
