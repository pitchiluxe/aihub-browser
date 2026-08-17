import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, X } from 'lucide-react'
import Markdown from './Markdown'

// One chat bubble, used by every chat surface in the app — the assistant
// panel, Agent Mode, Research. Before this existed each page had its own
// renderer: the assistant got full GitHub-flavoured markdown while an agent's
// answer came out as pre-wrapped plain text, so the same model asked the same
// question produced a table in one place and a wall of pipes in the other.
//
// Everything a message can do lives here now: markdown with tables and fenced
// code, copy, and attached images. Adding a surface means using this, not
// writing a fourth renderer.

export interface ChatBubbleProps {
  role: 'user' | 'assistant'
  content: string
  /** Data URLs the user attached to this turn. */
  images?: string[]
  /** The surface's colour — an agent's, or the theme accent. */
  accent?: string
  /** Rendered to the left of an assistant bubble. */
  avatar?: React.ReactNode
  onNavigate?: (url: string) => void
  /** Extra chrome inside the bubble, under the text (step chips, sources). */
  children?: React.ReactNode
  /** Hides the copy button — for notices with nothing worth copying. */
  copyable?: boolean
  maxWidth?: string
}

export default function ChatMessage({
  role, content, images, accent, avatar, onNavigate, children, copyable = true, maxWidth,
}: ChatBubbleProps) {
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [zoomed, setZoomed] = useState<string | null>(null)
  const isUser = role === 'user'

  const copy = () => {
    // The markdown source, not the rendered DOM: pasting into a document or
    // another chat should give back the table, not its flattened text.
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-start', gap: 8 }}
    >
      {!isUser && avatar}

      <div style={{ minWidth: 0, maxWidth: maxWidth || (isUser ? '82%' : '94%'), display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        <div style={isUser ? {
          borderRadius: 14, borderTopRightRadius: 4, padding: '9px 12px',
          fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
          background: accent
            ? `linear-gradient(135deg, ${accent}d0, ${accent}a8)`
            : 'linear-gradient(135deg, rgb(var(--ds-accent) / 0.82), rgb(var(--ds-accent-2) / 0.72))',
          color: '#fff', boxShadow: '0 2px 14px rgb(var(--ds-accent) / 0.22)',
          userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
          wordBreak: 'break-word', overflowWrap: 'break-word',
        } : {
          // No pre-wrap on assistant bubbles: markdown lays itself out, and
          // pre-wrap would double every blank line between paragraphs.
          minWidth: 0, borderRadius: 14, borderTopLeftRadius: 4, padding: '9px 12px',
          fontSize: 12.5, lineHeight: 1.55,
          background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)',
          color: 'rgb(var(--ds-text-2))',
          userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
          overflow: 'hidden', wordBreak: 'break-word', overflowWrap: 'break-word',
        }}>
          {!!images?.length && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: content ? 8 : 0 }}>
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`Attachment ${i + 1}`}
                  onClick={() => setZoomed(src)}
                  style={{
                    maxWidth: 150, maxHeight: 150, borderRadius: 9, cursor: 'zoom-in',
                    border: '1px solid rgba(255,255,255,0.18)', objectFit: 'cover',
                  }}
                />
              ))}
            </div>
          )}

          {!!content && (isUser
            ? <span>{content}</span>
            : <Markdown content={content} onNavigate={onNavigate || (() => {})} />)}

          {children}
        </div>

        {/* The copy button sits under the bubble rather than inside it, so it
            can never overlap a table or a code block's own copy control. */}
        {copyable && !!content && (
          <button
            onClick={copy}
            title="Copy this message"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, marginTop: 3,
              padding: '2px 6px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: 'transparent', fontSize: 10, fontWeight: 600,
              color: copied ? '#34d399' : 'rgb(var(--ds-text-4))',
              opacity: copied ? 1 : hovered ? 0.85 : 0,
              transition: 'opacity 0.12s',
            }}
          >
            {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
          </button>
        )}
      </div>

      {zoomed && createPortal(
        <div
          onClick={() => setZoomed(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 40,
            background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)', cursor: 'zoom-out',
          }}
        >
          <img src={zoomed} alt="Attachment" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
          <button
            onClick={() => setZoomed(null)}
            style={{
              position: 'absolute', top: 20, right: 20, width: 32, height: 32, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
            }}
          >
            <X size={15} />
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
