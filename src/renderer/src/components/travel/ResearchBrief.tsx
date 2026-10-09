import React, { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { normalizeAiMarkdown } from '../../services/markdownNormalize'
import type { Research } from './flightsRentals'

/** AI prose is presentation only. Only links to independently retrieved sources can open. */
export default function ResearchBrief({ research, onNavigate }: { research: Research; onNavigate: (url: string) => void }) {
  const allowed = useMemo(() => new Set(research.sources.map(s => s.url)), [research.sources])
  const content = useMemo(() => normalizeAiMarkdown(research.text), [research.text])
  return <div className="fare-brief"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => href && allowed.has(href) ? <button className="fare-source-link" onClick={() => onNavigate(href)}>{children}</button> : <span>{children}</span>,
    img: () => null,
    table: ({ children }) => <div className="fare-table-scroll"><table>{children}</table></div>,
  }}>{content}</ReactMarkdown></div>
}
